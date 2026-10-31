import type {MangaSourceInfo} from '../source/packages/shared/manga';
import {standaloneSourceReady} from './source-connections';

export interface BrowserMangaSourceInfo extends MangaSourceInfo {
  web: {
    state: 'available' | 'limited' | 'native-required';
    downloads: boolean;
    description: string;
    website: string;
  };
}

/** Current maintained app registry. Availability describes this website's transport. */
export const BROWSER_MANGA_SOURCES: BrowserMangaSourceInfo[] = [
  {id: 'xcomic', label: 'XComic', needsConnect: false, web: {state: 'available', downloads: true,
    description: 'Online reading and ordered chapter downloads are supported by the website.', website: 'https://xcomic.me'}},
  {id: 'mangaball', label: 'MangaBall', needsConnect: false, web: {state: 'limited', downloads: false,
    description: 'Its catalogue is available, but its image service is blocking pages and new downloads. Previously saved chapters still open offline.', website: 'https://mangaball.com'}},
  {id: 'mangadot', label: 'MangaDot', needsConnect: true, web: {state: 'native-required', downloads: false,
    description: 'Reading and new chapter downloads need a verified website connection. This connection is not available yet; choose another source for now.', website: 'https://mangadot.net'}},
  {id: 'toonkotsu', label: 'Toonkotsu', needsConnect: true, web: {state: 'native-required', downloads: false,
    description: 'Reading and new chapter downloads need a verified website connection. This connection is not available yet; choose another source for now.', website: 'https://toonkotsu.com'}},
];

export const browserMangaSource = (id: string): BrowserMangaSourceInfo | undefined => {
  const source = BROWSER_MANGA_SOURCES.find(source => source.id === id);
  return source && standaloneSourceReady(id) ? {...source,needsConnect:false,web:{...source.web,state:'available',downloads:true,description:'Online reading and ordered offline chapter downloads use the website’s standalone source connection.'}} : source;
};
export const browserMangaSources = () => BROWSER_MANGA_SOURCES.map(source => browserMangaSource(source.id)!);
