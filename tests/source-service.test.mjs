import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
registerHooks({
  resolve(specifier,context,next){if(specifier==='electron')return {url:'anitrack-test:electron',shortCircuit:true};try{return next(specifier,context);}catch(error){if (/^\.{1,2}\//.test(specifier)&&! /\.[a-z0-9]+$/i.test(specifier))return next(specifier+'.ts',context);throw error;}},
  load(url,context,next){if(url==='anitrack-test:electron')return {format:'module',shortCircuit:true,source:'export class BrowserWindow {static getAllWindows(){return globalThis.__sourceServiceWindows ?? [];}}'};if(url.includes('/apps/source-service/')&&url.endsWith('.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText};return next(url,context);},
});
const {SourceService}=await import('../apps/source-service/handler.ts');
const {sourceRequest,authenticates,ANIME_SOURCES,MANGA_SOURCES}=await import('../apps/source-service/protocol.ts');
const {AssetVault}=await import('../apps/source-service/assets.ts');
const {publicAddress,publicMediaFetch}=await import('../apps/source-service/public-media.ts');
const {SourceOperator}=await import('../apps/source-service/operator.ts');
const {chapterPage}=await import('../apps/source-service/pagination.ts');
const secret='fixture_key_'.repeat(4),base='https://source.example';
const selection={kind:'anime',source:'animepahe',method:'search',args:['Show']};
const rpc=(value=selection,headers={})=>new Request(base+'/v1/rpc',{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json',...headers},body:JSON.stringify(value)});
const adapter={call:async()=>[],asset:async()=>new Response('video')};

test('The standalone service roster stays on the published eight sources',()=>{
  assert.deepEqual(ANIME_SOURCES,['animepahe','anikoto','shonen','anichan']);
  assert.deepEqual(MANGA_SOURCES,['mangadot','mangaball','xcomic','toonkotsu']);
  for(const source of ['miruro','mkissa','comix','http://127.0.0.1'])assert.throws(()=>sourceRequest({...selection,source}));
  assert.throws(()=>sourceRequest({...selection,method:'fetch'}));
  assert.throws(()=>sourceRequest({...selection,url:'https://example.com'}));
});
test('Only health is public; visitors cannot turn the service into a cross-origin browser API',async()=>{
  const service=new SourceService(adapter,secret);
  assert.equal((await service.handle(new Request(base+'/health'))).status,200);
  assert.equal((await service.handle(new Request(base+'/v1/rpc',{method:'POST',body:'{}'}))).status,401);
  assert.equal((await service.handle(rpc(selection,{Origin:'https://anitrack.example'}))).status,403);
  assert.equal((await service.handle(rpc())).status,200);
  assert.equal(authenticates('Bearer '+'é'.repeat(secret.length),secret),false);
});
test('Malformed selections and oversized bodies stop before a connector is called',async()=>{
  let calls=0;const service=new SourceService({...adapter,call:async()=>{calls++;return [];}},secret);
  for(const value of [{...selection,args:['x'.repeat(201)]},{...selection,method:'episodes',args:['id',0]},{kind:'manga',source:'mangadot',method:'pages',args:[{sourceId:'xcomic',id:'1',title:'T'},'1']}])assert.equal((await service.handle(rpc(value))).status,400);
  assert.equal((await service.handle(rpc({...selection,args:['x'.repeat(70000)]}))).status,413);assert.equal(calls,0);
});
test('Upstream errors never expose cookies, source URLs or stacks',async()=>{
  const service=new SourceService({...adapter,call:async()=>{throw Error('verification at https://private.example/?cookie=secret');}},secret);
  const response=await service.handle(rpc());assert.equal(response.status,403);
  assert.deepEqual(await response.json(),{error:'SOURCE_VERIFICATION_REQUIRED'});
});

test('Native reading verification and rate limits preserve their stop statuses without exposing diagnostics',async()=>{
  for(const [error,status,code] of [[{verify:true,message:'Needs a quick check: https://private.example'},403,'SOURCE_VERIFICATION_REQUIRED'],[{message:'Toonkotsu is limiting requests. Wait a minute.'},429,'SOURCE_RATE_LIMITED']]){
    const service=new SourceService({...adapter,call:async()=>{throw error;}},secret);
    const response=await service.handle(rpc());assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:code});
  }
});
test('Long chapter lists cross a bounded page boundary without omissions or reordering',()=>{
  const chapters=Array.from({length:2001},(_,index)=>({id:String(index),number:index}));
  const pages=[1,2,3].map(page=>chapterPage(chapters,page));
  assert.deepEqual(pages.map(page=>page.chapters.length),[1000,1000,1]);
  assert.ok(pages.every(page=>page.totalPages===3));assert.deepEqual(pages.flatMap(page=>page.chapters),chapters);
  assert.deepEqual(chapterPage(chapters,4),{chapters:[],totalPages:3});
});
test('An uninterruptible timed-out connector keeps its slot until it actually finishes',async()=>{
  let finish;const service=new SourceService({...adapter,call:()=>new Promise(resolve=>{finish=resolve;})},secret,1,10);
  const [response]=await Promise.all([service.handle(rpc()),new Promise(resolve=>setTimeout(resolve,25))]);
  assert.equal(response.status,502);assert.equal((await service.handle(rpc())).status,429);
  finish([]);await new Promise(resolve=>setImmediate(resolve));assert.equal((await service.handle(new Request(base+'/health'))).status,200);
});
test('Media receipts rewrite every playlist reference while keeping order, keys, audio and subtitles',async()=>{
  const vault=new AssetVault();
  const playlist='#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio.m3u8"\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",URI="subs.m3u8"\n#EXT-X-SESSION-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-STREAM-INF:BANDWIDTH=100,AUDIO="a",SUBTITLES="s"\nvideo.m3u8\n';
  const targets=[];const fetcher=async(url,_signal,range)=>{targets.push({url,range});return new Response(playlist,{headers:{'Content-Type':'application/vnd.apple.mpegurl'}});};
  const receipt=vault.register('https://cdn.example/dir/master.m3u8?private=1','playlist',fetcher);
  assert.match(receipt,/^\/v1\/assets\/[A-Za-z0-9_-]{32}$/);
  const response=await vault.respond(receipt.split('/').at(-1),new Request(base+receipt));
  const text=await response.text();assert.doesNotMatch(text,/https:|private=1|audio\.m3u8|key\.bin/);
  assert.match(text,/TYPE=AUDIO/);assert.match(text,/TYPE=SUBTITLES/);assert.match(text,/EXT-X-SESSION-KEY/);
  const children=[...text.matchAll(/\/v1\/assets\/[A-Za-z0-9_-]{32}/g)].map(match=>match[0]);assert.equal(children.length,4);
  for(const child of children)await(await vault.respond(child.split('/').at(-1),new Request(base+child))).body.cancel();
  assert.deepEqual(targets.slice(1).map(item=>item.url),['https://cdn.example/dir/audio.m3u8','https://cdn.example/dir/subs.m3u8','https://cdn.example/dir/key.bin','https://cdn.example/dir/video.m3u8']);
});
test('Media ranges stream through receipts and expired receipts cannot reopen an upstream URL',async()=>{
  let now=0,range;const vault=new AssetVault(()=>now,10,100);
  const receipt=vault.register('https://cdn.example/movie.mp4','media',async(_url,_signal,value)=>{range=value;return new Response('bytes',{status:206,headers:{'Content-Range':'bytes 0-4/10','Content-Type':'video/mp4'}});});
  const id=receipt.split('/').at(-1),response=await vault.respond(id,new Request(base+receipt,{headers:{Range:'bytes=0-4'}}));
  assert.equal(response.status,206);assert.equal(range,'bytes=0-4');assert.equal(await response.text(),'bytes');
  now=101;await assert.rejects(vault.respond(id,new Request(base+receipt)),/MEDIA_EXPIRED/);
});
test('Successful source error documents never become page images or videos',async()=>{
  const vault=new AssetVault();
  for(const kind of ['media','image']){const path=vault.register('https://cdn.example/error',kind,async()=>new Response('<html>check</html>',{headers:{'Content-Type':'text/html'}}));await assert.rejects(vault.respond(path.split('/').at(-1),new Request(base+path)),/INVALID_PAGE_IMAGE|INVALID_MEDIA/);}
});
test('Pinned media transport refuses local, mapped, reserved and non-HTTPS destinations',async()=>{
  for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','100.64.0.1','192.168.2.1','198.18.0.1','::1','::ffff:8.8.8.8','fe80::1','fc00::1','2001:db8::1'])assert.equal(publicAddress(address),false,address);
  assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);
  for(const url of ['http://example.com/video','https://127.0.0.1/video','https://[::1]/video','https://user:pass@example.com/video','https://example.com:8443/video'])await assert.rejects(publicMediaFetch(url,new Headers(),AbortSignal.timeout(1000)),/INVALID_MEDIA_DESTINATION/);
});

const operatorKey='operator_fixture_'.repeat(3),operatorOrigin='https://source.example';
const operatorRequest=(path,body,password=operatorKey,origin=operatorOrigin)=>new Request(base+path,{method:body?'POST':'GET',headers:{Authorization:'Basic '+Buffer.from('operator:'+password).toString('base64'),...(body?{'Content-Type':'application/json',Origin:origin}:{})},...(body?{body:JSON.stringify(body)}:{})});
function sourceWindow(url){
  const state={url,visible:false,inputs:[]};
  return {state,isDestroyed:()=>false,isVisible:()=>state.visible,show:()=>{state.visible=true;},focus(){},close:()=>{state.visible=false;},getContentSize:()=>[800,600],
    webContents:{isDestroyed:()=>false,getURL:()=>state.url,capturePage:async()=>({toPNG:()=>Buffer.from('png')}),sendInputEvent:event=>state.inputs.push(event),insertText:async text=>state.inputs.push({text})}};
}
test('Invalid login flooding cannot lock out a correctly authenticated source operator',async()=>{
  const operator=new SourceOperator(operatorKey,operatorOrigin,()=>new Set());
  for(let i=0;i<10;i++)assert.equal((await operator.handle(operatorRequest('/operator',undefined,'bad'))).status,401);
  assert.equal((await operator.handle(operatorRequest('/operator',undefined,'bad'))).status,429);
  assert.equal((await operator.handle(operatorRequest('/operator'))).status,200);
});
test('The operator can select a background source check but cannot control an unapproved page',async()=>{
  const source=sourceWindow('https://anikototv.to/'),other=sourceWindow('https://unrelated.example/');globalThis.__sourceServiceWindows=[source,other];
  const operator=new SourceOperator(operatorKey,operatorOrigin,()=>new Set(['https://anikototv.to']));
  const rows=await(await operator.handle(operatorRequest('/operator/api/windows'))).json();assert.equal(rows.length,1);assert.match(rows[0].label,/background/);
  const id=rows[0].id;
  assert.equal((await operator.handle(operatorRequest('/operator/api/screen?id='+id))).status,200);assert.equal(source.state.visible,true);
  assert.equal((await operator.handle(operatorRequest('/operator/api/input',{id,type:'click',x:10,y:15}))).status,200);assert.equal(source.state.inputs.length,2);
  assert.equal((await operator.handle(operatorRequest('/operator/api/input',{id,type:'key',key:'F12'}))).status,400);
  assert.equal((await operator.handle(operatorRequest('/operator/api/input',{id,type:'click',x:900,y:15}))).status,400);
  assert.equal((await operator.handle(operatorRequest('/operator/api/input',{id,type:'text',text:'x'},operatorKey,'https://attacker.example'))).status,403);
  source.state.url='https://unrelated.example/';assert.equal((await operator.handle(operatorRequest('/operator/api/input',{id,type:'click',x:10,y:15}))).status,404);
  globalThis.__sourceServiceWindows=[];
});
test('Finishing a hidden-preserving source check does not reopen it on the next refresh',async()=>{
  const source=sourceWindow('https://mangadot.net/');source.state.visible=true;globalThis.__sourceServiceWindows=[source];
  const operator=new SourceOperator(operatorKey,operatorOrigin,()=>new Set(['https://mangadot.net']));
  const [{id}]=await(await operator.handle(operatorRequest('/operator/api/windows'))).json();
  assert.equal((await operator.handle(operatorRequest('/operator/api/input',{id,type:'finish'}))).status,200);
  assert.equal((await operator.handle(operatorRequest('/operator/api/screen?id='+id))).status,404);
  assert.deepEqual(await(await operator.handle(operatorRequest('/operator/api/windows'))).json(),[]);
  source.state.visible=true;assert.equal((await(await operator.handle(operatorRequest('/operator/api/windows'))).json()).length,1);
  globalThis.__sourceServiceWindows=[];
});

test('Operator Connect is fixed-source, same-origin and authenticated before opening any native session',async()=>{
  const calls=[];
  const operator=new SourceOperator(operatorKey,operatorOrigin,()=>new Set(),{
    toonkotsu:async()=>{calls.push('toonkotsu');},mangadot:async()=>{calls.push('mangadot');},
    'https://attacker.example':async()=>{calls.push('arbitrary');},
  });
  const sources=await(await operator.handle(operatorRequest('/operator/api/sources'))).json();
  assert.deepEqual(sources.map(row=>[row.source,row.label]),[['mangadot','MangaDot'],['toonkotsu','Toonkotsu']]);
  assert.equal((await operator.handle(operatorRequest('/operator/api/connect',{source:'toonkotsu'},'bad'))).status,401);
  for(const origin of ['https://attacker.example','null',''])assert.equal((await operator.handle(operatorRequest('/operator/api/connect',{source:'toonkotsu'},operatorKey,origin))).status,403);
  for(const input of [{source:'https://attacker.example'},{source:'comix'},{source:'xcomic'},{source:'constructor'},{source:'toonkotsu',url:'https://attacker.example'},['toonkotsu'],{}])assert.equal((await operator.handle(operatorRequest('/operator/api/connect',input))).status,400);
  assert.deepEqual(calls,[]);
  const page=await(await operator.handle(operatorRequest('/operator'))).text();assert.match(page,/id="sources"/);assert.match(page,/id="connect"/);
  const script=await(await operator.handle(operatorRequest('/operator/app.js'))).text();assert.doesNotThrow(()=>new Function(script));
  assert.equal((await operator.handle(operatorRequest('/operator/api/connect',{source:'mangadot'}))).status,202);
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,['mangadot']);
});

test('A pending native Connect returns immediately, deduplicates, and completes only after human Finish check',async()=>{
  let finish,connections=0,verificationNeeded=true;
  const win=sourceWindow('https://toonkotsu.example/');
  win.close=()=>{win.state.visible=false;finish();};
  globalThis.__sourceServiceWindows=[win];
  const operator=new SourceOperator(operatorKey,operatorOrigin,()=>new Set(['https://toonkotsu.example']),{
    toonkotsu:async()=>{connections++;win.show();await new Promise(resolve=>{finish=resolve;});verificationNeeded=false;return true;},
  });
  const request=()=>operator.handle(operatorRequest('/operator/api/connect',{source:'toonkotsu'}));
  assert.equal((await request()).status,202);assert.equal((await request()).status,202);
  assert.equal(connections,1);assert.equal(verificationNeeded,true);
  assert.equal((await(await operator.handle(operatorRequest('/operator/api/sources'))).json())[0].state,'connecting');
  const [{id}]=await(await operator.handle(operatorRequest('/operator/api/windows'))).json();
  assert.equal((await operator.handle(operatorRequest('/operator/api/input',{id,type:'finish'}))).status,200);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(verificationNeeded,false);
  assert.equal((await(await operator.handle(operatorRequest('/operator/api/sources'))).json())[0].state,'finished');
  globalThis.__sourceServiceWindows=[];
});

test('A failed native connection exposes no URL, cookie or stack and allows a new explicit Connect',async()=>{
  let count=0;
  const operator=new SourceOperator(operatorKey,operatorOrigin,()=>new Set(),{anichan:async()=>{count++;throw Error('private-cookie at https://private.example');}});
  for(let i=0;i<2;i++){
    assert.equal((await operator.handle(operatorRequest('/operator/api/connect',{source:'anichan'}))).status,202);
    await new Promise(resolve=>setImmediate(resolve));
    const response=await operator.handle(operatorRequest('/operator/api/sources')),text=await response.text();
    assert.doesNotMatch(text,/private|cookie|https:|stack/);assert.equal(JSON.parse(text)[0].state,'failed');
  }
  assert.equal(count,2);
});

test('Adapter Connect actions use fixed native sessions and AniChan reconnects the exact reader session',async()=>{
  const calls=[],pages=[];let providerRead;
  const pahe=sourceWindow('https://animepahe.example/'),unrelated=sourceWindow('https://unrelated.example/'),anikoto=sourceWindow('https://anikoto.example/');
  class PageSession {
    constructor(options){this.options=options;pages.push(this);}
    async readPage(url,code){calls.push(['read',this,url,code]);return {};}
    requireVerification(){return Error('verification');}
    async connect(url,parent){calls.push(['connect',this,url,parent]);}
  }
  class Provider {}
  class AniChanProvider {constructor(options){providerRead=options.read;}}
  const modules={
    '../desktop/main/services/providers/registry':{ProviderRegistry:class{constructor(providers){this.providers=providers;}descriptors(){return [];}}},
    '../desktop/main/services/providers/animepahe':{AnimePaheProvider:Provider,prewarm:()=>calls.push(['prewarm']),getPaheBaseUrl:()=> 'https://animepahe.example'},
    '../desktop/main/services/providers/anikoto':{AnikotoProvider:Provider},
    '../desktop/main/services/providers/shonen':{ShonenProvider:Provider},
    '../desktop/main/services/providers/anichan':{AniChanProvider},
    '../desktop/main/services/providers/stream-authorization':{},
    '../desktop/main/services/manga/sources':{configureMangaBallCatalogueTransport:()=>calls.push(['ball-catalogue-transport']),connectMangaSource:async(...args)=>{calls.push(['manga',...args]);return true;}},
    '../desktop/main/services/manga/anilist-manga':{},'./assets':{AssetVault:class{}},'./protocol':{},'./native-media':{NativeMediaTransport:class{async close(){}}},'./pagination':{chapterPage},
    './mangaball-images':{MangaBallImages:class{approvedOrigins(){return new Set();}async connect(){calls.push(['ball-images']);}close(){}}},
    './mangaball-catalogue':{MangaBallCatalogue:class{fetch=async()=>new Response();approvedOrigins(){return new Set(['https://api.mangaball.com']);}async connect(){calls.push(['ball-catalogue']);}close(){}}},
    '../../packages/shared/anichan':{ANICHAN:{ORIGIN:'https://anichan.to'}},
    '../../packages/shared/manga':{MANGADOT:{ORIGIN:'https://mangadot.example'}},
    '../../packages/shared/toonkotsu':{TOONKOTSU:{ORIGIN:'https://toonkotsu.example'}},
    '../desktop/main/services/providers/anikoto-config':{anikotoBaseUrl:()=> 'https://anikoto.example'},
    '../desktop/main/services/providers/anikoto-browser':{getAnikotoWindow:async()=>anikoto},
    '../desktop/main/services/providers/anichan-session':{aniChanPageReader:page=>async()=>page.readPage('https://anichan.to/anime/1/example/1','fixed reviewed reader')},
    '../desktop/main/services/providers/verified-page-session':{VerifiedPageSession:PageSession},
    electron:{BrowserWindow:{getAllWindows:()=>[pahe,unrelated]}},
  };
  const source=readFileSync(new URL('../apps/source-service/adapter.ts',import.meta.url),'utf8');
  const exports={};runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
    {exports,URL,Headers,require:name=>{assert.ok(Object.hasOwn(modules,name),name);return modules[name];}});
  const adapter=new exports.NativeSourceAdapter(),connect=adapter.operatorConnections();
  assert.deepEqual(Object.keys(connect).sort(),['anichan','anikoto','animepahe','mangaball','mangaball-catalogue','mangadot','toonkotsu']);
  assert.deepEqual(calls,[['ball-catalogue-transport']]);calls.length=0;
  assert.equal(adapter.approvedOrigins().has('https://api.mangaball.com'),true);
  await connect.mangadot();await connect.toonkotsu();await connect.animepahe();await connect.anikoto();
  assert.deepEqual(calls.slice(0,3),[['manga','mangadot',null],['manga','toonkotsu',null],['prewarm']]);
  assert.equal(pahe.state.visible,true);assert.equal(unrelated.state.visible,false);assert.equal(anikoto.state.visible,true);
  await providerRead({});await connect.anichan();
  const read=calls.find(row=>row[0]==='read'),connection=calls.find(row=>row[0]==='connect');
  assert.equal(pages.length,1);assert.equal(read[1],connection[1]);assert.equal(connection[2],read[2]);assert.equal(connection[3],null);
  assert.equal(pages[0].options.partition,'persist:anichan');
  await connect.mangaball();assert.equal(calls.at(-1)[0],'ball-images');
  await connect['mangaball-catalogue']();assert.equal(calls.at(-1)[0],'ball-catalogue');
});
