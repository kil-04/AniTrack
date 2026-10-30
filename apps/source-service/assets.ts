import {opaqueId, reject} from './protocol';

type AssetKind = 'media' | 'playlist' | 'subtitle-playlist' | 'subtitle' | 'key' | 'image';
interface Asset {url: string; kind: AssetKind; fetcher: AssetFetch; expires: number; family: Map<string, string>}
export type AssetFetch = (url: string, signal: AbortSignal, range: string | null) => Promise<Response>;

const TS_PACKET_BYTES=188, TS_PREFIX_BYTES=4*TS_PACKET_BYTES;
function transportPrefix(prefix:Uint8Array, length:number):boolean {
  for(let offset=0;offset<length;offset+=TS_PACKET_BYTES){
    if(prefix[offset]!==0x47)return false;
    // The reserved adaptation-field control cannot identify a valid packet.
    if(offset+3<length&&(prefix[offset+3]&0x30)===0)return false;
  }
  return true;
}
/** Inspect only four complete packets, then replay every original byte lazily. */
async function mediaPrefix(body:ReadableStream<Uint8Array>,signal:AbortSignal):Promise<{body:ReadableStream<Uint8Array>;transportStream:boolean}>{
  const reader=body.getReader(),chunks:Uint8Array[]=[],prefix=new Uint8Array(TS_PREFIX_BYTES);
  let length=0,ended=false,stopped=false,controller:ReadableStreamDefaultController<Uint8Array>|undefined,abort:(reason:unknown)=>void=()=>{};
  const interrupted=new Promise<never>((_,fail)=>{abort=fail;});
  const stop=(cancel:boolean,reason?:unknown)=>{
    if(stopped)return;stopped=true;signal.removeEventListener('abort',onAbort);
    if(cancel)void reader.cancel(reason).catch(()=>{});
    try{reader.releaseLock();}catch{}
  };
  const onAbort=()=>{const reason=signal.reason??new DOMException('Media request cancelled.','AbortError');controller?.error(reason);stop(true,reason);abort(reason);};
  signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();
  try{
    while(length<TS_PREFIX_BYTES){
      const part=await Promise.race([reader.read(),interrupted]);
      if(stopped)throw signal.reason??new DOMException('Media request cancelled.','AbortError');
      if(part.done){ended=true;break;}
      if(!part.value.byteLength)continue;
      chunks.push(part.value);
      const take=Math.min(part.value.byteLength,TS_PREFIX_BYTES-length);prefix.set(part.value.subarray(0,take),length);length+=take;
      if(!transportPrefix(prefix,length))break;
    }
  }catch(error){stop(true,error);throw error;}
  const transportStream=length===TS_PREFIX_BYTES&&transportPrefix(prefix,length);
  const replay=new ReadableStream<Uint8Array>({
    start(value){controller=value;},
    async pull(value){
      if(stopped)return;
      if(chunks.length){value.enqueue(chunks.shift()!);return;}
      if(ended){value.close();stop(false);return;}
      try{
        const part=await Promise.race([reader.read(),interrupted]);if(stopped)return;
        if(part.done){value.close();stop(false);}else value.enqueue(part.value);
      }catch(error){value.error(error);stop(true,error);}
    },
    cancel(reason){stop(true,reason);},
  },{highWaterMark:0});
  return {body:replay,transportStream};
}

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
    let type = response.headers.get('content-type') ?? '';
    if (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity') {await response.body?.cancel(); return reject(502, 'UNSUPPORTED_MEDIA_ENCODING');}
    if (asset.kind === 'playlist' || asset.kind === 'subtitle-playlist' || /mpegurl/i.test(type)) {
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
      const subtitle=asset.kind==='subtitle-playlist'||asset.kind==='subtitle';
      const lines = text.split(/\r?\n/).map(line => {
        if (line.trim() && !line.startsWith('#')) return child(line.trim(), subtitle?(master?'subtitle-playlist':'subtitle'):master?'playlist':'media');
        const kind:AssetKind=/^#EXT-X-(?:SESSION-)?KEY:/.test(line)?'key':/^#EXT-X-MEDIA:/.test(line)&&/(?:[:,])\s*TYPE=SUBTITLES(?:,|$)/.test(line)?'subtitle-playlist':/^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF)/.test(line)?'playlist':subtitle?'subtitle':'media';
        return line.replace(/URI="([^"]+)"/g, (_, url: string) => `URI="${child(url, kind)}"`);
      });
      return new Response(lines.join('\n'), {headers: {'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store'}});
    }
    if (asset.kind === 'image' && !/^image\//i.test(type)) {await response.body?.cancel(); return reject(502, 'INVALID_PAGE_IMAGE');}
    let body=response.body;
    if(asset.kind==='media'&&response.status===200&&!range&&!response.headers.has('content-range')&&body){
      const inspected=await mediaPrefix(body,request.signal);body=inspected.body;
      if(inspected.transportStream)type='video/mp2t';
    }
    if (/^(?:text\/(?:html|javascript|ecmascript|xml)|application\/(?:javascript|ecmascript|json|xml|[a-z0-9.+-]+\+(?:json|xml))|image\/svg\+xml)(?:\s*;|\s*$)/i.test(type.trim())) {await body?.cancel(); return reject(502, 'INVALID_MEDIA');}
    const headers = new Headers({'Content-Type': type || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
    for (const key of ['content-length','content-range','accept-ranges']) {const value = response.headers.get(key); if (value) headers.set(key, value);}
    return new Response(body, {status: response.status, headers});
  }
}
