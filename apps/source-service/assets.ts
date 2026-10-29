import {opaqueId, reject} from './protocol';

type AssetKind = 'media' | 'playlist' | 'subtitle' | 'image';
interface Asset {url: string; kind: AssetKind; fetcher: AssetFetch; expires: number; family: Map<string, string>}
export type AssetFetch = (url: string, signal: AbortSignal, range: string | null) => Promise<Response>;
/** Memory-only receipts keep cookies and source URLs on the source server. */
export class AssetVault {
  private items = new Map<string, Asset>();
  constructor(private now = Date.now, private capacity = 24000, private ttl = 2 * 3600000) {}
  private prune() {for (const [id, asset] of this.items) if (asset.expires <= this.now()) this.items.delete(id);}
  private put(url: string, kind: AssetKind, fetcher: AssetFetch, family: Map<string, string>, expires: number): string {
    if (url.length > 16384) return reject(502, 'INVALID_ASSET');
    let target: URL; try {target = new URL(url);} catch {return reject(502, 'INVALID_ASSET');}
    if (target.username || target.password || !(target.protocol === 'https:' || kind === 'image' && target.protocol === 'blob:' && target.origin.startsWith('https://'))) return reject(502, 'INVALID_ASSET');
    const key = `${kind}:${url}`, existing = family.get(key);
    if (existing && this.items.has(existing)) return `/v1/assets/${existing}`;
    this.prune();
    if (this.items.size >= this.capacity || family.size >= 6000) return reject(503, 'MEDIA_CAPACITY_REACHED');
    const id = opaqueId(); this.items.set(id, {url, kind, fetcher, expires, family}); family.set(key, id);
    return `/v1/assets/${id}`;
  }
  register(url: string, kind: AssetKind, fetcher: AssetFetch): string {return this.put(url, kind, fetcher, new Map(), this.now() + this.ttl);}
  async respond(id: string, request: Request): Promise<Response> {
    this.prune(); const asset = this.items.get(id);
    if (!asset) return reject(410, 'MEDIA_EXPIRED');
    const range = request.headers.get('range');
    if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) return reject(416, 'INVALID_RANGE');
    const response = await asset.fetcher(asset.url, request.signal, range);
    if (!response.ok) {await response.body?.cancel(); return reject([403,429].includes(response.status) ? response.status : 502, 'MEDIA_SOURCE_REJECTED');}
    const type = response.headers.get('content-type') ?? '';
    if (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity') {await response.body?.cancel(); return reject(502, 'UNSUPPORTED_MEDIA_ENCODING');}
    if (asset.kind === 'playlist' || /mpegurl/i.test(type)) {
      const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
      if (!reader) return reject(502, 'INVALID_PLAYLIST');
      try {
        for (;;) {const {done,value} = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 2 * 1024 * 1024) {await reader.cancel(); return reject(502, 'INVALID_PLAYLIST');} chunks.push(value);}
      } finally {reader.releaseLock();}
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trimStart().startsWith('#EXTM3U')) return reject(502, 'INVALID_PLAYLIST');
      const master = text.includes('#EXT-X-STREAM-INF:');
      const child = (raw: string, kind: AssetKind) => {
        let target: URL; try {target = new URL(raw, asset.url);} catch {return reject(502, 'INVALID_PLAYLIST');}
        if (target.protocol !== 'https:' || target.username || target.password) return reject(502, 'INVALID_PLAYLIST');
        return this.put(target.href, kind, asset.fetcher, asset.family, asset.expires);
      };
      const lines = text.split(/\r?\n/).map(line => {
        if (line.trim() && !line.startsWith('#')) return child(line.trim(), master ? 'playlist' : 'media');
        return line.replace(/URI="([^"]+)"/g, (_, url: string) => `URI="${child(url, /^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF)/.test(line) ? 'playlist' : 'media')}"`);
      });
      return new Response(lines.join('\n'), {headers: {'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store'}});
    }
    if (asset.kind === 'image' && !/^image\//i.test(type)) {await response.body?.cancel(); return reject(502, 'INVALID_PAGE_IMAGE');}
    if (/text\/html|application\/(?:json|problem\+json)/i.test(type)) {await response.body?.cancel(); return reject(502, 'INVALID_MEDIA');}
    const headers = new Headers({'Content-Type': type || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
    for (const key of ['content-length','content-range','accept-ranges']) {const value = response.headers.get(key); if (value) headers.set(key, value);}
    return new Response(response.body, {status: response.status, headers});
  }
}
