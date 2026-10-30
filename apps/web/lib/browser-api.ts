import {browserAnimeSources} from './anime-source-info';
import {setStandaloneSources,standaloneSourceIds} from './source-connections';
import { webAniList } from './anilist';
import { initializeStorage, table, values, write, on, emit, request, requestWithSignal, saveFile, loadFile, deleteFile } from './browser-storage';
import { mangaApi, novelApi } from './reading';
import { parseCharts } from '../source/packages/shared/anisongs';
import { parseThemesResponse, mixRadio } from '../source/packages/shared/anime-themes';
import { cityPopQueue } from '../source/packages/shared/city-pop';
import { playerHtml } from './city-pop-html';
import { browserAl, browserMal, browserAccountSync, finishBrowserAuth, loadBrowserAccountDefaults, queueListEntry, startBrowserAccountSync } from './browser-auth';
import { browserDownloads, recoverAnimeDownloads } from './browser-downloads';
import { entryAfterEpisode } from '../source/packages/shared/watch-progress';
import { browserMusic, musicUrl } from './browser-music';
import {followReadingDownloadsAcrossTabs} from './reading-download-events';
import {startReadingDownloadRecovery} from './reading-download-recovery';
import {downloadArchiveFile,cancelArchiveDownload,removeArchiveDownload,loadSavedArchiveBlob} from './browser-archive-downloads';
import type { ApiBridge } from '../source/apps/desktop/renderer/types';
import type { AnimeMeta, PlaybackProgress, ListEntry } from '../source/packages/shared/types';
import {enableLocalFileDownloads} from './local-files';
const metaMemory = new Map<number, AnimeMeta>();
function remember(value: any, depth = 0): any {
    if (!value || depth > 3)
        return value;
    if (Array.isArray(value)) {
        value.forEach(v => remember(v, depth + 1));
        return value;
    }
    if (typeof value === 'object') {
        if (Number.isInteger(value.id) && typeof value.title === 'string')
            metaMemory.set(value.id, value);
        for (const key of ['anime', 'results', 'data'])
            if (value[key])
                remember(value[key], depth + 1);
    }
    return value;
}
async function getAnime(id: number): Promise<AnimeMeta | null> { const saved = table('anime')[String(id)] ?? metaMemory.get(id); if (saved)
    return saved; const anime = await webAniList.get(id); if (anime) {
    metaMemory.set(id, anime);
    write('anime', String(id), anime);
} return anime; }
const animeApi = Object.fromEntries(Object.entries(webAniList).map(([key, fn]) => [key, async (...args: any[]) => remember(await (fn as any)(...args))])) as ApiBridge['anilist'];
animeApi.get = getAnime;
async function browserFeed(feed: 'top' | 'latest', page = 1, count = 30) {
    page = Math.max(1, Math.floor(page || 1)); count = Math.max(1, Math.min(50, Math.floor(count || 30)));
    if (feed === 'latest') {
        const result = await animeApi.recent(page);
        const items = result.data.slice(0, count).map(row => ({id: `${row.anime.id}:${row.episode}`, providerId: 'anilist', animeId: String(row.anime.id), externalLookupId: row.anime.id, title: row.anime.title, poster: row.anime.coverImage ?? undefined, episodeNumber: row.episode, publishedAt: new Date(row.airingAt * 1000).toISOString()}));
        return {providerId: 'anilist', feed, page, total: items.length, lastPage: page + (result.hasNextPage ? 1 : 0), groups: [{id: 'latest', title: 'Latest', items}]};
    }
    const definitions = [{id: 'trending', title: 'Trending', sort: 'TRENDING_DESC'}, {id: 'popular', title: 'Popular', sort: 'POPULARITY_DESC'}, {id: 'rated', title: 'Rated', sort: 'SCORE_DESC'}];
    const results = await Promise.all(definitions.map(group => animeApi.advancedSearch({sort: group.sort, page})));
    const groups = definitions.map((group, index) => ({id: group.id, title: group.title, items: results[index].results.slice(0, count).map(anime => ({id: String(anime.id), providerId: 'anilist', animeId: String(anime.id), externalLookupId: anime.id, title: anime.title, poster: anime.coverImage ?? undefined}))}));
    return {providerId: 'anilist', feed, page, total: groups.reduce((total, group) => total + group.items.length, 0), lastPage: Math.max(page, ...results.map(result => result.lastPage ?? page + (result.hasNextPage ? 1 : 0))), groups};
}
async function continueWatching() {
    const latest = new Map<number, PlaybackProgress>();
    for (const p of values('progress'))
        if (!table('dismissed')[String(p.animeId)] && (!latest.has(p.animeId) || latest.get(p.animeId)!.updatedAt < p.updatedAt))
            latest.set(p.animeId, p);
    const rows = [];
    for (const p of [...latest.values()].sort((a, b) => b.updatedAt - a.updatedAt)) {
        const anime = await getAnime(p.animeId).catch(() => null) ?? { id: p.animeId, title: p.animeTitle || 'Untitled', coverImage: p.animeCoverUrl };
        rows.push({ anime, episode: p.episode, positionSec: p.positionSec, durationSec: p.durationSec, percent: p.durationSec > 0 ? Math.min(100, p.positionSec / p.durationSec * 100) : 0, providerId: p.providerId, animePaheSession: p.animePaheSession, updatedAt: p.updatedAt });
    }
    return rows;
}
let player: HTMLDialogElement | null = null;
let playerUrls: string[] = [];
function closePlayer() { player?.querySelector('iframe')?.remove(); player?.close(); player?.remove(); player = null; for (const url of playerUrls)
    URL.revokeObjectURL(url); playerUrls = []; emit('city-pop:playback', false); }
