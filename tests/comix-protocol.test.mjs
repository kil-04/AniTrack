import test from "node:test";
import assert from "node:assert/strict";
import {
  COMIX_ORIGIN, COMIX_MAX_RESPONSE, comixValidRequest, comixNetworkAllowed, comixPublicConnectionPage,
  comixSearchIds, comixDetail, comixChapters, comixHasNext, comixPages,
} from "../apps/desktop/main/services/manga/comix-protocol.ts";
import { sourceMatches } from "../packages/shared/manga.ts";

const search = { keyword: "Example Saga", page: 1, limit: 20, "order[relevance]": "desc" };
const chapters = { page: 2, limit: 100, "order[number]": "asc" };
const title = (over = {}) => ({ hid: "abc123", title: "Example Saga", altTitles: ["Rei no Saga"], year: 2018, originalLanguage: "ko", ...over });
const manga = (over = {}) => ({
  id: 500, malId: 77, title: "Example Saga", titleRomaji: "Rei no Saga", synonyms: [], year: 2018, country: "KR", ...over,
});

test("Comix: exact bounded public catalogue operations", () => {
  assert.equal(COMIX_ORIGIN, "https://comix.to");
  assert.equal(COMIX_MAX_RESPONSE, 200_000);
  assert.ok(comixValidRequest("/manga", search));
  assert.ok(comixValidRequest("/manga/abc123/chapters", chapters));
  assert.ok(comixValidRequest("/manga/abc123", {}));
  assert.ok(comixValidRequest("/chapters/123456789012345", {}));
  assert.ok(comixValidRequest("/manga", { ...search, page: "1", limit: "20" }));
  for (const [path, params] of [
    ["/account", {}], ["/manga/a/chapters/1", {}], ["/manga/../account", {}], ["/manga/a_b", {}],
    ["/chapters/1234567890123456", {}], ["/manga/a", { arbitrary: 1 }],
    ["/manga", { ...search, page: 2 }], ["/manga", { ...search, page: 1.5 }],
    ["/manga", { ...search, keyword: "" }], ["/manga", { ...search, keyword: "a".repeat(201) }],
    ["/manga", { ...search, limit: 100 }], ["/manga", { ...search, "order[relevance]": "asc" }],
    ["/manga/a/chapters", { ...chapters, page: 0 }], ["/manga/a/chapters", { ...chapters, page: 201 }],
    ["/manga/a/chapters", { ...chapters, "order[number]": "desc" }], ["/manga/a", null],
  ]) assert.equal(comixValidRequest(path, params), false, path);
});

test("Comix: network confinement and manual-only challenge resources", () => {
  for (const path of ["/", "/assets/main-hash.js", "/favicon.ico", "/api/v1/manga?keyword=x", "/api/v1/manga/a", "/api/v1/manga/a/chapters", "/api/v1/chapters/123"])
    assert.ok(comixNetworkAllowed(COMIX_ORIGIN + path, "GET", path === "/", false), path);
  for (const url of ["https://challenges.cloudflare.com/turnstile/v0/a", COMIX_ORIGIN + "/cdn-cgi/challenge-platform/test"])
    for (const method of ["GET", "POST"]) {
      assert.ok(comixNetworkAllowed(url, method, false, true));
      assert.equal(comixNetworkAllowed(url, method, false, false), false);
      assert.equal(comixNetworkAllowed(url, method, true, true), false);
    }
  for (const path of ["/account", "/login", "/api/v1/account", "/api/v1/chapters/1/account", "/api/v1/manga/a/comments", "/cdn-cgi/trace", "/assets/../account"])
    assert.equal(comixNetworkAllowed(COMIX_ORIGIN + path, "GET", false, true), false, path);
  for (const url of ["http://comix.to/", "https://comix.to:8443/", "https://user@comix.to/", "https://comix.to.evil.example/", "https://127.0.0.1/", "https://comix.to/#x"])
    assert.equal(comixNetworkAllowed(url, "GET", true, true), false, url);
  assert.equal(comixNetworkAllowed(COMIX_ORIGIN + "/api/v1/manga", "POST", false, true), false);
  assert.equal(comixNetworkAllowed(COMIX_ORIGIN + "/assets/x.js", "GET", true, true), false);
  assert.equal(comixNetworkAllowed(COMIX_ORIGIN + "/", "PUT", false, true), false);
});

