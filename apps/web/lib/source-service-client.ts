/** Portable server-only transport. This module deliberately has no Node imports or environment access. */
export interface SourceServiceConfig {origin: string; key: string}
export interface SourceServiceClientOptions {
  signAsset(path: string): Promise<string>;
  fetch?: typeof fetch;
}
export interface SourceServiceSelection {kind: 'anime' | 'manga'; source: string; method: string; args: unknown[]}
export interface SourceAssetOptions {range?: string | null; signal?: AbortSignal}
interface OpenedResponse {response: Response; controller: AbortController; signal: AbortSignal}

const ASSET = /^\/v1\/assets\/[A-Za-z0-9_-]{32}$/;
const JSON_LIMIT = 8 * 1024 * 1024, PLAYLIST_LIMIT = 2 * 1024 * 1024;
const SAFE_CODES = new Set([
  'UNAUTHORIZED', 'SERVER_REQUEST_REQUIRED', 'NOT_FOUND', 'SERVICE_BUSY', 'REQUEST_CANCELLED',
  'INVALID_REQUEST', 'INVALID_SELECTION', 'SOURCE_OPERATION_NOT_ALLOWED', 'REQUEST_TOO_LARGE',
  'SOURCE_RESPONSE_TOO_LARGE', 'SOURCE_VERIFICATION_REQUIRED', 'SOURCE_RATE_LIMITED', 'SOURCE_UNAVAILABLE',
  'SERVER_LIST_EXPIRED', 'MEDIA_CAPACITY_REACHED', 'MEDIA_EXPIRED', 'INVALID_RANGE',
  'INVALID_PLAYLIST', 'INVALID_PAGE_IMAGE', 'INVALID_PAGE_LIST', 'INVALID_MEDIA',
  'INVALID_MEDIA_DESTINATION', 'MEDIA_SOURCE_REJECTED', 'UNSUPPORTED_MEDIA_ENCODING',
  'INVALID_SERVICE_CONFIG', 'INVALID_SERVICE_RESPONSE', 'INVALID_ASSET_PATH',
  'INVALID_SIGNED_ASSET', 'SOURCE_SERVICE_TIMEOUT',
]);

/** Only a bounded, known code and HTTP error status may cross the relay boundary. */
export class SourceServiceClientError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(status: number, code: string) {
    const safe = SAFE_CODES.has(code) ? code : 'SOURCE_UNAVAILABLE';
    super(safe);
    this.name = 'SourceServiceClientError';
    this.code = safe;
    this.status = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502;
  }
}
const fail = (status: number, code: string): never => {throw new SourceServiceClientError(status, code);};
const abortError = (signal: AbortSignal) => signal.reason instanceof SourceServiceClientError
  ? signal.reason : new SourceServiceClientError(499, 'REQUEST_CANCELLED');
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {void operation.catch(() => {}); return Promise.reject(abortError(signal));}
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError(signal));
    signal.addEventListener('abort', abort, {once: true});
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function normalized(error: unknown, signal?: AbortSignal): SourceServiceClientError {
  if (signal?.aborted) return abortError(signal);
  return error instanceof SourceServiceClientError ? error : new SourceServiceClientError(502, 'SOURCE_UNAVAILABLE');
}

