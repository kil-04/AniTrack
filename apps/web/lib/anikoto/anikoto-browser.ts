import {AnikotoTransportError} from './anikoto-transport';
import {assertAnikotoMediaUrl} from './anikoto-source';
import {anikotoBaseUrl} from './anikoto-config';
import type {StreamData} from './types';
import {SourceHttpError} from '../source-http';

export type SourceText = (url: string, init?: RequestInit, maximum?: number) => Promise<string>;
let readText: SourceText | undefined;
export function configureAnikotoTransport(transport: SourceText) {readText=transport;}
export async function anikotoFetch(raw: string, init: RequestInit = {}): Promise<Response> {
  if (!readText) throw new Error('The Anikoto transport has not started.');
  const url = assertAnikotoMediaUrl(raw);
  try {
    const value = await readText(url, {...init, cache: /getSources|ajax\/server\?get=/.test(url) ? 'no-store' : init.cache});
    return new Response(value,{headers:{'Content-Type':'text/plain;charset=utf-8'}});
  } catch(error) {
    // HLS masters can advertise absent optional I-frame/quality playlists.
    // Preserve their real status so the verifier can choose an existing video
    // rendition, rather than rejecting every server before that fallback runs.
    if (error instanceof SourceHttpError && error.sourceStatus === 404) return new Response(null,{status:404});
    const message = error instanceof Error ? error.message : 'Anikoto could not be reached.';
    if (/\b403\b|human browser|security check|browser verification/i.test(message)) throw new AnikotoTransportError('SECURITY_CHECK',message);
    if (/\b429\b|rate.limit/i.test(message)) throw new AnikotoTransportError('RATE_LIMITED',message);
    throw error;
  }
}
export function prewarmAnikoto(): void {}
export function rememberAnikotoStreamOrigin(_stream: StreamData, _referer: string): void {}
export function getAnikotoPlayerOrigin() {return anikotoBaseUrl();}
export function getAnikotoPlayerOriginForUrl(raw: string) {return new URL(assertAnikotoMediaUrl(raw)).origin;}
