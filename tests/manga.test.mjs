import test from "node:test";
import assert from "node:assert/strict";
import {
  applyDownloadEvent,
  chapterFolder,
  chapterListing,
  downloadKey,
  downloadMeta,
  downloadMetaJson,
  heldChapters,
  humanSize,
  imageSize,
  isSourceChapterId,
  newChapterCount,
  PAGE_FILE,
  pageContentType,
  pageExtension,
  planRange,
  progressFor,
  rangeChoice,
  rangePresets,
  rangeStartGroup,
  trackedTitles,
  withUpload,
  mangaBallAllChapters,
  mangaBallChapters,
  mangaBallDetail,
  mangaBallLatest,
  mangaBallPages,
  mangaBallSearch,
  mangaDotChapters,
  mangaDotDetail,
  mangaDotImagesPath,
  mangaDotPages,
  mangaDotSuggestions,
  mangaDotTime,
  normalizeChapters,
  publicHttps,
  resumeTarget,
  sourceMatches,
} from "../packages/shared/manga.ts";

// Synthetic responses shaped like the sources' JSON APIs (no saved site content).
const manga = (over = {}) => ({
  id: 500, malId: null, title: "Example Saga", titleRomaji: "Rei no Saga", cover: null, banner: null, chapters: null,
  volumes: null, status: null, format: "MANGA", year: 2018, score: null, synopsis: null, genres: [], popularity: null,
  country: "KR", synonyms: [], ...over,
});

const titleId = "685158ff702284f834178c9b";
const ballDetail = ({ mal = null, name = "Example Saga", year = "2018", language = "ko", adult = false, alt = [] } = {}) => ({
  status: "success",
  data: {
    id: titleId, name, alternateName: alt, links: { mangadex: "x", myanimelist: mal },
    date_published: year, originalLanguage: language, is18plus: adult,
  },
});

test("MangaBall: search hits, identity and matching", () => {
  const hits = mangaBallSearch({ data: [
    { id: titleId, name: "Example Saga", is18plus: false }, { id: "not-an-id" },
    { _id: "68515e13702284f834179e9e", name: "Adult One", is18plus: true }, { id: titleId, name: "Duplicate" },
  ] });
  assert.deepEqual(hits.map((h) => h.id), [titleId, "68515e13702284f834179e9e"]);
  const d = mangaBallDetail(ballDetail({ mal: "121496" }));
  assert.equal(d.malId, 121496);
  assert.equal(d.year, 2018);
  assert.equal(d.country, "KR");
  assert.ok(sourceMatches(mangaBallDetail(ballDetail({ mal: "77" })), manga({ malId: 77 })));
  assert.ok(!sourceMatches(mangaBallDetail(ballDetail({ mal: "78" })), manga({ malId: 77 })));
  assert.ok(!sourceMatches(mangaBallDetail(ballDetail({ mal: "77", adult: true })), manga({ malId: 77 })));
  assert.ok(sourceMatches(mangaBallDetail(ballDetail({ name: "Rei no Saga!" })), manga()));
  assert.ok(sourceMatches(mangaBallDetail(ballDetail({ name: "Other", alt: ["Example  SAGA"] })), manga()));
  assert.ok(!sourceMatches(mangaBallDetail(ballDetail({ year: "2022" })), manga()));
  assert.ok(!sourceMatches(mangaBallDetail(ballDetail({ language: "ja" })), manga()));
  assert.ok(!sourceMatches(mangaBallDetail(ballDetail({ name: "Example Saga: Ragnarok" })), manga()));
});

