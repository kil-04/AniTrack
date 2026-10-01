import type { MkissaBuildInfo, MkissaCryptoScheme } from "./mkissa-crypto";

const IDENTIFIER = String.raw`[A-Za-z_$][\w$]*`;
const INTEGER_LITERAL = String.raw`-?\d+(?:[eE][+\-]?\d+)?`;
const CALL_SOURCE = String.raw`(${IDENTIFIER})\(\s*(${INTEGER_LITERAL})\s*(?:,\s*(${INTEGER_LITERAL})\s*)?\)`;
const CALL_REGEX = new RegExp(CALL_SOURCE, "g");
const SEED_REGEX = /^[A-Za-z0-9+/]{11}=$/;

interface BaseDecoder {
  tableName: string;
  offset: number;
}

interface DecoderAlias {
  baseName: string;
  argumentIndex: number;
  delta: number;
}

interface DecoderGraph {
  tables: Map<string, string[]>;
  bases: Map<string, BaseDecoder>;
  aliases: Map<string, DecoderAlias>;
}

interface SeedCandidate {
  seeds: [string, string, string, string];
  rotation: number;
  tableName: string;
  sourceIndex: number;
}

interface ParsedCall {
  name: string;
  arguments: number[];
  source: string;
}

class IntegerExpressionParser {
  private index = 0;
  private readonly value: string;

  constructor(value: string) {
    this.value = value;
  }

  parse(): number | null {
    const result = this.parseAdditive();
    this.skipWhitespace();
    return result !== null && this.index === this.value.length && Number.isSafeInteger(result)
      ? result
      : null;
  }

  private parseAdditive(): number | null {
    let left = this.parseMultiplicative();
    if (left === null) return null;
    while (true) {
      this.skipWhitespace();
      const operator = this.value[this.index];
      if (operator !== "+" && operator !== "-") return left;
      this.index++;
      const right = this.parseMultiplicative();
      if (right === null) return null;
      left = operator === "+" ? left + right : left - right;
      if (!Number.isSafeInteger(left)) return null;
    }
  }

  private parseMultiplicative(): number | null {
    let left = this.parseUnary();
    if (left === null) return null;
    while (true) {
      this.skipWhitespace();
      if (this.value[this.index] !== "*") return left;
      this.index++;
      const right = this.parseUnary();
      if (right === null) return null;
      left *= right;
      if (!Number.isSafeInteger(left)) return null;
    }
  }

  private parseUnary(): number | null {
    this.skipWhitespace();
    let sign = 1;
    while (this.value[this.index] === "+" || this.value[this.index] === "-") {
      if (this.value[this.index] === "-") sign *= -1;
      this.index++;
      this.skipWhitespace();
    }
    const value = this.parsePrimary();
    return value === null ? null : sign * value;
  }

  private parsePrimary(): number | null {
    this.skipWhitespace();
    if (this.value[this.index] === "(") {
      this.index++;
      const value = this.parseAdditive();
      this.skipWhitespace();
      if (this.value[this.index] !== ")") return null;
      this.index++;
      return value;
    }
    const match = /^\d+/.exec(this.value.slice(this.index));
    if (!match) return null;
    this.index += match[0].length;
    const value = Number(match[0]);
    return Number.isSafeInteger(value) ? value : null;
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.value[this.index] ?? "")) this.index++;
  }
}

function evaluateIntegerExpression(value: string): number | null {
  if (!/^[\d+*()\s-]+$/.test(value) || value.length > 200) return null;
  return new IntegerExpressionParser(value).parse();
}