test("Comix: Cloudflare's full-page check may return to the homepage only while connecting", () => {
  for (const url of [COMIX_ORIGIN + "/", COMIX_ORIGIN + "/?__cf_chl_f_tk=fixture"]) {
    assert.equal(comixNetworkAllowed(url, "POST", true, true), true, url);
    assert.equal(comixNetworkAllowed(url, "POST", true, false), false, url); // Never in the hidden session.
    assert.equal(comixNetworkAllowed(url, "POST", false, true), false, url); // Never as a subresource.
  }
  for (const path of ["/browse", "/title/abc123", "/api/v1/manga", "/account", "/@waf/challenge"])
    assert.equal(comixNetworkAllowed(COMIX_ORIGIN + path, "POST", true, true), false, path);
  for (const url of ["https://comix.to.evil.example/", "http://comix.to/", "https://comix.to:8443/"])
    assert.equal(comixNetworkAllowed(url, "POST", true, true), false, url);
});

test("Comix: normal manual browsing and exact website WAF routes are connection-only", () => {
  for (const path of ["/browse", "/browse?keyword=Berserk", "/title/xg6r1-berserk", "/title/abc123"]) {
    assert.equal(comixPublicConnectionPage(COMIX_ORIGIN + path), true, path);
    assert.equal(comixNetworkAllowed(COMIX_ORIGIN + path, "GET", true, true), true, path);
    assert.equal(comixNetworkAllowed(COMIX_ORIGIN + path, "GET", false, true), true, path); // Site's own HTML navigation fetch.
    assert.equal(comixNetworkAllowed(COMIX_ORIGIN + path, "GET", false, false), false, path);
    assert.equal(comixNetworkAllowed(COMIX_ORIGIN + path, "GET", true, false), false, path);
    assert.equal(comixNetworkAllowed(COMIX_ORIGIN + path, "POST", true, true), false, path);
  }
  for (const main of [true, false]) {
    assert.equal(comixNetworkAllowed(COMIX_ORIGIN + "/@waf/challenge?return=%2F", "GET", main, true), true);
    assert.equal(comixNetworkAllowed(COMIX_ORIGIN + "/@waf/challenge", "GET", main, false), false);
    assert.equal(comixNetworkAllowed(COMIX_ORIGIN + "/@waf/challenge", "POST", main, true), false);
  }
  for (const [path, method] of [["/@waf/generate", "GET"], ["/@waf/verify", "POST"]]) {
    assert.equal(comixNetworkAllowed(COMIX_ORIGIN + path, method, false, true), true);
    assert.equal(comixNetworkAllowed(COMIX_ORIGIN + path, method, false, false), false);
    assert.equal(comixNetworkAllowed(COMIX_ORIGIN + path, method, true, true), false);
    assert.equal(comixNetworkAllowed(COMIX_ORIGIN + path, method === "GET" ? "POST" : "GET", false, true), false);
  }
  for (const path of ["/@waf/unknown", "/@waf/verify/extra", "/title/id/chapter-1", "/title/id/account", "/browse/other", "/title/%61bc", "/assets/%2e%2e/account", "/assets/../assets/main.js", "/title//id"]) {
    assert.equal(comixPublicConnectionPage(COMIX_ORIGIN + path), false, path);
    assert.equal(comixNetworkAllowed(COMIX_ORIGIN + path, "GET", true, true), false, path);
    assert.equal(comixNetworkAllowed(COMIX_ORIGIN + path, "POST", false, true), false, path);
  }
  assert.equal(comixPublicConnectionPage(COMIX_ORIGIN + "/@waf/challenge"), false);
  assert.equal(comixNetworkAllowed(COMIX_ORIGIN + "/assets/%2e%2e/assets/main.js", "GET", false, true), false);
  assert.equal(comixNetworkAllowed(COMIX_ORIGIN + "/api/v1/%6danga", "GET", false, true), false);
});

test("Comix: validated, unique and bounded search identities", () => {
  assert.deepEqual(comixSearchIds({ items: [{ hid: "a" }, { hid: "a" }, { hid: "b" }, { hid: "not_a_hid" }, null] }), ["a", "b"]);
  assert.equal(comixSearchIds({ items: Array.from({ length: 30 }, (_, i) => ({ hid: "a" + i })) }).length, 20);
  assert.throws(() => comixSearchIds({ error: "Not a catalogue" }), /format/);
});

test("Comix: title group filters are exact visible-connection GETs, never native read operations", () => {
  const url = COMIX_ORIGIN + "/api/v1/manga/eqr1e/groups";
  assert.equal(comixNetworkAllowed(url, "GET", false, true), true);
  assert.equal(comixNetworkAllowed(url, "GET", false, false), false);
  assert.equal(comixNetworkAllowed(url, "GET", true, true), false);
  for (const method of ["POST", "HEAD", "PUT", "DELETE"])
    assert.equal(comixNetworkAllowed(url, method, false, true), false);
  for (const path of ["/api/v1/manga/eqr1e/groups?", "/api/v1/manga/eqr1e/groups?other=1", "/api/v1/manga/eqr1e/groups/account", "/api/v1/manga/eqr1e/group", "/api/v1/manga/eqr_1/groups"])
    assert.equal(comixNetworkAllowed(COMIX_ORIGIN + path, "GET", false, true), false, path);
  assert.equal(comixValidRequest("/manga/eqr1e/groups", {}), false);
  assert.equal(comixNetworkAllowed(COMIX_ORIGIN + "/title/eqr1e-overgeared/11480837-chapter-343", "GET", false, true), false);
});