test("MangaBall: published English uploads and CDN pages only", () => {
  const page = mangaBallChapters({ data: [
    { id: "68de79241ec6dc083a3051ee", lang: "en", name: "Chapter 202", number: 202, group: { name: "Suicune" }, status: "published", created_at: "2025-10-02T13:07:48.357000" },
    { id: "69ccf8a162f717a33a04b72b", lang: "en", name: "Ch. 201.5: The End", number: 201.5, group_name: "Swampert", status: "published" },
    { id: "69ccf8a162f717a33a04b72c", lang: "fr", name: "Chapitre 200", number: 200, status: "published" },
    { id: "69ccf8a162f717a33a04b72d", lang: "en", number: 199, status: "pending" },
    { id: "bad", lang: "en", number: 198 },
    { id: "69ccf8a162f717a33a04b72e", lang: "en", number: null },
  ], pagination: { total_pages: 2 } });
  assert.deepEqual(page.chapters.map((c) => c.number), [202, 201.5]);
  assert.deepEqual(page.chapters.map((c) => c.group), ["Suicune", "Swampert"]);
  assert.equal(page.chapters[0].title, null);
  assert.equal(page.chapters[1].title, "The End");
  assert.equal(page.chapters[0].uploadedAt, 1759410468357);
  assert.equal(page.totalPages, 2);
  const pages = mangaBallPages({ data: { chapter: { pages: [
    "https://bulbasaur.poke-black-and-white.net/storage/x/a-001.webp",
    "http://bulbasaur.poke-black-and-white.net/storage/x/a-002.webp",
    "https://elsewhere.example/a-003.webp",
  ] } } });
  assert.deepEqual(pages, ["https://bulbasaur.poke-black-and-white.net/storage/x/a-001.webp"]);
  // MangaBall rotates its image CDN: a chapter wholly on a new host is kept, a stray host is not.
  const rotated = mangaBallPages({ data: { chapter: { pages: [
    "https://chikorita.red-and-blue.net/storage/y/b-001.webp",
    "https://chikorita.red-and-blue.net/storage/y/b-002.webp",
    "https://stray.example/b-003.webp",
    "https://user:pw@chikorita.red-and-blue.net/storage/y/b-004.webp",
    "https://10.0.0.1/b-005.webp",
  ] } } });
  assert.deepEqual(rotated, [
    "https://chikorita.red-and-blue.net/storage/y/b-001.webp",
    "https://chikorita.red-and-blue.net/storage/y/b-002.webp",
  ]);
  assert.deepEqual(mangaBallPages({ data: { chapter: { pages: [] } } }), []);
});

test("MangaDot: suggestions, tracker links, chapters and same-origin pages", () => {
  assert.deepEqual(mangaDotSuggestions({ suggestions: [{ id: 152 }, { id: 31021 }, { id: 152 }, { id: 0 }] }), [152, 31021]);
  const linked = mangaDotDetail({ manga: { id: 99, title: "Example Saga", anilist_id: 500, year: 2015, country_of_origin: "JP", alt_titles: [] } });
  assert.ok(sourceMatches(linked, manga({ year: 2015, country: "JP" })));
  assert.ok(!sourceMatches({ ...linked, anilistId: 501 }, manga({ year: 2015, country: "JP" })));
  const chapters = mangaDotChapters([
    { id: 25424, chapter_number: 1, chapter_title: "Chapter 1.0", language: "en", group_name: "Group A", page_count: 14, source: "user" },
    { id: 25425, chapter_number: "1.5", chapter_title: "Ch. 1.5: Rebirth", language: "en", group_name: null, scanlator_name: "Scan B", page_count: 9, source: "user" },
    { id: 327776, chapter_number: 2, chapter_title: "The Second", language: "en", page_count: 20, source: "scraper" },
    { id: 9, chapter_number: 3, language: "es", page_count: 20, source: "user" },
    { id: 10, chapter_number: 4, language: "en", page_count: 0, source: "user" },
    { id: 11, chapter_number: 5, language: "en", page_count: 5, source: "elsewhere" },
    { id: 12, chapter_number: null, language: "en", page_count: 5, source: "user" },
  ]);
  assert.deepEqual(chapters.map((c) => c.id), ["user:25424", "user:25425", "scraper:327776"]);
  assert.deepEqual(chapters.map((c) => c.title), [null, "Rebirth", "The Second"]);
  assert.deepEqual(chapters.map((c) => c.group), ["Group A", "Scan B", null]);
  assert.equal(mangaDotImagesPath("user:25424"), "/api/uploads/25424/images");
  assert.equal(mangaDotImagesPath("scraper:327776"), "/api/chapters/327776/images");
  assert.equal(mangaDotImagesPath("evil:1"), null);
  const pages = mangaDotPages({ images: [
    { url: "/chapters/a/b/001.webp", w: 800, h: 1200 }, { url: "/../etc/passwd" }, { url: "https://evil.example/x.webp" },
  ] });
  assert.deepEqual(pages.map((p) => p.url), ["https://mangadot.net/chapters/a/b/001.webp"]);
  assert.equal(mangaDotTime("2026-04-29 20:49:55+00"), Date.parse("2026-04-29T20:49:55Z"));
});

