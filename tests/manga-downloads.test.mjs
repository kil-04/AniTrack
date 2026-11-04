import test, { after } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Desktop manga downloads with a fake source: what an interrupted chapter keeps,
// how it waits and how it carries on (packages/shared/download-resume.ts).
const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "anitrack-manga-dl-test-"));
const harness = {
  online: true,
  pageLists: 0,
  pages: () => [],
  fetch: async () => { throw new Error("Unexpected page request"); },
};
globalThis.__anitrackMangaFixture = harness;
harness.app = { getPath: () => storageRoot };
harness.net = { isOnline: () => harness.online };
const moduleUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const electron = moduleUrl("export const app = globalThis.__anitrackMangaFixture.app; export const net = globalThis.__anitrackMangaFixture.net;");
const sources = moduleUrl(`
  const h = globalThis.__anitrackMangaFixture;
  export class MangaSourceError extends Error {
    constructor(message, status, verify = false, retryAfter = null) { super(message); this.status = status; this.verify = verify; this.retryAfter = retryAfter; }
  }
  export function sourceById() { return { pageImages: async () => { h.pageLists++; return h.pages(); } }; }
  export function fetchPageImage(sourceId, target, signal) { return h.fetch(target.toString(), signal); }
`);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith("/services/manga/downloads.ts")) {
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

const M = await import("../apps/desktop/main/services/manga/downloads.ts");
const R = await import("../packages/shared/download-resume.ts");
const { downloadMetaJson } = await import("../packages/shared/manga.ts");
M.setMangaRetryScale(0.001);
const events = [];
M.setMangaDownloadEmitter((event) => events.push(event));

const manga = { id: 777, title: "Fixture Manga", cover: null, country: "JP" };
const title = { sourceId: "xcomic", id: "fixture-title", title: "Fixture Manga" };
const chapter = (id, number) => ({ id, number, title: null, group: null, pageCount: null, uploadedAt: null });
const jpeg = (n) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, n)]);
const pageUrls = (token, n) => Array.from({ length: n }, (_, i) => ({ url: `https://img${token}.xcomic.example/c/p${i + 1}.jpg?token=${token}`, width: 800, height: 1200 }));
const indexOf = (url) => Number(/\/p(\d+)\.jpg/.exec(url)[1]) - 1;
const image = (i) => new Response(jpeg(i), { headers: { "content-type": "image/jpeg" } });
const dir = (chapterId) => path.join(storageRoot, "manga_downloads", String(manga.id), chapterId);
async function settled(key, timeout = 4000) {
  const started = Date.now();
  for (;;) {
    const item = (await M.listMangaDownloads()).find((d) => d.key === key);
    if (item && (item.status === "done" || item.status === "failed")) return item;
    if (Date.now() - started > timeout) throw new Error(`Chapter ${key} did not settle: ${JSON.stringify(item)}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
const metaOf = (chapterId) => JSON.parse(fs.readFileSync(path.join(dir(chapterId), "meta.json"), "utf8"));

// Runs first: the folder below is what an app closed mid-chapter leaves behind.
test("after a restart, an unfinished chapter resumes with re-signed page URLs and keeps its pages in order", async () => {
  const id = "restart1";
  fs.mkdirSync(dir(id), { recursive: true });
  fs.writeFileSync(path.join(dir(id), "meta.json"), downloadMetaJson({ manga, title, chapter: chapter(id, 1), pages: [], complete: false, sizeBytes: 0 }));
  const oldPages = pageUrls("old", 5);
  const rendition = R.renditionId(`chapter ${id}`, oldPages.map((p) => ({ kind: "page", url: p.url })));
  let ledger = R.ledgerHeader(rendition, 5);
  for (const i of [0, 1, 3]) {
    fs.writeFileSync(path.join(dir(id), `00${i + 1}.jpg`), jpeg(i));
    ledger += R.ledgerLine(i, `00${i + 1}.jpg`, jpeg(i).length, "jpeg");
  }
  fs.writeFileSync(path.join(dir(id), "005.jpg.part"), Buffer.alloc(10));
  fs.writeFileSync(path.join(dir(id), R.LEDGER_FILE), ledger + "4 005.jpg 2"); // cut off by the kill
  const fetched = [];
  harness.pages = () => pageUrls("new", 5);
  harness.fetch = async (url) => { fetched.push(indexOf(url)); return image(indexOf(url)); };
  const done = await settled(`${manga.id}:${id}`);
  assert.equal(done.status, "done");
  assert.deepEqual(fetched.sort(), [2, 4], "only the missing pages were fetched");
  const meta = metaOf(id);
  assert.equal(meta.complete, true);
  assert.deepEqual(meta.pages.map((p) => p.file), ["001.jpg", "002.jpg", "003.jpg", "004.jpg", "005.jpg"]);
  for (let i = 0; i < 5; i++) assert.deepEqual(fs.readFileSync(path.join(dir(id), `00${i + 1}.jpg`)), jpeg(i));
  assert.equal(fs.existsSync(path.join(dir(id), "005.jpg.part")), false);
  const local = await M.localPages(manga.id, id);
  assert.deepEqual(local.map((p) => p.url.split("/").pop()), ["001.jpg", "002.jpg", "003.jpg", "004.jpg", "005.jpg"]);
});

test("a chapter waits for the network to come back and continues from the first missing page", async () => {
  const id = "network1";
  const fetched = [];
  harness.pages = () => pageUrls("a", 6);
  harness.fetch = async (url) => {
    const i = indexOf(url);
    if (!harness.online) throw new TypeError("net::ERR_INTERNET_DISCONNECTED");
    fetched.push(i);
    if (i === 2) {
      harness.online = false; // the connection drops after page 3
      setTimeout(() => { harness.online = true; }, 150);
    }
    return image(i);
  };
  assert.equal(await M.downloadChapter(manga, title, chapter(id, 2)), true);
  const done = await settled(`${manga.id}:${id}`);
  assert.equal(done.status, "done");
  assert.deepEqual(new Set(fetched), new Set([0, 1, 2, 3, 4, 5]));
  assert.ok(fetched.length <= 6 + 2, `pages saved before the drop weren't fetched again: ${fetched}`);
  const waiting = events.map((e) => e.item).filter((item) => item?.key === `${manga.id}:${id}` && item.status === "queued" && item.error);
  assert.ok(waiting.some((item) => /network/.test(item.error)), "it showed it was waiting for the network");
  assert.deepEqual(metaOf(id).pages.map((p) => p.file), ["001.jpg", "002.jpg", "003.jpg", "004.jpg", "005.jpg", "006.jpg"]);
});

test("a rate-limited page waits out Retry-After instead of failing the chapter", async () => {
  const id = "limited1";
  let limited = 2;
  const times = [];
  harness.pages = () => pageUrls("a", 2);
  harness.fetch = async (url) => {
    if (indexOf(url) === 1 && limited-- > 0) { times.push(Date.now()); return new Response("", { status: 429, headers: { "retry-after": "30" } }); }
    return image(indexOf(url));
  };
  await M.downloadChapter(manga, title, chapter(id, 3));
  const done = await settled(`${manga.id}:${id}`);
  assert.equal(done.status, "done");
  assert.equal(limited, -1);
  assert.ok(times[1] - times[0] >= 28, "Retry-After: 30 (scaled to 30 ms) was honoured");
});

test("expired page addresses fetch the page list again; a page still missing fails the chapter but keeps the rest", async () => {
  const id = "expired1";
  let token = "a";
  harness.pageLists = 0;
  harness.pages = () => pageUrls(token, 3);
  harness.fetch = async (url) => {
    if (url.includes("token=a") && indexOf(url) === 2) { token = "b"; return new Response("", { status: 403 }); }
    return image(indexOf(url));
  };
  await M.downloadChapter(manga, title, chapter(id, 4));
  assert.equal((await settled(`${manga.id}:${id}`)).status, "done");
  assert.equal(harness.pageLists, 2, "the page list was fetched again once");

  const gone = "missing1";
  harness.pages = () => pageUrls("a", 3);
  harness.fetch = async (url) => (indexOf(url) === 1 ? new Response("", { status: 404 }) : image(indexOf(url)));
  await M.downloadChapter(manga, title, chapter(gone, 5));
  const failed = await settled(`${manga.id}:${gone}`);
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /Page 2 is missing/);
  assert.ok(fs.existsSync(path.join(dir(gone), "001.jpg")), "saved pages stay for the next try");
  const fetched = [];
  harness.fetch = async (url) => { fetched.push(indexOf(url)); return image(indexOf(url)); };
  await M.downloadChapter(manga, title, chapter(gone, 5));
  assert.equal((await settled(`${manga.id}:${gone}`)).status, "done");
  assert.ok(!fetched.includes(0), `the retry kept page 1: ${fetched}`);
});

