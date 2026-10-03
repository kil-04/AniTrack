import { MiruroProtocolError } from "./miruro-protocol";
import type { ProviderSubtitle } from "./types";

// Port of the Android connector's tested catalogue and media rules
// (connectors/miruro/MiruroCatalogue.kt and MiruroMedia.kt).

export type MiruroTranslation = "sub" | "dub";
export type MiruroCategory = "sub" | "ssub" | "dub";

/** Opaque source ids stay in memory, separate from episode numbers. */
export interface MiruroEpisodeChoice {
  number: number;
  episodeId: string;
  server: string;
  category: MiruroCategory;
  title?: string;
}

export interface MiruroMedia {
  url: string;
  hls: boolean;
  referer: string;
  subtitles: ProviderSubtitle[];
}

type Json = Record<string, unknown>;
const SERVER = /^[a-zA-Z0-9_-]{1,64}$/;

function object(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
}

function malformed(message = "Miruro returned an unsupported or malformed response"): never {
  throw new MiruroProtocolError(message);
}

export function miruroVariantLabel(choice: Pick<MiruroEpisodeChoice, "server" | "category">): string {
  const kind = choice.category === "ssub" ? "Soft sub" : choice.category === "dub" ? "Dub" : "Sub";
  return `${choice.server.toUpperCase()} · ${kind}`;
}

/** Parse only configured, visible servers. Never infer identities from array indexes. */
export function miruroChoices(anilistId: number, translation: MiruroTranslation, config: Json, payload: Json): MiruroEpisodeChoice[] {
  if (!Number.isSafeInteger(anilistId) || anilistId <= 0) malformed();
  const mapped = object(payload.mappings)?.aniId;
  if (typeof mapped === "number" && mapped !== anilistId) malformed("Miruro returned another show's episodes");
  const servers = object(config.streaming) ?? malformed();
  const providers = object(payload.providers) ?? malformed();
  if (Object.keys(servers).length > 32 || Object.keys(providers).length > 32) malformed();
  const order = Array.isArray(config.providerOrder) ? config.providerOrder.slice(0, 32).filter((id): id is string => typeof id === "string") : [];
  const keys = [...new Set([...order, ...Object.keys(servers).sort()])];
  const choices: MiruroEpisodeChoice[] = [];
  for (const server of keys) {
    if (!SERVER.test(server)) continue;
    const setting = object(servers[server]);
    if (!setting || setting.visible !== true) continue;
    const capabilities = object(setting.capabilities);
    const categories: MiruroCategory[] = translation === "dub" ? ["dub"]
      : [...(capabilities?.sub === true ? ["sub" as const] : []), ...(capabilities?.ssub === true ? ["ssub" as const] : [])];
    if (categories.length === 0) continue;
    const episodes = object(object(providers[server])?.episodes)?.[translation];
    if (!Array.isArray(episodes)) continue;
    if (episodes.length > 5000) malformed();
    const seen = new Set<number>();
    for (const raw of episodes) {
      const episode = object(raw);
      const number = episode?.number;
      if (typeof number !== "number" || !Number.isFinite(number) || number < 0 || number > 100_000) continue;
      const id = episode?.id;
      if (typeof id !== "string" || !id.trim() || id.length > 512 || /[\u0000-\u001f\u007f]/.test(id)) continue;
      if (seen.has(number)) continue;
      seen.add(number);
      const title = typeof episode?.title === "string" && episode.title.trim() ? episode.title.slice(0, 300) : undefined;
      for (const category of categories) {
        if (choices.length >= 10_000) malformed();
        choices.push({ number, episodeId: id, server, category, ...(title ? { title } : {}) });
      }
    }
  }
  return choices;
}

/** CDN names only; rejects credentials, other ports, IP literals and local names. */
export function miruroHttps(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 8192 || /[\u0000- \u007f\\]/.test(value)) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password) return null;
  if (!host.includes(".") || host.includes(":") || host.startsWith("[") || /^[\d.]+$/.test(host)
    || ["localhost", "local", "internal", "lan", "home", "invalid"].some((name) => host === name || host.endsWith(`.${name}`))) return null;
  url.hash = "";
  return url.toString();
}

/** Conservative subset of the observed source response. No embed extraction. */
export function miruroDirectMedia(source: Json): MiruroMedia[] {
  const offered = Array.isArray(source.subtitles) ? source.subtitles.slice(0, 32) : [];
  const subtitles: (ProviderSubtitle & { language?: string })[] = [];
  for (const raw of offered) {
    const sub = object(raw);
    const file = miruroHttps(sub?.file);
    if (!sub || !file) continue;
    const kind = String(sub.kind ?? "").toLowerCase();
    const label = typeof sub.label === "string" && sub.label.trim() ? sub.label.slice(0, 100) : "Subtitles";
    if (["thumbnails", "metadata", "chapters"].includes(kind) || /thumbnail/i.test(label)) continue;
    const declared = typeof sub.format === "string" ? sub.format.toLowerCase().trim() : "";
    const extension = new URL(file).pathname.split("/").pop()?.split(".").pop()?.toLowerCase() ?? "";
    // The desktop player renders WebVTT; other declared formats are skipped
    // rather than handed to it as though they were VTT.
    if (!["vtt", "webvtt", "text/vtt"].includes(declared || extension)) continue;
    const language = typeof sub.language === "string" ? sub.language.toLowerCase().trim() : "";
    const english = ["english", "eng", "en"].includes(language) || /^english/i.test(label);
    if (subtitles.some((existing) => existing.file === file)) continue;
    subtitles.push({ file, label, kind: "captions", default: sub.default === true, ...(english ? { language: "en" } : {}) });
  }
  subtitles.sort((a, b) => Number(b.language === "en") - Number(a.language === "en") || Number(b.default) - Number(a.default));
  const captions: ProviderSubtitle[] = subtitles.map(({ file, label, kind, default: isDefault }) => ({ file, label, kind, default: isDefault }));

  const streams = Array.isArray(source.streams) ? source.streams.slice(0, 32) : [];
  const media: { preferred: boolean; value: MiruroMedia }[] = [];
  for (const raw of streams) {
    const stream = object(raw);
    const kind = String(stream?.type ?? "").toLowerCase();
    if (!["hls", "m3u8", "mp4"].includes(kind)) continue;
    const url = miruroHttps(stream?.url);
    if (!url) continue;
    const rawReferer = stream?.referer;
    const referer = typeof rawReferer !== "string" || !rawReferer.trim() ? "" : miruroHttps(rawReferer);
    if (referer === null) continue;
    if (media.some((entry) => entry.value.url === url)) continue;
    media.push({ preferred: stream?.default === true, value: { url, hls: kind !== "mp4", referer, subtitles: captions } });
  }
  return media.sort((a, b) => Number(b.preferred) - Number(a.preferred)).map((entry) => entry.value);
}
