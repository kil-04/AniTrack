import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

registerHooks({
  resolve(specifier,context,next){
    const parent=context.parentURL?new URL(context.parentURL).pathname:'';
    if(parent.endsWith('/apps/web/lib/source-http.ts')&&specifier==='../server/network')return {url:'render-throttle-test:network',shortCircuit:true};
    if(parent.endsWith('/apps/web/server/site.ts')&&specifier==='../lib/gateway')return {url:'render-throttle-test:gateway',shortCircuit:true};
    if(parent.endsWith('/apps/web/server/site.ts')&&specifier==='./runtime')return {url:'render-throttle-test:runtime',shortCircuit:true};
    try{return next(specifier,context);}catch(error){if(/^\.{1,2}\//.test(specifier)&&! /\.[a-z0-9]+$/i.test(specifier))return next(specifier+'.ts',context);throw error;}
  },
  load(url,context,next){
    if(url==='render-throttle-test:network')return {format:'module',shortCircuit:true,source:'export const serverFetch=(...args)=>globalThis.__renderThrottleFetch(...args);'};
    if(url==='render-throttle-test:gateway')return {format:'module',shortCircuit:true,source:'export const rpc=(...args)=>globalThis.__renderThrottleRpc(...args);export const mediaResponse=async()=>new Response();export const pageImage=mediaResponse;export const archiveMedia=mediaResponse;'};
    if(url==='render-throttle-test:runtime')return {format:'module',shortCircuit:true,source:'export function configureRuntime(){}'};
    if(url.startsWith('file:')&&new URL(url).pathname.includes('/apps/web/')&&new URL(url).pathname.endsWith('.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText};
    return next(url,context);
  },
});
let sequence=0;
const module=()=>import('../apps/web/lib/source-http.ts?case='+sequence++);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const clock=context=>context.mock.timers.enable({apis:['Date','setTimeout'],now:Date.UTC(2026,9,31,0,0,0)});
const outcome=promise=>promise.then(value=>({value}),error=>({error}));
const limited=result=>{assert.equal(result.error?.sourceStatus,429);return result.error;};

test('A 429 stops both queued and new host reads; ordinary reads resume only after its cooldown',async context=>{
  clock(context);const {sourceText}=await module(),response=deferred();let calls=0;
  globalThis.__renderThrottleFetch=async()=>{calls++;return response.promise;};
  const first=outcome(sourceText('https://graphql.anilist.co/query-one',{method:'POST',body:'{}'}));
  const queued=outcome(sourceText('https://graphql.anilist.co/query-two',{method:'POST',body:'{}'}));await tick();assert.equal(calls,1);
  // Even a slow first response must not let queued reads run before its status is known.
  context.mock.timers.tick(5000);await tick();assert.equal(calls,1);
  response.resolve(new Response('limited',{status:429,headers:{'Retry-After':'120'}}));
  assert.equal(limited(await first).retryAfter,120);assert.equal(limited(await queued).retryAfter,120);
  assert.equal(limited(await outcome(sourceText('https://graphql.anilist.co/new',{method:'POST'}))).retryAfter,120);assert.equal(calls,1);
  context.mock.timers.tick(119000);assert.equal(limited(await outcome(sourceText('https://graphql.anilist.co/new',{method:'POST'}))).retryAfter,1);assert.equal(calls,1);
  context.mock.timers.tick(1000);globalThis.__renderThrottleFetch=async()=>{calls++;return new Response('allowed');};
  assert.equal(await sourceText('https://graphql.anilist.co/new',{method:'POST'}),'allowed');assert.equal(calls,2);
});

test('Unknown, invalid, zero and past Retry-After values impose a sixty-second default',async context=>{
  clock(context);
  for(const header of [null,'invalid','0','-5','1.5','Fri, 30 Oct 2026 00:00:00 GMT']){
    const {sourceText}=await module();let calls=0;globalThis.__renderThrottleFetch=async()=>{calls++;return new Response('limited',{status:429,headers:header?{'Retry-After':header}:{}});};
    const first=limited(await outcome(sourceText('https://unknown.example.test/data')));assert.equal(first.retryAfter,60,header);
    context.mock.timers.tick(59000);assert.equal(limited(await outcome(sourceText('https://unknown.example.test/again'))).retryAfter,1);assert.equal(calls,1);
    context.mock.timers.tick(1000);
  }
});

test('Retry-After HTTP dates and oversized delays become bounded positive seconds',async context=>{
  clock(context);
  for(const [header,seconds] of [[new Date(Date.now()+90000).toUTCString(),90],['9999999999999999999999999999',86400],['1',1]]){
    const {sourceText}=await module();globalThis.__renderThrottleFetch=async()=>new Response('limited',{status:429,headers:{'Retry-After':header}});
    assert.equal(limited(await outcome(sourceText('https://dates.example.test/data'))).retryAfter,seconds);
  }
});

test('AniList network starts remain at least two seconds apart without any automatic retry',async context=>{
  clock(context);const {sourceText}=await module(),starts=[];
  globalThis.__renderThrottleFetch=async()=>{starts.push(Date.now());return new Response('ok');};
  assert.equal(await sourceText('https://graphql.anilist.co/one',{method:'POST',body:'one'}),'ok');
  const second=sourceText('https://graphql.anilist.co/two',{method:'POST',body:'two'});await tick();context.mock.timers.tick(1999);await tick();assert.equal(starts.length,1);
  context.mock.timers.tick(1);assert.equal(await second,'ok');assert.equal(starts[1]-starts[0],2000);
  context.mock.timers.tick(60000);await tick();assert.equal(starts.length,2);
});

test('Existing Shonen, MangaBall, XComic and other host spacing is preserved',async context=>{
  clock(context);
  for(const [host,spacing] of [['shonen.to',500],['api.mangaball.com',250],['xcomic.me',700],['other.example.test',300]]){
    const {sourceText}=await module(),starts=[];globalThis.__renderThrottleFetch=async()=>{starts.push(Date.now());return new Response('ok');};
    await sourceText('https://'+host+'/one',{cache:'no-store'});
    const second=sourceText('https://'+host+'/two',{cache:'no-store'});await tick();context.mock.timers.tick(spacing-1);await tick();assert.equal(starts.length,1);
    context.mock.timers.tick(1);await second;assert.equal(starts[1]-starts[0],spacing);
  }
});

test('Account POSTs and credential-bearing reads never use the public source cache',async context=>{
  clock(context);
  for(const init of [{method:'POST',body:'first-account'},{headers:{Authorization:'Bearer fixture_account_token'}},{headers:{Cookie:'session=fixture'}},{cache:'no-store'}]){
    const {sourceText}=await module();let calls=0;globalThis.__renderThrottleFetch=async()=>new Response('response-'+(++calls));
    assert.equal(await sourceText('https://accounts.example.test/identity',init),'response-1');
    const second=sourceText('https://accounts.example.test/identity',init);await tick();context.mock.timers.tick(300);assert.equal(await second,'response-2');assert.equal(calls,2);
  }
});

test('Public cached data stays available during cooldown without issuing a source request',async context=>{
  clock(context);const {sourceText}=await module();let calls=0;globalThis.__renderThrottleFetch=async()=>{calls++;return new Response('cached');};
  assert.equal(await sourceText('https://cache.example.test/known'),'cached');
  globalThis.__renderThrottleFetch=async()=>{calls++;return new Response('limited',{status:429});};
  const denied=outcome(sourceText('https://cache.example.test/other'));await tick();context.mock.timers.tick(300);limited(await denied);
  assert.equal(await sourceText('https://cache.example.test/known'),'cached');assert.equal(calls,2);
});

test('An aborted queued read never starts its network operation',async context=>{
  clock(context);const {sourceText}=await module(),wait=deferred(),controller=new AbortController();let calls=0;
  globalThis.__renderThrottleFetch=async()=>{calls++;return wait.promise;};
  const first=sourceText('https://cancel.example.test/one'),second=outcome(sourceText('https://cancel.example.test/two',{signal:controller.signal}));await tick();controller.abort();wait.resolve(new Response('ok'));
  assert.equal(await first,'ok');assert.equal((await second).error?.name,'AbortError');assert.equal(calls,1);
});

test('A host cooldown leaves other hosts available and does not change a 403 into retries',async context=>{
  clock(context);const {sourceText}=await module();const calls=[];
  globalThis.__renderThrottleFetch=async url=>{calls.push(url);return new Response('denied',{status:url.includes('limited')?429:url.includes('forbidden')?403:200});};
  limited(await outcome(sourceText('https://limited.example.test/data')));
  assert.equal(await sourceText('https://separate.example.test/data'),'denied');
  assert.equal((await outcome(sourceText('https://forbidden.example.test/data'))).error.sourceStatus,403);
  context.mock.timers.tick(120000);await tick();assert.equal(calls.length,3);
});

test('API rate-limit errors have a legacy-compatible HTTP marker and bounded Retry-After without diagnostics',async context=>{
  const {createWebsite}=await import('../apps/web/server/site.ts');
  const qa=path.resolve(fileURLToPath(new URL('../artifacts/web-qa/',import.meta.url)));await mkdir(qa,{recursive:true});const directory=await mkdtemp(path.join(qa,'render-throttle-'));
  context.after(async()=>{assert.ok(path.resolve(directory).startsWith(qa+path.sep));await rm(directory,{recursive:true,force:true});});await writeFile(path.join(directory,'index.html'),'fixture');
  const handle=await createWebsite({directory,origin:'https://anitrack.example.test',environment:{},sourceFetch:fetch});
  for(const [retryAfter,expected] of [[95,95],[0,60],[undefined,60],[Infinity,60],[9000000,86400],[1.2,2]]){
    globalThis.__renderThrottleRpc=async()=>{throw Object.assign(Error('private URL https://secret.test/?token=hidden'),{sourceStatus:429,retryAfter});};
    const response=await handle(new Request('https://anitrack.example.test/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'fixture',args:[]})}));
    assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),String(expected));const body=await response.text();assert.match(body,/HTTP 429/);assert.doesNotMatch(body,/secret|token|private/);
  }
});
