import { table, values, write, emit, on, recordVersion, saveFile, loadFile, deleteFile } from './browser-storage';
import type { ApiBridge } from '../source/apps/desktop/renderer/types';
import type { DownloadItem } from '../source/packages/shared/types';
import { downloadOwner, type DownloadClaim } from './download-ownership';
import { assertDownloadPayload } from './media-payload';
import {localFileDownloads,prepareFileDownload,titleWriter,type SavedFiles} from './local-files';
import {animeFileOutput,AnimeFileOutput,episodeName} from './anime-file-output';
type WebDownload = DownloadItem & Partial<DownloadClaim> & {fileCount?: number; filePrefix?: string;webFileOutput?:boolean;webFiles?:SavedFiles};
const active = new Map<string, AbortController>();
const claims = new Map<string, DownloadClaim>();
const settling = new Map<string, Promise<void>>();
const removals = new Map<string, Promise<{ok: boolean}>>();
const urls = new Map<string, string[]>();
const known = new Map<string, string>();
const update = (row: WebDownload) => { write('animeDownloads', row.id, { ...row }); known.set(row.id, JSON.stringify(row)); emit('download:progress', { ...row }); };
const prefixFor = (row: WebDownload) => row.filePrefix ?? `episode:${row.id}`;
let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
let watching = false;
function watchOtherTabs() {
    if (watching || typeof window === 'undefined') return;
    watching = true;
    for (const row of values('animeDownloads')) known.set(row.id, JSON.stringify(row));
    window.addEventListener('focus', () => { void recoverAnimeDownloads().catch(() => {}); });
    on('storage:changed', ({tables = []}: {tables?: string[]}) => {
        if (tables.length && !tables.includes('animeDownloads')) return;
        for (const [id, controller] of active) if (!downloadOwner.matches(table('animeDownloads')[id], claims.get(id)!)) controller.abort();
        const rows = values('animeDownloads');
        const present = new Set(rows.map(row => row.id));
        for (const id of known.keys()) if (!present.has(id)) { known.delete(id); emit('download:removed', id); }
        for (const row of rows) {
            const signature = JSON.stringify(row);
            if (known.get(row.id) !== signature) { known.set(row.id, signature); emit('download:progress', row); }
        }
    });
}
export async function recoverAnimeDownloads(): Promise<void> {
    watchOtherTabs();
    if (!downloadOwner.supported) return;
    let pending = false;
    for (const item of values('animeDownloads') as WebDownload[]) {
        if (!item.webOwner || !['queued', 'downloading'].includes(item.status)) continue;
        await downloadOwner.withResource('anime', item.id, async () => {
            const row = table('animeDownloads')[item.id] as WebDownload | undefined;
            if (!row?.webOwner || !['queued', 'downloading'].includes(row.status)) return;
            if (await downloadOwner.isLive(row.webOwner)) { if (row.webOwner !== downloadOwner.id) pending = true; return; }
            if (row.status==='queued'&&row.animeSession&&row.episodeSession) {
                // Retain the dead lease identity so the renderer can distinguish
                // resumable modern work from an ambiguous pre-lease queue.
                update({...row,error:undefined,updatedAt:Date.now()});
            } else update({...row, status: 'failed', error: 'The tab closed before this download finished. Retry to complete it.'});
        });
    }
    if (!pending && recoveryTimer !== undefined) { clearTimeout(recoveryTimer); recoveryTimer = undefined; }
    if (pending && recoveryTimer === undefined && typeof document !== 'undefined') {
        recoveryTimer = setTimeout(() => { recoveryTimer = undefined; void recoverAnimeDownloads().catch(() => {}); }, 30000);
        (recoveryTimer as any).unref?.();
    }
}
async function claimQueued(input: DownloadItem): Promise<{ok: boolean; claim?: DownloadClaim; row?: WebDownload}> {
    watchOtherTabs();
    const before = recordVersion('animeDownloads', input.id);
    await downloadOwner.ensure();
    return downloadOwner.withResource('anime', input.id, async () => {
        const previous = table('animeDownloads')[input.id] as WebDownload | undefined;
        if (!previous && recordVersion('animeDownloads', input.id) !== before) return {ok: false};
        if (input.status === 'failed') {
            if (!previous || previous.webOwner !== downloadOwner.id || previous.status === 'done' || (active.has(input.id) && !active.get(input.id)!.signal.aborted)) return {ok: false};
            update({...previous, status: 'failed', error: input.error ?? 'The source could not resolve this episode. Retry the download.', updatedAt: Date.now()});
            return {ok: true};
        }
        if (previous?.status === 'done') return {ok: false};
        // An older release has no lease to test. Only an explicit removal may
        // release its pending work; it may still be running in another tab.
        if (previous && !previous.webOwner && ['queued', 'downloading'].includes(previous.status)) return {ok: false};
        if (previous?.webOwner && previous.webOwner !== downloadOwner.id && await downloadOwner.isLive(previous.webOwner)) return {ok: false};
        if (previous?.webOwner === downloadOwner.id && previous.webGeneration && previous.status === 'queued') return {ok: true, claim: {webOwner: previous.webOwner, webGeneration: previous.webGeneration}, row: previous};
        if (active.has(input.id) && !active.get(input.id)!.signal.aborted) return {ok: false};
        const claim = downloadOwner.claim();
        // Deliberately whitelist metadata: resolved signed URLs never persist.
        const row: WebDownload = {id: input.id, animeId: input.animeId, episode: input.episode, title: input.title, coverUrl: input.coverUrl, providerId: input.providerId, animeSession: input.animeSession, episodeSession: input.episodeSession, status: 'queued', progress: 0, sizeBytes: previous?.sizeBytes ?? 0, updatedAt: Date.now(), fileCount: previous?.fileCount ?? 0, filePrefix: previous?.filePrefix,webFileOutput:previous?.webFileOutput, ...claim};
        update(row);
        return {ok: true, claim, row};
    });
}
async function clearSaved(row: WebDownload) {
    if(row.webFileOutput||row.webFiles)return;
    const prefix = prefixFor(row);
    const index = await loadFile<any>(`${prefix}:index`);
    const count = Math.max(index?.count ?? 0, row.fileCount ?? 0);
    for (let i = 0; i < count; i++) await deleteFile(`${prefix}:${i}`);
    await deleteFile(`${prefix}:index`);
    await deleteFile(`${prefix}:subtitle`);
}
async function start(opts: any): Promise<{ok: boolean}> {
    const removal = removals.get(opts.id);
    if (removal) { await removal; return start(opts); }
    const previous = active.get(opts.id);
    if (previous) {
        if (!previous.signal.aborted) return {ok: true};
        await settling.get(opts.id);
        return start(opts);
    }
    if (table('animeDownloads')[opts.id]?.status === 'done')
        return { ok: true };
    const queued = await claimQueued({...opts, status: 'queued'});
    if (!queued.ok || !queued.claim || !queued.row) return {ok: false};
    // Another local caller may have adopted the same queued generation while
    // the short metadata lock was pending.
    if (active.has(opts.id)) return {ok: true};
    const claim = queued.claim;
    const previousFiles = queued.row;
    if (!downloadOwner.matches(table('animeDownloads')[opts.id], claim)) return {ok: false};
    const controller = new AbortController();
    let release!: () => void;
    const finished = new Promise<void>(resolve => {release = resolve;});
    settling.set(opts.id, finished);
    active.set(opts.id, controller);
    claims.set(opts.id, claim);
    const prefix = `episode:${opts.id}:${claim.webGeneration}`;
    const row: WebDownload & {fileCount: number} = { id: opts.id, animeId: opts.animeId, episode: opts.episode, title: opts.title, coverUrl: opts.coverUrl, providerId: opts.providerId, status: 'downloading', progress: 0, sizeBytes: 0, updatedAt: Date.now(), animeSession: opts.animeSession, episodeSession: opts.episodeSession, fileCount: 0, filePrefix: prefix, ...claim };
    const current = () => {
        const saved = table('animeDownloads')[opts.id];
        if (controller.signal.aborted || !downloadOwner.matches(saved, claim) || !['queued', 'downloading'].includes(saved.status)) { controller.abort(); throw new Error('Download cancelled.'); }
    };
    const publish = () => downloadOwner.withResource('anime', opts.id, () => { current(); update(row); });
    let count = 0, completed = 0, total = 1, totalBytes = 0;
    const files = new Map<string, Promise<number>>();
    const visiting=new Set<string>();
    let output:AnimeFileOutput|undefined,delivered=false;
    async function keep(url: string, depth = 0, kind: 'media' | 'key' = 'media'): Promise<number> {
        current();
        if (depth > 5 || count >= 15000)
            throw new Error('The playlist is too large to save in this browser.');
        const absolute = new URL(url, location.origin);
        if (absolute.origin !== location.origin || !absolute.pathname.startsWith('/api/media'))
            throw new Error('This source has no browser-supported offline endpoint.');
        const known = files.get(absolute.href);
        if (known) {
            if(visiting.has(absolute.href))throw new Error('The source returned a circular playlist. Choose another server.');
            const index = await known;
            if(output)output.check(index,kind);
            else {
                const saved = await loadFile<any>(`${prefix}:${index}`);
                if (saved?.blob) await assertDownloadPayload(saved.blob, kind);
                else if (kind === 'key') throw new Error('The source returned an invalid encryption key.');
            }
            current();
            return index;
        }
        const index = count++;
        visiting.add(absolute.href);
        const promise = (async () => {
            if (opts.conservativeNetwork && index > 0)
                await new Promise(resolve => setTimeout(resolve, 250));
            const response = await fetch(absolute.href, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]) });
            if (!response.ok) {
                let message = 'A media file could not be downloaded.';
                try {
                    message = ((await response.json()) as {
                        error?: string;
                    }).error ?? message;
                }
                catch { }
                throw new Error(message);
            }
            const blob = await response.blob();
            current();
            await assertDownloadPayload(blob, kind);
            totalBytes += blob.size;
            if (output?.writer.kind!=='folder'&&totalBytes > 2 * 1024 ** 3)
                throw new Error('This download exceeds the 2 GB browser limit.');
            const header = await blob.slice(0, 16).text();
            if (kind !== 'key' && header.trimStart().startsWith('#EXTM3U')) {
                const text = await blob.text();
                const lines = text.split(/\r?\n/);
                let wanted = lines;
                const variants = lines.flatMap((line, i) => line.startsWith('#EXT-X-STREAM-INF:') && lines[i + 1] ? [{ line: lines[i + 1], header: line, bandwidth: Number(line.match(/BANDWIDTH=(\d+)/)?.[1] ?? 0) }] : []);
                if (variants.length) {
                    const best = variants.sort((a, b) => b.bandwidth - a.bandwidth)[0];
                    const audio = best.header.match(/AUDIO="([^"]+)"/)?.[1];
                    const subtitles = best.header.match(/SUBTITLES="([^"]+)"/)?.[1];
                    const groups = lines.filter(line => line.startsWith('#EXT-X-MEDIA:') && ((audio && /TYPE=AUDIO(?:,|$)/.test(line) && line.includes(`GROUP-ID="${audio}"`)) || (subtitles && /TYPE=SUBTITLES(?:,|$)/.test(line) && line.includes(`GROUP-ID="${subtitles}"`))));
                    const keys = lines.filter(line => line.startsWith('#EXT-X-SESSION-KEY:'));
                    wanted = ['#EXTM3U', ...keys, ...groups, best.header, best.line];
                }
                else if (!lines.some(line => line.trim() === '#EXT-X-ENDLIST')) throw new Error('This episode is live or still updating. Wait for a finished playlist before downloading it offline.');
                total += wanted.filter(line => line.trim() && !line.startsWith('#')).length + wanted.filter(line => /URI="/.test(line)).length;
                const rewritten = [];
                for (const line of wanted) {
                    if (line.trim() && !line.startsWith('#'))
                        rewritten.push(`anitrack-file:${await keep(new URL(line.trim(), absolute.href).href, depth + 1)}`);
                    else {
                        let next = line;
                        for (const match of line.matchAll(/URI="([^"]+)"/g)) {
                            const file = await keep(new URL(match[1], absolute.href).href, depth + 1, /^#EXT-X-(?:SESSION-)?KEY:/.test(line) ? 'key' : 'media');
                            next = next.replace(match[0], `URI="anitrack-file:${file}"`);
                        }
                        rewritten.push(next);
                    }
                }
                current();
                if(output)await output.playlist(index,rewritten.join('\n'));
                else await saveFile(`${prefix}:${index}`, { text: rewritten.join('\n') });
            }
            else if(output)await output.blob(index,blob,kind);
            else await saveFile(`${prefix}:${index}`, { blob });
            current();
            completed++;
            row.fileCount = count;
            row.sizeBytes = totalBytes;
            row.doneSegments = completed;
            row.totalSegments = Math.max(total, completed);
            row.progress = Math.min(99, Math.floor(completed / Math.max(total, completed) * 100));
            row.updatedAt = Date.now();
            await publish();
            return index;
        })().finally(()=>visiting.delete(absolute.href));
        files.set(absolute.href, promise);
        return promise;
    }
    try {
        if(localFileDownloads()){output=await animeFileOutput(opts.title,opts.episode);row.webFileOutput=true;}
        if(output)await clearSaved(previousFiles).catch(()=>{});
        else await clearSaved(previousFiles);
        current();
        await publish();
        const first = await keep(opts.hlsUrl);
        if (opts.subtitleUrl) {
            const url = new URL(opts.subtitleUrl, location.origin);
            if (url.origin !== location.origin || !url.pathname.startsWith('/api/media'))
                throw new Error('This source subtitle cannot be saved in the browser.');
            const response = await fetch(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]) });
            if (!response.ok)
                throw new Error('The subtitle could not be saved.');
            const subtitle = await response.blob();
            current();
            await assertDownloadPayload(subtitle, 'subtitle');
            if(output)await output.subtitle(subtitle);
            else await saveFile(`${prefix}:subtitle`, subtitle);
        }
        if (controller.signal.aborted)
            throw new Error('Download cancelled.');
        if(output){row.webFiles=await output.finish();delivered=true;}
        else await saveFile(`${prefix}:index`, { first, count, subtitle: !!opts.subtitleUrl });
        current();
        row.status = 'done';
        row.progress = 100;
        row.updatedAt = Date.now();
        await publish();
        return { ok: true };
    }
    catch (e) {
        await downloadOwner.withResource('anime', opts.id, () => {
            if (!downloadOwner.matches(table('animeDownloads')[opts.id], claim)) return;
            row.status = 'failed';
            row.error = e instanceof Error && e.name === 'TimeoutError' ? 'The media request timed out. Retry this download when the connection is stable.' : e instanceof Error ? e.message : 'Download failed.';
            row.updatedAt = Date.now();
            update(row);
        });
        throw e;
    }
    finally {
        try {
            if(output&&!delivered)await output.abort();
            if (!output&&(controller.signal.aborted || !downloadOwner.matches(table('animeDownloads')[opts.id], claim))) {
                for (let i = 0; i < count; i++) await deleteFile(`${prefix}:${i}`);
                await deleteFile(`${prefix}:index`);
                await deleteFile(`${prefix}:subtitle`);
            }
        } finally {
            if (active.get(opts.id) === controller) active.delete(opts.id);
            if (claims.get(opts.id) === claim) claims.delete(opts.id);
            if (settling.get(opts.id) === finished) settling.delete(opts.id);
            release();
        }
    }
}
async function getPlayUrl(id: string) {
    const row = table('animeDownloads')[id] as WebDownload | undefined;
    if (!row || row.status !== 'done') throw new Error('This download is not complete.');
    if(row.webFileOutput||row.webFiles)throw new Error('This episode was saved as local files. Open it from the title folder on your device.');
    const prefix = prefixFor(row);
    const index = await loadFile<any>(`${prefix}:index`);
    if (!index)
        throw new Error('This download is not complete.');
    for (const url of urls.get(id) ?? [])
        URL.revokeObjectURL(url);
    const created: string[] = [];
    urls.set(id, created);
    const memo = new Map<number, string>();
    async function restore(i: number): Promise<string> {
        const known = memo.get(i);
        if (known)
            return known;
        const record = await loadFile<any>(`${prefix}:${i}`);
        if (!record)
            throw new Error('The saved episode is incomplete. Download it again.');
        let blob: Blob;
        if (record.text != null) {
            let text = record.text;
            const references = [...new Set([...text.matchAll(/anitrack-file:(\d+)/g)].map((match: RegExpMatchArray) => Number(match[1])))];
            const restored = new Map<number, string>();
            for (const reference of references) restored.set(reference, await restore(reference));
            // Replace complete tokens in one pass: file:1 must never modify
            // file:10/file:11 before those segment references are restored.
            text = text.replace(/anitrack-file:(\d+)/g, (_: string, id: string) => restored.get(Number(id))!);
            blob = new Blob([text], { type: 'application/vnd.apple.mpegurl' });
        }
        else
            blob = record.blob;
        const url = URL.createObjectURL(blob);
        created.push(url);
        memo.set(i, url);
        return url;
    }
    const url = await restore(index.first);
    return { url: `${url}#index.m3u8` };
}
export async function subtitleUrl(id: string) { const row = table('animeDownloads')[id] as WebDownload | undefined; if (!row || row.status !== 'done') return null; const blob = await loadFile<Blob>(`${prefixFor(row)}:subtitle`); return blob ? URL.createObjectURL(blob) : null; }
async function remove(id: string): Promise<{ok: boolean}> {
    const existing = removals.get(id);
    if (existing) return existing;
    const removing = (async () => {
        active.get(id)?.abort();
        const row = await downloadOwner.withResource('anime', id, () => {
            const row = table('animeDownloads')[id] as WebDownload | undefined;
            write('animeDownloads', id, undefined);
            known.delete(id);
            emit('download:removed', id);
            return row;
        });
        // A foreign worker sees the missing generation and stops publishing.
        // Its generation-scoped files cannot overwrite or delete a retry.
        if (row) await clearSaved(row);
        for (const url of urls.get(id) ?? []) URL.revokeObjectURL(url);
        urls.delete(id);
        return {ok: true};
    })();
    removals.set(id, removing);
    try { return await removing; }
    finally { if (removals.get(id) === removing) removals.delete(id); }
}
export const browserDownloads: NonNullable<ApiBridge['downloads']> & {
    subtitleUrl: typeof subtitleUrl;
    queue: (row: DownloadItem) => Promise<{ok: boolean}>;
    prepareSave:typeof prepareFileDownload;
    exportFiles:typeof exportEpisodeFiles;
} = {
    start, list: async () => ({ items: values('animeDownloads') }), getPlayUrl, subtitleUrl,
    queue: async row => { const result = await claimQueued(row); return {ok: result.ok}; },
    remove,
    prepareSave:prepareFileDownload,exportFiles:exportEpisodeFiles,
};