test("a chapter whose page list changed starts over rather than mixing pages", async () => {
  const id = "changed1";
  harness.pages = () => pageUrls("a", 3);
  harness.fetch = async (url) => image(indexOf(url));
  await M.downloadChapter(manga, title, chapter(id, 6));
  assert.equal((await settled(`${manga.id}:${id}`)).status, "done");
  const saved = Object.fromEntries(fs.readdirSync(dir(id)).map((name) => [name, fs.readFileSync(path.join(dir(id), name))]));
  // Removed, then asked for again after the source re-uploaded it with four
  // pages, while the old (interrupted) files are still on disk.
  await M.removeMangaDownload(`${manga.id}:${id}`);
  fs.mkdirSync(dir(id), { recursive: true });
  for (const [name, bytes] of Object.entries(saved)) fs.writeFileSync(path.join(dir(id), name), bytes);
  const fetched = [];
  harness.pages = () => pageUrls("a", 4).map((p) => ({ ...p, url: p.url.replace("/c/", "/c2/") }));
  harness.fetch = async (url) => { fetched.push(indexOf(url)); return image(10 + indexOf(url)); };
  await M.downloadChapter(manga, title, chapter(id, 6));
  assert.equal((await settled(`${manga.id}:${id}`)).status, "done");
  assert.deepEqual(fetched.sort(), [0, 1, 2, 3]);
  for (let i = 0; i < 4; i++) assert.deepEqual(fs.readFileSync(path.join(dir(id), `00${i + 1}.jpg`)), jpeg(10 + i));
});

after(() => {
  const resolved = path.resolve(storageRoot);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("anitrack-manga-dl-test-")) throw new Error("Invalid fixture cleanup path");
  fs.rmSync(resolved, { recursive: true, force: true });
  delete globalThis.__anitrackMangaFixture;
});