test("chapters: one upload per number, preferred group, listing and resume", () => {
  const uploads = [
    { id: "a1", number: 1, group: "A", title: null, pageCount: null, uploadedAt: 1 },
    { id: "b1", number: 1, group: "B", title: null, pageCount: null, uploadedAt: 2 },
    { id: "a2", number: 2, group: "A", title: "Two", pageCount: null, uploadedAt: 3 },
    { id: "b3", number: 3, group: "B", title: null, pageCount: null, uploadedAt: 4 },
    { id: "a3", number: 3, group: "A", title: null, pageCount: null, uploadedAt: 5 },
  ];
  assert.deepEqual(normalizeChapters(uploads).map((c) => c.id), ["a1", "a2", "a3"]);
  assert.deepEqual(normalizeChapters(uploads, "B").map((c) => c.id), ["b1", "a2", "b3"]);
  assert.deepEqual(chapterListing(uploads, "A", "", true).map((c) => c.id), ["a3", "a2", "a1"]);
  assert.deepEqual(chapterListing(uploads, null, "two", false).map((c) => c.id), ["a2"]);
  const list = normalizeChapters(uploads);
  assert.equal(resumeTarget(list, {}).id, "a1");
  assert.equal(resumeTarget(list, { 1: { page: 9, pageCount: 10, updatedAt: 5 } }).id, "a2");
  assert.equal(resumeTarget(list, { 2: { page: 3, pageCount: 10, updatedAt: 5 } }).id, "a2");
});

test("only public HTTPS addresses are accepted", () => {
  assert.ok(publicHttps("https://mangadot.net/x"));
  for (const bad of ["http://mangadot.net/x", "https://localhost/x", "https://127.0.0.1/x", "https://user:pw@mangadot.net/", "https://box.local/x", "https://mangadot.net:8443/x"]) {
    assert.equal(publicHttps(bad), null, bad);
  }
});

test("two-page spreads: cover alone, then pairs, wide pages alone", async () => {
  const { spreadsOf } = await import("../packages/shared/manga.ts");
  assert.deepEqual(spreadsOf(5, false, () => false), [[0], [1, 2], [3, 4]]);
  assert.deepEqual(spreadsOf(5, true, () => false), [[0, 1], [2, 3], [4]]);
  assert.deepEqual(spreadsOf(6, false, (i) => i === 2), [[0], [1], [2], [3, 4], [5]]);
});

// ── Downloads and Updates ────────────────────────────────────────────────────

const upload = (id, number, group, pageCount = null) => ({ id, number, group, title: null, pageCount, uploadedAt: null });
const saved = (mangaId, chapter, status = "done") => ({
  key: downloadKey(mangaId, chapter.id), mangaId, mangaTitle: "Example", cover: null, country: null, sourceId: "mangaball",
  sourceTitleId: titleId, sourceTitle: "Example", chapter, status, done: 0, total: 0, error: null, sizeBytes: 0,
});

