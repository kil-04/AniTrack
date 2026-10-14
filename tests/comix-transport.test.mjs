import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script = fs.readFileSync(new URL('../apps/android/app/src/main/assets/comix_transport.js',import.meta.url),'utf8');
// Only the browser import boundary is replaced. No downloaded code executes in
// Node; fixtures expose a reviewed wrapper over an in-memory HTTP response.
assert.equal(script.split('await import(url.href)').length,2);
const offlineScript = script.replace('await import(url.href)','await moduleLoader(url.href)');
const root = 'https://comix.to/assets/fixture/dist/';
const envUrl = root+'env-fixture.js';
const mainUrl = root+'main-fixture.js';
const catalogueUrl = root+'catalogue-fixture.js';
const searchParams = () => ({keyword:'Fixture',page:1,limit:20,'order[relevance]':'desc'});
const chapterParams = () => ({page:1,limit:100,'order[number]':'asc'});
const verbs = ['get','post','put','patch','delete'];

function facadeSource({name='publicClient',exportKey='facade',renamed=false}={}) {
  const keys = renamed ? ['kV','FE','fc','CU','MQ'] : verbs;
  return `var ${name}={${verbs.map((verb,i)=>`${keys[i]}:async(a,b,c)=>(await oq.${verb}(a,b,c)).data`).join(',')}};export{${name} as ${exportKey}};`;
}

function fixtureFacade(read,renamed=false) {
  const http = {get:async(path,config)=>({data:await read(path,config)})};
  const facade = {
    get:async(a,b)=>(await http.get(a,b)).data,
    post(){throw new Error('Mutation must never run');},
    put(){throw new Error('Mutation must never run');},
    patch(){throw new Error('Mutation must never run');},
    delete(){throw new Error('Mutation must never run');}
  };
  return renamed ? {kV:facade.get,FE:facade.post,fc:facade.put,CU:facade.patch,MQ:facade.delete} : facade;
}

function setup(read=async()=>({items:[]}),options={}) {
  const window = {};
  const stats = {fetches:[],loads:[],reads:[],timers:new Map()};
  const sources = options.sources || new Map([[envUrl,facadeSource()]]);
  const modules = options.modules || new Map([[envUrl,{facade:fixtureFacade(async(path,config)=>{
    stats.reads.push({path,config});return read(path,config);
  })}]]);
  let timerId = 0;
  const context = vm.createContext({window,location:{origin:options.origin || 'https://comix.to',href:'https://comix.to/',pathname:options.pathname || '/'},
    URL,Map,JSON,TextDecoder,AbortController,
    setTimeout:(fn,delay)=>{const id=++timerId;stats.timers.set(id,{fn,delay});return id;},
    clearTimeout:id=>stats.timers.delete(id),
    document:{querySelectorAll:selector=>selector.startsWith('link') ? (options.preloads || [envUrl]).map(href=>({href})) : (options.mains || []).map(src=>({src}))},
    fetch:async(url,config)=>{
      stats.fetches.push({url,config});
      assert.equal(config.method,'GET');assert.equal(config.credentials,'same-origin');assert.equal(config.redirect,'error');
      if (options.fetchResponse) return options.fetchResponse(url,config);
      assert.equal(sources.has(url),true,`Unknown fixture ${url}`);
      const body=new TextEncoder().encode(sources.get(url));
      let read=false;
      return {ok:true,status:200,headers:{get:()=>null},body:{getReader:()=>({read:async()=>read?{done:true}:(read=true,{done:false,value:body}),cancel:async()=>{}})}};
    },
    moduleLoader:async url=>{
      stats.loads.push(url);
      assert.equal(modules.has(url),true,`Unexpected module execution ${url}`);
      return modules.get(url);
    }
  });
  vm.runInContext(offlineScript,context);
  return {api:window.__anitrackComix,stats,context};
}

async function finish(api,id) {
  for(let i=0;i<100;i++) {
    const result=api.take(id);
    if(result!==null) return JSON.parse(result);
    await new Promise(resolve=>setImmediate(resolve));
  }
  throw new Error('Fixture never completed');
}

