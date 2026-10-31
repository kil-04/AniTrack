import * as manga from '../source/packages/shared/manga';
import * as novel from '../source/packages/shared/novel';
import * as shonen from '../source/packages/shared/shonen';
import { archiveSearchUrl, parseArchiveSearch, parseArchiveTracks, validArchiveId } from '../source/packages/shared/city-pop-archive';
import { parseCityPopSearch } from '../source/packages/shared/city-pop';
import { ANISONGS, parseAniSongs, searchBody, isSeasonQuery } from '../source/packages/shared/anisongs';
import { env } from '../server/runtime';
import { protectMalProgress,protectAniListProgress } from './account-progress';
import { shonenLinks, shonenLinkToken, shonenStreamFor } from './shonen-links';
import * as xcomic from '../source/packages/shared/xcomic';
import { normalizeNovelHome } from './novel-home';
import { publicAccountConfig, malClientSecret } from './account-config';
import {mediaRequestHeaders} from './source-request';
import {sourceText,boundedText} from './source-http';
export {sourceText} from './source-http';
import {animeOperation} from './anime-sources';
import { browserMangaSource } from './manga-source-info';
import {standaloneSources,standaloneCall,standaloneAsset} from './standalone-service';
import {signMediaReceipt,readMediaReceipt} from './media-receipts';
import {safeMedia} from '../server/media';
import {serverFetch as fetch} from '../server/network';
import {publicCatalogue} from '../server/catalogue';
const json = async (url: string, init: RequestInit = {}) => JSON.parse(await sourceText(url, init));
const textArg = (x: unknown, max = 200) => { if (typeof x !== 'string' || x.length > max || /[\x00-\x1f]/.test(x))
    throw new Error('Invalid selection.'); return x; };
const numberArg = (x: unknown, max = 2147483647) => { if (typeof x !== 'number' || !Number.isSafeInteger(x) || x < 1 || x > max)
    throw new Error('Invalid selection.'); return x; };