test("latest chapter fields from both sources' detail endpoints", () => {
  const ball = mangaBallDetail({ data: { ...ballDetail().data, latest_chapter_number: 202, updated_at: "2025-10-02T13:07:48.357000" } });
  assert.equal(ball.latestChapter, 202);
  assert.equal(ball.latestAt, 1759410468357);
  assert.equal(mangaBallDetail(ballDetail()).latestChapter, null);
  const dot = mangaDotDetail({ manga: { id: 99, title: "X", latest_chapter_number: "143.5", last_chapter_date: "2026-04-29 20:49:55+00" } });
  assert.equal(dot.latestChapter, 143.5);
  assert.equal(dot.latestAt, Date.parse("2026-04-29T20:49:55Z"));
  const none = mangaDotDetail({ manga: { id: 99, title: "X", latest_chapter_number: null, last_chapter_date: "soon" } });
  assert.equal(none.latestChapter, null);
  assert.equal(none.latestAt, null);
});

test("MangaBall's single-call chapter listing comes back in the paged listing's order", () => {
  // POST /chapter/chapter-listing-by-title-id: every upload at once, newest first, no pagination block.
  const uploads = mangaBallAllChapters({ status: "success", data: [
    { id: "6ac87738052042d762e1fa61", title_id: "68515540702284f8341784c8", lang: "en", name: "Chapter 1195", number: 1195, status: "published",
      created_at: "2026-10-09T05:10:16.119000", chapter_number: 1195, group: { id: "6a4f73cf8ecdd020b95469d2", _id: "6a4f73cf8ecdd020b95469d2", name: "Meganium", slug: "meganium" } },
    { id: "6ac87738052042d762e1fa60", lang: "en", name: "Chapter 1195", number: 1195, status: "published", created_at: "2026-10-09T02:53:26.916000", group: { name: "Ho-oh" } },
    { id: "6ac87738052042d762e1fa62", lang: "en", name: "Chapter 1194: Title", number: 1194, status: "published", created_at: "2026-10-02T05:10:16.119000", group: { name: "Swampert" } },
  ] });
  // Chapter number, then upload time: the older of two uploads of a number comes first.
  assert.deepEqual(uploads.map((c) => [c.number, c.group, c.title]), [[1194, "Swampert", "Title"], [1195, "Ho-oh", null], [1195, "Meganium", null]]);
  assert.deepEqual(mangaBallAllChapters({ status: "success", data: [] }), []);
});

test("MangaBall's newest chapter comes from its newest English uploads", () => {
  const latest = mangaBallLatest({ data: [
    { id: "6acbae52a91bdf88681cd38e", lang: "en", number: 134, status: "published", created_at: "2026-10-11T15:42:10.401000", group: { name: "Swampert" } },
    { id: "6acbacbbf0fedfcd3333e992", lang: "en", number: 134, status: "published", created_at: "2026-10-11T15:35:23.147000" },
    { id: "6ac27255052042d762e1eed1", lang: "en", number: 133, status: "published", created_at: "2026-10-04T15:35:49.195000" },
    { id: "6ac27255052042d762e1eed2", lang: "fr", number: 135, status: "published", created_at: "2026-10-12T00:00:00" },
  ], pagination: { total_pages: 122 } });
  assert.deepEqual(latest, { chapter: 134, at: Date.parse("2026-10-11T15:42:10.401Z") });
  assert.equal(mangaBallLatest({ data: [] }), null);
  assert.deepEqual(mangaBallLatest({ data: [{ id: "6ac27255052042d762e1eed1", lang: "en", number: 2 }] }), { chapter: 2, at: null });
});

