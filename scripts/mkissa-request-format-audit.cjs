#!/usr/bin/env node
/** Read public static request-format metadata only; never execute website code. */
const path = require("node:path");
const ts = require("typescript");

/** Build candidate documents from module initializers, never execute JS or imported code.
 * Candidates are NOT a claim about runtime values; only their exact content hash may be used.
 */
function readDocuments(source) {
  if (typeof source !== "string" || source.length > 5 * 1024 * 1024) return [];
  const { readOperation } = require("./electron-mkissa-session-smoke");
  const ast = ts.createSourceFile("public.js", source, ts.ScriptTarget.ESNext, false, ts.ScriptKind.JS);
  if (ast.parseDiagnostics.length) return [];
  const constants = new Map();
  const candidates = [];
  let indexed = 0;
  function index(node, depth = 0) {
    if (++indexed > 200_000 || depth > 64) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const name = node.name.text;
      // Ambiguous/shadowed identifiers are not substituted.
      constants.set(name, constants.has(name) ? null : node.initializer);
    }
    if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isStringLiteral(node)) candidates.push(node);
    ts.forEachChild(node, child => index(child, depth + 1));
  }
  index(ast);
  let resolutionBudget = 100_000;
  function resolve(node, active = new Set(), depth = 0) {
    if (!node || depth > 24 || --resolutionBudget < 0) return null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text.length <= 16_384 ? node.text : null;
    if (ts.isIdentifier(node)) {
      if (active.has(node.text)) return null;
      return resolve(constants.get(node.text), new Set([...active, node.text]), depth + 1);
    }
    let parts;
    if (ts.isTemplateExpression(node)) {
      parts = [node.head.text];
      for (const span of node.templateSpans) parts.push(resolve(span.expression, active, depth + 1), span.literal.text);
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      parts = [resolve(node.left, active, depth + 1), resolve(node.right, active, depth + 1)];
    } else return null;
    if (parts.some(part => part == null) || parts.reduce((total, part) => total + part.length, 0) > 16_384) return null;
    return parts.join("");
  }
  const result = new Set();
  for (const value of candidates) {
    if (result.size >= 64) break;
    const document = resolve(value);
    if (document && readOperation(document)) result.add(document);
  }
  return [...result];
}

function staticShape(source) {
  const shape = { persistedQuery: false, omitQueryOption: false, explicitQueryRemoval: false,
    readDocuments: { shows: 0, show: 0, episode: 0 } };
  const ast = ts.createSourceFile("public-fixture.js", source, ts.ScriptTarget.ESNext, false, ts.ScriptKind.JS);
  let visited = 0;
  function visit(node, depth) {
    if (++visited > 200_000 || depth > 64) return;
    const property = ts.isPropertyAccessExpression(node) ? node.name.text
      : ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) ? node.name.text : null;
    if (property === "persistedQuery") shape.persistedQuery = true;
    if (["includeQuery", "omitQuery", "useGETForHashedQueries"].includes(property)) shape.omitQueryOption = true;
    if (ts.isDeleteExpression(node)) {
      const target = node.expression;
      if (ts.isPropertyAccessExpression(target) && target.name.text === "query"
        || ts.isElementAccessExpression(target) && ts.isStringLiteral(target.argumentExpression) && target.argumentExpression.text === "query") {
        shape.explicitQueryRemoval = true;
      }
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      // Export counts, not literals/documents/hashes. Do not interpret interpolated templates.
      const text = node.text;
      if (text.length <= 16_384 && !/\b(?:mutation|subscription)\b/.test(text)) {
        const root = /^(?:\s*query\b[^{}]*)?\s*\{\s*(shows|show|episode)\b/.exec(text)?.[1];
        if (root) shape.readDocuments[root]++;
      }
    }
    ts.forEachChild(node, child => visit(child, depth + 1));
  }
  visit(ast, 0);
  return shape;
}

