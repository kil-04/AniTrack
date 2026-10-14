import { miruroDirectMedia, miruroHttps, type MiruroCategory, type MiruroMedia } from "./miruro-media";
import { MiruroProtocolError } from "./miruro-protocol";
import type { EpisodeInfo, ProviderSkipRange } from "./types";

type Json = Record<string, unknown>;
export interface MiruroV1Episode extends EpisodeInfo { intro?: ProviderSkipRange; outro?: ProviderSkipRange }
export interface MiruroV1Choice {
  track: MiruroCategory;
  provider: string;
  server: string;
  occurrence: number;
  media: MiruroMedia;
  headers: Record<string, string>;
}
function object(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
}
function fail(message: string): never { throw new MiruroProtocolError(message); }

export function miruroV1Show(payload: Json, anilistId: number): string {
  if (!Array.isArray(payload.data) || payload.data.length > 100 || payload.has_more === true) fail("Miruro lookup was incomplete");
  const matches = payload.data.map(object).filter((show): show is Json => {
    const ids = object(show?.external_ids)?.anilist;
    return !!show && Array.isArray(ids) && ids.length <= 64 && ids.some(id => String(id) === String(anilistId));
  });
  if (matches.length !== 1) fail("Miruro show identity could not be verified unambiguously");
  const id = matches[0].id;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(id)) fail("Invalid Miruro catalogue reference");
  return id;
}

export function miruroV1Episodes(payload: Json): MiruroV1Episode[] {
  if (!Array.isArray(payload.data) || payload.data.length > 10_000 || payload.has_more === true) fail("Miruro episode catalogue was incomplete");
  const episodes: MiruroV1Episode[] = [];
  const seen = new Set<number>();
  for (const raw of payload.data) {
    const episode = object(raw);
    const number = episode?.episode_number;
    if (typeof number !== "number" || !Number.isFinite(number) || number < 0 || number > 100_000) continue;
    if (seen.has(number)) fail("Miruro returned conflicting episode identities");
    seen.add(number);
    const normalized: MiruroV1Episode = {
      id: `ep:${number}`, episodeNumber: number,
      title: typeof episode?.title === "string" && episode.title.trim() ? episode.title.slice(0, 300) : `Episode ${number}`,
    };
    const skip = Array.isArray(episode?.skip_times) ? episode.skip_times.slice(0, 10) : [];
    for (const rawRange of skip) {
      const range = object(rawRange);
      const start = range?.start_seconds, end = range?.end_seconds;
      if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end)
        || start < 0 || end <= start || end > 86_400) continue;
      if (range?.kind === "intro" || range?.kind === "opening") normalized.intro ??= { start, end };
      if (range?.kind === "outro" || range?.kind === "ending") normalized.outro ??= { start, end };
    }
    episodes.push(normalized);
  }
  return episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
}

function mediaHeaders(raw: unknown): Record<string, string> | null {
  const input = object(raw);
  if (!input || Object.keys(input).length > 2) return null;
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input)) {
    if (!/^(referer|origin)$/i.test(name)) return null;
    const url = miruroHttps(value);
    if (!url) return null;
    if (name.toLowerCase() === "origin") {
      if (url !== `${new URL(url).origin}/`) return null;
      headers.Origin = new URL(url).origin;
    } else headers.Referer = url;
  }
  return headers;
}

/** Direct servers only; never open an embed or substitute track/server identity. */
export function miruroV1Choices(payload: Json, episodeNumber: number): MiruroV1Choice[] {
  if (payload.episode_number !== episodeNumber || !Array.isArray(payload.tracks) || payload.tracks.length > 3) {
    fail("Miruro returned another episode or an unsupported playback catalogue");
  }
  const choices: MiruroV1Choice[] = [];
  const occurrences = new Map<string, number>();
  for (const rawTrack of payload.tracks) {
    const track = object(rawTrack);
    const category = track?.track;
    if (category !== "sub" && category !== "ssub" && category !== "dub") continue;
    if (!Array.isArray(track?.providers) || track.providers.length > 32) fail("Miruro returned too many providers");
    for (const rawProvider of track.providers) {
      const provider = object(rawProvider);
      const id = provider?.provider;
      if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) continue;
      if (!Array.isArray(provider?.servers) || provider.servers.length > 32) fail("Miruro returned too many servers");
      for (const rawServer of provider.servers) {
        const server = object(rawServer);
        const name = server?.server;
        if (typeof name !== "string" || !/^[A-Za-z0-9 _.-]{1,100}$/.test(name)) continue;
        const identity = `${category}:${id}:${name}`;
        const occurrence = occurrences.get(identity) ?? 0;
        if (occurrence > 31) fail("Miruro returned too many duplicate server identities");
        occurrences.set(identity, occurrence + 1);
        const headers = mediaHeaders(server?.headers ?? {});
        if (!headers || !Array.isArray(server?.streams) || server.streams.length > 32) continue;
        const streams = server.streams.map(object).filter((stream): stream is Json => !!stream && !stream.embed)
          .map(stream => ({ ...stream, type: stream.format, referer: headers.Referer ?? "" }));
        const subtitles = Array.isArray(provider?.subtitles) ? provider.subtitles.slice(0, 32).map(raw => {
          const subtitle = object(raw);
          return { ...subtitle, file: subtitle?.url ?? subtitle?.file };
        }) : [];
        const media = miruroDirectMedia({ streams, subtitles })[0];
        if (!media) continue;
        if (choices.length >= 256) fail("Miruro returned too many direct server choices");
        choices.push({ track: category, provider: id, server: name, occurrence, media, headers });
      }
    }
  }
  return choices;
}