test("range downloads: one upload per number, group gaps, presets and the starting group", () => {
  const uploads = [upload("a1", 1, "A"), upload("b1", 1, "B"), upload("a2", 2, "A"), upload("b3", 3, "B"), upload("a3", 3, "A")];
  const ids = (list) => list.map((c) => c.id);
  assert.deepEqual(ids(rangeChoice(uploads, "B", 1, 3, true).chapters), ["b1", "a2", "b3"]);
  assert.deepEqual(ids(rangeChoice(uploads, "B", 1, 3, true).gaps), ["a2"]);
  assert.deepEqual(ids(rangeChoice(uploads, "B", 1, 3, false).chapters), ["b1", "b3"]);
  assert.deepEqual(ids(rangeChoice(uploads, null, 3, 2, false).chapters), ["a2", "a3"]);
  assert.deepEqual(rangeChoice(uploads, null, 3, 2, false).gaps, []);
  assert.deepEqual(ids(withUpload(rangeChoice(uploads, null, 1, 3, true).chapters, uploads[1])), ["b1", "a2", "a3"]);

  const series = Array.from({ length: 30 }, (_, i) => upload(`c${i + 1}`, i + 1, "A"));
  assert.deepEqual(rangePresets(series, series[4]), [["Next 10", 5, 14], ["Next 25", 5, 29], ["All unread", 5, 30], ["All", 1, 30]]);
  // In a 12-chapter series the next 10, the next 25 and all unread are one range: the broadest label stays.
  assert.deepEqual(rangePresets(series.slice(0, 12), series[4]), [["All unread", 5, 12], ["All", 1, 12]]);
  assert.deepEqual(rangePresets(series.slice(0, 20), series[4]), [["Next 10", 5, 14], ["All unread", 5, 20], ["All", 1, 20]]);
  assert.deepEqual(rangePresets(series.slice(0, 3), null), [["All", 1, 3]]);
  assert.deepEqual(rangePresets([], null), []);

  const groups = [["A", 3], ["B", 2]];
  assert.equal(rangeStartGroup([saved(7, upload("b1", 1, "B")), saved(7, upload("b3", 3, "B")), saved(7, upload("a2", 2, "A"))], groups, "A"), "B");
  assert.equal(rangeStartGroup([saved(7, upload("z1", 1, "Gone"))], groups, "A"), "A");
  assert.equal(rangeStartGroup([], groups, null), "A");
  assert.equal(rangeStartGroup([], [], null), null);
});

test("range downloads never save the same chapter number twice", () => {
  const items = [
    saved(7, upload("a2", 2, "A")),
    saved(7, upload("b3", 3, "B"), "failed"),
    saved(7, upload("a4", 4, "A"), "queued"),
    saved(8, upload("x1", 1, "A")),
  ];
  assert.deepEqual([...heldChapters(items, 7).keys()].sort(), [2, 4]);
  const plan = planRange([upload("a3", 3, "A"), upload("a1", 1, "A"), upload("a2", 2, "A"), upload("b1", 1, "B"), upload("a4", 4, "A")], items, 7);
  assert.deepEqual(plan.add.map((c) => c.id), ["a1", "a3"]);
  assert.deepEqual(plan.drop, ["7:b3"]);
  // Retrying the failed upload itself keeps its row instead of dropping it.
  assert.deepEqual(planRange([upload("b3", 3, "B")], items, 7), { add: [upload("b3", 3, "B")], drop: [] });
});

test("continuing downloads counts progress on downloaded chapters only", () => {
  const saved = [upload("a199", 199, "A"), upload("b200", 200, "B")];
  const progress = { 200: { page: 7, pageCount: 22, updatedAt: 10 }, 202: { page: 0, pageCount: 20, updatedAt: 20 } };
  // Chapter 202 was read online (not saved): the in-progress download, 200, is where to continue.
  assert.equal(resumeTarget(saved, progress).id, "a199");
  assert.equal(resumeTarget(saved, progressFor(saved, progress)).id, "b200");
  assert.deepEqual(Object.keys(progressFor(saved, progress)), ["200"]);
  assert.deepEqual(progressFor(saved, { 5: { page: 1, pageCount: 2, updatedAt: 1 } }), {});
});