/** Export an earlier browser save without fetching any media again. */
export async function exportEpisodeFiles(id:string):Promise<SavedFiles>{
    const row=table('animeDownloads')[id] as WebDownload|undefined;
    if(!row||row.status!=='done')throw new Error('This episode is not completely downloaded.');
    if(row.webFiles)return row.webFiles;
    if(!await prepareFileDownload())throw new Error('Folder selection was cancelled.');
    const prefix=prefixFor(row),index=await loadFile<any>(`${prefix}:index`);
    if(!index||!Number.isInteger(index.first)||!Number.isInteger(index.count)||index.count>15000)throw new Error('The saved episode is incomplete.');
    const target=await titleWriter(row.title,episodeName(row.episode)),output=new AnimeFileOutput(target.writer,target.stem,index.first);
    const visited=new Set<number>(),pending=new Set<number>();
    async function copy(file:number,kind:'media'|'key'='media'){
        if(visited.has(file)){output.check(file,kind);return;}
        if(pending.has(file)||file<0||file>=index.count)throw new Error('The saved episode contains an invalid playlist.');
        pending.add(file);
        const data=await loadFile<any>(`${prefix}:${file}`);if(!data)throw new Error('The saved episode is incomplete.');
        if(typeof data.text==='string'){
            const refs=[...data.text.matchAll(/anitrack-file:(\d+)/g)].map((match:RegExpMatchArray)=>Number(match[1]));
            const keys=new Set<number>(data.text.split(/\r?\n/).filter((line:string)=>/^#EXT-X-(?:SESSION-)?KEY:/.test(line)).flatMap((line:string)=>[...line.matchAll(/URI="anitrack-file:(\d+)"/g)].map(match=>Number(match[1]))));
            for(const child of refs)await copy(child,keys.has(child)?'key':'media');
            await output.playlist(file,data.text);
        }else if(data.blob){await assertDownloadPayload(data.blob,kind);await output.blob(file,data.blob,kind);}
        else throw new Error('The saved episode is incomplete.');
        pending.delete(file);visited.add(file);
    }
    try{
        await copy(index.first);
        const subtitle=await loadFile<Blob>(`${prefix}:subtitle`);if(subtitle)await output.subtitle(subtitle);
        return await output.finish();
    }catch(error){await output.abort();throw error;}
}