test('legacy env facade exports only projected public catalogue fields',async()=>{
  const {api,stats}=setup(async()=>({items:[{hid:'sample',title:'Fixture title',links:{al:'https://anilist.co/manga/1',token:'private'},account:'private',signature:'private'}],cookie:'private'}));
  assert.equal(api.start('one','/manga',searchParams()),true);
  const result=await finish(api,'one');
  assert.deepEqual(result,{ok:true,value:{items:[{hid:'sample',title:'Fixture title',links:{al:'https://anilist.co/manga/1'}}]}});
  assert.equal(JSON.stringify(result).includes('private'),false);
  assert.equal(stats.loads.length,1);assert.equal(stats.reads.length,1);
});

test('validated flat queries become ordinary website nested queries without mutating frozen callers',async()=>{
  for(const operation of [
    {path:'/manga',params:searchParams(),expected:{keyword:'Fixture',page:1,limit:20,order:{relevance:'desc'}}},
    {path:'/manga/sample/chapters',params:{...chapterParams(),page:17},expected:{page:17,limit:20,order:{number:'asc'}}},
    {path:'/manga/sample',params:{},expected:{}},
    {path:'/chapters/123',params:{},expected:{}}
  ]) {
    const params=Object.freeze(operation.params);
    const before=JSON.stringify(params);
    const {api,stats}=setup(async()=>operation.path==='/manga/sample'?{hid:'sample',title:'Title'}:
      operation.path==='/chapters/123'?{items:[{url:'1.webp'}]}:{items:[]});
    assert.equal(api.start('one',operation.path,params),true);
    assert.equal((await finish(api,'one')).ok,true);
    assert.equal(stats.reads.length,1);
    assert.deepEqual(JSON.parse(JSON.stringify(stats.reads[0].config.params)),operation.expected);
    assert.notEqual(stats.reads[0].config.params,params);
    assert.equal(JSON.stringify(params),before);
  }
});

test('query normalization snapshots validated input before asynchronous module discovery',async()=>{
  const params=chapterParams();
  const {api,stats}=setup(async()=>({items:[]}));
  assert.equal(api.start('one','/manga/sample/chapters',params),true);
  params.page=201;params.limit=1000;params['order[number]']='desc';params.group='unreviewed';
  assert.equal((await finish(api,'one')).ok,true);
  assert.deepEqual(JSON.parse(JSON.stringify(stats.reads[0].config.params)),{page:1,limit:20,order:{number:'asc'}});
  assert.equal(stats.reads.length,1);
});

test('observed main static imports discover renamed facade, not secure config or Axios',async()=>{
  const secureUrl=root+'secure-fixture.js';
  const sources=new Map([[mainUrl,'import{i as cfg,n as store}from"./secure-fixture.js";import{mt as client}from"./catalogue-fixture.js";'],
    [secureUrl,'var config={publicOrigin:"https://comix.to"};export{config as i};'],
    [catalogueUrl,facadeSource({name:'Zh',exportKey:'mt',renamed:true})]]);
  const reads=[];
  const modules=new Map([[catalogueUrl,{mt:fixtureFacade(async(path)=>{reads.push(path);return{items:[]};},true),rawAxios:{interceptors:{}}}]]);
  const {api,stats}=setup(undefined,{preloads:[],mains:[mainUrl],sources,modules});
  api.start('one','/manga',searchParams());
  assert.equal((await finish(api,'one')).ok,true);
  assert.deepEqual(stats.fetches.map(x=>x.url),[mainUrl,secureUrl,catalogueUrl]);
  assert.deepEqual(stats.loads,[catalogueUrl]);assert.deepEqual(reads,['/manga']);
});

test('modulepreload candidates support renamed exported GET wrappers',async()=>{
  const {api,stats}=setup(undefined,{preloads:[catalogueUrl],sources:new Map([[catalogueUrl,facadeSource({name:'Zh',exportKey:'mt',renamed:true})]]),
    modules:new Map([[catalogueUrl,{mt:fixtureFacade(async()=>({hid:'sample',title:'Title'}),true)}]])});
  api.start('one','/manga/sample',{});
  assert.equal((await finish(api,'one')).value.title,'Title');
  assert.deepEqual(stats.loads,[catalogueUrl]);
});