async function loadPublicDocuments({ inspect } = {}) {
  const { findMkissaAppEntry, extractMkissaAssetReferences } = require(
    path.join(__dirname, "../dist-electron/apps/desktop/main/services/providers/mkissa-bundle"));
  const { requestDecision } = require("./electron-mkissa-session-smoke");
  const allowedOrigins = new Set(["https://mkissa.to", "https://cdn.mkissa.net"]);
  const deadline = Date.now() + 30_000;
  let total = 0;
  async function read(raw, maximum) {
    const url = new URL(raw);
    if (!allowedOrigins.has(url.origin) || url.username || url.password || url.port) throw new Error("Scope");
    if (Date.now() >= deadline) throw new Error("Deadline");
    const signal = AbortSignal.timeout(Math.min(12_000, deadline - Date.now()));
    const response = await fetch(url, { redirect: "manual", credentials: "omit", signal });
    if (response.status === 403 || response.status === 429) {
      console.log(JSON.stringify({ stage: "stopped", status: response.status, retry: false }));
      throw new Error("Access stop");
    }
    if (!response.ok || Number(response.headers.get("content-length")) > maximum) throw new Error("Response");
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.length; total += part.value.length;
        if (bytes > maximum || total > 12 * 1024 * 1024) throw new Error("Byte cap");
        chunks.push(Buffer.from(part.value));
      }
    } finally { await reader.cancel().catch(() => {}); }
    const source = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes));
    if (/^\s*</.test(source) && /cf-chl-|<title[^>]*>[^<]*(?:just a moment|attention required)/i.test(source)) throw new Error("Human check");
    return source;
  }
  const html = await read("https://mkissa.to/", 2 * 1024 * 1024);
  const entry = findMkissaAppEntry(html, "https://mkissa.to");
  if (!entry) throw new Error("Entry");
  const homeNodes = /nodes:\s*\[([\d,\s]+)\]/.exec(html)?.[1]?.split(",").map(Number).filter(Number.isSafeInteger) ?? [];
  const queue = [entry], visited = new Set();
  const shapes = [];
  const reviewedDocuments = new Set();
  while (queue.length && visited.size < 8) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    const url = new URL(current);
    if (!allowedOrigins.has(url.origin) || !/\.js$/.test(url.pathname)) throw new Error("Asset scope");
    const source = await read(current, 5 * 1024 * 1024);
    inspect?.(source);
    const shape = staticShape(source);
    const documents = readDocuments(source);
    for (const document of documents) if (reviewedDocuments.size < 128) reviewedDocuments.add(document);
    shapes.push({ ...shape, staticReadDocuments: documents.length,
      roots: Object.fromEntries(["shows", "show", "episode"].map(root => [root,
        documents.filter(document => new RegExp("\\{\\s*" + root + "\\b").test(document)).length])) });
    const children = extractMkissaAssetReferences(source, current).filter(child => {
      const parsed = new URL(child);
      return allowedOrigins.has(parsed.origin) && /\.js$/.test(parsed.pathname) && !visited.has(child) && !queue.includes(child);
    });
    if (current === entry && homeNodes.length) {
      queue.unshift(...children.filter(child => homeNodes.includes(Number(/\/nodes\/(\d+)\./.exec(child)?.[1]))).slice(0, 4));
    } else queue.unshift(...children.slice(0, Math.max(0, 48 - queue.length)));
    if (shapes.at(-1).staticReadDocuments > 0) break;
  }
  const example = "https://api.mkissa.net/api?extensions=" + encodeURIComponent(JSON.stringify({
    persistedQuery: { version: 1, sha256Hash: "a".repeat(64) },
  }));
  return { documents: [...reviewedDocuments], summary: { stage: "public-static-shapes", assets: shapes.length, bytes: total,
    shapes, guardBlocksHashOnly: requestDecision(example, "GET", "xhr").blockedReason === "api-query",
    protectedRequests: 0, websiteCodeExecuted: false } };
}

if (require.main === module) {
  if (process.argv.length === 3 && process.argv[2] === "--public") loadPublicDocuments().then(result => console.log(JSON.stringify(result.summary))).catch(() => {
    console.log('{"stage":"stopped","retry":false,"detailsOmitted":true}'); process.exitCode = 1;
  });
  else { console.log("Use --public for bounded public static-file inspection; no protected API calls."); process.exitCode = 1; }
}
module.exports = { staticShape, readDocuments, loadPublicDocuments };
