import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {mkdir,mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

registerHooks({
  resolve(specifier,context,next){
    if(context.parentURL?.endsWith('/apps/web/server/site.ts')&&specifier==='../lib/gateway')return {url:'render-site-test:gateway',shortCircuit:true};
    if(context.parentURL?.endsWith('/apps/web/server/site.ts')&&specifier==='./runtime')return {url:'render-site-test:runtime',shortCircuit:true};
    return next(specifier,context);
  },
  load(url,context,next){
    if(url==='render-site-test:gateway')return {format:'module',shortCircuit:true,source:'export const rpc=(...args)=>globalThis.__renderGateway.rpc(...args);export const mediaResponse=(request)=>globalThis.__renderGateway.media(request);export const pageImage=(request)=>globalThis.__renderGateway.page(request);export const archiveMedia=(request)=>globalThis.__renderGateway.archive(request);'};
    if(url==='render-site-test:runtime')return {format:'module',shortCircuit:true,source:'export function configureRuntime(settings,transport){globalThis.__renderRuntime={settings,transport};}'};
    if(url.endsWith('/apps/web/server/site.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText};
    return next(url,context);
  },
});
const {createWebsite}=await import('../apps/web/server/site.ts');
const qa=path.resolve(fileURLToPath(new URL('../artifacts/web-qa/',import.meta.url))),origin='https://anitrack.example.test';
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const req=(route,init={})=>new Request(origin+route,init);
const rpcRequest=(body={operation:'fixture',args:[]},init={})=>req('/api/rpc',{method:'POST',...init,headers:{'Content-Type':'application/json',...init.headers},body:typeof body==='string'?body:JSON.stringify(body)});
async function fixture(context,overrides={}){
  await mkdir(qa,{recursive:true});const directory=await mkdtemp(path.join(qa,'render-site-')),publicDir=path.join(directory,'public');
  context.after(async()=>{const resolved=path.resolve(directory);assert.ok(resolved.startsWith(qa+path.sep));await rm(resolved,{recursive:true,force:true});});
  await mkdir(path.join(publicDir,'assets'),{recursive:true});
  await writeFile(path.join(publicDir,'index.html'),'<!doctype html><title>AniTrack fixture</title>');
  await writeFile(path.join(publicDir,'assets','main.js'),'abcdef');
  await writeFile(path.join(publicDir,'space name.txt'),'spaced asset');
  await writeFile(path.join(publicDir,'empty.txt'),'');
  await writeFile(path.join(publicDir,'.secret.json'),'private');
  await writeFile(path.join(publicDir,'assets','main.js.map'),'private source map');
  await writeFile(path.join(directory,'outside.txt'),'outside build');
  const calls=[];
  globalThis.__renderGateway={rpc:async(...args)=>{calls.push(args);return {ok:true};},media:async()=>new Response('media'),page:async()=>new Response('page'),archive:async()=>new Response('archive'),...overrides};
  const environment={ANITRACK_SOURCE_SERVICE_KEY:'fixture_only_not_a_real_key'},transport=async()=>new Response('internal');
  const handle=await createWebsite({directory:publicDir,origin,environment,sourceFetch:transport});
  return {handle,calls,directory,publicDir,environment,transport};
}

test('The website serves only mapped build files, decoded asset names, and normal HEAD responses',async context=>{
  const f=await fixture(context);
  const index=await f.handle(req('/'));assert.equal(index.status,200);assert.match(await index.text(),/AniTrack fixture/);assert.equal(index.headers.get('cache-control'),'no-cache');
  const asset=await f.handle(req('/assets/main.js?cache=bust'));assert.equal(await asset.text(),'abcdef');assert.equal(asset.headers.get('cache-control'),'public, max-age=31536000, immutable');assert.equal(asset.headers.get('x-content-type-options'),'nosniff');
  const spaced=await f.handle(req('/space%20name.txt'));assert.equal(await spaced.text(),'spaced asset');
  const head=await f.handle(req('/assets/main.js',{method:'HEAD'}));assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),'6');assert.equal(await head.text(),'');
  assert.equal(globalThis.__renderRuntime.settings,f.environment);assert.equal(globalThis.__renderRuntime.transport,f.transport);
});

test('Expired account responses preserve the 401 signal without exposing credentials or provider diagnostics',async context=>{
  const f=await fixture(context,{rpc:async()=>{throw Object.assign(new Error('private account diagnostics'),{sourceStatus:401});}});
  const response=await f.handle(rpcRequest()),value=await response.text();assert.equal(response.status,401);assert.match(value,/401/);assert.doesNotMatch(value,/private account/);
});

test('Hidden files, source maps, traversal, private endpoints and unsupported methods cannot become a SPA response',async context=>{
  const f=await fixture(context);
  for(const route of ['/.secret.json','/assets/main.js.map','/../outside.txt','/%2e%2e/outside.txt','/assets%2f..%2foutside.txt','/assets%5c..%5coutside.txt','/%00','/%ZZ','/v1/rpc','/operator/app.js','/unknown'])assert.equal((await f.handle(req(route))).status,404,route);
  assert.equal((await f.handle(req('/',{method:'POST'}))).status,404);
  assert.equal((await f.handle(req('/api/rpc'))).status,404);assert.equal((await f.handle(req('/api/unknown'))).status,404);
  assert.equal((await f.handle(new Request('https://other.example.test/'))).status,403);
});

test('Symlinked directories are not indexed as public build contents',async context=>{
  const f=await fixture(context),outside=path.join(f.directory,'outside');await mkdir(outside);await writeFile(path.join(outside,'secret.txt'),'not public');
  try{await symlink(outside,path.join(f.publicDir,'linked'),'junction');}catch(error){if(error.code==='EPERM'){context.skip('This Windows account cannot create a test junction.');return;}throw error;}
  const handle=await createWebsite({directory:f.publicDir,origin,environment:{},sourceFetch:fetch});assert.equal((await handle(req('/linked/secret.txt'))).status,404);
});

test('Static byte ranges preserve exact bytes and reject invalid, overflowing and empty-file ranges',async context=>{
  const f=await fixture(context);
  for(const [range,bytes,contentRange] of [['bytes=1-3','bcd','bytes 1-3/6'],['bytes=3-','def','bytes 3-5/6'],['bytes=-2','ef','bytes 4-5/6'],['bytes=0-999','abcdef','bytes 0-5/6']]){
    const response=await f.handle(req('/assets/main.js',{headers:{Range:range}}));assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),contentRange);assert.equal(await response.text(),bytes);
  }
  for(const range of ['bytes=9-','bytes=4-2','bytes=-0','bytes=','bytes=0-1,3-4','bytes=0-9007199254740992','bytes=-9007199254740992']){
    const response=await f.handle(req('/assets/main.js',{headers:{Range:range}}));assert.equal(response.status,416,range);assert.equal(response.headers.get('content-range'),'bytes */6');
  }
  assert.equal((await f.handle(req('/empty.txt',{headers:{Range:'bytes=0-'}}))).status,416);
  const head=await f.handle(req('/assets/main.js',{method:'HEAD',headers:{Range:'bytes=2-4'}}));assert.equal(head.status,206);assert.equal(head.headers.get('content-length'),'3');assert.equal(await head.text(),'');
});