test("Comix: genuine metadata and tracker identities, never requested-title guesses", () => {
  const value = comixDetail(title({ links: { al: "https://anilist.co/manga/500/example", mal: "https://myanimelist.net/manga/77/example" }, latestChapter: 7.5 }), "abc123");
  assert.equal(value.anilistId, 500);
  assert.equal(value.malId, 77);
  assert.equal(value.year, 2018);
  assert.equal(value.country, "KR");
  assert.equal(value.latestChapter, 7.5);
  assert.equal(value.latestAt, null);
  assert.ok(sourceMatches(value, manga({ year: 1999, country: "JP" })));
  assert.equal(comixDetail(title(), "different"), null);
  assert.equal(comixDetail(title({ hid: "a_b" })), null);
  assert.equal(comixDetail(title({ title: " " })), null);
  const unknown = comixDetail({ hid: "a", title: "Example Saga" });
  assert.equal(unknown.year, null);
  assert.equal(unknown.country, null);
  assert.equal(sourceMatches(unknown, manga()), false);
  assert.equal(sourceMatches(comixDetail(title({ year: 2020 })), manga()), false);
  assert.equal(sourceMatches(comixDetail(title({ originalLanguage: "ja" })), manga()), false);
  assert.equal(comixDetail(title({ year: "2018", originalLanguage: "unknown" })).year, null);
  assert.equal(comixDetail(title({ originalLanguage: "unknown" })).country, null);
  assert.equal(comixDetail(title({ originalLanguage: "constructor" })).country, null);
  assert.equal(sourceMatches(comixDetail(title({ links: { al: "https://anilist.co/manga/501" } })), manga()), false);
  assert.equal(sourceMatches(comixDetail(title({ links: { mal: "https://myanimelist.net/manga/78" } })), manga()), false);
  assert.equal(sourceMatches(comixDetail(title({ is18plus: true })), manga()), false);
});

test("Comix: tracker URLs cannot spoof identity", () => {
  for (const value of ["500", "http://anilist.co/manga/500", "https://anilist.co.evil.example/manga/500", "https://user@anilist.co/manga/500", "https://@anilist.co/manga/500", "https://anilist.co:8443/manga/500", "https://anilist.co/anime/500", "https://anilist.co/manga/500x", "https://anilist.co/manga/0", "https://anilist.co/manga/999999999999999999"])
    assert.equal(comixDetail(title({ links: { al: value } })).anilistId, null, value);
});

test("Comix: fractional chapter numbers, uploads and safe row bounds", () => {
  const parsed = comixChapters({ items: [
    { id: "123456789012345", number: 377.5, name: "Interlude", group: { name: "Group A" } },
    { id: 7, number: "377.5", name: "Second upload", group: { name: "Group B" } },
    { id: "8", number: 0 }, { id: "9", number: -1 }, { id: "a", number: 1 },
    { id: "1234567890123456", number: 1 }, { id: "10", number: Infinity }, { id: "11", number: null },
  ] });
  assert.deepEqual(parsed.map((row) => row.number), [377.5, 377.5, 0]);
  assert.deepEqual(parsed.map((row) => row.group), ["Group A", "Group B", null]);
  assert.equal(parsed[0].id, "123456789012345");
  assert.equal(parsed[0].pageCount, null);
  assert.equal(parsed[0].uploadedAt, null);
  assert.throws(() => comixChapters({ items: Array(101).fill({ id: "1", number: 1 }) }), /too many/);
  assert.throws(() => comixChapters({}), /format/);
});

test("Comix: complete pagination or explicit failure", () => {
  assert.equal(comixHasNext({ meta: { page: 1, lastPage: 3 } }, 1), true);
  assert.equal(comixHasNext({ pagination: { page: 3, last_page: 3 } }, 3), false);
  assert.equal(comixHasNext({ meta: { lastPage: 1 } }, 1), false);
  assert.equal(comixHasNext({ meta: { hasNext: true } }, 1), true);
  assert.equal(comixHasNext({ meta: { hasNext: false } }, 200), false);
  for (const [payload, page] of [
    [{}, 1], [{ meta: {} }, 1], [{ meta: { page: 1, lastPage: 4 } }, 2],
    [{ meta: { page: 2, lastPage: 1 } }, 2], [{ meta: { lastPage: 0 } }, 1],
    [{ meta: { lastPage: 201 } }, 1], [{ meta: { hasNext: "false" } }, 1],
    [{ meta: { page: 1, lastPage: 1, hasNext: true } }, 1], [{ meta: { hasNext: true } }, 200],
    [{ meta: { lastPage: 1 } }, 0], [{ meta: { lastPage: 1 } }, 1.5],
  ]) assert.throws(() => comixHasNext(payload, page), /Comix/);
});