async function novelOperation(method: string, args: any[]): Promise<any> {
    const [sourceId, id, chapterId] = args;
    if (method === 'sources')
        return novel.NOVEL_SOURCES;
    if (method === 'home') {
        try {
            const home = novel.novelBuddyHome(await json(novel.novelBuddyHomeUrl()));
            const human = (filters: Parameters<typeof novel.novelBuddySearchUrl>[0], limit: number) => json(novel.novelBuddySearchUrl(filters, limit)).then(novel.novelBuddySearch).then(page => page.items.filter(card => !card.mtl)).catch(() => []);
            const [latest, completed, favourites] = await Promise.all([human({sort: 'latest'}, 60), human({sort: 'popular', status: 'completed'}, 30), human({sort: 'favourites'}, 30)]);
            return normalizeNovelHome({...home, latest: latest.length ? latest : home.latest, completed, favourites});
        }
        catch (error) {
            const lists: any = {};
            for (const [key, config] of Object.entries(novel.NOVELARCHIVE_HOME_LISTS))
                lists[key] = await json(novel.novelArchiveSearchUrl(config.filters, config.limit)).then(novel.novelArchiveSearch).then(page => page.items).catch(() => []);
            const result = novel.novelArchiveHome(lists);
            if (!result)
                throw error;
            return result;
        }
    }
    if (method === 'search') {
        const filters = sourceId;
        if (!filters || !novel.isNovelSource(filters.sourceId))
            throw new Error('Choose a novel source.');
        return filters.sourceId === 'novelbuddy' ? novel.novelBuddySearch(await json(novel.novelBuddySearchUrl(filters))) : novel.novelArchiveSearch(await json(novel.novelArchiveSearchUrl(filters)));
    }
    if (!novel.isNovelSource(sourceId) || !novel.isNovelTitleId(sourceId, id))
        throw new Error('Invalid novel.');
    const buddy = sourceId === 'novelbuddy';
    if (method === 'title')
        return buddy ? novel.novelBuddyDetail(await json(novel.novelBuddyTitleUrl(id))) : novel.novelArchiveDetail(await json(novel.novelArchiveTitleUrl(id)));
    if (method === 'chapters')
        return buddy ? novel.novelBuddyChapters(await json(novel.novelBuddyChaptersUrl(id))) : novel.novelArchiveChapters(await json(novel.novelArchiveTitleUrl(id)));
    if (method === 'chapter') {
        if (!novel.isNovelChapterId(sourceId, chapterId))
            throw new Error('Invalid chapter.');
        const chapter = buddy ? novel.novelBuddyChapterText(await json(novel.novelBuddyChapterUrl(id, chapterId))) : novel.novelArchiveChapterText(await json(novel.novelArchiveChapterUrl(id, chapterId)), chapterId);
        if (!chapter.paragraphs.length)
            throw new Error('This chapter came back empty from its source.');
        return chapter;
    }
    throw new Error('Unknown novel operation.');
}
async function mangaPages(chapterId: string) {
    if (!manga.isMangaBallId(chapterId))
        throw new Error('Invalid MangaBall chapter.');
    return manga.mangaBallPages(await json(`${manga.MANGABALL.API}/chapter-detail?chapter_id=${chapterId}&user_id=demo_user`));
}
async function mangaPageUrls(sourceId: string, chapterId: string) {
    if (sourceId === 'mangaball') return mangaPages(chapterId);
    if (sourceId === 'mangadot') {
        const path = manga.mangaDotImagesPath(chapterId);
        if (!path) throw new Error('Invalid MangaDot chapter.');
        const pages = manga.mangaDotPages(await json(`${manga.MANGADOT.ORIGIN}${path}`));
        if (!pages.length) throw new Error('MangaDot has no pages for this chapter.');
        return pages.map(page => page.url);
    }
    if (sourceId === 'toonkotsu') throw new Error(browserMangaSource(sourceId)!.web.description);
    if (sourceId !== 'xcomic' || !xcomic.isXComicId(chapterId)) throw new Error('Invalid manga source or chapter.');
    const pages = xcomic.xcomicPages(await sourceText(xcomic.xcomicChapterUrl(chapterId), {}, 6 * 1024 * 1024));
    if (!pages.length) throw new Error('XComic has no pages for this chapter.');
    return pages;
}
async function mangaOperation(method: string, args: any[]): Promise<any> {
    if (method === 'find') {
        const meta = args[0];
        const sourceId = args[1] ?? 'mangaball';
        if (!meta || !Number.isSafeInteger(meta.id))
            throw new Error('Choose a manga.');
        if (sourceId === 'toonkotsu') throw new Error(browserMangaSource(sourceId)!.web.description);
        if (sourceId === 'mangadot') {
            const checked = new Set<number>();
            for (const name of [...new Set([meta.title, meta.titleRomaji].filter(Boolean))].slice(0, 2)) {
                const ids = manga.mangaDotSuggestions(await json(`${manga.MANGADOT.ORIGIN}/api/search/suggestions?q=${encodeURIComponent(textArg(name))}&limit=8`));
                for (const id of ids) {
                    if (checked.has(id)) continue;
                    checked.add(id);
                    const detail = manga.mangaDotDetail(await json(`${manga.MANGADOT.ORIGIN}/api/manga/${id}`));
                    if (detail && manga.sourceMatches(detail, meta)) return {sourceId: 'mangadot', id: detail.id, title: detail.title};
                }
            }
            return null;
        }
        if (sourceId === 'xcomic') {
            const checked = new Set<string>();
            for (const name of [...new Set([meta.title, meta.titleRomaji].filter(Boolean))].slice(0, 2)) {
                const hits = xcomic.xcomicSearchIds(await sourceText(xcomic.xcomicSearchUrl(textArg(name)), {}, 6 * 1024 * 1024));
                for (const id of hits) {
                    if (checked.has(id)) continue;
                    checked.add(id);
                    const detail = xcomic.xcomicDetail(await sourceText(xcomic.xcomicTitleUrl(id), {}, 6 * 1024 * 1024), id);
                    if (detail && manga.sourceMatches(detail, meta)) return {sourceId: 'xcomic', id: detail.id, title: detail.title};
                }
            }
            return null;
        }
        if (sourceId !== 'mangaball') throw new Error('This manga source is unavailable in the browser.');
        for (const name of [...new Set([meta.title, meta.titleRomaji, ...(meta.synonyms ?? [])].filter(Boolean))].slice(0, 3)) {
            const hits = manga.mangaBallSearch(await json(`${manga.MANGABALL.API}/title/search-advanced?keyword=${encodeURIComponent(textArg(name))}&page=1&limit=10&adult_mode=no_18`)).filter(hit => !hit.adult).slice(0, 5);
            for (const hit of hits) {
                const detail = manga.mangaBallDetail(await json(`${manga.MANGABALL.API}/title/detail/${hit.id}`));
                if (detail && manga.sourceMatches(detail, meta))
                    return { sourceId: 'mangaball', id: hit.id, title: detail.title };
            }
        }
        return null;
    }
    const title = args[0];
    if (title?.sourceId === 'toonkotsu') throw new Error(browserMangaSource('toonkotsu')!.web.description);
    if (title?.sourceId === 'mangadot') {
        if (!/^[1-9][0-9]{0,11}$/.test(title.id)) throw new Error('Invalid MangaDot title.');
        if (method === 'chapters-page') {
            numberArg(args[1], 1);
            const chapters = manga.mangaDotChapters(JSON.parse(await sourceText(`${manga.MANGADOT.ORIGIN}/api/manga/${title.id}/chapters/list`, {}, 16 * 1024 * 1024)));
            return {chapters, totalPages: 1};
        }
        if (method === 'pages') return (await mangaPageUrls('mangadot', textArg(args[1], 80))).map((_, index) => ({url: `/api/page?s=mangadot&chapter=${encodeURIComponent(args[1])}&page=${index}`, width: null, height: null}));
        if (method === 'latest') {
            const detail = manga.mangaDotDetail(await json(`${manga.MANGADOT.ORIGIN}/api/manga/${title.id}`));
            return detail && (detail.latestChapter != null || detail.latestAt != null) ? {chapter: detail.latestChapter, at: detail.latestAt} : null;
        }
        throw new Error('Unknown manga operation.');
    }
    if (title?.sourceId === 'xcomic') {
        const ref = xcomic.parseXComicTitleRef(title.id);
        if (!ref) throw new Error('Invalid XComic title.');
        if (method === 'chapters-page') {
            const page = numberArg(args[1], xcomic.XCOMIC_MAX_LIST_PAGES);
            const listing = xcomic.xcomicChapters(await sourceText(xcomic.xcomicEditionUrl(ref.editionId, page), {}, 6 * 1024 * 1024));
            return {chapters: listing.chapters, totalPages: listing.lastPage};
        }
        if (method === 'pages') return (await mangaPageUrls('xcomic', textArg(args[1], 80))).map((_, index) => ({url: `/api/page?s=xcomic&chapter=${encodeURIComponent(args[1])}&page=${index}`, width: null, height: null}));
        if (method === 'latest') return xcomic.xcomicLatest(await sourceText(xcomic.xcomicEditionUrl(ref.editionId), {}, 6 * 1024 * 1024));
        throw new Error('Unknown manga operation.');
    }
    if (!title || title.sourceId !== 'mangaball' || !manga.isMangaBallId(title.id))
        throw new Error('This source needs an app-managed website session. MangaBall is available in this browser version.');
    if (method === 'chapters-page') { const page=numberArg(args[1],manga.MANGABALL_MAX_LIST_PAGES); return manga.mangaBallChapters(await json(manga.mangaBallListingUrl(title.id,page))); }
    if (method === 'pages')
        return (await mangaPages(textArg(args[1], 80))).map((_, i) => ({ url: `/api/page?chapter=${encodeURIComponent(args[1])}&page=${i}`, width: null, height: null }));
    if (method === 'latest')
        return manga.mangaBallLatest(await json(`${manga.MANGABALL.API}/title/chapter-listing?title_id=${title.id}&page=1&limit=10&group_by=flat&sort_order=desc&language=en&search=`));
    throw new Error('Unknown manga operation.');
}
const shonenStreamLists = new Map<string, {at: number; streams: shonen.ShonenStream[]}>();
async function shonenStreams(id: number, episode: number, language: shonen.ShonenLanguage, fresh = false) {
    const key = `${id}:${episode}:${language}`, now = Date.now(), cached = shonenStreamLists.get(key);
    if (!fresh && cached && now - cached.at < 60000 && cached.streams.every(item => item.expiresAt === null || item.expiresAt - now > 60000)) return cached.streams;
    const streams = shonen.parseShonenStreams(await json(shonen.shonenSourcesUrl(id, episode, language), {cache: 'no-store'}));
    if (shonenStreamLists.size >= 50) shonenStreamLists.delete(shonenStreamLists.keys().next().value!);
    shonenStreamLists.set(key, {at: now, streams});
    return streams;
}
async function shonenOperation(method: string, args: any[]): Promise<any> {
    if (method === 'search')
        return shonen.parseShonenSearch(await sourceText(shonen.shonenSearchUrl(textArg(args[0])))).map(hit => ({ id: String(hit.anilistId), providerId: 'shonen', title: hit.title, poster: hit.poster ?? '', episodes: hit.episodes, externalLookupId: hit.anilistId }));
    if (method === 'find') {
        const id = numberArg(Number(args[0]));
        const title = await sourceText(shonen.shonenAnimeUrl(id)).then(shonen.parseShonenTitlePage).catch(() => null);
        return title?.title && title.episodes ? {id: String(id), providerId: 'shonen', title: title.title, poster: '', episodes: title.episodes, externalLookupId: id} : null;
    }
    if (method === 'episodes') {
        const id = numberArg(Number(args[0]));
        const page = numberArg(Number(args[1] ?? 1), 50);
        const title = shonen.parseShonenTitlePage(await sourceText(shonen.shonenAnimeUrl(id)));
        if (!title.episodes)
            throw new Error('No episodes are available from this source.');
        return { data: Array.from({ length: Math.max(0, Math.min(100, title.episodes - (page - 1) * 100)) }, (_, i) => ({ id: `ep:${(page - 1) * 100 + i + 1}`, episodeNumber: (page - 1) * 100 + i + 1, title: `Episode ${(page - 1) * 100 + i + 1}` })), total: title.episodes, lastPage: Math.ceil(title.episodes / 100) };
    }
    if (method === 'links') {
        const id = numberArg(Number(args[1]));
        const ep = numberArg(Number(String(args[0]).replace('ep:', '')), 5000);
        return shonenLinks(id, ep, language => shonenStreams(id, ep, language, true));
    }
    if (method === 'resolve') {
        const token = shonenLinkToken(textArg(args[0], 200));
        const stream = shonenStreamFor(token, await shonenStreams(token.a, token.n, token.l));
        return { url: stream.url, subtitles: stream.subtitles, intro: stream.intro, outro: stream.outro, hls: true, conservativeNetwork: true, referer: 'https://shonen.to/' };
    }
    throw new Error('Unknown stream operation.');
}
export async function rpc(operation: string, args: any[]): Promise<any> {
    const connected=standaloneSources(env as any);
    if(operation==='source.status')return {sources:connected};
    if(operation==='anime'&&args[0]!=='top'&&connected.includes(args[1]))return standaloneCall(env as any,{kind:'anime',source:args[1],method:args[0],args:args.slice(2)},signedStandaloneAsset);
    if(operation==='shonen'&&connected.includes('shonen'))return standaloneCall(env as any,{kind:'anime',source:'shonen',method:args[0],args:args.slice(1)},signedStandaloneAsset);
    if(operation==='manga'){
        const source=args[0]==='find'?args[2]:args[1]?.sourceId;
        if(connected.includes(source))return standaloneCall(env as any,{kind:'manga',source,method:args[0],args:args[0]==='find'?[args[1]?.id]:args.slice(1)},signedStandaloneAsset);
    }
    if (operation === 'anime') {
        const result = await animeOperation(String(args[0]),args.slice(1),sourceText);
        if (args[0] !== 'resolve') return result;
        const headers = mediaRequestHeaders({...result.requestHeaders,...(result.referer ? {Referer:result.referer,Origin:new URL(result.referer).origin} : {})});
        return {...result,url:await signedMediaUrl(result.url,result.hls ?? /\.m3u8(?:\?|$)/i.test(result.url),headers),subtitles:await Promise.all((result.subtitles??[]).map(async (sub:any)=>({...sub,file:await signedMediaUrl(sub.file,false,headers)}))),requestHeaders:undefined,cookies:undefined};
    }
    if (operation === 'accounts.config') return publicAccountConfig(env as any);
    if (operation === 'al.action') {
        const token = textArg(args[0], 4096), action = args[1], value = args[2];
        let query: string, variables: any = {};
        if (action === 'viewer')
            query = '{Viewer{id name}}';
        else if (action === 'list') {
            variables = { id: numberArg(value) };
            query = 'query($id:Int){MediaListCollection(userId:$id,type:ANIME){lists{entries{status progress score(format:POINT_10) updatedAt media{id idMal isAdult title{romaji english}coverImage{large}bannerImage episodes status format popularity seasonYear averageScore genres description(asHtml:false)}}}}}';
        }
        else if (action === 'save') {
            if (!['CURRENT', 'COMPLETED', 'PAUSED', 'DROPPED', 'PLANNING'].includes(value?.status))
                throw new Error('Invalid list status.');
            variables = { id: numberArg(value.id), status: value.status, progress: Math.min(20000, Math.max(0, Number(value.progress) || 0)), score: Math.min(10, Math.max(0, Number(value.score) || 0)) };
            const current = await json('https://graphql.anilist.co', { method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({query:'query($id:Int){Media(id:$id){mediaListEntry{status progress}}}',variables:{id:variables.id}}) });
            if(current.errors?.length)throw new Error(current.errors[0].message);
            variables=protectAniListProgress(variables,current.data?.Media?.mediaListEntry??null);
            query = 'mutation($id:Int,$status:MediaListStatus,$progress:Int,$score:Float){SaveMediaListEntry(mediaId:$id,status:$status,progress:$progress,score:$score){id}}';
        }
        else
            throw new Error('Unknown AniList account operation.');
        const data = await json('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ query, variables }) });
        if (data.errors?.length)
            throw new Error(data.errors[0].message);
        return data.data;
    }
    if (operation === 'mal.token') {
        const p = args[0];
        if (!p || !/^[a-zA-Z0-9]{10,80}$/.test(p.clientId) || !['authorization_code', 'refresh_token'].includes(p.grant_type))
            throw new Error('Invalid MyAnimeList sign-in request.');
        const fields = new URLSearchParams({ client_id: p.clientId, grant_type: p.grant_type });
        for (const key of p.grant_type === 'authorization_code' ? ['code', 'code_verifier', 'redirect_uri'] : ['refresh_token'])
            fields.set(key, textArg(p[key], 4096));
        const secret = malClientSecret(env as any, p.clientId);
        if (secret)
            fields.set('client_secret', secret);
        return json('https://myanimelist.net/v1/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: fields.toString() });
    }
    if (operation === 'mal.viewer')
        return json('https://api.myanimelist.net/v2/users/@me', { method: 'GET', headers: { Authorization: `Bearer ${textArg(args[0], 4096)}` } });
    if (operation === 'mal.list') {
        const token = textArg(args[0], 4096), all: any[] = [];
        for (let offset = 0; offset < 10000; offset += 100) {
            const page = await json(`https://api.myanimelist.net/v2/users/@me/animelist?limit=100&offset=${offset}&fields=list_status`, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
            all.push(...page.data);
            if (!page.paging?.next)
                break;
        }
        return all;
    }
    if (operation === 'mal.save') {
        const token = textArg(args[0], 4096), id = numberArg(args[1]), v = args[2];
        if (!['watching', 'completed', 'on_hold', 'dropped', 'plan_to_watch'].includes(v?.status))
            throw new Error('Invalid list status.');
        const current=await json(`https://api.myanimelist.net/v2/anime/${id}?fields=my_list_status`,{method:'GET',headers:{Authorization:`Bearer ${token}`}});
        const watched=protectMalProgress({status:v.status,episodesWatched:Math.max(0,Math.min(20000,Number(v.num_watched_episodes)||0))},current.my_list_status??null);
        const fields = new URLSearchParams({ status: watched.status, num_watched_episodes: String(watched.episodesWatched), score: String(Math.max(0, Math.min(10, Number(v.score) || 0))) });
        return json(`https://api.myanimelist.net/v2/anime/${id}/my_list_status`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: fields.toString() });
    }
    if (operation === 'catalogue') {
        const [query, variables] = args;
        if (typeof query !== 'string' || query.length > 20000 || /\bmutation\b/i.test(query))
            throw new Error('Only catalogue queries are available here.');
        return publicCatalogue(query,variables,()=>json('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) }));
    }
    if (operation === 'novel')
        return novelOperation(textArg(args[0], 30), args.slice(1));
    if (operation === 'manga')
        return mangaOperation(textArg(args[0], 30), args.slice(1));
    if (operation === 'shonen') {
        const method = textArg(args[0], 30), data = await shonenOperation(method, args.slice(1));
        if (method === 'resolve') {
            data.url = await signedMediaUrl(data.url, true);
            data.subtitles = await Promise.all((data.subtitles ?? []).map(async (s: any) => ({ ...s, file: await signedMediaUrl(s.file) })));
            delete data.referer;
        }
        return data;
    }
    if (operation === 'archive.search')
        return parseArchiveSearch(await json(archiveSearchUrl(textArg(args[0]), args[1] ?? 1, args[2] ?? 'all')), args[1] ?? 1, args[2] ?? 'all');
    if (operation === 'archive.item') {
        if (!validArchiveId(args[0]))
            throw new Error('Invalid album.');
        return parseArchiveTracks(args[0], await json(`https://archive.org/metadata/${args[0]}`));
    }
    if (operation === 'youtube.search')
        return parseCityPopSearch(await sourceText(`https://www.youtube.com/results?search_query=${encodeURIComponent(textArg(args[0]))}`));
    if (operation === 'songs') {
        const [method, ...params] = args;
        let path: string, body: any;
        if (method === 'search') {
            path = 'search_request';
            body = searchBody(textArg(params[0]), params[1]);
        }
        else if (method === 'season') {
            if (!isSeasonQuery(params[0], params[1]))
                throw new Error('Choose a season.');
            path = 'season_request';
            body = { season: `${params[0]} ${params[1]}` };
        }
        else if (method === 'show') {
            path = 'mal_ids_request';
            body = { mal_ids: [numberArg(params[0])] };
        }
        else
            throw new Error('Unknown music operation.');
        return parseAniSongs(await json(`${ANISONGS.API}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    }
    if (operation === 'themes')
        return json(`https://api.animethemes.moe/anime?filter[has]=resources&filter[site]=AniList&filter[external_id]=${args[0].map((id: number) => numberArg(id)).slice(0, 12).join(',')}&include=animethemes.animethemeentries.videos,animethemes.song,resources`);
    throw new Error('This action is not available in AniTrack Web.');
}
async function signedStandaloneAsset(path:string,expires=Date.now()+2*3600000){
    if(!/^\/v1\/assets\/[A-Za-z0-9_-]{32}$/.test(path))throw new Error('Invalid source media access.');
    return signMediaReceipt((env as any).ANITRACK_MEDIA_SECRET,{sourceAsset:path,expires});
}
async function signedMediaUrl(url: string, hls = false, hints: Record<string,string> = {Referer:'https://shonen.to/'}, expires = Date.now() + 6 * 3600000) { if (!manga.publicHttps(url))
    throw new Error('The source returned an invalid media address.'); return signMediaReceipt((env as any).ANITRACK_MEDIA_SECRET,{url,hls,headers:mediaRequestHeaders(hints),expires}); }
export async function mediaResponse(request: Request): Promise<Response> {
    const token = new URL(request.url).searchParams.get('t');
    const info=await readMediaReceipt((env as any).ANITRACK_MEDIA_SECRET,token);
    if(info.sourceAsset)return standaloneAsset(env as any,info.sourceAsset,request,path=>signedStandaloneAsset(path,info.expires));
    if (!info.url || !manga.publicHttps(info.url))
        throw new Error('This stream access expired. Select the episode again.');
    let url = info.url;
    let response: Response | undefined;
    for (let hop = 0; hop < 4; hop++) {
        if (!manga.publicHttps(url))
            throw new Error('Invalid media redirect.');
        const headers = mediaRequestHeaders(info.headers ?? {Referer:'https://shonen.to/'});
        const range = request.headers.get('range');
        if (range && /^bytes=\d+-\d*$/.test(range))
            headers.Range = range;
        response = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(30000) });
        if (response.status >= 300 && response.status < 400) {
            const next = response.headers.get('location');
            await response.body?.cancel();
            if (!next)
                throw new Error('Invalid media redirect.');
            url = new URL(next, url).href;
            continue;
        }
        break;
    }
    if (!response?.ok)
        throw new Error(`This media server answered ${response?.status ?? 'with an error'}. Retry manually or choose another server.`);
    const type = response.headers.get('content-type') ?? '';
    if (info.hls || /mpegurl/i.test(type) || /(?:\.|\/)m3u8(?:\?|$)/i.test(url)) {
        const text = await boundedText(response, 2 * 1024 * 1024);
        if (!text.trimStart().startsWith('#EXTM3U'))
            throw new Error('The source returned an invalid playlist.');
        const master = text.includes('#EXT-X-STREAM-INF:');
        const lines = [];
        for (const line of text.split(/\r?\n/)) {
            if (line.trim() && !line.startsWith('#'))
                lines.push(await signedMediaUrl(new URL(line.trim(), url).href, master, info.headers, info.expires));
            else if (/URI="[^"]+"/.test(line)) {
                let rewritten = line;
                for (const match of line.matchAll(/URI="([^"]+)"/g))
                    rewritten = rewritten.replace(match[0], `URI="${await signedMediaUrl(new URL(match[1], url).href, line.startsWith('#EXT-X-MEDIA') || line.startsWith('#EXT-X-I-FRAME'), info.headers, info.expires)}"`);
                lines.push(rewritten);
            }
            else
                lines.push(line);
        }
        return new Response(lines.join('\n'), { headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'private, max-age=15' } });
    }
    const headers = new Headers({ 'Content-Type': type || 'application/octet-stream', 'Cache-Control': 'private, max-age=600', 'X-Content-Type-Options': 'nosniff' });
    for (const name of ['content-length', 'content-range', 'accept-ranges']) {
        const value = response.headers.get(name);
        if (value)
            headers.set(name, value);
    }
    return safeMedia(new Response(response.body, { status: response.status, headers }),request);
}
export async function pageImage(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const sourceId = params.get('s') ?? 'mangaball';
    const label = browserMangaSource(sourceId)?.label ?? 'Manga';
    const urls = await mangaPageUrls(sourceId, textArg(params.get('chapter'), 80));
    const index = Number(params.get('page'));
    if (!Number.isSafeInteger(index) || index < 0 || index >= urls.length)
        throw new Error('Invalid page.');
    let url = manga.publicHttps(urls[index]);
    if (!url)
        throw new Error('The source returned an invalid image.');
    if (sourceId === 'xcomic' && !xcomic.isXComicImage(url)) throw new Error('XComic returned an invalid image address.');
    if (sourceId === 'mangadot' && !manga.isMangaDotPage(url)) throw new Error('MangaDot returned an invalid image address.');
    let response: Response | undefined;
    for (let hop = 0; hop < 4; hop++) {
        response = await fetch(url, { redirect: 'manual', headers: sourceId === 'xcomic' ? {'User-Agent': 'AniTrack/9.2.2 (Web)'} : { Referer: sourceId === 'mangadot' ? 'https://mangadot.net/' : 'https://mangaball.com/', 'User-Agent': 'AniTrack/9.2.2 (Web)' }, signal: AbortSignal.timeout(25000) });
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location');
            await response.body?.cancel();
            url = location ? manga.publicHttps(new URL(location, url).href) : null;
            if (!url) throw new Error('The source returned an invalid image redirect.');
            if (sourceId === 'xcomic' && !xcomic.isXComicImage(url)) throw new Error('XComic redirected to an unexpected image host.');
            if (sourceId === 'mangadot' && !manga.isMangaDotPage(url)) throw new Error('MangaDot redirected to an unexpected image host.');
            continue;
        }
        break;
    }
    if (!response?.ok || !/^image\/(?:jpeg|png|webp|avif|gif|bmp)(?:\s*;|$)/i.test(response.headers.get('content-type')??'')) {
        await response?.body?.cancel();
        if (response?.status === 403 || response?.status === 503) throw new Error(`${label}'s image host (${url.hostname}) requires a browser verification session. Choose another source or use the installed app.`);
        throw new Error(`${label}'s image host could not deliver this page${response ? ` (HTTP ${response.status})` : ''}. Try another source or retry later.`);
    }
    return new Response(response.body, { headers: { 'Content-Type': response.headers.get('content-type')!, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
}
export async function archiveMedia(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const tracks = await rpc('archive.item', [params.get('item')]);
    const track = tracks.find((t: any) => t.fileName === params.get('file'));
    if (!track)
        throw new Error('This album no longer has that file.');
    let url = track.url;
    let response: Response | undefined;
    for (let hop = 0; hop < 4; hop++) {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' || !(parsed.hostname === 'archive.org' || parsed.hostname.endsWith('.archive.org')) || parsed.username || parsed.password)
            throw new Error('Invalid Archive media destination.');
        response = await fetch(url, { redirect: 'manual', headers: request.headers.has('range') ? { Range: request.headers.get('range')! } : {}, signal: AbortSignal.timeout(30000) });
        if (response.status >= 300 && response.status < 400) {
            const next = response.headers.get('location');
            await response.body?.cancel();
            if (!next)
                throw new Error('Archive returned an invalid redirect.');
            url = new URL(next, url).href;
            continue;
        }
        break;
    }
    if (!response?.ok)
        throw new Error('Internet Archive could not deliver this file.');
    const headers = new Headers();
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        const value = response.headers.get(name);
        if (value)
            headers.set(name, value);
    }
    headers.set('Cache-Control', 'private, max-age=3600');
    headers.set('X-Content-Type-Options', 'nosniff');
    return safeMedia(new Response(response.body, { status: response.status, headers }),request);
}