test('dynamic imports, quoted source and comments do not authorize catalogue modules',async()=>{
  const source='// import{x}from"./commented.js";\n'+
    'const text=\'import{x}from"./quoted.js";\';'+
    '/* import{x}from"./block.js"; */import("./dynamic.js");'+
    'import{mt as client}from"./catalogue-fixture.js";';
  const {api,stats}=setup(undefined,{preloads:[],mains:[mainUrl],sources:new Map([[mainUrl,source],[catalogueUrl,facadeSource({exportKey:'mt',renamed:true})]]),
    modules:new Map([[catalogueUrl,{mt:fixtureFacade(async()=>({items:[]}),true)}]])});
  api.start('one','/manga',searchParams());assert.equal((await finish(api,'one')).ok,true);
  assert.deepEqual(stats.fetches.map(x=>x.url),[mainUrl,catalogueUrl]);
});

test('commented or quoted facade/export syntax is not executable identity evidence',async()=>{
  for (const source of ['/*'+facadeSource()+'*/',JSON.stringify(facadeSource())]) {
    const {api,stats}=setup(undefined,{sources:new Map([[envUrl,source]])});
    api.start('one','/manga',searchParams());assert.equal((await finish(api,'one')).ok,false);assert.equal(stats.loads.length,0);
  }
});

test('ambiguous facade modules and duplicate exports are refused before execution',async()=>{
  for(const duplicateExport of [false,true]) {
    const other=root+'second-fixture.js';
    const sources=duplicateExport?new Map([[envUrl,facadeSource()+'export{publicClient as second};']]):new Map([[envUrl,facadeSource()],[other,facadeSource()]]);
    const {api,stats}=setup(undefined,{sources,preloads:duplicateExport?[envUrl]:[envUrl,other]});
    api.start('one','/manga',searchParams());
    const result=await finish(api,'one');
    assert.equal(result.ok,false);assert.match(result.error,/http-facade-ambiguous/);assert.equal(stats.loads.length,0);assert.equal(stats.reads.length,0);
  }
});

test('unrecognised and runtime-mismatched facades never invoke catalogue methods',async()=>{
  for(const source of ['export const account={login(){}};',facadeSource()]) {
    const {api,stats}=setup(undefined,{sources:new Map([[envUrl,source]]),modules:new Map([[envUrl,{facade:{get(){throw Error('Must not run');}}}]])});
    api.start('one','/manga',searchParams());
    assert.equal((await finish(api,'one')).ok,false);assert.equal(stats.reads.length,0);
  }
});

test('account/mutation paths and arbitrary parameters are refused without network',()=>{
  const {api,stats}=setup();
  for(const path of ['/user','/auth/login','/manga/sample/recommend','/chapters/123/like','https://other.example/manga','/manga/a/../user']) assert.equal(api.start('bad',path,{}),false);
  for(const params of [{}, {...searchParams(),token:'private'}, {...searchParams(),page:2}, {...searchParams(),keyword:'x'.repeat(201)}]) assert.equal(api.start('bad','/manga',params),false);
  assert.equal(api.start('bad','/manga/sample/chapters',{...chapterParams(),page:201}),false);
  assert.equal(stats.fetches.length,0);
});

test('foreign origins, query-bearing module URLs and non-homepage contexts are refused',async()=>{
  for(const bad of ['https://other.example/assets/env-fixture.js',envUrl+'?token=private','https://comix.to/api/v1/user']) {
    const {api,stats}=setup(undefined,{preloads:[bad]});api.start('one','/manga',searchParams());
    assert.equal((await finish(api,'one')).ok,false);assert.equal(stats.fetches.length,0);assert.equal(stats.loads.length,0);
  }
  assert.equal(setup(undefined,{origin:'https://other.example'}).api,undefined);
  assert.equal(setup(undefined,{pathname:'/title/example'}).api,undefined);
});

test('unrelated homepage module hints cannot block or expand the same-origin catalogue',async()=>{
  const badHints=['https://thirdparty.example/assets/env.js',envUrl+'?token=private','https://comix.to/api/v1/user'];
  const {api,stats}=setup(undefined,{preloads:[...badHints,envUrl],mains:['https://thirdparty.example/assets/main-script.js']});
  api.start('one','/manga',searchParams());
  assert.equal((await finish(api,'one')).ok,true);
  assert.deepEqual(stats.fetches.map(value=>value.url),[envUrl]);
  assert.deepEqual(stats.loads,[envUrl]);
});