test('All public API routes reject foreign origins and cross-site requests without exposing CORS grants',async context=>{
  let media=0;const f=await fixture(context,{media:async()=>{media++;return new Response('bytes',{headers:{'Access-Control-Allow-Origin':'*'}});}});
  for(const route of ['/api/media','/api/page','/api/archive']){
    assert.equal((await f.handle(req(route,{headers:{Origin:'https://foreign.example.test'}}))).status,403);
    assert.equal((await f.handle(req(route,{headers:{'Sec-Fetch-Site':'cross-site'}}))).status,403);
  }
  assert.equal((await f.handle(rpcRequest(undefined,{headers:{Origin:'null'}}))).status,403);assert.equal(f.calls.length,0);assert.equal(media,0);
  const accepted=await f.handle(req('/api/media',{headers:{Origin:origin}}));assert.equal(await accepted.text(),'bytes');assert.equal(accepted.headers.has('access-control-allow-origin'),false);
});

test('RPC accepts only bounded JSON objects and never calls a gateway on invalid bodies',async context=>{
  const f=await fixture(context);
  for(const body of ['not json',null,[],{}, {operation:'fixture',args:[],extra:true},{operation:'',args:[]},{operation:'x'.repeat(121),args:[]},{operation:'fixture',args:Array(9).fill(null)}])assert.equal((await f.handle(rpcRequest(body))).status,400);
  assert.equal((await f.handle(rpcRequest({}, {headers:{'Content-Type':'text/plain'}}))).status,415);
  assert.equal((await f.handle(rpcRequest('x'.repeat(65537)))).status,413);assert.equal(f.calls.length,0);
  const valid=await f.handle(rpcRequest());assert.equal(valid.status,200);assert.deepEqual(await valid.json(),{value:{ok:true}});assert.equal(f.calls.length,1);
});

