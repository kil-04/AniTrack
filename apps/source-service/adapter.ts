import {ProviderRegistry} from '../desktop/main/services/providers/registry';
import {AnimePaheProvider, prewarm as prewarmAnimePahe, getPaheBaseUrl} from '../desktop/main/services/providers/animepahe';
import {AnikotoProvider} from '../desktop/main/services/providers/anikoto';
import {ShonenProvider} from '../desktop/main/services/providers/shonen';
import {AniChanProvider} from '../desktop/main/services/providers/anichan';
import {getResolvedStreamAuthorization} from '../desktop/main/services/providers/stream-authorization';
import {sourceById, fetchPageImage, connectMangaSource, configureMangaBallCatalogueTransport} from '../desktop/main/services/manga/sources';
import {mangaById} from '../desktop/main/services/manga/anilist-manga';
import {AssetVault, type AssetFetch} from './assets';
import {opaqueId, reject, type SourceRequest} from './protocol';
import type {SourceAdapter} from './handler';
import {NativeMediaTransport} from './native-media';
import {ANICHAN} from '../../packages/shared/anichan';
import {MANGADOT} from '../../packages/shared/manga';
import {TOONKOTSU} from '../../packages/shared/toonkotsu';
import {anikotoBaseUrl} from '../desktop/main/services/providers/anikoto-config';
import {chapterPage} from './pagination';
import {getAnikotoWindow} from '../desktop/main/services/providers/anikoto-browser';
import {aniChanPageReader} from '../desktop/main/services/providers/anichan-session';
import {VerifiedPageSession} from '../desktop/main/services/providers/verified-page-session';
import {BrowserWindow} from 'electron';
import type {SourceConnections} from './operator';
import {MangaBallImages} from './mangaball-images';
import {MangaBallCatalogue} from './mangaball-catalogue';

