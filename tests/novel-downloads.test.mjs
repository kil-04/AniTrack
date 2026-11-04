import test, { after } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Desktop novel downloads with a fake source: the queue survives a restart, and
// rate limits and network drops are waited out (packages/shared/download-resume.ts).
const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "anitrack-novel-dl-test-"));
const harness = { online: true, chapter: async () => { throw new Error("Unexpected chapter request"); } };
globalThis.__anitrackNovelFixture = harness;
harness.app = { getPath: () => storageRoot };
harness.net = { isOnline: () => harness.online };
const moduleUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const electron = moduleUrl("export const app = globalThis.__anitrackNovelFixture.app; export const net = globalThis.__anitrackNovelFixture.net;");
const sources = moduleUrl(`
  const h = globalThis.__anitrackNovelFixture;
  export class NovelSourceError extends Error {
    constructor(message, status, verify = false, retryAfter = null) { super(message); this.status = status; this.verify = verify; this.retryAfter = retryAfter; }
  }
  export function novelChapter(sourceId, titleId, chapterId, lane) { return h.chapter(chapterId, lane); }
`);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith("/services/novel/downloads.ts")) {
      if (specifier === "electron") return { url: electron, shortCircuit: true };
      if (specifier === "./sources") return { url: sources, shortCircuit: true };
    }
    try { return nextResolve(specifier, context); }
    catch (error) {
      if (/^\.{1,2}\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
      throw error;
    }
  },
});

const N = await import("../apps/desktop/main/services/novel/downloads.ts");
N.setNovelRetryScale(0.001);
const events = [];
N.onNovelDownload((event) => events.push(event));
const { NovelSourceError } = await import(sources);

const detail = (id) => ({
  sourceId: "novelbuddy", id, title: `Fixture ${id}`, cover: null, status: "ongoing", chapters: 5, rating: null, genres: [],
  machine: false, author: null, altNames: [], url: `https://novelbuddy.example/${id}`, latest: null,
});
const chapters = Array.from({ length: 5 }, (_, i) => ({ id: `ch${i + 1}abc`, order: i, label: `Chapter ${i + 1}`, updatedAt: null }));
const text = (id) => ({ id, label: id, paragraphs: [`Text of ${id}`] });
const hex = (value) => Buffer.from(value, "utf-8").toString("hex");
const folder = (id) => path.join(storageRoot, "novel_downloads", `novelbuddy-${hex(id)}`);
async function idle(id, timeout = 4000) {
  const started = Date.now();
  for (;;) {
    const t = (await N.listNovelDownloads()).find((x) => x.titleId === id);
    if (t && t.queued === 0) return t;
    if (Date.now() - started > timeout) throw new Error(`Title ${id} did not settle: ${JSON.stringify(t)}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// Runs first: the folder below is what an app closed mid-download leaves behind.
test("after a restart, the chapters still waiting are fetched in order; saved ones aren't", async () => {
  const id = "Restart01";
  fs.mkdirSync(folder(id), { recursive: true });
  fs.writeFileSync(path.join(folder(id), "meta.json"), JSON.stringify({ detail: detail(id), chapters }));
  fs.writeFileSync(path.join(folder(id), `c-${hex("ch1abc")}.json`), JSON.stringify(text("ch1abc")));
  fs.writeFileSync(path.join(folder(id), "pending.json"), JSON.stringify(["ch1abc", "ch2abc", "ch3abc", "../evil", "ch9zzz"]));
  const fetched = [];
  harness.chapter = async (chapterId, lane) => { assert.equal(lane, "back"); fetched.push(chapterId); return text(chapterId); };
  const t = await idle(id);
  assert.deepEqual(fetched, ["ch2abc", "ch3abc"]);
  assert.equal(t.saved, 3);
  assert.equal(fs.existsSync(path.join(folder(id), "pending.json")), false, "nothing left to resume");
  assert.deepEqual((await N.localChapter("novelbuddy", id, "ch3abc")).paragraphs, ["Text of ch3abc"]);
});

test("a rate limit is waited out (Retry-After) instead of stopping the title", async () => {
  const id = "Limited01";
  let limited = 2;
  const times = [];
  harness.chapter = async (chapterId) => {
    if (chapterId === "ch2abc" && limited-- > 0) {
      times.push(Date.now());
      throw new NovelSourceError("NovelBuddy is limiting requests. Wait a minute, then retry.", 429, false, "30");
    }
    return text(chapterId);
  };
  assert.equal(await N.enqueueNovelChapters(detail(id), chapters.slice(0, 3), chapters), 3);
  const t = await idle(id);
  assert.equal(t.saved, 3);
  assert.equal(t.failed, 0);
  assert.equal(t.error, null);
  assert.ok(times[1] - times[0] >= 28, "Retry-After: 30 (scaled to 30 ms) was honoured");
});

test("a dropped network pauses the title and it carries on when the network is back", async () => {
  const id = "Network01";
  const fetched = [];
  harness.chapter = async (chapterId) => {
    if (!harness.online) throw new NovelSourceError("NovelBuddy couldn't be reached. Check your connection and retry.", 0);
    fetched.push(chapterId);
    if (chapterId === "ch2abc") {
      harness.online = false;
      setTimeout(() => { harness.online = true; }, 150);
    }
    return text(chapterId);
  };
  await N.enqueueNovelChapters(detail(id), chapters, chapters);
  // While it waits, the queue is on disk for a restart.
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder(id), "pending.json"), "utf8")), ["ch3abc", "ch4abc", "ch5abc"]);
  const t = await idle(id);
  assert.equal(t.saved, 5);
  assert.equal(t.failed, 0);
  assert.deepEqual(fetched, chapters.map((c) => c.id));
  assert.ok(events.some((e) => e.titleId === id && /Waiting for the network/.test(e.error ?? "")));
});

test("a chapter the source no longer has still fails, and three in a row stop the title", async () => {
  const id = "Missing01";
  harness.chapter = async () => { throw new NovelSourceError("NovelBuddy doesn't have this anymore.", 404); };
  await N.enqueueNovelChapters(detail(id), chapters, chapters);
  const t = await idle(id);
  assert.equal(t.saved, 0);
  assert.equal(t.failed, 5);
  assert.match(t.error, /Downloading stopped/);
});

after(() => {
  const resolved = path.resolve(storageRoot);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("anitrack-novel-dl-test-")) throw new Error("Invalid fixture cleanup path");
  fs.rmSync(resolved, { recursive: true, force: true });
  delete globalThis.__anitrackNovelFixture;
});
