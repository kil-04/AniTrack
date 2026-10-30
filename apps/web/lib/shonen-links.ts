import { isShonenAnimeId, type ShonenLanguage, type ShonenStream } from '../source/packages/shared/shonen';

export interface ShonenLinkToken { a: number; n: number; l: ShonenLanguage; s?: number; b?: string }

export function shonenLinkToken(value: string): ShonenLinkToken {
  let token: Partial<ShonenLinkToken> | null = null;
  try { if (value.length <= 200) token = JSON.parse(value); } catch { }
  if (!token || !isShonenAnimeId(token.a) || !Number.isInteger(token.n) || token.n! < 1 || token.n! > 5000
    || (token.l !== 'sub' && token.l !== 'dub')
    || (token.s !== undefined && (!Number.isInteger(token.s) || token.s < 0 || token.s > 7))
    || (token.b !== undefined && (typeof token.b !== 'string' || token.b.length > 40))) {
    throw new Error('Invalid shonen.to server link. Reload the episode list.');
  }
  return token as ShonenLinkToken;
}

export async function shonenLinks(a: number, n: number, streamsFor: (language: ShonenLanguage) => Promise<ShonenStream[]>) {
  const links = [];
  for (const l of ['sub', 'dub'] as const) {
    let streams: ShonenStream[];
    try { streams = await streamsFor(l); }
    catch (error) {
      if (l === 'dub') continue;
      throw error;
    }
    for (const [s, stream] of streams.entries()) links.push({
      id: JSON.stringify({a, n, l, s, b: stream.label} satisfies ShonenLinkToken),
      quality: `${l === 'dub' ? 'Dub' : 'Sub'} · ${stream.label}`,
      audio: l === 'dub' ? 'eng' : 'jpn',
      variant: l,
    });
  }
  return links;
}

export function shonenStreamFor(token: ShonenLinkToken, streams: ShonenStream[]) {
  const stream = token.b ? streams.find(item => item.label === token.b) : streams[token.s ?? 0];
  if (!stream) throw new Error('That shonen.to server is no longer listed. Reload the servers or choose another.');
  return stream;
}
