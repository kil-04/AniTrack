import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

const image='https://bulbasaur.poke-black-and-white.net/chapter/page.png';
const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};
function fixture(status){
  const state={mode:'public',publicReads:0,verifiedReads:0,connections:0,closed:0,registered:[],assets:[]};
  class Provider {}
  class Images {
    async registerImages(pages){state.registered.push(...pages);}
    approvedOrigins(){return new Set(state.registered.length?['https://bulbasaur.poke-black-and-white.net']:[]);}
    accessMode(){return state.mode;}
    stop(_raw,code){state.mode='blocked';state.status=code;return fail(code,code===429?'SOURCE_RATE_LIMITED':'SOURCE_VERIFICATION_REQUIRED');}
    async fetch(){state.verifiedReads++;if(state.mode==='blocked')return fail(state.status,'SOURCE_VERIFICATION_REQUIRED');return new Response('fixture-image',{headers:{'Content-Type':'image/png'}});}
    async connect(){state.connections++;state.mode='verified';}
    close(){state.closed++;}
  }
  const modules={
    '../desktop/main/services/providers/registry':{ProviderRegistry:class{descriptors(){return [];}}},
    '../desktop/main/services/providers/animepahe':{AnimePaheProvider:Provider},
    '../desktop/main/services/providers/anikoto':{AnikotoProvider:Provider},
    '../desktop/main/services/providers/shonen':{ShonenProvider:Provider},
    '../desktop/main/services/providers/anichan':{AniChanProvider:Provider},
    '../desktop/main/services/providers/stream-authorization':{},
    '../desktop/main/services/manga/sources':{configureMangaBallCatalogueTransport(){},sourceById:()=>({pageImages:async()=>[{url:image,width:800,height:1200}]}),fetchPageImage:async()=>{state.publicReads++;return new Response('verification',{status});}},
    '../desktop/main/services/manga/anilist-manga':{},
    './assets':{AssetVault:class{register(raw,kind,fetcher){state.assets.push({raw,kind,fetcher});return '/v1/assets/'+'A'.repeat(32);}}},
    './protocol':{reject:fail},'./native-media':{NativeMediaTransport:class{async close(){}}},'./pagination':{},'./mangaball-images':{MangaBallImages:Images},
    './mangaball-catalogue':{MangaBallCatalogue:class{fetch=async()=>new Response();approvedOrigins(){return new Set();}async connect(){}close(){}}},
    '../../packages/shared/anichan':{ANICHAN:{ORIGIN:'https://anichan.to'}},
    '../../packages/shared/manga':{MANGADOT:{ORIGIN:'https://mangadot.net'}},
    '../../packages/shared/toonkotsu':{TOONKOTSU:{ORIGIN:'https://toonkotsu.com'}},
    '../desktop/main/services/providers/anikoto-config':{anikotoBaseUrl:()=> 'https://anikototv.to'},
    '../desktop/main/services/providers/anikoto-browser':{},
    '../desktop/main/services/providers/anichan-session':{aniChanPageReader:()=>()=>{}},
    '../desktop/main/services/providers/verified-page-session':{VerifiedPageSession:Provider},
    electron:{BrowserWindow:{getAllWindows:()=>[]}},
  };
  const exports={},source=readFileSync(new URL('../apps/source-service/adapter.ts',import.meta.url),'utf8');
  runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
    {exports,URL,Headers,Map,Set,require:name=>{assert.ok(Object.hasOwn(modules,name),name);return modules[name];}});
  return {adapter:new exports.NativeSourceAdapter(),state};
}
for(const status of [403,429])test(`MangaBall ${status} stops ordinary delivery until a named manual connection; receipts retain page order`,async()=>{
  const {adapter,state}=fixture(status),signal=new AbortController().signal;
  assert.equal(adapter.approvedOrigins().has(new URL(image).origin),false);
  const pages=await adapter.call({kind:'manga',source:'mangaball',method:'pages',args:[{sourceId:'mangaball',id:'fixture',title:'Fixture'},'chapter']},signal);
  assert.equal(state.registered[0].url,image);assert.equal(pages[0].width,800);assert.equal(pages[0].url,'/v1/assets/'+'A'.repeat(32));
  assert.equal(adapter.approvedOrigins().has(new URL(image).origin),true);
  const asset=state.assets[0];
  await assert.rejects(asset.fetcher(asset.raw,signal,null),error=>error.status===status);
  assert.equal(state.publicReads,1);assert.equal(state.verifiedReads,0);assert.equal(state.connections,0);
  await assert.rejects(asset.fetcher(asset.raw,signal,null),error=>error.status===status);
  assert.equal(state.publicReads,1,'a subsequent image cannot retry a stopped ordinary transport');assert.equal(state.connections,0);
  await adapter.operatorConnections().mangaball();
  assert.equal((await asset.fetcher(asset.raw,signal,null)).status,200);assert.equal(state.publicReads,1);assert.equal(state.connections,1);
  await assert.rejects(asset.fetcher(asset.raw,signal,'bytes=0-1'),error=>error.status===416);
  adapter.close();assert.equal(state.closed,1);
});