test('RPC streaming size and cancellation stop before the source and cancel the body producer',async context=>{
  const f=await fixture(context);let cancelled=0;
  const huge=new ReadableStream({start(c){c.enqueue(new Uint8Array(65537));},cancel(){cancelled++;}});
  const response=await f.handle(req('/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:huge,duplex:'half'}));assert.equal(response.status,413);assert.equal(cancelled,1);
  const controller=new AbortController(),stalled=new ReadableStream({cancel(){cancelled++;}});
  const pending=f.handle(req('/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:stalled,duplex:'half',signal:controller.signal}));await tick();controller.abort();assert.equal((await pending).status,499);await tick();assert.equal(f.calls.length,0);assert.equal(cancelled,2);
});

test('Slow RPC bodies have a bounded deadline and return their admission slot',async context=>{
  context.mock.timers.enable({apis:['setTimeout']});const f=await fixture(context);let cancelled=0;
  const stalled=new ReadableStream({cancel(){cancelled++;}});
  const pending=f.handle(req('/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:stalled,duplex:'half'}));await tick();context.mock.timers.tick(10001);
  assert.equal((await pending).status,408);assert.equal(cancelled,1);assert.equal(f.calls.length,0);
  const valid=await f.handle(rpcRequest());assert.equal(valid.status,200);await valid.body.cancel();
});

test('API admission is retained through unread and partially read media bodies, without prefetch',async context=>{
  let reads=0,cancels=0;const bytes=Uint8Array.from({length:131089},(_,i)=>i%251);
  const f=await fixture(context,{media:async()=>new Response(new ReadableStream({pull(c){reads++;c.enqueue(bytes);},cancel(){cancels++;}},{highWaterMark:0}))});
  const held=[];for(let i=0;i<8;i++)held.push(await f.handle(req('/api/media')));
  assert.equal(reads,0);assert.equal((await f.handle(req('/api/media'))).status,429);
  const reader=held[0].body.getReader(),first=await reader.read();assert.equal(first.value.length,65536);assert.equal(first.value.buffer.byteLength,65536);assert.equal(reads,1);
  assert.equal((await f.handle(req('/api/media'))).status,429);await reader.cancel();assert.equal(cancels,1);
  const next=await f.handle(req('/api/media'));assert.equal(next.status,200);await next.body.cancel();for(const response of held.slice(1))await response.body.cancel();
});

test('Eight unread RPC envelopes also hold their slots until consumed',async context=>{
  const f=await fixture(context),held=[];for(let i=0;i<8;i++)held.push(await f.handle(rpcRequest()));
  assert.equal((await f.handle(rpcRequest())).status,429);await held[0].json();
  const next=await f.handle(rpcRequest());assert.equal(next.status,200);await next.body.cancel();for(const response of held.slice(1))await response.body.cancel();
});

test('Body errors and request aborts cancel upstream readers and release API admission',async context=>{
  let cancels=0;const f=await fixture(context,{media:async()=>new Response(new ReadableStream({cancel(){cancels++;}},{highWaterMark:0}))});
  const controller=new AbortController(),aborted=await f.handle(req('/api/media',{signal:controller.signal}));const read=aborted.body.getReader().read();controller.abort();await assert.rejects(read);assert.equal(cancels,1);
  globalThis.__renderGateway.media=async()=>new Response(new ReadableStream({pull(c){c.error(Error('broken body'));}},{highWaterMark:0}));
  const broken=await f.handle(req('/api/media'));await assert.rejects(broken.text());
  globalThis.__renderGateway.media=async()=>new Response('works');const recovered=await f.handle(req('/api/media'));assert.equal(await recovered.text(),'works');
});

test('An uninterruptible gateway keeps admission after caller cancellation until it truly settles',async context=>{
  const wait=deferred(),f=await fixture(context,{rpc:()=>wait.promise}),controllers=Array.from({length:8},()=>new AbortController());
  const pending=controllers.map(controller=>f.handle(rpcRequest(undefined,{signal:controller.signal})));await tick();controllers.forEach(controller=>controller.abort());
  for(const response of await Promise.all(pending))assert.equal(response.status,499);
  assert.equal((await f.handle(rpcRequest())).status,429);
  wait.resolve('finished');await tick();globalThis.__renderGateway.rpc=async()=>true;
  const recovered=await f.handle(rpcRequest());assert.equal(recovered.status,200);await recovered.body.cancel();
});

test('A transfer deadline cancels an unread media response and releases admission',async context=>{
  context.mock.timers.enable({apis:['setTimeout']});let cancelled=0;const f=await fixture(context,{media:async()=>new Response(new ReadableStream({cancel(){cancelled++;}},{highWaterMark:0}))});
  const response=await f.handle(req('/api/media'));context.mock.timers.tick(125001);await assert.rejects(response.text());assert.equal(cancelled,1);
  globalThis.__renderGateway.media=async()=>new Response('recovered');const recovered=await f.handle(req('/api/media'));assert.equal(await recovered.text(),'recovered');
});

test('Source denials preserve the player stop guard while unknown diagnostics stay private',async context=>{
  const f=await fixture(context,{rpc:async()=>{throw Error('PROVIDER_ACCESS_DENIED: private cookie https://secret.test');}});
  const denied=await f.handle(rpcRequest());assert.match((await denied.json()).error,/^PROVIDER_ACCESS_DENIED:/);
  globalThis.__renderGateway.rpc=async()=>{throw Object.assign(Error('private URL token'),{sourceStatus:429});};const busy=await f.handle(rpcRequest());assert.equal(busy.status,429);assert.doesNotMatch(await busy.text(),/private|token/);
  globalThis.__renderGateway.rpc=async()=>{throw Object.assign(Error('private URL token'),{sourceStatus:403});};const check=await f.handle(rpcRequest());assert.equal(check.status,403);assert.match(await check.text(),/website check/);
  globalThis.__renderGateway.rpc=async()=>{throw Error('private cookie secret');};const unknown=await f.handle(rpcRequest());assert.equal(unknown.status,502);assert.doesNotMatch(await unknown.text(),/private|cookie|secret/);
});

test('RPC output is bounded and already-aborted requests never call a source',async context=>{
  const f=await fixture(context,{rpc:async()=> 'x'.repeat(8*1024*1024)});assert.equal((await f.handle(rpcRequest())).status,502);
  const controller=new AbortController();controller.abort();assert.equal((await f.handle(rpcRequest(undefined,{signal:controller.signal}))).status,499);
});