test("download files: keys, chapter folders, page files and types", () => {
  assert.equal(downloadKey(21, "user:25424"), "21:user:25424");
  assert.ok(isSourceChapterId("mangaball", "68de79241ec6dc083a3051ee"));
  assert.ok(isSourceChapterId("mangadot", "scraper:327776"));
  assert.ok(isSourceChapterId("comix", "123456789"));
  for (const [source, id] of [["mangaball", "user:1"], ["mangadot", "evil:1"], ["mangadot", "user:1/../x"], ["comix", "68de79241ec6dc083a3051ee"]]) {
    assert.ok(!isSourceChapterId(source, id), `${source} ${id}`);
  }
  assert.equal(chapterFolder("user:25424"), "user_25424");
  assert.equal(chapterFolder("68de79241ec6dc083a3051ee"), "68de79241ec6dc083a3051ee");
  for (const bad of ["../x", "a/b", "a\\b", "", "x".repeat(65)]) assert.equal(chapterFolder(bad), null, bad);
  for (const good of ["001.webp", "012.jpg", "1200.png"]) assert.ok(PAGE_FILE.test(good), good);
  for (const bad of ["../001.webp", "001.exe", "a.webp", "001.webp.part", "meta.json"]) assert.ok(!PAGE_FILE.test(bad), bad);
  assert.equal(pageExtension("image/webp", "https://cdn.example/a.jpg"), "webp");
  assert.equal(pageExtension("image/jpeg; charset=binary", "https://cdn.example/a"), "jpg");
  assert.equal(pageExtension(null, "https://cdn.example/a/001.JPEG?x=1"), "jpg");
  assert.equal(pageExtension("application/octet-stream", "https://cdn.example/a"), "img");
  assert.equal(pageContentType("001.webp"), "image/webp");
  assert.equal(pageContentType("001.img"), "application/octet-stream");
  assert.equal(humanSize(0), "");
  assert.equal(humanSize(500), "1 KB");
  assert.equal(humanSize(5 * 1024 * 1024 + 7), "5 MB");
  assert.equal(humanSize(1.5 * 1024 ** 3), "1.5 GB");
});

test("page sizes from image headers", () => {
  const ascii = (text) => [...text].map((c) => c.charCodeAt(0));
  const be32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  const le16 = (n) => [n & 0xff, (n >>> 8) & 0xff];
  const le24 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff];
  const riff = (chunk, payload) => new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"), ...ascii(chunk), 0, 0, 0, 0, ...payload, ...new Array(16).fill(0)]);
  const png = new Uint8Array([0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...ascii("IHDR"), ...be32(1200), ...be32(16848)]);
  assert.deepEqual(imageSize(png), { width: 1200, height: 16848 });
  assert.deepEqual(imageSize(new Uint8Array([...ascii("GIF89a"), ...le16(640), ...le16(480)])), { width: 640, height: 480 });
  assert.deepEqual(imageSize(riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(800), ...le16(1200)])), { width: 800, height: 1200 });
  const lossless = ((800 - 1) | ((1200 - 1) << 14)) >>> 0;
  assert.deepEqual(imageSize(riff("VP8L", [0x2f, lossless & 0xff, (lossless >>> 8) & 0xff, (lossless >>> 16) & 0xff, (lossless >>> 24) & 0xff])), { width: 800, height: 1200 });
  assert.deepEqual(imageSize(riff("VP8X", [0x10, 0, 0, 0, ...le24(1599), ...le24(2399)])), { width: 1600, height: 2400 });
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const exif = [0xff, 0xe1, 0x00, 0x08, ...ascii("Exif"), 0, 0];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x05, 0x46, 0x03, 0x84, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  assert.deepEqual(imageSize(new Uint8Array([0xff, 0xd8, ...app0, ...sof, 0xff, 0xd9])), { width: 900, height: 1350 });
  assert.equal(imageSize(new Uint8Array([0xff, 0xd8, ...exif, ...sof, 0xff, 0xd9])), null);
  assert.equal(imageSize(new Uint8Array(ascii("<html>Just a moment</html>"))), null);
  assert.equal(imageSize(new Uint8Array()), null);
});