function decodeEscapedCharacter(source: string, index: number): { value: string; next: number } | null {
  const marker = source[index];
  const simple: Record<string, string> = {
    "\\": "\\",
    "\"": "\"",
    "'": "'",
    n: "\n",
    r: "\r",
    t: "\t",
    b: "\b",
    f: "\f",
    v: "\v",
    "0": "\0",
  };
  if (marker in simple) return { value: simple[marker], next: index + 1 };
  if (marker === "x") {
    const hex = source.slice(index + 1, index + 3);
    return /^[a-f0-9]{2}$/i.test(hex)
      ? { value: String.fromCharCode(Number.parseInt(hex, 16)), next: index + 3 }
      : null;
  }
  if (marker === "u") {
    const hex = source.slice(index + 1, index + 5);
    return /^[a-f0-9]{4}$/i.test(hex)
      ? { value: String.fromCharCode(Number.parseInt(hex, 16)), next: index + 5 }
      : null;
  }
  return null;
}

/** Parse a JavaScript string array without compiling or executing any of it. */
function readStringArray(source: string, openBracket: number): string[] | null {
  const values: string[] = [];
  let index = openBracket + 1;
  while (index < source.length) {
    const character = source[index];
    if (character === "]") return values;
    if (character === "," || /\s/.test(character)) {
      index++;
      continue;
    }
    if (character !== "\"" && character !== "'") return null;
    const quote = character;
    let value = "";
    index++;
    while (index < source.length && source[index] !== quote) {
      if (source[index] !== "\\") {
        value += source[index++];
        continue;
      }
      const decoded = decodeEscapedCharacter(source, index + 1);
      if (!decoded) return null;
      value += decoded.value;
      index = decoded.next;
    }
    if (source[index] !== quote) return null;
    values.push(value);
    index++;
  }
  return null;
}

function parseCalls(value: string): ParsedCall[] {
  const matches: ParsedCall[] = [];
  CALL_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CALL_REGEX.exec(value)) !== null) {
    const args = [match[2], match[3]].filter(Boolean).map(Number);
    if (args.every(Number.isSafeInteger)) {
      matches.push({ name: match[1], arguments: args, source: match[0] });
    }
  }
  return matches;
}

function readDecoderGraph(source: string): DecoderGraph {
  const tables = new Map<string, string[]>();
  const tableHead = new RegExp(
    String.raw`function\s+(${IDENTIFIER})\s*\(\s*\)\s*\{\s*(?:const|let|var)\s+${IDENTIFIER}\s*=\s*\[`,
    "g",
  );
  for (const match of source.matchAll(tableHead)) {
    const openBracket = source.indexOf("[", match.index!);
    const values = readStringArray(source, openBracket);
    if (values && values.length > 0 && values.length <= 20_000) tables.set(match[1], values);
  }

  const bases = new Map<string, BaseDecoder>();
  const basePattern = new RegExp(
    String.raw`function\s+(${IDENTIFIER})\s*\(\s*(${IDENTIFIER})(?:\s*,\s*${IDENTIFIER})*\s*\)\s*\{\s*return\s+\2\s*=\s*\2\s*-\s*\(?([\d+*()\s-]+?)\)?\s*,\s*(${IDENTIFIER})\s*\(\s*\)\s*\[\s*\2\s*\]\s*\}`,
    "g",
  );
  for (const match of source.matchAll(basePattern)) {
    const offset = evaluateIntegerExpression(match[3]);
    if (offset !== null && tables.has(match[4])) {
      bases.set(match[1], { tableName: match[4], offset });
    }
  }

  const aliases = new Map<string, DecoderAlias>();
  for (const baseName of bases.keys()) {
    aliases.set(baseName, { baseName, argumentIndex: 0, delta: 0 });
  }
  const aliasPattern = new RegExp(
    String.raw`function\s+(${IDENTIFIER})\s*\(\s*(${IDENTIFIER})\s*,\s*(${IDENTIFIER})\s*\)\s*\{\s*return\s+(${IDENTIFIER})\s*\(\s*(${IDENTIFIER})\s*([+\-*\d()\s]*)\)\s*\}`,
    "g",
  );
  for (const match of source.matchAll(aliasPattern)) {
    if (!bases.has(match[4]) || (match[5] !== match[2] && match[5] !== match[3])) continue;
    const delta = match[6].trim() ? evaluateIntegerExpression(`0${match[6]}`) : 0;
    if (delta === null) continue;
    aliases.set(match[1], {
      baseName: match[4],
      argumentIndex: match[5] === match[2] ? 0 : 1,
      delta,
    });
  }
  // Recent bundles hide an otherwise static alias offset in a one-property object,
  // for example `return base(second-{offset:573}.offset)`. Parse that tiny shape
  // explicitly instead of evaluating any provider JavaScript.
  const inlineConstantAliasPattern = new RegExp(
    String.raw`function\s+(${IDENTIFIER})\s*\(\s*(${IDENTIFIER})\s*,\s*(${IDENTIFIER})\s*\)\s*\{\s*return\s+(${IDENTIFIER})\s*\(\s*(${IDENTIFIER})\s*([+\-])\s*\{\s*(${IDENTIFIER})\s*:\s*([\d+*()\s-]{1,200})\s*\}\s*\.\s*\7\s*\)\s*\}`,
    "g",
  );
  for (const match of source.matchAll(inlineConstantAliasPattern)) {
    if (!bases.has(match[4]) || (match[5] !== match[2] && match[5] !== match[3])) continue;
    const constant = evaluateIntegerExpression(match[8]);
    if (constant === null) continue;
    aliases.set(match[1], {
      baseName: match[4],
      argumentIndex: match[5] === match[2] ? 0 : 1,
      delta: match[6] === "-" ? -constant : constant,
    });
  }
  return { tables, bases, aliases };
}