/** Explicit published composition; never imports the development registry. */
export class NativeSourceAdapter implements SourceAdapter {
  private aniChanConnectionUrl = ANICHAN.ORIGIN + '/';
  private aniChanPage = new VerifiedPageSession({origin: ANICHAN.ORIGIN, partition: 'persist:anichan', label: 'AniChan', world: 1216,
    allowedResourceHosts: ['anichan.to', 'challenges.cloudflare.com']});
  private registry = new ProviderRegistry([new AnimePaheProvider(), new AnikotoProvider(), new ShonenProvider(), new AniChanProvider({read: aniChanPageReader({
    readPage: (url, code) => {this.aniChanConnectionUrl = url; return this.aniChanPage.readPage(url, code);},
    requireVerification: () => this.aniChanPage.requireVerification(),
  })})]);
  private vault = new AssetVault();
  private links = new Map<string, {source: string; link: string; expires: number}>();
  private serial = new Map<string, Promise<unknown>>();
  private mangaBallImages = new MangaBallImages();
  private mangaBallCatalogue = new MangaBallCatalogue();
  private nativeMedia = new NativeMediaTransport();
  constructor(){configureMangaBallCatalogueTransport(this.mangaBallCatalogue.fetch);}
  approvedOrigins(): Set<string> {
    const origins = new Set([ANICHAN.ORIGIN, MANGADOT.ORIGIN, TOONKOTSU.ORIGIN, new URL(anikotoBaseUrl()).origin]);
    for(const origin of this.mangaBallImages.approvedOrigins())origins.add(origin);
    for(const origin of this.mangaBallCatalogue.approvedOrigins())origins.add(origin);
    for (const descriptor of this.registry.descriptors()) {
      const base = this.registry.get(descriptor.id).getBaseUrl?.();
      if (base) origins.add(new URL(base).origin);
    }
    return origins;
  }
  /** Fixed native actions available only to the separately authenticated operator. */
  operatorConnections(): SourceConnections {
    return {
      mangaball: () => this.mangaBallImages.connect(),
      'mangaball-catalogue': () => this.mangaBallCatalogue.connect(),
      mangadot: () => connectMangaSource('mangadot', null),
      toonkotsu: () => connectMangaSource('toonkotsu', null),
      animepahe: async () => {
        prewarmAnimePahe();
        for (const win of BrowserWindow.getAllWindows()) {
          if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
          try {if (new URL(win.webContents.getURL()).origin === new URL(getPaheBaseUrl()).origin) {win.show();win.focus();}}
          catch { /* A newly created source window may still be navigating. */ }
        }
      },
      anikoto: async () => {const win = await getAnikotoWindow(); if (!win.isDestroyed()) {win.show();win.focus();}},
      anichan: () => this.aniChanPage.connect(this.aniChanConnectionUrl, null),
    };
  }
  private mediaFetcher(publicReferer?: string): AssetFetch {return async (url, signal, range) => {
    const grant = getResolvedStreamAuthorization(url);
    const headers = new Headers(grant?.headers);
    if (grant?.referer) headers.set('Referer', grant.referer);
    else if (publicReferer) {headers.set('Referer', publicReferer);headers.set('Origin', new URL(publicReferer).origin);}
    if (grant?.cookie) headers.set('Cookie', grant.cookie);
    if (range) headers.set('Range', range);
    // Keep the maintained connector's browser networking, while the private
    // tunnel pins public destinations. A denial never chooses another transport.
    return this.nativeMedia.fetch(url, headers, signal);
  };}
  async call(request: SourceRequest, signal: AbortSignal): Promise<unknown> {
    const previous = this.serial.get(request.source) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      if (signal.aborted) return reject(499, 'REQUEST_CANCELLED');
      return request.kind === 'anime' ? this.anime(request) : this.manga(request);
    });
    this.serial.set(request.source, current);
    try {return await current;} finally {if (this.serial.get(request.source) === current) this.serial.delete(request.source);}
  }
  private async anime({source, method, args}: SourceRequest): Promise<unknown> {
    const provider = this.registry.get(source);
    if (method === 'search') return provider.search(args[0]);
    if (method === 'episodes') return this.registry.getEpisodes(source, args[0], args[1]);
    if (method === 'ids') return this.registry.getExternalIds(source, args[0]);
    if (method === 'find') return provider.findByExternalId?.(args[0]) ?? null;
    if (method === 'feed') {
      if (!provider.getFeed) return reject(400,'SOURCE_OPERATION_NOT_ALLOWED');
      return provider.getFeed(args[0],args[1],args[2]);
    }
    if (method === 'links') {
      for (const [key, row] of this.links) if (row.expires < Date.now()) this.links.delete(key);
      const links = await this.registry.getStreamLinks(source, args[0], args[1]);
      if (links.length > 100 || this.links.size + links.length > 2000) return reject(503, 'SERVICE_BUSY');
      return links.map(link => {
        const id = opaqueId(); this.links.set(id, {source, link: link.id, expires: Date.now() + 10 * 60000});
        return {...link, id};
      });
    }
    if (method === 'resolve') {
      const receipt = this.links.get(args[0]);
      if (!receipt || receipt.source !== source || receipt.expires < Date.now()) return reject(410, 'SERVER_LIST_EXPIRED');
      const stream = await this.registry.resolveStream(source, receipt.link);
      const fetcher = this.mediaFetcher(stream.referer);
      return {
        url: this.vault.register(stream.url, stream.hls || /\.m3u8(?:\?|$)/i.test(stream.url) ? 'playlist' : 'media', fetcher),
        hls: stream.hls ?? /\.m3u8(?:\?|$)/i.test(stream.url),
        conservativeNetwork: stream.conservativeNetwork,
        intro: stream.intro, outro: stream.outro,
        subtitles: (stream.subtitles ?? []).map(sub => ({file: this.vault.register(sub.file, 'subtitle', fetcher), label: sub.label, kind: sub.kind, default: sub.default})),
      };
    }
    return reject(400, 'SOURCE_OPERATION_NOT_ALLOWED');
  }
  private async manga({source, method, args}: SourceRequest): Promise<unknown> {
    const connector = sourceById(source);
    if (method === 'find') {const manga = await mangaById(args[0]); return manga ? connector.find(manga) : null;}
    const title = args[0];
    if (method === 'latest') return connector.latest(title);
    if (method === 'chapters-page') {
      // The native connector owns pagination, source limits and reading order.
      return chapterPage(await connector.chapters(title),args[1]);
    }
    if (method === 'pages') {
      const pages = await connector.pageImages(title, args[1]);
      if (!pages.length || pages.length > 1000) return reject(502, 'INVALID_PAGE_LIST');
      if(source==='mangaball')await this.mangaBallImages.registerImages(pages);
      const fetcher: AssetFetch = async (raw, signal, range) => {
        if (range) return reject(416, 'INVALID_RANGE');
        let url: URL; try {url = new URL(raw);} catch {return reject(502, 'INVALID_PAGE_IMAGE');}
        if(source==='mangaball'&&this.mangaBallImages.accessMode(raw)!=='public')return this.mangaBallImages.fetch(raw,signal);
        const pending = fetchPageImage(source, url, signal);
        if (!pending) return reject(403, 'INVALID_PAGE_IMAGE');
        const response=await pending;
        if(source==='mangaball'&&(response.status===403||response.status===429||response.headers.get('cf-mitigated')?.toLowerCase()==='challenge')){
          await response.body?.cancel();
          return this.mangaBallImages.stop(raw,response.status===429?429:403);
        }
        return response;
      };
      return pages.map(page => ({url: this.vault.register(page.url, 'image', fetcher), width: page.width, height: page.height}));
    }
    return reject(400, 'SOURCE_OPERATION_NOT_ALLOWED');
  }
  asset(id: string, request: Request) {return this.vault.respond(id, request);}
  close(){this.mangaBallImages.close();this.mangaBallCatalogue.close();void this.nativeMedia.close().catch(()=>{});}
}