test('candidate and individual module byte caps refuse excessive discovery',async()=>{
  const tooMany=setup(undefined,{preloads:Array.from({length:13},(_,i)=>root+`candidate-${i}.js`)});
  tooMany.api.start('one','/manga',searchParams());
  assert.match((await finish(tooMany.api,'one')).error,/module-bounds/);assert.equal(tooMany.stats.fetches.length,0);
  const huge=setup(undefined,{sources:new Map([[envUrl,' '.repeat(2000001)]])});huge.api.start('one','/manga',searchParams());
  assert.match((await finish(huge.api,'one')).error,/module-bounds/);assert.equal(huge.stats.loads.length,0);
});

test('module graph total byte cap and declared content length are enforced',async()=>{
  const urls=Array.from({length:3},(_,i)=>root+`large-${i}.js`);
  const bounded=setup(undefined,{preloads:urls,sources:new Map(urls.map(u=>[u,' '.repeat(1500000)]))});bounded.api.start('one','/manga',searchParams());
  assert.match((await finish(bounded.api,'one')).error,/module-bounds/);assert.equal(bounded.stats.loads.length,0);
  const declared=setup(undefined,{fetchResponse:async()=>({ok:true,status:200,headers:{get:key=>key==='content-length'?'2000001':null},body:{}})});
  declared.api.start('one','/manga',searchParams());assert.match((await finish(declared.api,'one')).error,/module-bounds/);
});

test('module security rejection stops before any other candidate or retry',async()=>{
  for(const status of [403,429]) {
    const {api,stats}=setup(undefined,{preloads:[envUrl,catalogueUrl],fetchResponse:async()=>({ok:false,status,headers:{get:()=>null}})});
    api.start('one','/manga',searchParams());const result=await finish(api,'one');
    assert.equal(result.status,status);assert.equal(result.error,'Comix HTTP '+status);
    assert.equal(stats.fetches.length,1);assert.equal(stats.loads.length,0);
  }
});

test('catalogue access rejection reports status only and performs one GET without retry',async()=>{
  for(const status of [403,429]) {
    const {api,stats}=setup(async()=>{throw{response:{status,data:{token:'secret'}},message:'https://cdn.example/signed?token=secret'};});
    api.start('one','/manga',searchParams());const result=await finish(api,'one');
    assert.equal(result.status,status);assert.equal(result.error,'Comix HTTP '+status);assert.equal(JSON.stringify(result).includes('secret'),false);assert.equal(stats.reads.length,1);
  }
});

test('normalized chapter-list query still stops after one rejected GET without retry',async()=>{
  const params=Object.freeze(chapterParams());
  const {api,stats}=setup(async()=>{throw{response:{status:403,data:{error:'captcha_required'}}};});
  assert.equal(api.start('one','/manga/sample/chapters',params),true);
  assert.deepEqual(await finish(api,'one'),{ok:false,status:403,error:'Comix HTTP 403'});
  assert.equal(stats.reads.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(stats.reads[0].config.params)),{page:1,limit:20,order:{number:'asc'}});
  assert.deepEqual(params,chapterParams());
});

test('title identity retains bounded tracker URLs and actually supplied public metadata',async()=>{
  const {api}=setup(async()=>({hid:'sample',title:'Title',year:1989,originalLanguage:'ja',latestChapter:42.5,hasChapters:true,
    links:{al:'https://anilist.co/manga/1',mal:'https://myanimelist.net/manga/2',account:'secret'},cipher:'secret'}));
  api.start('one','/manga/sample',{});
  assert.deepEqual((await finish(api,'one')).value,{hid:'sample',title:'Title',year:1989,originalLanguage:'ja',latestChapter:42.5,hasChapters:true,
    links:{al:'https://anilist.co/manga/1',mal:'https://myanimelist.net/manga/2'}});
});

test('chapter list projects pagination but removes account and request authorization fields',async()=>{
  const {api}=setup(async()=>({items:[{id:123,number:0.5,name:'Prologue',group:{name:'Group',token:'secret'},signature:'secret'}],
    meta:{page:1,lastPage:2,total:101,hasNext:true,cookie:'secret'}}));
  api.start('one','/manga/sample/chapters',chapterParams());
  assert.deepEqual((await finish(api,'one')).value,{items:[{id:123,number:0.5,name:'Prologue',group:{name:'Group'}}],meta:{page:1,lastPage:2,total:101,hasNext:true}});
});