function resolveCall(call: ParsedCall, rotation: number, graph: DecoderGraph): string | null {
  const alias = graph.aliases.get(call.name);
  if (!alias) return null;
  const base = graph.bases.get(alias.baseName);
  if (!base) return null;
  const table = graph.tables.get(base.tableName);
  const argument = call.arguments[alias.argumentIndex];
  if (!table?.length || argument === undefined) return null;
  const rawIndex = argument + alias.delta - base.offset + rotation;
  const index = ((rawIndex % table.length) + table.length) % table.length;
  return table[index] ?? null;
}

function splitTopLevel(value: string): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === "(") depth++;
    if (value[index] === ")") depth--;
    if (depth < 0) return null;
    if (value[index] === "," && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  if (depth !== 0) return null;
  parts.push(value.slice(start));
  return parts;
}

function decodeStaticStringExpression(
  expression: string,
  rotation: number,
  graph: DecoderGraph,
): string | null {
  if (!expression || expression.length > 500) return null;
  let output = "";
  let index = 0;
  let consumed = false;
  const callAtStart = new RegExp(`^${CALL_SOURCE}`);
  while (index < expression.length) {
    while (/\s|\+/.test(expression[index] ?? "")) index++;
    if (index >= expression.length) break;
    const quote = expression[index];
    if (quote === "\"" || quote === "'") {
      index++;
      while (index < expression.length && expression[index] !== quote) {
        if (expression[index] !== "\\") {
          output += expression[index++];
          continue;
        }
        const decoded = decodeEscapedCharacter(expression, index + 1);
        if (!decoded) return null;
        output += decoded.value;
        index = decoded.next;
      }
      if (expression[index] !== quote) return null;
      index++;
      consumed = true;
      continue;
    }
    const match = callAtStart.exec(expression.slice(index));
    if (!match) return null;
    const args = [match[2], match[3]].filter(Boolean).map(Number);
    if (!args.every(Number.isSafeInteger)) return null;
    const decoded = resolveCall({ name: match[1], arguments: args, source: match[0] }, rotation, graph);
    if (decoded === null) return null;
    output += decoded;
    index += match[0].length;
    consumed = true;
  }
  return consumed ? output : null;
}

