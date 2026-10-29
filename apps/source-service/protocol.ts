import {timingSafeEqual, randomBytes} from 'node:crypto';

export const ANIME_SOURCES = ['animepahe', 'anikoto', 'shonen', 'anichan'] as const;
export const MANGA_SOURCES = ['mangadot', 'mangaball', 'xcomic', 'toonkotsu'] as const;
export const MAX_BODY = 65536;
export class ServiceError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export const reject = (status: number, code: string): never => {throw new ServiceError(status, code);};
export const opaqueId = () => randomBytes(24).toString('base64url');
export function authenticates(value: string | null, secret: string): boolean {
  if (secret.length < 32 || !value || value.length !== secret.length + 7 || !value.startsWith('Bearer ')) return false;
  const provided = Buffer.from(value.slice(7)), expected = Buffer.from(secret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
export const reference = (value: unknown, max = 16384): string => {
  if (typeof value !== 'string' || !value || value.length > max || /[\x00-\x1f\x7f]/.test(value)) return reject(400, 'INVALID_SELECTION');
  return value;
};
export const positive = (value: unknown, max = 2147483647): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) return reject(400, 'INVALID_SELECTION');
  return value;
};
export interface SourceRequest {kind: 'anime' | 'manga'; source: string; method: string; args: any[]}
export function sourceRequest(input: unknown): SourceRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return reject(400, 'INVALID_REQUEST');
  const row = input as Record<string, unknown>;
  if (Object.keys(row).some(key => !['kind', 'source', 'method', 'args'].includes(key))) return reject(400, 'INVALID_REQUEST');
  const {kind, source, method, args} = row;
  const sources: readonly unknown[] = kind === 'anime' ? ANIME_SOURCES : kind === 'manga' ? MANGA_SOURCES : [];
  const methods = kind === 'anime' ? ['search', 'episodes', 'links', 'resolve', 'ids', 'find', 'feed'] : ['find', 'chapters-page', 'pages', 'latest'];
  if (!sources.includes(source) || typeof method !== 'string' || !methods.includes(method) || !Array.isArray(args) || args.length > 3) return reject(400, 'SOURCE_OPERATION_NOT_ALLOWED');
  if (kind === 'anime') {
    if (method === 'search') {if (args.length !== 1) return reject(400, 'INVALID_REQUEST'); reference(args[0], 200);}
    else if (method === 'episodes') {if (args.length !== 2) return reject(400, 'INVALID_REQUEST'); reference(args[0], 512); positive(args[1], 1000);}
    else if (method === 'links') {if (args.length !== 2) return reject(400, 'INVALID_REQUEST'); reference(args[0], 8192); reference(args[1], 512);}
    else if (method === 'find') {if (args.length !== 1) return reject(400, 'INVALID_REQUEST'); positive(args[0]);}
    else if (method === 'feed') {if(args.length!==3||!['latest','top'].includes(args[0]))return reject(400,'INVALID_REQUEST');positive(args[1],1000);positive(args[2],50);}
    else {if (args.length !== 1) return reject(400, 'INVALID_REQUEST'); reference(args[0]);}
  } else if (method === 'find') {
    if (args.length !== 1) return reject(400, 'INVALID_REQUEST'); positive(args[0]);
  } else {
    const title = args[0];
    if (!title || typeof title !== 'object' || Array.isArray(title) || title.sourceId !== source || Object.keys(title).some(key => !['sourceId', 'id', 'title'].includes(key))) return reject(400, 'INVALID_SELECTION');
    reference(title.id, 512); reference(title.title, 512);
    if (method === 'chapters-page') {if (args.length !== 2) return reject(400, 'INVALID_REQUEST'); positive(args[1], 1000);}
    else if (method === 'pages') {if (args.length !== 2) return reject(400, 'INVALID_REQUEST'); reference(args[1], 512);}
    else if (args.length !== 1) return reject(400, 'INVALID_REQUEST');
  }
  return {kind: kind as SourceRequest['kind'], source: source as string, method, args};
}
/** No upstream error text, URL, cookie or stack crosses the service boundary. */
export function errorResponse(error: unknown): Response {
  const marker=String((error as any)?.code??'')+' '+String((error as any)?.message??'');
  const limited=(error as any)?.status===429||/RATE_LIMITED|COOLDOWN|limiting requests|too many requests|\b(?:HTTP|answered) 429\b/i.test(marker);
  const verification=(error as any)?.verify===true||(error as any)?.status===403||/SECURITY_CHECK|CAPTCHA_REQUIRED|verification|verify|challenge|Cloudflare/i.test(marker);
  const status = error instanceof ServiceError ? error.status : limited?429:verification?403:502;
  const code = error instanceof ServiceError ? error.code : limited?'SOURCE_RATE_LIMITED':verification?'SOURCE_VERIFICATION_REQUIRED':'SOURCE_UNAVAILABLE';
  return Response.json({error: code}, {status, headers: {'Cache-Control': 'no-store'}});
}
export async function boundedJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > MAX_BODY) return reject(413, 'REQUEST_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) return reject(400, 'INVALID_REQUEST');
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY) {await reader.cancel(); return reject(413, 'REQUEST_TOO_LARGE');}
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {if (error instanceof ServiceError) throw error; return reject(400, 'INVALID_REQUEST');}
}