test('current top-level page holder and legacy page envelopes retain s and dimensions only',async()=>{
  const holder={baseUrl:'https://images.example/folder',items:[{url:'1.webp',s:1,width:1200,height:1800,token:'secret'}],alt:['ignored.example'],node:'ignored',cookie:'secret'};
  for(const value of [holder,{pages:holder},{pages:holder.items}]) {
    const {api}=setup(async()=>value);api.start('one','/chapters/123',{});
    assert.deepEqual((await finish(api,'one')).value,{pages:{baseUrl:value.pages===holder.items?'':'https://images.example/folder',items:[{url:'1.webp',s:1,width:1200,height:1800}]}});
  }
});

test('oversized row count, scalar and process-boundary payloads are refused',async()=>{
  const cases=[{path:'/manga',params:searchParams(),value:{items:Array(21).fill({hid:'x',title:'Title'})}},
    {path:'/manga/sample/chapters',params:chapterParams(),value:{items:Array(101).fill({id:1,number:1})}},
    {path:'/chapters/123',params:{},value:{items:Array(501).fill({url:'1.webp'})}},
    {path:'/chapters/123',params:{},value:{items:[{url:'a'.repeat(4097)}]}},
    {path:'/chapters/123',params:{},value:{items:Array(500).fill({url:'a'.repeat(500)})}}];
  for(const c of cases) {const {api}=setup(async()=>c.value);api.start('one',c.path,c.params);assert.equal((await finish(api,'one')).ok,false);}
});

test('one pending request and cancellation prevent late same-ID responses poisoning a new request',async()=>{
  const releases=[];
  const {api,stats}=setup(()=>new Promise(resolve=>releases.push(resolve)));
  assert.equal(api.start('one','/manga',searchParams()),true);assert.equal(api.phase('one'),'website-module');
  for(let i=0;i<10&&releases.length<1;i++)await new Promise(r=>setImmediate(r));
  assert.equal(api.phase('one'),'catalogue');assert.equal(api.start('busy','/manga',searchParams()),false);
  api.cancel('one');assert.equal(api.phase('one'),'idle');assert.equal(stats.reads[0].config.signal.aborted,true);
  assert.equal(api.start('one','/manga',searchParams()),true);
  for(let i=0;i<10&&releases.length<2;i++)await new Promise(r=>setImmediate(r));
  releases[0]({items:[{hid:'old',title:'Old'}]});await new Promise(r=>setImmediate(r));assert.equal(api.take('one'),null);
  releases[1]({items:[{hid:'new',title:'New'}]});assert.equal((await finish(api,'one')).value.items[0].hid,'new');
  assert.equal(stats.timers.size,0);
});

test('timeout aborts the selected operation and cancellation during discovery prevents GET',async()=>{
  const held=setup(()=>new Promise(()=>{}));held.api.start('one','/manga',searchParams());
  for(let i=0;i<10&&held.stats.reads.length===0;i++)await new Promise(r=>setImmediate(r));
  held.stats.timers.values().next().value.fn();
  assert.equal((await finish(held.api,'one')).error,'Comix catalogue request timed out.');assert.equal(held.stats.reads[0].config.signal.aborted,true);
  const cancelled=setup();cancelled.api.start('one','/manga',searchParams());cancelled.api.cancel('one');await new Promise(r=>setImmediate(r));
  assert.equal(cancelled.stats.loads.length,0);assert.equal(cancelled.stats.reads.length,0);assert.equal(JSON.parse(cancelled.api.take('one')).ok,false);
});

test('transport contains one browser import boundary and no native execution or prototype capture hook',()=>{
  assert.equal(script.includes('eval('),false);assert.equal(script.includes('new Function'),false);
  assert.equal(script.includes('Object.defineProperty(Object.prototype'),false);
  assert.equal(script.includes('XMLHttpRequest.prototype'),false);
  assert.equal(script.includes('JSON.parse ='),false);
  assert.equal(script.split('await import(url.href)').length,2);
});