function parseCryptoScheme(
  source: string,
  rotation: number,
  graph: DecoderGraph,
): MkissaCryptoScheme | null {
  const pattern = /saltMul:(\d{1,3}),saltAdd:(\d{1,3}),fragMul:(\d{1,3}),fragAdd:(\d{1,3}),bootPrefix:([\s\S]{1,300}?),join:([\s\S]{1,100}?),parts:\[([^\]]{1,1200})\],omitEmptyLane:(true|false|!0|!1)/g;
  const requiredFields = new Set(["buildId", "group", "host", "epoch", "lane"]);
  const schemes = new Map<string, MkissaCryptoScheme>();
  for (const match of source.matchAll(pattern)) {
    const values = match.slice(1, 5).map(Number);
    if (!values.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) continue;
    const bootPrefix = decodeStaticStringExpression(match[5], rotation, graph);
    const separator = decodeStaticStringExpression(match[6], rotation, graph);
    const expressions = splitTopLevel(match[7]);
    const fields = expressions?.map((value) => decodeStaticStringExpression(value, rotation, graph));
    if (!bootPrefix || !/^[A-Za-z0-9_-]{2,40}:$/.test(bootPrefix)) continue;
    if (!separator || separator.length !== 1 || /[A-Za-z0-9]/.test(separator)) continue;
    if (!fields || fields.some((field) => field === null) || fields.length !== 5) continue;
    const typedFields = fields as MkissaCryptoScheme["fields"];
    if (typedFields.some((field) => !requiredFields.has(field)) || new Set(typedFields).size !== 5) continue;
    const scheme: MkissaCryptoScheme = {
      saltMultiplier: values[0],
      saltOffset: values[1],
      fragmentMultiplier: values[2],
      fragmentOffset: values[3],
      bootPrefix,
      separator,
      fields: typedFields,
      omitEmptyLane: match[8] === "true" || match[8] === "!0",
    };
    schemes.set(JSON.stringify(scheme), scheme);
  }
  return schemes.size === 1 ? [...schemes.values()][0] : null;
}

function seedCandidates(source: string, graph: DecoderGraph): SeedCandidate[] {
  const candidates: SeedCandidate[] = [];
  const shortArray = /=\[([^\]]{1,1200})\]/g;
  for (const arrayMatch of source.matchAll(shortArray)) {
    const expressions = splitTopLevel(arrayMatch[1]);
    if (!expressions || expressions.length !== 4) continue;
    const calls = expressions.map(parseCalls);
    // MKissa formerly built every 12-character mask from two decoder calls. Newer
    // bundles split the same static value across four calls, so accept a small,
    // bounded number and let the whitelist expression decoder validate all tokens.
    if (calls.some((entry) => entry.length < 2 || entry.length > 8)) continue;
    const flat = calls.flat();
    const firstAlias = graph.aliases.get(flat[0].name);
    const firstBase = firstAlias ? graph.bases.get(firstAlias.baseName) : undefined;
    const table = firstBase ? graph.tables.get(firstBase.tableName) : undefined;
    if (!firstBase || !table) continue;
    const usesOneTable = flat.every((call) => {
      const alias = graph.aliases.get(call.name);
      const base = alias ? graph.bases.get(alias.baseName) : undefined;
      return base?.tableName === firstBase.tableName;
    });
    if (!usesOneTable) continue;

    for (let rotation = 0; rotation < table.length; rotation++) {
      const seeds = expressions.map((expression) => decodeStaticStringExpression(expression, rotation, graph));
      if (seeds.every((seed): seed is string => seed !== null && SEED_REGEX.test(seed))) {
        candidates.push({
          seeds: seeds as [string, string, string, string],
          rotation,
          tableName: firstBase.tableName,
          sourceIndex: arrayMatch.index!,
        });
      }
    }
  }
  const unique = new Map(candidates.map((candidate) => [
    `${candidate.tableName}:${candidate.rotation}:${candidate.seeds.join("")}`,
    candidate,
  ]));
  return [...unique.values()];
}