// Configuration is supplied by the operator, never a visitor. Literal addresses
// still need checking because portable Worker runtimes do not expose DNS APIs.
function publicHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host.startsWith('[')) {
    const ip = host.slice(1, -1);
    return /^[23][0-9a-f]{3}:/.test(ip) && !/^2001:db8(?::|$)/.test(ip);
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b, c] = host.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  return host.includes('.') && !host.endsWith('.') &&
    !/(^|\.)(localhost|local|localdomain|internal|lan|home|home\.arpa)$/.test(host);
}
function publicUrl(raw: string): URL {
  let url: URL; try {url = new URL(raw);} catch {return fail(500, 'INVALID_SERVICE_CONFIG');}
  if (url.protocol !== 'https:' || url.username || url.password || !publicHost(url.hostname)) return fail(500, 'INVALID_SERVICE_CONFIG');
  return url;
}
function selection(input: unknown): SourceServiceSelection {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail(400, 'INVALID_REQUEST');
  const row = input as Record<string, unknown>;
  if (Object.keys(row).some(key => !['kind', 'source', 'method', 'args'].includes(key))) return fail(400, 'INVALID_REQUEST');
  const {kind, source, method, args} = row;
  const sources = kind === 'anime' ? ['animepahe', 'anikoto', 'shonen', 'anichan'] : kind === 'manga' ? ['mangadot', 'mangaball', 'xcomic', 'toonkotsu'] : [];
  const methods = kind === 'anime' ? ['search', 'episodes', 'links', 'resolve', 'ids', 'find', 'feed'] : ['find', 'chapters-page', 'pages', 'latest'];
  if (typeof source !== 'string' || !sources.includes(source) || typeof method !== 'string' || !methods.includes(method) || !Array.isArray(args)) return fail(400, 'SOURCE_OPERATION_NOT_ALLOWED');
  const string = (value: unknown, max: number): string => {
    if (typeof value !== 'string' || !value || value.length > max || /[\x00-\x1f\x7f]/.test(value)) return fail(400, 'INVALID_SELECTION');
    return value;
  };
  const positive = (value: unknown, max = 2147483647): number => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) return fail(400, 'INVALID_SELECTION');
    return value;
  };
  const count = (length: number) => {if (args.length !== length) fail(400, 'INVALID_REQUEST');};
  let clean: unknown[];
  if (kind === 'anime') {
    if (method === 'search') {count(1); clean = [string(args[0], 200)];}
    else if (method === 'episodes') {count(2); clean = [string(args[0], 512), positive(args[1], 1000)];}
    else if (method === 'links') {count(2); clean = [string(args[0], 8192), string(args[1], 512)];}
    else if (method === 'find') {count(1); clean = [positive(args[0])];}
    else if (method === 'feed') {count(3); if (!['latest', 'top'].includes(args[0] as string)) return fail(400, 'INVALID_SELECTION'); clean = [args[0], positive(args[1], 1000), positive(args[2], 50)];}
    else {count(1); const id = string(args[0], 16384); if (method === 'resolve' && !/^[A-Za-z0-9_-]{32}$/.test(id)) return fail(400, 'INVALID_SELECTION'); clean = [id];}
  } else if (method === 'find') {count(1); clean = [positive(args[0])];}
  else {
    const title = args[0] as Record<string, unknown> | undefined;
    if (!title || typeof title !== 'object' || Array.isArray(title) || title.sourceId !== source || Object.keys(title).some(key => !['sourceId', 'id', 'title'].includes(key))) return fail(400, 'INVALID_SELECTION');
    const copy = {sourceId: source, id: string(title.id, 512), title: string(title.title, 512)};
    if (method === 'chapters-page') {count(2); clean = [copy, positive(args[1], 1000)];}
    else if (method === 'pages') {count(2); clean = [copy, string(args[1], 512)];}
    else {count(1); clean = [copy];}
  }
  return {kind: kind as SourceServiceSelection['kind'], source, method, args: clean};
}
function rangeHeader(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string' || value.length > 80) return fail(416, 'INVALID_RANGE');
  const match = /^bytes=(?:(\d+)-(\d*)|-(\d+))$/.exec(value);
  if (!match) return fail(416, 'INVALID_RANGE');
  const numbers = match.slice(1).filter(part => part !== undefined && part !== '').map(Number);
  if (numbers.some(number => !Number.isSafeInteger(number)) || (match[3] && Number(match[3]) < 1) ||
    (match[2] && Number(match[1]) > Number(match[2]))) return fail(416, 'INVALID_RANGE');
  return value;
}
async function boundedText(response: Response, limit: number, signal: AbortSignal): Promise<string> {
  if (Number(response.headers.get('content-length')) > limit) {void response.body?.cancel().catch(() => {}); return fail(502, 'SOURCE_RESPONSE_TOO_LARGE');}
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const next = await abortable(reader.read(), signal); if (next.done) break;
      length += next.value.byteLength;
      if (length > limit) return fail(502, 'SOURCE_RESPONSE_TOO_LARGE');
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } finally {void reader.cancel().catch(() => {});}
}

