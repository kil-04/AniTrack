import {cacheableSourceRequest} from './source-request';
import {serverFetch as fetch} from '../server/network';
const cache = new Map<string, {
    at: number;
    value: string;
}>();
const lastRequest = new Map<string, number>();
/** Preserve upstream status for connectors with optional HTTP resources. */
export class SourceHttpError extends Error {
    constructor(public readonly sourceStatus: number, message: string) {
        super(message);
        this.name = 'SourceHttpError';
    }
}
export async function boundedText(response: Response, maximum: number): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader)
        throw new Error('The source returned no data.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            size += value.byteLength;
            if (size > maximum)
                throw new Error('The source returned too much data.');
            chunks.push(value);
        }
    }
    finally {
        await reader.cancel().catch(() => { });
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
        data.set(c, offset);
        offset += c.length;
    }
    return new TextDecoder().decode(data);
}
export async function sourceText(url: string, init: RequestInit = {}, maximum = 8 * 1024 * 1024): Promise<string> {
    const cached = cache.get(url);
    const cacheable = cacheableSourceRequest(init);
    if (cacheable && cached && Date.now() - cached.at < 180000)
        return cached.value;
    const host = new URL(url).hostname;
    const delay = host === 'shonen.to' ? 500 : host === 'api.mangaball.com' ? 250 : host === 'xcomic.me' ? 700 : 300;
    const slot = Math.max(Date.now(), lastRequest.get(host) ?? 0);
    lastRequest.set(host, slot + delay);
    if (slot > Date.now())
        await new Promise(resolve => setTimeout(resolve, slot - Date.now()));
    const requestInit = {...init};
    delete requestInit.cache;
    const headers = new Headers(init.headers);
    if (!headers.has('User-Agent')) headers.set('User-Agent','AniTrack/9.2.2 (Web)');
    if (!headers.has('Accept')) headers.set('Accept','application/json,text/html;q=0.9');
    const response = await fetch(url, { ...requestInit, redirect: 'manual', headers, signal: init.signal ? AbortSignal.any([init.signal,AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000) });
    if (!response.ok) {
        await response.body?.cancel();
        throw new SourceHttpError(response.status, `${new URL(url).hostname} answered ${response.status}. This source may require its own browser session; try another source or the installed app.`);
    }
    const text = await boundedText(response, maximum);
    if (/<title>[^<]*(?:just a moment|attention required|verify)/i.test(text))
        throw new Error(`${new URL(url).hostname} requires a human browser check. The website cannot share the installed app's verified session.`);
    if (cacheable) {
        cache.set(url, { at: Date.now(), value: text });
        let chars = [...cache.values()].reduce((sum, x) => sum + x.value.length, 0);
        while (cache.size > 80 || chars > 8 * 1024 * 1024) {
            const first = cache.keys().next().value!;
            chars -= cache.get(first)!.value.length;
            cache.delete(first);
        }
    }
    return text;
}
