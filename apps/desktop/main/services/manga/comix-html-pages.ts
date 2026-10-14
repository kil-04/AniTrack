/**
 * Data-only parser for a host-supplied Comix reader outerHTML snapshot.
 * It performs no network I/O and never evaluates the payload; it only scans
 * `<img class="rpage-page__img">` tags for their page URLs.
 */
const COMIX_ORIGIN = "https://comix.to";
export const COMIX_HTML_MAX_PAYLOAD = 4_000_000;
export const COMIX_HTML_MAX_PAGES = 500;

const PAGE_CLASS = "rpage-page__img";
const IMG_TAG = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const ATTRIBUTE = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
// Lazy readers keep a placeholder in `src` until the page scrolls into view.
const LAZY_SOURCES = ["data-src", "data-lazy-src", "data-original"];
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", "#39": "'", "#x27": "'", "#x2f": "/", "#47": "/" };

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match);
}

function attributes(tag: string): Map<string, string> {
  const result = new Map<string, string>();
  const body = tag.replace(/^<img\b/i, "").replace(/\/?>$/, "");
  for (const [, name, double, single, bare] of body.matchAll(ATTRIBUTE)) {
    const key = name.toLowerCase();
    if (!result.has(key)) result.set(key, decodeEntities((double ?? single ?? bare ?? "").trim()));
  }
  return result;
}

function absolutePageUrl(raw: string | undefined, baseUrl: string): string | null {
  if (!raw || raw.length > 4096 || /[\x00-\x1f\x7f]/.test(raw)) return null;
  let url: URL;
  try { url = new URL(raw, baseUrl); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
  url.hash = "";
  return url.toString();
}

export class ComixHtmlPageParser {
  /** `baseUrl` resolves relative or protocol-relative `src` values. */
  private readonly baseUrl: string;

  constructor(baseUrl: string = `${COMIX_ORIGIN}/`) {
    this.baseUrl = baseUrl;
  }

  extractMangaPages(rawHtmlPayload: string): string[] {
    if (typeof rawHtmlPayload !== "string" || !rawHtmlPayload) return [];
    if (rawHtmlPayload.length > COMIX_HTML_MAX_PAYLOAD) throw new Error("Comix reader HTML is too large.");
    const pages: string[] = [];
    const seen = new Set<string>();
    for (const [tag] of rawHtmlPayload.matchAll(IMG_TAG)) {
      const attrs = attributes(tag);
      if (!(attrs.get("class") ?? "").split(/\s+/).includes(PAGE_CLASS)) continue;
      const url = absolutePageUrl(attrs.get("src"), this.baseUrl) ??
        LAZY_SOURCES.map((name) => absolutePageUrl(attrs.get(name), this.baseUrl)).find(Boolean) ?? null;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      pages.push(url);
      if (pages.length > COMIX_HTML_MAX_PAGES) throw new Error("Comix chapter has too many pages.");
    }
    return pages;
  }
}
