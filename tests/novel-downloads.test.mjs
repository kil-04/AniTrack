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
async function idle(id, timeout = 8000) {
  const started = Date.now();
  for (;;) {
    const t = (await N.listNovelDownloads()).find((x) => x.titleId === id);
    if (t && t.queued === 0) return t;
    if (Date.now() - started > timeout) throw new Error(`Title ${id} did not settle: ${JSON.stringify(t)}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
/** Polls until [condition] holds (timing differs under load and on Windows; never assert a moment). */
async function waitFor(condition, what, timeout = 8000) {
  const started = Date.now();
  while (!(await condition())) {
    if (Date.now() - started > timeout) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
const titleOf = async (id) => (await N.listNovelDownloads()).find((x) => x.titleId === id);

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
  // pending.json goes before the title shows as settled; poll anyway rather than assert a moment.
  await waitFor(() => !fs.existsSync(path.join(folder(id), "pending.json")), "nothing left to resume");
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
    if (chapterId === "ch2abc") harness.online = false; // the network drops after chapter 2
    return text(chapterId);
  };
  await N.enqueueNovelChapters(detail(id), chapters, chapters);
  // It stays offline until the title shows it is waiting: no race with the retries.
  await waitFor(async () => /Waiting for the network/.test((await titleOf(id))?.error ?? ""), "the network wait");
  // While it waits, the queue is on disk for a restart.
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder(id), "pending.json"), "utf8")), ["ch3abc", "ch4abc", "ch5abc"]);
  harness.online = true;
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

test("a chapter whose source keeps failing fails after three stalls instead of waiting forever", async () => {
  const id = "Broken01";
  let calls = 0;
  harness.chapter = async () => { calls++; throw new NovelSourceError("NovelBuddy returned an error (HTTP 502).", 502); };
  await N.enqueueNovelChapters(detail(id), chapters.slice(0, 1), chapters);
  const t = await idle(id);
  assert.equal(t.saved, 0);
  assert.equal(t.failed, 1);
  assert.equal(t.error, "The source kept failing on part of this chapter. Try again later.");
  assert.equal(calls, 3 * 7, "three runs of six retries each");
});

test("no answer while online is a stall too: it fails rather than waiting for a network that is there", async () => {
  const id = "Unreach01";
  harness.chapter = async () => { throw new NovelSourceError("NovelBuddy couldn't be reached. Check your connection and retry.", 0); };
  await N.enqueueNovelChapters(detail(id), chapters.slice(0, 1), chapters);
  const t = await idle(id);
  assert.equal(t.failed, 1);
  assert.match(t.error, /kept failing/);
  assert.ok(!events.some((e) => e.titleId === id && /Waiting for the network/.test(e.error ?? "")), "it never claimed to wait for the network");
});

test("removing or cancelling a title ends its chapter's wait at once, and the worker moves on", async () => {
  for (const stop of ["remove", "cancel"]) {
    const id = `Waiting${stop}`;
    const next = `After${stop}`;
    harness.chapter = async (chapterId) => {
      if (chapterId === "ch1abc") throw new NovelSourceError("NovelBuddy is limiting requests. Wait a minute, then retry.", 429, false, "999999");
      return text(chapterId);
    };
    await N.enqueueNovelChapters(detail(id), chapters.slice(0, 1), chapters);
    await N.enqueueNovelChapters(detail(next), chapters.slice(1, 2), chapters);
    // Six hours (scaled to 21.6 s) of Retry-After: far longer than this test may take.
    await waitFor(async () => /Continuing automatically/.test((await titleOf(id))?.error ?? ""), "the rate-limit wait");
    const started = Date.now();
    if (stop === "remove") await N.removeNovelDownloads("novelbuddy", id);
    else await N.cancelNovelDownloads("novelbuddy", id);
    const t = await idle(next);
    assert.equal(t.saved, 1);
    assert.ok(Date.now() - started < 5000, `the worker moved on after ${Date.now() - started} ms`);
    if (stop === "cancel") {
      const cancelled = await titleOf(id);
      assert.equal(cancelled.queued, 0);
      assert.equal(cancelled.failed, 0, "a cancelled chapter isn't a failure");
      assert.equal(cancelled.error, null, "nothing says it is continuing: nothing is");
      await waitFor(() => !fs.existsSync(path.join(folder(id), "pending.json")), "nothing left to resume");
    } else {
      assert.equal(await titleOf(id), undefined);
    }
  }
});

test("a chapter queued again right after Cancel is downloaded, whether it was waiting or on its way", async () => {
  for (const stage of ["waiting", "in flight"]) {
    const id = stage === "waiting" ? "Requeue01" : "Requeue02";
    const fetched = [];
    let answer;
    const first = new Promise((resolve) => { answer = resolve; });
    harness.chapter = async (chapterId) => {
      fetched.push(chapterId);
      if (fetched.length > 1) return text(chapterId);
      if (stage === "waiting") throw new NovelSourceError("NovelBuddy is limiting requests. Wait a minute, then retry.", 429, false, "999999");
      // In flight: it answers (a retryable error) only after the cancel and the new request.
      await first;
      throw new NovelSourceError("NovelBuddy returned an error (HTTP 503).", 503);
    };
    await N.enqueueNovelChapters(detail(id), chapters.slice(0, 1), chapters);
    if (stage === "waiting") await waitFor(async () => /Continuing automatically/.test((await titleOf(id))?.error ?? ""), "the rate-limit wait");
    else await waitFor(() => fetched.length === 1, "the request on its way");
    await N.cancelNovelDownloads("novelbuddy", id);
    assert.equal(await N.enqueueNovelChapters(detail(id), chapters.slice(0, 1), chapters), 1, `${stage}: asking again queues it again`);
    answer();
    const t = await idle(id);
    assert.equal(t.saved, 1, `${stage}: it was downloaded`);
    assert.equal(t.failed, 0);
    assert.equal(t.error, null);
    assert.deepEqual(fetched, ["ch1abc", "ch1abc"]);
  }
});

test("a chapter queued again while it is downloading isn't fetched twice", async () => {
  const id = "Requeue03";
  const fetched = [];
  let answer;
  const first = new Promise((resolve) => { answer = resolve; });
  harness.chapter = async (chapterId) => { fetched.push(chapterId); await first; return text(chapterId); };
  await N.enqueueNovelChapters(detail(id), chapters.slice(0, 1), chapters);
  await waitFor(() => fetched.length === 1, "the request on its way");
  assert.equal(await N.enqueueNovelChapters(detail(id), chapters.slice(0, 1), chapters), 0, "already on its way");
  await N.cancelNovelDownloads("novelbuddy", id);
  assert.equal(await N.enqueueNovelChapters(detail(id), chapters.slice(0, 1), chapters), 1, "cancelled, so asked for again");
  answer();
  const t = await idle(id);
  assert.equal(t.saved, 1);
  assert.deepEqual(fetched, ["ch1abc"], "it finished on its way, so the queued copy was skipped");
});

test("a Novel Phoenix title with a long address id is saved under a short folder name", async () => {
  // 120 characters, the longest id accepted: its hex alone would overrun Windows' path limit.
  const id = `${"a-very-long-novel-title-".repeat(5)}`.slice(0, 120);
  const positions = [1, 2].map((n) => ({ id: String(n), order: n - 1, label: `Chapter ${n}`, updatedAt: null }));
  harness.chapter = async (chapterId) => text(chapterId);
  const longDetail = { ...detail(id), sourceId: "novelphoenix", url: `https://novelphoenix.example/novel/${id}` };
  assert.equal(await N.enqueueNovelChapters(longDetail, positions, positions), 2);
  const t = await idle(id);
  assert.equal(t.saved, 2);
  const dirs = fs.readdirSync(path.join(storageRoot, "novel_downloads")).filter((name) => name.startsWith("novelphoenix-"));
  assert.equal(dirs.length, 1);
  assert.match(dirs[0], /^novelphoenix-[0-9a-f]{64}-[0-9a-f]{32}$/);
  assert.deepEqual((await N.localChapter("novelphoenix", id, "2")).paragraphs, ["Text of 2"]);
  assert.deepEqual((await N.savedChapterIds("novelphoenix", id)).sort(), ["1", "2"]);
  // A short id keeps the plain hex name, like every title saved before.
  const short = { ...detail("shadow-slave"), sourceId: "novelphoenix" };
  await N.enqueueNovelChapters(short, positions.slice(0, 1), positions);
  await idle("shadow-slave");
  assert.ok(fs.existsSync(path.join(storageRoot, "novel_downloads", `novelphoenix-${hex("shadow-slave")}`, `c-${hex("1")}.json`)));
  await N.removeNovelDownloads("novelphoenix", id);
  assert.equal(fs.existsSync(path.join(storageRoot, "novel_downloads", dirs[0])), false);
});

after(() => {
  const resolved = path.resolve(storageRoot);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("anitrack-novel-dl-test-")) throw new Error("Invalid fixture cleanup path");
  fs.rmSync(resolved, { recursive: true, force: true });
  delete globalThis.__anitrackNovelFixture;
});
