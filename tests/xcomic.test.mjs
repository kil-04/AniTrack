import test from "node:test";
import assert from "node:assert/strict";
import {
  isXComicImage,
  parseXComicTitleRef,
  xcomicBestEdition,
  xcomicChapterNumber,
  xcomicChapters,
  xcomicDetail,
  xcomicEditions,
  xcomicLatest,
  xcomicPages,
  xcomicSearchIds,
} from "../packages/shared/xcomic.ts";

// Shapes copied from xcomic.me on 19 Oct 2026 (trimmed; Qwik's ":" attributes kept).
const card = (id, flag, name, chapters, follows, latest, time, group) =>
  `<div :="${id}" class="border border-base-300 hover:bg-base-200 relative"><div : class="flex"><div : class="flex-1 min-w-0 p-2 space-y-2"><div : class="flex items-baseline min-w-0"><span : class="md:truncate"><span class="font-family-NotoColorEmoji mr-1" :="c2_0">${flag}</span><a href="/source/${id}" : class="link-hover link-pri font-medium">${name}</a></span></div><div : class="flex flex-nowrap items-baseline gap-2 min-w-0 text-md truncate"><span class="font-variant-small-caps text-success" :="fJ_0">Ongoing</span><span : class="opacity-60">${chapters} chapters · ${follows} follows</span></div><div : class="flex flex-nowrap"><a href="/chapter/abc${id}" : class="link-hover link-primary truncate">${latest}</a><time class="opacity-60" data-time="${time}" :="jq_1"><span>9d ago</span></time></div></div></div>${group ? `<div :="1a_8" class="absolute -left-1 -top-2"><span : class="px-1.5 border border-primary/30 bg-base-100 text-primary text-xs rounded-box whitespace-nowrap line-clamp-1 truncate">${group}</span></div>` : ""}</div>`;

const HUB = `<h3 class="text-2xl">ONE PIECE</h3><a href="https://anilist.co/manga/30013">AniList</a><a href="https://myanimelist.net/manga/13">MAL</a>
<div : class="grid gap-3">${card("m78yb8", "🇬🇧", "One Piece", "1,199", "0", "Chapter 1195", "1791534731786", "TCB Scans")}${card("8kybo", "🇬🇧", "One Piece", "1,172", "4,597", "Chapter 1171", "1768567503087", null)}${card("ptbr1", "🇧🇷", "One Piece", "1,300", "9", "Capítulo 1180", "1791534731000", null)}${card("8kybo", "🇬🇧", "dup", "1", "1", "Chapter 1", "1", null)}</div>`;

const row = (id, label, name, time) =>
  `<div class="break-inside-avoid px-2 py-2 flex justify-between items-baseline border border-base-300/90 rounded-box" :="Ev_5"><div : class="flex-1 min-w-0 truncate space-x-1"><a href="/chapter/${id}" : class="link-hover link-primary visited:text-accent">${label}</a>${name ? `<span :="Ev_1" class="opacity-80">: ${name}</span>` : ""}</div><div : class="flex-none"><dpv : class="pl-2"><time class="" data-time="${time}" :="jq_1"><span>275d ago</span></time></dpv></div></div>`;
const EDITION = `<div class="gap-2 space-y-2 columns-1">${row("xj263r3", "Chapter 1171", "Ragnir", "1768567503087")}${row("46x5qa2", "Vol.TBE Ch.1170", "Contradictions", "1768000000000")}${row("vol9999", "Volume 105", null, "1")}${row("xjqyjr3", "Volume 105 Chapter 1065.5", null, "1700000000000")}</div><a href="/source/8kybo?page=1">1</a><a href="/source/8kybo?page=2">2</a><a href="/source/8kybo?page=6">6</a>`;

test("xcomic: search ids in order, without repeats", () => {
  const html = `<a href="/title/kolxr"><img alt="ONE PIECE"></a><a href="/title/kolxr">ONE PIECE</a><a href="/title/x8jxo">x</a><a href="/title/BAD!">y</a>`;
  assert.deepEqual(xcomicSearchIds(html), ["kolxr", "x8jxo"]);
});

test("xcomic: edition cards, and the English one with the most chapters wins", () => {
  const editions = xcomicEditions(HUB);
  assert.equal(editions.length, 3);
  assert.deepEqual(editions[0], {
    id: "m78yb8", name: "One Piece", flag: "🇬🇧", chapters: 1199, follows: 0,
    latestChapter: 1195, latestAt: 1791534731786, group: "TCB Scans",
  });
  assert.equal(editions[1].follows, 4597);
  // The Portuguese edition has more chapters but isn't English.
  assert.equal(xcomicBestEdition(editions).id, "m78yb8");
});

test("xcomic: a title page gives its tracker ids and the edition AniTrack reads", () => {
  const detail = xcomicDetail(HUB, "kolxr");
  assert.equal(detail.id, "kolxr.m78yb8");
  assert.equal(detail.title, "ONE PIECE");
  assert.equal(detail.anilistId, 30013);
  assert.equal(detail.malId, 13);
  assert.equal(detail.latestChapter, 1195);
  assert.deepEqual(parseXComicTitleRef(detail.id), { titleId: "kolxr", editionId: "m78yb8" });
  assert.equal(parseXComicTitleRef("kolxr"), null);
  // No English edition, no match.
  assert.equal(xcomicDetail(HUB.replace(/🇬🇧/g, "🇫🇷"), "kolxr"), null);
});

test("xcomic: chapter rows, numbers from any label style, and the last list page", () => {
  const { chapters, lastPage } = xcomicChapters(EDITION, "TCB Scans");
  assert.equal(lastPage, 6);
  assert.deepEqual(chapters.map((c) => c.number), [1171, 1170, 1065.5]);
  assert.deepEqual(chapters[0], { id: "xj263r3", number: 1171, title: "Ragnir", group: "TCB Scans", pageCount: null, uploadedAt: 1768567503087 });
  assert.equal(chapters[2].title, null);
  assert.deepEqual(xcomicLatest(EDITION), { chapter: 1171, at: 1768567503087 });
  assert.equal(xcomicChapterNumber("Capítulo 12"), null);
  // Without a group passed in, the edition's badge above the list names it.
  const badged = `<span : class="px-1.5 text-xs rounded-box whitespace-nowrap">TCB Scans</span>` + EDITION;
  assert.equal(xcomicChapters(badged).chapters[0].group, "TCB Scans");
  assert.equal(xcomicChapters(EDITION).chapters[0].group, null);
  assert.equal(xcomicChapterNumber("12"), 12);
});

test("xcomic: page images come from the page state, only on its image hosts", () => {
  const html = `..."vote_val",0,9.4],0,"imageUrls",4,[0,"https://i04.img00.org/_f/3b/Bp/lxXvpB/a.webp",0,"https://i09.img02.org/_f/3b/Bp/lxXvpB/b.webp",0,"https://evil.example/_f/c.webp",0,"https://i04.img00.org/_f/3b/Bp/lxXvpB/a.webp"],0,"next"...`;
  assert.deepEqual(xcomicPages(html), [
    "https://i04.img00.org/_f/3b/Bp/lxXvpB/a.webp",
    "https://i09.img02.org/_f/3b/Bp/lxXvpB/b.webp",
  ]);
  assert.equal(xcomicPages("<p>no state</p>").length, 0);
  assert.equal(isXComicImage(new URL("https://i01.img02.org/_f/x.webp")), true);
  assert.equal(isXComicImage(new URL("https://img02.org/_f/x.webp")), false);
  assert.equal(isXComicImage(new URL("http://i01.img02.org/_f/x.webp")), false);
});