export class SourceServiceClient {
  #origin!: string;
  #key!: string;
  #fetch!: typeof fetch;
  #signAsset!: SourceServiceClientOptions['signAsset'];
  constructor(config: SourceServiceConfig, options: SourceServiceClientOptions) {
    if (!config || typeof config.origin !== 'string' || typeof config.key !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(config.key)) return fail(500, 'INVALID_SERVICE_CONFIG');
    const origin = publicUrl(config.origin);
    if (origin.origin !== config.origin || !options || typeof options.signAsset !== 'function') return fail(500, 'INVALID_SERVICE_CONFIG');
    this.#origin = origin.origin; this.#key = config.key;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#signAsset = options.signAsset;
  }
  async #open(path: string, init: RequestInit, caller: AbortSignal | undefined, timeout: number) {
    const controller = new AbortController();
    const signal = caller ? AbortSignal.any([caller, controller.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(new SourceServiceClientError(504, 'SOURCE_SERVICE_TIMEOUT')), timeout);
    try {
      if (signal.aborted) throw abortError(signal);
      const target = this.#origin + path;
      const response = await abortable(this.#fetch(target, {...init, redirect: 'manual', credentials: 'omit', cache: 'no-store', signal} as RequestInit), signal);
      if (response.redirected || (response.status >= 300 && response.status < 400) || (response.url && response.url !== target)) {
        void response.body?.cancel().catch(() => {}); return fail(502, 'INVALID_SERVICE_RESPONSE');
      }
      return {response, controller, signal};
    } catch (error) {const safe = normalized(error, signal); controller.abort(); throw safe;}
    finally {clearTimeout(timer);}
  }
  async #error(response: Response, signal: AbortSignal): Promise<never> {
    let code = 'SOURCE_UNAVAILABLE';
    try {
      const body = JSON.parse(await boundedText(response, 65536, signal));
      if (body && typeof body.error === 'string' && SAFE_CODES.has(body.error)) code = body.error;
    } catch (error) {if (signal.aborted) throw abortError(signal);}
    return fail(response.status, code);
  }
  #signer(signal: AbortSignal) {
    const cache = new Map<string, Promise<string>>();
    return (path: string): Promise<string> => {
      if (!ASSET.test(path)) return Promise.reject(new SourceServiceClientError(502, 'INVALID_SERVICE_RESPONSE'));
      let pending = cache.get(path);
      if (!pending) {
        if (cache.size >= 6000) return Promise.reject(new SourceServiceClientError(502, 'SOURCE_RESPONSE_TOO_LARGE'));
        pending = (async () => {
          const signed = await abortable(Promise.resolve().then(() => this.#signAsset(path)), signal);
          if (typeof signed !== 'string' || !signed || signed === path || signed.length > 16384 || /[\s\x00-\x1f\x7f"'<>\\]/.test(signed)) return fail(502, 'INVALID_SIGNED_ASSET');
          try {
            const url = signed.startsWith('/') && !signed.startsWith('//') ? new URL(signed, 'https://relay.invalid') : publicUrl(signed);
            if (url.hash || url.origin === this.#origin || (!signed.startsWith('/') && url.protocol !== 'https:')) return fail(502, 'INVALID_SIGNED_ASSET');
          } catch {return fail(502, 'INVALID_SIGNED_ASSET');}
          return signed;
        })();
        cache.set(path, pending);
      }
      return pending;
    };
  }
  async call(input: unknown, signal?: AbortSignal): Promise<unknown> {
    const body = JSON.stringify(selection(input));
    if (new TextEncoder().encode(body).length > 65536) return fail(413, 'REQUEST_TOO_LARGE');
    let opened: OpenedResponse | undefined;
    // A complete catalogue response, including signing, has one bounded lifetime.
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(new SourceServiceClientError(504, 'SOURCE_SERVICE_TIMEOUT')), 120000);
    const combined = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
    try {
      opened = await this.#open('/v1/rpc', {method: 'POST', headers: {Authorization: `Bearer ${this.#key}`, 'Content-Type': 'application/json', Accept: 'application/json'}, body}, combined, 120000);
      const {response} = opened;
      if (!response.ok) return await this.#error(response, combined);
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) return fail(502, 'INVALID_SERVICE_RESPONSE');
      let envelope: any;
      try {envelope = JSON.parse(await boundedText(response, JSON_LIMIT, combined));}
      catch (error) {if (error instanceof SourceServiceClientError) throw error; return fail(502, 'INVALID_SERVICE_RESPONSE');}
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || !Object.hasOwn(envelope, 'value') || Object.keys(envelope).some(key => key !== 'value')) return fail(502, 'INVALID_SERVICE_RESPONSE');
      const sign = this.#signer(combined); let nodes = 0;
      const rewrite = async (value: any, depth = 0): Promise<any> => {
        if (depth > 32 || ++nodes > 250000) return fail(502, 'SOURCE_RESPONSE_TOO_LARGE');
        if (Array.isArray(value)) {const output = []; for (const child of value) output.push(await rewrite(child, depth + 1)); return output;}
        if (!value || typeof value !== 'object') return value;
        const output: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(value)) {
          if (['__proto__', 'constructor', 'prototype'].includes(key)) return fail(502, 'INVALID_SERVICE_RESPONSE');
          if (key === 'url' || key === 'file') {
            if (child == null) output[key] = child;
            else {if (typeof child !== 'string' || !ASSET.test(child)) return fail(502, 'INVALID_SERVICE_RESPONSE'); output[key] = await sign(child);}
          } else output[key] = await rewrite(child, depth + 1);
        }
        return output;
      };
      return await rewrite(envelope.value);
    } catch (error) {throw normalized(error, combined);}
    finally {clearTimeout(timer); opened?.controller.abort();}
  }
  async asset(path: string, options: SourceAssetOptions = {}): Promise<Response> {
    if (typeof path !== 'string' || !ASSET.test(path)) return fail(400, 'INVALID_ASSET_PATH');
    const range = rangeHeader(options.range);
    let opened: OpenedResponse | undefined;
    try {
      const headers = new Headers({Authorization: `Bearer ${this.#key}`, Accept: '*/*'});
      if (range) headers.set('Range', range);
      opened = await this.#open(path, {method: 'GET', headers}, options.signal, 30000);
      const {response, controller, signal} = opened;
      if (!response.ok) {
        const timer = setTimeout(() => controller.abort(new SourceServiceClientError(504, 'SOURCE_SERVICE_TIMEOUT')), 30000);
        try {return await this.#error(response, signal);} finally {clearTimeout(timer);}
      }
      if (![200, 206].includes(response.status)) return fail(502, 'INVALID_SERVICE_RESPONSE');
      const type = response.headers.get('content-type') ?? 'application/octet-stream';
      const output = new Headers({'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
      if (/mpegurl/i.test(type)) {
        if (response.status !== 200) return fail(502, 'INVALID_PLAYLIST');
        const timer = setTimeout(() => controller.abort(new SourceServiceClientError(504, 'SOURCE_SERVICE_TIMEOUT')), 30000);
        try {
          const text = await boundedText(response, PLAYLIST_LIMIT, signal);
          if (!/^#EXTM3U(?:\r?\n|$)/.test(text) || /\x00/.test(text)) return fail(502, 'INVALID_PLAYLIST');
          const sign = this.#signer(signal);
          const lines = text.split(/(\r?\n)/); let references = 0;
          for (let i = 0; i < lines.length; i += 2) {
            const line = lines[i];
            if (!line.trim()) continue;
            if (!line.startsWith('#')) {if (++references > 6000 || !ASSET.test(line.trim())) return fail(502, 'INVALID_PLAYLIST'); lines[i] = await sign(line.trim()); continue;}
            const matches = [...line.matchAll(/\b[A-Z0-9-]*URI="([^"]*)"/g)];
            const stripped = line.replace(/\b[A-Z0-9-]*URI="[^"]*"/g, '');
            if (/\b[A-Z0-9-]*URI\s*=/i.test(stripped)) return fail(502, 'INVALID_PLAYLIST');
            let cursor = 0, rewritten = '';
            for (const match of matches) {
              if (++references > 6000 || !ASSET.test(match[1])) return fail(502, 'INVALID_PLAYLIST');
              const start = match.index! + match[0].indexOf('"') + 1;
              rewritten += line.slice(cursor, start) + await sign(match[1]); cursor = start + match[1].length;
            }
            lines[i] = rewritten + line.slice(cursor);
          }
          output.set('Content-Type', 'application/vnd.apple.mpegurl');
          return new Response(lines.join(''), {status: 200, headers: output});
        } finally {clearTimeout(timer); controller.abort();}
      }
      if (type.length > 256 || /[\x00-\x1f\x7f]/.test(type) || /(?:html|json|javascript|xml|svg)/i.test(type)) return fail(502, 'INVALID_MEDIA');
      output.set('Content-Type', type);
      const length = response.headers.get('content-length');
      if (length) {if (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))) return fail(502, 'INVALID_SERVICE_RESPONSE'); output.set('Content-Length', length);}
      const contentRange = response.headers.get('content-range');
      if (contentRange) {if (!/^bytes \d+-\d+\/(?:\d+|\*)$/.test(contentRange)) return fail(502, 'INVALID_SERVICE_RESPONSE'); output.set('Content-Range', contentRange);}
      if (response.status === 206 && !contentRange) return fail(502, 'INVALID_SERVICE_RESPONSE');
      if (response.headers.get('accept-ranges') === 'bytes') output.set('Accept-Ranges', 'bytes');
      const reader = response.body?.getReader();
      if (!reader) return fail(502, 'INVALID_MEDIA');
      let finished = false;
      const stop = () => {if (!finished) {finished = true; signal.removeEventListener('abort', abort); controller.abort(); void reader.cancel().catch(() => {});}};
      let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
      const abort = () => {if (!finished) {const error = abortError(signal); stop(); stream?.error(error);}};
      const body = new ReadableStream<Uint8Array>({
        start(value) {stream = value; signal.addEventListener('abort', abort, {once: true}); if (signal.aborted) abort();},
        async pull(value) {
          try {const next = await abortable(reader.read(), signal); if (finished) return; if (next.done) {stop(); value.close();} else value.enqueue(next.value);}
          catch (error) {if (!finished) {stop(); value.error(normalized(error, options.signal));}}
        },
        cancel() {stop();},
      });
      return new Response(body, {status: response.status, headers: output});
    } catch (error) {const safe = normalized(error, options.signal); opened?.controller.abort(); void opened?.response.body?.cancel().catch(() => {}); throw safe;}
  }
}
