import test from "node:test";
import assert from "node:assert/strict";
import {
  ComixHtmlPageParser, COMIX_HTML_MAX_PAGES,
} from "../apps/desktop/main/services/manga/comix-html-pages.ts";

const parser = new ComixHtmlPageParser();
const page = (n) => `https://img.example-cdn.net/c/42/${n}.webp`;

test("Comix HTML: page images in document order, other images ignored", () => {
  const html = `<div class="rpage">
    <img class="site-logo" src="https://comix.to/logo.png">
    <img src="${page(1)}" class="rpage-page__img" alt="1">
    <img class='rpage-page__img is-loaded' alt=2 src='${page(2)}'/>
    <IMG CLASS="rpage-page__img" SRC=${page(3)}>
    <img class="rpage-page__img-wrapper" src="https://comix.to/x.png">
  </div>`;
  assert.deepEqual(parser.extractMangaPages(html), [page(1), page(2), page(3)]);
});

test("Comix HTML: relative, protocol-relative, entity and lazy sources", () => {
  const html = `
    <img class="rpage-page__img" src="/i/1.jpg?a=1&amp;b=2#frag">
    <img class="rpage-page__img" src="//img.example-cdn.net/2.jpg">
    <img class="rpage-page__img" src="data:image/gif;base64,R0lGOD" data-src="${page(3)}">
    <img class="rpage-page__img" data-alt=">" src="${page(4)}">`;
  assert.deepEqual(parser.extractMangaPages(html), [
    "https://comix.to/i/1.jpg?a=1&b=2", "https://img.example-cdn.net/2.jpg", page(3), page(4),
  ]);
});

test("Comix HTML: rejects unsafe URLs and duplicates; empty input is empty", () => {
  const html = `
    <img class="rpage-page__img" src="http://img.example-cdn.net/1.jpg">
    <img class="rpage-page__img" src="https://user:pw@img.example-cdn.net/2.jpg">
    <img class="rpage-page__img" src="https://img.example-cdn.net:8443/3.jpg">
    <img class="rpage-page__img" src="javascript:alert(1)">
    <img class="rpage-page__img" src="${page(5)}"><img class="rpage-page__img" src="${page(5)}">`;
  assert.deepEqual(parser.extractMangaPages(html), [page(5)]);
  assert.deepEqual(parser.extractMangaPages(""), []);
});

test("Comix HTML: bounded page count", () => {
  const html = Array.from({ length: COMIX_HTML_MAX_PAGES + 1 }, (_, i) => `<img class="rpage-page__img" src="${page(i)}">`).join("");
  assert.throws(() => parser.extractMangaPages(html), /too many pages/);
});