test("Comix: absolute and directory-relative pages, including scrambled-image version flags", () => {
  const parsed = comixPages({ pages: { baseUrl: "https://images.example.org/chapter", items: [
    { url: "/001.webp", width: 800, height: 1200, s: 1 },
    { url: "002.webp?signature=a%2Bb", s: 1 },
    { url: "https://other.example.org/003.jpg?flag=x&v3=keep", s: 1 },
    { url: "004.webp?v3", s: 1 },
    { url: "005.webp", width: -1, height: 20001 },
  ] } });
  assert.deepEqual(parsed[0], { url: "https://images.example.org/chapter/001.webp?v3", width: 800, height: 1200 });
  assert.equal(parsed[1].url, "https://images.example.org/chapter/002.webp?signature=a%2Bb&v3");
  assert.equal(parsed[2].url, "https://other.example.org/003.jpg?flag=x&v3=keep");
  assert.equal(parsed[3].url, "https://images.example.org/chapter/004.webp?v3");
  assert.equal(parsed[4].width, null);
  assert.equal(parsed[4].height, null);
  assert.equal(comixPages({ pages: [{ url: "https://images.example.org/a.jpg" }] })[0].url, "https://images.example.org/a.jpg");
  assert.equal(comixPages(["https://images.example.org/a.jpg"])[0].url, "https://images.example.org/a.jpg");
  assert.equal(comixPages({ pages: { baseUrl: "broken", items: [{ url: "https://images.example.org/a.jpg" }] } })[0].url, "https://images.example.org/a.jpg");
  assert.equal(comixPages({ pages: [{ url: "https://images.example.org/a.jpg?", s: 1 }] })[0].url, "https://images.example.org/a.jpg?v3");
});

test("Comix: unsafe, missing and excessive page payloads fail closed", () => {
  for (const url of ["http://images.example.org/a", "https://127.0.0.1/a", "https://[::1]/a", "https://2130706433/a", "https://localhost/a", "https://machine.local/a", "https://machine.local./a", "https://machine.internal/a", "https://machine.lan/a", "https://machine.home.arpa/a", "https://machine.localdomain/a", "https://user@images.example.org/a", "https://@images.example.org/a", "https://images.example.org:8443/a", "https://images.example.org/a#x", "https://images.example.org/a#", "file:///a", "data:image/png,x", "https://images.example.org/a b"])
    assert.throws(() => comixPages({ pages: [{ url }] }), /Comix/, url);
  for (const payload of [{}, { pages: [] }, { pages: Array(501).fill({ url: "https://images.example.org/a.jpg" }) }, { pages: [{ url: "/a.jpg" }] }, { pages: { baseUrl: "https://images.example.org/?token=x", items: [{ url: "a.jpg" }] } }, { pages: [null] }])
    assert.throws(() => comixPages(payload), /Comix/);
});

test("Comix: rate-limit answers pause for the site's Retry-After, bounded", async () => {
  const { comixRetryAfterMs, comixIsChapterList, COMIX_CHAPTER_PAGE_INTERVAL_MS, COMIX_CHAPTER_LIST_DEADLINE_MS } =
    await import("../apps/desktop/main/services/manga/comix-protocol.ts");
  assert.equal(comixRetryAfterMs(502, "60"), 60_000);
  assert.equal(comixRetryAfterMs(429, " 5 "), 5_000);
  assert.equal(comixRetryAfterMs(503, "0"), 1_000);
  assert.equal(comixRetryAfterMs(502, "86400"), 300_000);
  const now = Date.parse("Wed, 14 Oct 2026 10:00:00 GMT");
  assert.equal(comixRetryAfterMs(502, "Wed, 14 Oct 2026 10:00:30 GMT", now), 30_000);
  for (const [status, header] of [[200, "60"], [403, "60"], [500, "60"], [502, null], [502, ""], [502, "soon"]]) {
    assert.equal(comixRetryAfterMs(status, header), null);
  }
  assert.ok(comixIsChapterList("/manga/zjem/chapters"));
  assert.ok(!comixIsChapterList("/manga/zjem") && !comixIsChapterList("/chapters/42"));
  // 200 pages at the observed-safe interval must fit inside the traversal deadline.
  assert.ok(200 * COMIX_CHAPTER_PAGE_INTERVAL_MS < COMIX_CHAPTER_LIST_DEADLINE_MS);
});