test("meta.json round trip and rejection of foreign files", () => {
  const meta = {
    manga: { id: 7, title: "Example", cover: null, country: "KR" },
    title: { sourceId: "mangaball", id: titleId, title: "Example" },
    chapter: { id: "68de79241ec6dc083a3051ee", number: 12.5, title: "Side", group: "Suicune", pageCount: 2, uploadedAt: 1759410468357 },
    pages: [{ file: "001.webp", w: 800, h: 1200 }, { file: "002.jpg", w: null, h: null }],
    complete: true,
    sizeBytes: 1234,
  };
  assert.deepEqual(downloadMeta(JSON.parse(downloadMetaJson(meta))), meta);
  const partial = downloadMeta(JSON.parse(downloadMetaJson({ ...meta, pages: [], complete: true })));
  assert.equal(partial.complete, false);
  assert.equal(partial.chapter.pageCount, null);
  const json = JSON.parse(downloadMetaJson(meta));
  assert.equal(downloadMeta({ ...json, pages: [{ file: "../../evil.webp" }] }), null);
  assert.equal(downloadMeta({ ...json, sourceId: "comix" }), null);
  assert.equal(downloadMeta({ ...json, chapterId: "../x" }), null);
  assert.equal(downloadMeta({ ...json, mangaId: -1 }), null);
  assert.equal(downloadMeta("not json"), null);
});

test("download events keep rows in place", () => {
  const a = saved(7, upload("a1", 1, "A"), "queued");
  const b = saved(7, upload("a2", 2, "A"), "queued");
  let items = applyDownloadEvent([], { item: a });
  items = applyDownloadEvent(items, { item: b });
  items = applyDownloadEvent(items, { item: { ...a, status: "done" } });
  assert.deepEqual(items.map((i) => [i.key, i.status]), [["7:a1", "done"], ["7:a2", "queued"]]);
  assert.deepEqual(applyDownloadEvent(items, { removed: ["7:a1", "missing"] }).map((i) => i.key), ["7:a2"]);
});

test("updates: tracked titles and new chapters since the last read one", () => {
  const row = (mangaId, title) => ({ mangaId, chapter: 1, chapterId: "x", page: 0, pageCount: 1, title, cover: null, sourceId: "mangaball", updatedAt: 1 });
  const entry = (mangaId, status) => ({ mangaId, status, title: `List ${mangaId}`, cover: "c", updatedAt: 1 });
  const tracked = trackedTitles(
    [row(1, "Read one"), row(2, "Read two")],
    [entry(2, "reading"), entry(3, "plan_to_read"), entry(4, "dropped"), entry(5, "completed"), entry(6, "on_hold")],
    { 1: 10, 2: 3.5 },
  );
  assert.deepEqual(tracked.map((t) => [t.mangaId, t.title, t.lastRead]), [[1, "Read one", 10], [2, "Read two", 3.5], [3, "List 3", null], [6, "List 6", null]]);
  assert.equal(trackedTitles([row(1, "a"), row(2, "b")], [], {}, 1).length, 1);
  assert.equal(newChapterCount(12, 10), 2);
  assert.equal(newChapterCount(10.5, 10), 1);
  assert.equal(newChapterCount(10, 10), 0);
  assert.equal(newChapterCount(9, 10), 0);
  assert.equal(newChapterCount(null, 10), 0);
  assert.equal(newChapterCount(12, null), null);
});

test("chapter numbers drop floating-point noise, so one chapter stays one number", () => {
  const ball = mangaBallChapters({ data: [
    { id: "6acbacbbf0fedfcd3333e990", lang: "en", number: 7.199999999999999, group: { name: "Swampert" } },
    { id: "6acbacbbf0fedfcd3333e991", lang: "en", number: 7.2, group: { name: "Meganium" } },
    { id: "6acbacbbf0fedfcd3333e992", lang: "en", number: 140.25, group: { name: "Meganium" } },
  ] });
  assert.deepEqual(ball.chapters.map((c) => c.number), [7.2, 7.2, 140.25]);
  assert.equal(normalizeChapters(ball.chapters).length, 2);
  const dot = mangaDotChapters([{ id: 1, chapter_number: "12.500000000001", language: "en", page_count: 5, source: "user" }]);
  assert.equal(dot[0].number, 12.5);
  assert.equal(mangaBallDetail({ data: { ...ballDetail().data, latest_chapter_number: 7.199999999999999 } }).latestChapter, 7.2);
});
