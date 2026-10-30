import { table, values, write, on, emit, request, result, saveFile, loadFile, deleteFile } from './browser-storage';
import { mangaFeed, searchManga, mangaById as getManga, animeAdaptations } from './anilist-manga';
import { chapterKey, NOVEL_SOURCES } from '../source/packages/shared/novel';
import type { MangaApi } from '../source/apps/desktop/renderer/lib/manga-api';
import type { NovelApi } from '../source/apps/desktop/renderer/lib/novel-api';
import type { MangaDownload } from '../source/packages/shared/manga';
import { planRange } from '../source/packages/shared/manga';
import { normalizeNovelHome } from './novel-home';
import {prepareFileDownload} from './local-files';
import { browserMangaSources, browserMangaSource } from './manga-source-info';
import {downloadManga,offlineMangaPages,removeMangaDownload,cancelMangaDownloads} from './browser-manga-downloads';
import {queueNovelDownloads,savedNovelChapter,cancelNovelDownloads,removeNovelDownloads} from './browser-novel-downloads';
export {recoverNovelDownloads} from './browser-novel-downloads';
const last = (rows: any[], key: (x: any) => string) => [...new Map([...rows].sort((a, b) => a.updatedAt - b.updatedAt).map(x => [key(x), x])).values()].sort((a, b) => b.updatedAt - a.updatedAt);
export const mangaApi: MangaApi = {
    feed: mangaFeed, search: searchManga, get: getManga, adaptations: animeAdaptations,
    sources: async () => browserMangaSources().map(source => ({...source, web: {...source.web}})),
    find: async (sourceId, id) => { const source = browserMangaSource(sourceId); if (source?.web.state === 'native-required') return {ok:false,error:source.web.description,verify:true}; return result((async () => { if (!source)
        throw new Error('This source requires an app-managed website session.'); const manga = await getManga(id); if (!manga)
        throw new Error('This manga is unavailable.'); const title = await request('manga', 'find', manga, sourceId); if (title) { write('mangaTitles', `${id}:${sourceId}`, title); write('mangaTitles', String(id), title); } return title; })()); },
    chapters: async (title) => result((async () => { const chapters = []; for (let page = 1; page <= 100; page++) { const result = await request('manga', 'chapters-page', title, page); chapters.push(...result.chapters); if (page >= result.totalPages) break; } const list = [...new Map(chapters.map(chapter => [chapter.id, chapter])).values()].sort((a, b) => a.number - b.number); await saveFile(`manga-chapters:${title.sourceId}:${title.id}`, { at: Date.now(), list }); return list; })()),
    savedChapters: async (title) => await loadFile(`manga-chapters:${title.sourceId}:${title.id}`) ?? null,
    pages: async (title, chapterId, mangaId) => result((async () => await offlineMangaPages(mangaId,chapterId) ?? await request('manga','pages',title,chapterId))()),
    connect: async (sourceId) => { const source = browserMangaSource(sourceId); throw new Error(source?.web.state === 'native-required' ? source.web.description : 'This source needs its website check refreshed. Choose another source and try again later.'); },
    reading: async (id) => Object.fromEntries(values('mangaReading').filter(r => r.mangaId === id).map(r => [String(r.chapter), r])),
    saveReading: async (row) => { write('mangaReading', `${row.mangaId}:${row.chapter}`, { ...row, updatedAt: Date.now() }); return { ok: true }; },
    markRead: async (id, chapters, read, title, cover, sourceId) => { for (const c of chapters) {
        write('mangaReading', `${id}:${c.number}`, read ? { mangaId: id, chapter: c.number, chapterId: c.id, page: Math.max(0, c.pageCount - 1), pageCount: c.pageCount, title, cover, sourceId, updatedAt: Date.now() } : undefined);
    } return { ok: true }; },
    continueReading: async () => last(values('mangaReading'), r => String(r.mangaId)),
    forgetReading: async (id) => { for (const [key, row] of Object.entries(table('mangaReading')))
        if (row.mangaId === id)
            write('mangaReading', key, undefined); return { ok: true }; },
    readingAll: async () => values('mangaReading'),
    applyReading: async (upserts, removes) => { for (const r of removes)
        write('mangaReading', `${r.mangaId}:${r.chapter}`, undefined); for (const r of upserts)
        if ((table('mangaReading')[`${r.mangaId}:${r.chapter}`]?.updatedAt ?? 0) < r.updatedAt)
            write('mangaReading', `${r.mangaId}:${r.chapter}`, r); return { ok: true, applied: upserts.length, removed: removes.length }; },
    status: async (id) => table('mangaList')[String(id)]?.status ?? null,
    setStatus: async (id, status, title, cover) => { write('mangaList', String(id), status ? { mangaId: id, status, title, cover, updatedAt: Date.now() } : undefined); return { ok: true }; },
    list: async () => values('mangaList'), downloads: async () => values('mangaDownloads'), download: downloadManga,
    downloadRange: async (manga, title, chapters) => { if(!await prepareFileDownload())return 0; const plan = planRange(chapters, values('mangaDownloads'), manga.id); for (const key of plan.drop) await mangaApi.removeDownload(key); let count = 0; for (const chapter of plan.add)
        if (await downloadManga(manga, title, chapter))
            count++; return count; },
    removeDownload: removeMangaDownload,
    cancelDownloads: cancelMangaDownloads,
    onDownload: fn => on('manga:download', fn),
    tracked: async () => last([...values('mangaList'), ...values('mangaReading')].map(x => ({ ...x, lastRead: x.chapter ?? null })), x => String(x.mangaId)),
    latest: async (id, preferred, skip) => {
        const blocked: string[] = [];
        const order = browserMangaSources().sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));
        for (const source of order) {
            if (skip.includes(source.id)) continue;
            if (source.web.state === 'native-required') {blocked.push(source.id); continue;}
            try {
                let title = table('mangaTitles')[`${id}:${source.id}`];
                const legacy = table('mangaTitles')[String(id)];
                if (!title && legacy?.sourceId === source.id) title = legacy;
                if (!title) {const found = await mangaApi.find(source.id, id); if (found.ok) title = found.value; else {blocked.push(source.id); continue;}}
                if (!title) continue;
                const latest = await request('manga', 'latest', title);
                if (latest) return {found: {...latest, sourceId: source.id, label: source.label}, blocked};
            } catch {blocked.push(source.id);}
        }
        return {found: null, blocked};
    },
};
const copy = (s: string, id: string) => `${s}:${id}`;
function novelTime(kind: 'reading' | 'list', key: string) { const known = table(`novelKnownDeleted:${kind}`); const pending = table(`novelDeleted:${kind}`); return Math.max(Date.now(), Number(known[key] ?? 0) + 1, Number(pending[key] ?? 0) + 1); }
function removeNovel(kind: 'reading' | 'list', key: string) { write(`novelDeleted:${kind}`, key, novelTime(kind, key)); }
const rememberNovel = (detail: any) => { const key = copy(detail.sourceId, detail.id); const previous = table('novelTitles')[key]; write('novelTitles', key, { ...previous, sourceId: detail.sourceId, titleId: detail.id, title: detail.title, cover: detail.cover, novelKey: previous?.novelKey ?? key, linkAt: previous?.linkAt ?? null, seen: previous?.seen ?? null }); write('novelDetails', key, detail); return detail; };
function novelGroup(s: string, id: string) { const key = copy(s, id), known = table('novelTitles')[key]; const copies = values('novelTitles').filter(t => (t.novelKey ?? copy(t.sourceId, t.titleId)) === (known?.novelKey ?? key)); return { key: known?.novelKey ?? key, members: copies.map(t => ({ sourceId: t.sourceId, id: t.titleId, title: t.title, cover: t.cover })), reading: values('novelReading').filter(r => copies.some(t => t.sourceId === r.sourceId && t.titleId === r.titleId)) }; }
export const novelApi: NovelApi = {
    sources: async () => NOVEL_SOURCES,
    home: async () => result(request('novel', 'home').then(normalizeNovelHome)),
    search: async (filters) => result(request('novel', 'search', filters)),
    title: async (s, id) => result(request('novel', 'title', s, id).then(rememberNovel)),
    savedTitle: async (s, id) => { const detail = table('novelDetails')[copy(s, id)]; return detail ? { detail, chapters: await loadFile(`novel-chapters:${copy(s, id)}`) ?? [] } : null; },
    chapters: async (s, id) => result(request('novel', 'chapters', s, id).then(async chapters => { await saveFile(`novel-chapters:${copy(s, id)}`, chapters); return chapters; })),
    chapter: async (s, id, c) => result((async () => await savedNovelChapter(s,id,c) ?? await request('novel', 'chapter', s, id, c))()),
    reading: async (s, id) => Object.fromEntries(novelGroup(s, id).reading.sort((a, b) => a.updatedAt - b.updatedAt).map(r => [chapterKey(r.chapterLabel), r])),
    saveReading: async (row) => { const key = `${row.sourceId}:${row.titleId}:${row.chapterId}`; write('novelReading', key, { ...row, updatedAt: Math.max(novelTime('reading', key), novelTime('reading', `${row.sourceId}:${row.titleId}`)) }); return { ok: true }; },
    markRead: async (s, id, chapters, read, title, cover) => { for (const c of chapters) {
        const key = `${s}:${id}:${c.id}`;
        if (!read)
            removeNovel('reading', key);
        write('novelReading', key, read ? { sourceId: s, titleId: id, chapterId: c.id, chapterOrder: c.order, chapterLabel: c.label, paragraph: 1, paragraphCount: 1, title, cover, updatedAt: Math.max(novelTime('reading', key), novelTime('reading', `${s}:${id}`)) } : undefined);
    } return { ok: true }; },
    continueReading: async () => last(values('novelReading'), r => table('novelTitles')[copy(r.sourceId, r.titleId)]?.novelKey ?? copy(r.sourceId, r.titleId)),
    forgetReading: async (s, id) => { removeNovel('reading', copy(s, id)); for (const [key, row] of Object.entries(table('novelReading')))
        if (row.sourceId === s && row.titleId === id)
            write('novelReading', key, undefined); return { ok: true }; },
    status: async (s, id) => table('novelList')[copy(s, id)]?.status ?? null,
    setStatus: async (s, id, status, title, cover) => { const key = copy(s, id); if (!status)
        removeNovel('list', key); write('novelList', key, status ? { sourceId: s, titleId: id, status, title, cover, updatedAt: novelTime('list', key) } : undefined); return { ok: true }; },
    list: async () => values('novelList'), group: async (s, id) => novelGroup(s, id) as any,
    findOn: async (s, id, target) => result((async () => { const detail = rememberNovel(table('novelDetails')[copy(s, id)] ?? await request('novel', 'title', s, id)); const page = await request('novel', 'search', { sourceId: target, query: detail.title }); const normalize = (v: string) => v.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); const hit = page.items.find((x: any) => normalize(x.title) === normalize(detail.title)); if (!hit)
        return page.items.length ? { state: 'candidates' as const, items: page.items } : { state: 'none' as const }; const targetDetail = rememberNovel(await request('novel', 'title', target, hit.id)); await novelApi.link({ sourceId: s, id }, { sourceId: target, id: hit.id }); return { state: 'linked' as const, member: { sourceId: target, id: targetDetail.id, title: targetDetail.title, cover: targetDetail.cover } }; })()),
    link: async (a, b) => { const ka = copy(a.sourceId, a.id), kb = copy(b.sourceId, b.id), groups = new Set([table('novelTitles')[ka]?.novelKey ?? ka, table('novelTitles')[kb]?.novelKey ?? kb]); const rows = values('novelTitles').filter(r => groups.has(r.novelKey)); const key = rows.map(r => copy(r.sourceId, r.titleId)).sort()[0] ?? ka; for (const row of rows)
        write('novelTitles', copy(row.sourceId, row.titleId), { ...row, novelKey: key, linkAt: Date.now() }); return novelGroup(a.sourceId, a.id) as any; },
    unlink: async (s, id) => { const key = copy(s, id), row = table('novelTitles')[key]; if (row)
        write('novelTitles', key, { ...row, novelKey: key, linkAt: Date.now() }); return { ok: true }; },
    updates: async () => result((async () => { const updates = []; for (const item of values('novelList').slice(0, 30)) {
        const chapters = await request('novel', 'chapters', item.sourceId, item.titleId);
        const read = values('novelReading').filter(r => r.sourceId === item.sourceId && r.titleId === item.titleId);
        const furthest = Math.max(-1, ...read.map(r => r.chapterOrder));
        updates.push({ ...item, newCount: furthest < 0 ? 0 : chapters.filter((c: any) => c.order > furthest).length, latestLabel: chapters.at(-1)?.label ?? null, latestAt: chapters.at(-1)?.uploadedAt ?? null });
    } return updates; })()),
    downloads: async () => values('novelDownloads'),
    downloaded: async (s, id) => table('novelSaved')[copy(s, id)] ?? [],
    download: async (detail,chapters) => {rememberNovel(detail);return queueNovelDownloads(detail,chapters);},
    cancelDownloads: cancelNovelDownloads,
    removeDownloads: removeNovelDownloads,
    onDownload: fn => on('novel:download', fn),
    syncSnapshot: async () => ({ reading: values('novelReading'), list: values('novelList'), titles: values('novelTitles'), pending: { reading: { ...table('novelDeleted:reading') }, list: { ...table('novelDeleted:list') } } }),
        syncApply: async (change) => { let applied = 0; for (const [key, name] of [['reading', 'novelReading'], ['list', 'novelList']]) {
            for (const row of (change as any)[key]?.remove ?? [])
                write(name, `${row.sourceId}:${row.titleId}${key === 'reading' ? ':' + row.chapterId : ''}`, undefined);
            for (const row of (change as any)[key]?.upsert ?? []) {
                const id = `${row.sourceId}:${row.titleId}${key === 'reading' ? ':' + row.chapterId : ''}`;
                if ((table(name)[id]?.updatedAt ?? 0) < row.updatedAt) {
                    write(name, id, row);
                    applied++;
                }
            }
        } for (const row of change.titles) {
            write('novelTitles', copy(row.sourceId, row.titleId), row);
            applied++;
        } return { applied }; },
        syncAck: async (sent, known) => { for (const kind of ['reading', 'list'] as const) {
            for (const [key, at] of Object.entries(sent[kind]))
                if (table(`novelDeleted:${kind}`)[key] === at)
                    write(`novelDeleted:${kind}`, key, undefined);
            for (const [key, at] of Object.entries(known[kind]))
                if ((table(`novelKnownDeleted:${kind}`)[key] ?? 0) < at)
                    write(`novelKnownDeleted:${kind}`, key, at);
        } return { ok: true }; },
};
