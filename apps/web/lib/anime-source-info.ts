import type {ProviderDescriptor} from '../source/packages/shared/provider-types';
import {standaloneSourceReady} from './source-connections';

export type SourceWebState = {state:'available'|'limited'|'native-required';downloads:boolean;description:string;website:string};
export type BrowserProviderDescriptor = ProviderDescriptor & {web:SourceWebState};
export const BROWSER_ANIME_SOURCES: BrowserProviderDescriptor[] = [
  {id:'shonen',name:'shonen.to',capabilities:{externalIds:true,downloads:true,prefetch:false,streamVariants:'server',episodePageSize:100},web:{state:'available',downloads:true,description:'Streaming, subtitles and offline episode downloads are supported.',website:'https://shonen.to'}},
  {id:'anikoto',name:'Anikoto',capabilities:{externalIds:true,downloads:true,prefetch:false,streamVariants:'subtitle-type',episodePageSize:10000},web:{state:'available',downloads:true,description:'Streaming with subtitle choices, captions and offline episode downloads are supported through the hosted media connection.',website:'https://anikototv.to'}},
  {id:'anichan',name:'AniChan',capabilities:{externalIds:true,downloads:false,prefetch:false,streamVariants:'server',episodePageSize:100},web:{state:'native-required',downloads:false,description:'Playback and new downloads need a verified website connection. This connection is not available yet; choose another source for now.',website:'https://anichan.to'}},
  {id:'animepahe',name:'AnimePahe',capabilities:{downloads:false,prefetch:false,configurableBaseUrl:true,streamVariants:'quality'},web:{state:'native-required',downloads:false,description:'Playback and new downloads need a verified website connection. This connection is not available yet; choose another source for now.',website:'https://animepahe.pw'}},
];
export const browserAnimeSource = (id: string): BrowserProviderDescriptor | undefined => {
  const source = BROWSER_ANIME_SOURCES.find(source=>source.id===id);
  return source && standaloneSourceReady(id) ? {...source,capabilities:{...source.capabilities,downloads:true},web:{...source.web,state:'available',downloads:true,description:'Streaming, subtitles and offline episode downloads use the website’s standalone source connection.'}} : source;
};
export const browserAnimeSources = () => BROWSER_ANIME_SOURCES.map(source => browserAnimeSource(source.id)!);