function openPlayer(items: any[], start: number, mode: any, cover: string | null = null) {
    closePlayer();
    playerUrls = items.map(item => item.media).filter(url => url.startsWith('blob:'));
    const dialog = document.createElement('dialog');
    dialog.style.cssText = 'padding:0;border:1px solid #ff71b7;width:min(850px,calc(100vw - 24px));max-height:90dvh;background:#0d0221;color:white;border-radius:10px;box-shadow:0 20px 100px #000b';
    const close = document.createElement('button');
    close.textContent = 'Close player ×';
    close.style.cssText = 'display:block;margin:10px 14px 10px auto;background:#30203e;border:1px solid #a76b9a;color:#ffd1ef;border-radius:6px;padding:7px 14px;cursor:pointer';
    close.onclick = closePlayer;
    const iframe = document.createElement('iframe');
    iframe.title = 'City Pop player';
    iframe.allow = 'autoplay; fullscreen';
    iframe.style.cssText = 'display:block;width:100%;height:650px;max-height:76dvh;border:0';
    iframe.srcdoc = playerHtml(items, start, mode, cover);
    dialog.appendChild(close);
    dialog.appendChild(iframe);
    document.body.appendChild(dialog);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closePlayer(); });
    dialog.showModal();
    player = dialog;
    emit('city-pop:playback', true);
    return { ok: true };
}
export const downloadCityPop=downloadArchiveFile;
export async function archiveQueueItems(id: string, names: string[]) {
    let all: any[] | undefined;
    const items = [];
    for (const name of names) {
        const saved = values('cityDownloads').find(x => x.itemId === id && x.fileName === name && x.status === 'completed');
        const blob = saved ? await loadSavedArchiveBlob(saved.key) : null;
        if (blob && saved) {
            items.push({title: saved.title, artist: saved.artist, source: `https://archive.org/details/${id}`, media: URL.createObjectURL(blob), kind: saved.mediaType});
            continue;
        }
        all ??= await request('archive.item', id);
        const file = all!.find((x: any) => x.fileName === name);
        if (!file) throw new Error('One album file is no longer available.');
        items.push({title: file.title, artist: file.artist, source: `https://archive.org/details/${id}`, media: `/api/archive?item=${encodeURIComponent(id)}&file=${encodeURIComponent(name)}`, kind: file.mediaType});
    }
    return items;
}
export const cityPop: NonNullable<ApiBridge['cityPop']> = {
    open: async (ids, mode, saved) => { const queue = cityPopQueue(ids, saved); if (!queue.length)
        throw new Error('Choose a song.'); return openPlayer(queue.map(t => ({ title: t.title, artist: t.artist, source: `https://www.youtube.com/watch?v=${t.videoId}`, media: t.videoId, kind: 'youtube' })), 0, mode); },
    close: async () => closePlayer(), status: async () => !!player, onPlaybackChanged: fn => on('city-pop:playback', fn),
    search: q => request('youtube.search', q), archiveSearch: (q, page, media) => request('archive.search', q, page, media), archiveItem: id => request('archive.item', id),
    playArchive: async (id, names, start, mode) => openPlayer(await archiveQueueItems(id, names), start, mode, `https://archive.org/services/img/${id}`),
    downloadArchive: downloadCityPop, downloads: async () => values('cityDownloads'),
    cancelDownload: cancelArchiveDownload,
    removeDownload: removeArchiveDownload,
    playDownload: async (key, mode) => { const row = table('cityDownloads')[key]; const blob = await loadSavedArchiveBlob(key); if (!row || !blob)
        throw new Error(row?.webFiles?'This recording was saved to your device. Open it from your download folder.':'The saved file could not be found.'); return openPlayer([{ title: row.title, artist: row.artist, source: `https://archive.org/details/${row.itemId}`, media: URL.createObjectURL(blob), kind: row.mediaType }], 0, mode); },
};
export async function installBrowserApi() {
    initializeStorage();
    await enableLocalFileDownloads();
    try {const config=await requestWithSignal(AbortSignal.timeout(5000),'source.status');setStandaloneSources(config?.sources);} catch {setStandaloneSources([]);}
    followReadingDownloadsAcrossTabs();
    await recoverAnimeDownloads();
    await startReadingDownloadRecovery();
    const api: ApiBridge = {
        anilist: animeApi, manga: mangaApi, novel: novelApi, cityPop, downloads: browserDownloads, music: browserMusic, accountSync: browserAccountSync,
        list: {
            getAll: async () => Promise.all(values('list').map(async (entry) => ({ entry, anime: await getAnime(entry.animeId).catch(() => null) }))),
            set: async (entry) => { const anime = await getAnime(entry.animeId); if (anime)
                write('anime', String(anime.id), anime); const updated = { ...entry, updatedAt: Date.now() }; write('list', String(entry.animeId), updated); await queueListEntry(updated); return values('list'); },
            continueWatching, continueWatchingPaged: async (page, size) => { const rows = await continueWatching(); return { items: rows.slice((page - 1) * size, page * size), total: rows.length }; },
            dismissContinueWatching: async (id) => { write('dismissed', String(id), true); return { ok: true }; },
        },
        progress: { get: async (id, ep) => table('progress')[`${id}:${ep}`] ?? null, getForAnime: async (id) => values('progress').filter(p => p.animeId === id), set: async (p) => { write('progress', `${p.animeId}:${p.episode}`, { ...p, updatedAt: p.updatedAt || Date.now() }); write('dismissed', String(p.animeId), undefined); if (p.durationSec > 0 && p.positionSec / p.durationSec >= .9) {
                const anime = table('anime')[String(p.animeId)] ?? metaMemory.get(p.animeId);
                const existing = table('list')[String(p.animeId)];
                const watched = entryAfterEpisode(existing, p.episode, anime?.episodes);
                if (watched && (!existing || watched.status !== existing.status || watched.episodesWatched > existing.episodesWatched)) await api.list.set({ ...existing, ...watched, animeId: p.animeId, updatedAt: Date.now() });
            } return { ok: true }; } },
        al: browserAl, mal: browserMal,
        songs: { charts: async () => parseCharts(await (await fetch('/song_charts.json')).json()), search: (q, by) => request('songs', 'search', q, by), season: (s, y) => request('songs', 'season', s, y), show: id => request('songs', 'show', id) },
        themes: { forAnime: async (id) => { const anime = await getAnime(id); const shows = [{ id, title: anime?.title ?? 'Unknown', cover: anime?.coverImage ?? null }]; return parseThemesResponse(await request('themes', [id]), shows).get(id) ?? []; }, radio: async () => { const rows = values('list').slice(0, 10); const themes = await Promise.all(rows.map(r => api.themes.forAnime(r.animeId).catch(() => []))); return mixRadio(themes.flat()); } },
        providers: {
            list: async () => browserAnimeSources().map(source=>({...source,capabilities:{...source.capabilities},web:{...source.web}})),
            search: async q => {const extra=standaloneSourceIds().filter(id=>id==='animepahe'||id==='anichan');const responses=await Promise.allSettled([request('shonen','search',q),request('anime','search','anikoto',q),...extra.map(id=>request('anime','search',id,q))]);const rows=responses.flatMap(response=>response.status==='fulfilled'?response.value:[]);if(!rows.length&&responses.every(response=>response.status==='rejected'))throw new Error('The streaming sources could not be reached. Try another title or return later.');return rows;},
            episodes: (provider,id,page) => provider==='shonen'?request('shonen','episodes',id,page):request('anime','episodes',provider,id,page),
            links: (provider,episode,id) => provider==='shonen'?request('shonen','links',episode,id):request('anime','links',provider,episode,id),
            resolve: (provider,link) => provider==='shonen'?request('shonen','resolve',link):request('anime','resolve',provider,link),
            prefetch: async () => ({ok:true}),
            findByExternalId: async (id) => id ? request('shonen', 'find', id) : null,
            getExternalIds: async (provider,id) => provider==='shonen'||provider==='anichan'?{anilistId:Number(id)}:request('anime','ids',provider,id), feed: browserFeed,
        },
        pahe: { getUrl: async () => localStorage.getItem('anitrack.web.pahe-url') ?? 'https://animepahe.si', setUrl: async (url) => { const parsed = new URL(url); if (parsed.protocol !== 'https:' || !/^animepahe\.(?:si|ru|com|pw)$/.test(parsed.hostname))
                return { ok: false, url, reason: 'Choose a supported AnimePahe HTTPS domain.' }; localStorage.setItem('anitrack.web.pahe-url', parsed.origin); return { ok: true, url: parsed.origin }; }, search: q => api.providers!.search(q), episodes: (p,id,page) => api.providers!.episodes(p,id,page), links:(p,e,id)=>api.providers!.links(p,e,id), resolve:(p,l)=>api.providers!.resolve(p,l), prefetch: async () => ({ ok: true }), getIds: async (id) => ({ anilistId: Number(id) }), findById: async (id, mal) => api.providers!.findByExternalId(id, mal), latest: async () => { throw new Error('AnimePahe requires an app-managed website session. Use Latest Episodes from AniList here.'); }, anikotoTop: async () => request('anime','top','anikoto') },
        updater: { check: async () => { emit('update:not-available'); return { ok: true, version: '9.2.3-web' }; }, status: async () => ({ phase: 'disabled', message: 'The website updates when you reload it.' }), install: async () => location.reload() },
        on,
    };
    window.api = api;
    (window as any).__anitrackMusicUrl = musicUrl;
    if (table('publicAccountConfig').clients) void loadBrowserAccountDefaults();
    else await loadBrowserAccountDefaults();
    await finishBrowserAuth();
    await startBrowserAccountSync();
    document.addEventListener('visibilitychange', () => { if (document.hidden)
        emit('app:window-hidden'); });
}