function buildCallCandidates(source: string): Array<{ call: ParsedCall; index: number; score: number }> {
  const preferredVariables = new Set<string>();
  const defaultPattern = new RegExp(
    String.raw`function\s+${IDENTIFIER}\s*\(\s*${IDENTIFIER}\s*=\s*(${IDENTIFIER})\s*[,)]`,
    "g",
  );
  for (const match of source.matchAll(defaultPattern)) preferredVariables.add(match[1]);

  const results: Array<{ call: ParsedCall; index: number; score: number }> = [];
  const assignment = new RegExp(String.raw`\b(${IDENTIFIER})\s*=\s*(${CALL_SOURCE})`, "g");
  for (const match of source.matchAll(assignment)) {
    const calls = parseCalls(match[2]);
    if (calls.length !== 1) continue;
    results.push({
      call: calls[0],
      index: match.index!,
      score: preferredVariables.has(match[1]) ? 100 : 0,
    });
  }
  return results;
}

/**
 * Recover the client build number and four mask seeds using a whitelist parser.
 * This function never uses eval, Function, vm, or dynamic imports.
 */
export function parseMkissaBundle(source: string): MkissaBuildInfo | null {
  if (!source || source.length > 25_000_000 || !source.includes("aaReq")) return null;
  const graph = readDecoderGraph(source);
  const seeds = seedCandidates(source, graph);
  if (seeds.length === 0) return null;

  const legacyBuild = /!==\s*["']string["']\s*\?\s*["'](\d{2,10})["']\s*:\s*["']["']/.exec(source)?.[1];
  if (legacyBuild) {
    const distinctSeeds = new Map(seeds.map((candidate) => [candidate.seeds.join("|"), candidate.seeds]));
    const only = [...distinctSeeds.values()];
    return only.length === 1 ? { buildId: legacyBuild, seeds: only[0] } : null;
  }

  const buildCalls = buildCallCandidates(source);
  const matches: Array<{ buildId: string; seeds: SeedCandidate; score: number }> = [];
  for (const seed of seeds) {
    for (const candidate of buildCalls) {
      const alias = graph.aliases.get(candidate.call.name);
      const base = alias ? graph.bases.get(alias.baseName) : undefined;
      if (!base || base.tableName !== seed.tableName) continue;
      const value = resolveCall(candidate.call, seed.rotation, graph);
      if (!value || !/^\d{2,10}$/.test(value)) continue;
      const distance = Math.abs(seed.sourceIndex - candidate.index);
      matches.push({
        buildId: value,
        seeds: seed,
        score: candidate.score + Math.max(0, 20 - Math.floor(distance / 100)),
      });
    }
  }
  if (matches.length === 0) return null;
  matches.sort((left, right) => right.score - left.score);
  const best = matches[0];
  const tied = matches.filter((candidate) => candidate.score === best.score);
  if (new Set(tied.map((candidate) => `${candidate.buildId}:${candidate.seeds.seeds.join("|")}`)).size !== 1) {
    return null;
  }
  return {
    buildId: best.buildId,
    seeds: best.seeds.seeds,
    cryptoScheme: parseCryptoScheme(source, best.seeds.rotation, graph) ?? undefined,
  };
}

export function findMkissaAppEntry(html: string, siteOrigin: string): string | null {
  if (!html || html.length > 5_000_000) return null;
  const reference = /(?:import\s*\(|\bsrc\s*=)\s*["']([^"']*\/_app\/immutable\/entry\/app\.[^"']+\.js)["']/.exec(html)?.[1]
    ?? /<script[^>]+src=["']([^"']+\/entry\/app\.[^"']+\.js)["']/i.exec(html)?.[1];
  if (!reference) return null;
  try {
    return new URL(reference, `${siteOrigin.replace(/\/+$/, "")}/`).toString();
  } catch {
    return null;
  }
}

export function extractMkissaAssetReferences(source: string, parentUrl: string): string[] {
  if (!source || source.length > 25_000_000) return [];
  const references = new Set<string>();
  const patterns = [
    /(?:import\s*\(|from\s*)["']([^"'\n]+\.js)["']/g,
    /["'](\.\.?\/(?:chunks|nodes)\/[^"'\n]+\.js)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (!match[1].startsWith(".") && !match[1].startsWith("/")) continue;
      try { references.add(new URL(match[1], parentUrl).toString()); } catch { /* malformed asset */ }
    }
  }
  return [...references];
}
