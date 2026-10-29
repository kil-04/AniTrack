import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
registerHooks({
  resolve(specifier,context,next){if(specifier==='electron')return {url:'anitrack-mangaball-test:electron',shortCircuit:true};try{return next(specifier,context);}catch(error){if(/^\.{1,2}\//.test(specifier)&&! /\.[a-z0-9]+$/i.test(specifier))return next(specifier+'.ts',context);throw error;}},
  load(url,context,next){if(url==='anitrack-mangaball-test:electron')return {format:'module',shortCircuit:true,source:'export const app={}; export class BrowserWindow {}'};if((url.includes('/apps/source-service/')||url.endsWith('/verified-page-session.ts'))&&url.endsWith('.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText};return next(url,context);},
});
const {MangaBallImages}=await import('../apps/source-service/mangaball-images.ts');
const host='bulbasaur.poke-black-and-white.net',image=`https://${host}/chapter/page.png?source=fixture`;
const second='https://chikorita.red-and-blue.net/chapter/second.webp';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hJ0AAAAASUVORK5CYII=','base64');
const response=(status=200,type='image/png',body=png.toString('base64'))=>({status,headers:{'content-type':type,'set-cookie':'never-return-this'},body});
const code=(expected,status)=>error=>error.code===expected&&(status===undefined||error.status===status);
function fixture(options={}){
  let now=0,addresses=['8.8.8.8'],answer=response(),pending,connected=true;
  const state={created:[],connects:[],gets:[],closed:0,resolves:[]};
  const transport=new MangaBallImages({now:()=>now,resolveHost:async value=>{state.resolves.push(value);return addresses;},createSession:settings=>{
    state.created.push(settings);
    return {isConnected:()=>connected,connect:async(url,parent)=>{connected=true;state.connects.push({url,parent});if(options.connectError)throw Error('https://private.example/?cookie=secret');},get:async(...args)=>{state.gets.push(args);return pending?await pending:answer;},close:()=>{connected=false;state.closed++;}};
  }});
  return {transport,state,setConnected:value=>{connected=value;},setNow:value=>{now=value;},setAddresses:value=>{addresses=value;},setAnswer:value=>{answer=value;},setPending:value=>{pending=value;}};
}
const signal=()=>new AbortController().signal;
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('An idle-closed source window requires explicit Connect and cannot reopen during an image fetch',async()=>{
  const f=fixture();await f.transport.registerImages([{url:image}]);await f.transport.connect();f.setConnected(false);
  await assert.rejects(f.transport.fetch(image,signal()),code('SOURCE_VERIFICATION_REQUIRED',403));
  assert.equal(f.state.created.length,1);assert.equal(f.state.gets.length,0);assert.equal(f.transport.accessMode(image),'blocked');
  await f.transport.connect();await f.transport.fetch(image,signal());assert.equal(f.state.created.length,2);assert.equal(f.state.gets.length,1);f.transport.close();
});

test('Only exact, explicitly registered native MangaBall images can reach a browser session',async()=>{
  const f=fixture();
  for(const url of ['http://'+host+'/page.png','https://127.0.0.1/page.png','https://user:secret@'+host+'/page.png','https://'+host+':8443/page.png','https://'+host+'/page.png#fragment','https://other.poke-black-and-white.net/page.png','https://'+host+'.evil.example/page.png','blob:https://'+host+'/id'])await assert.rejects(f.transport.registerImages([{url}]),code('INVALID_PAGE_IMAGE'));
  await assert.rejects(f.transport.fetch(image,signal()),code('INVALID_PAGE_IMAGE',403));
  assert.equal(f.state.created.length,0);assert.equal(f.state.resolves.length,0);
  await f.transport.registerImages([{url:image},{url:second}]);
  assert.deepEqual([...f.transport.approvedOrigins()],[`https://${host}`,'https://chikorita.red-and-blue.net']);
  assert.equal(f.transport.accessMode(image),'public');assert.equal(f.state.created.length,0);
  await assert.rejects(f.transport.fetch(image,signal()),code('SOURCE_VERIFICATION_REQUIRED',403));assert.equal(f.state.created.length,0);
  assert.throws(()=>f.transport.accessMode(image+'&unregistered=1'),code('INVALID_PAGE_IMAGE',403));
  f.transport.close();
});

test('Registration and each manual connection/read reject empty, mixed or private DNS answers',async()=>{
  for(const addresses of [[],['127.0.0.1'],['8.8.8.8','10.0.0.1'],['::ffff:8.8.8.8'],['fc00::1']]){
    const f=fixture();f.setAddresses(addresses);await assert.rejects(f.transport.registerImages([{url:image}]),code('INVALID_MEDIA_DESTINATION'));assert.equal(f.state.created.length,0);assert.equal(f.transport.approvedOrigins().size,0);f.transport.close();
  }
  const f=fixture();await f.transport.registerImages([{url:image}]);f.setAddresses(['192.168.1.2']);
  await assert.rejects(f.transport.connect(),code('SOURCE_VERIFICATION_REQUIRED'));assert.equal(f.state.created.length,0);
  f.setAddresses(['8.8.8.8']);await f.transport.connect();f.setAddresses(['169.254.169.254']);
  await assert.rejects(f.transport.fetch(image,signal()),code('INVALID_MEDIA_DESTINATION'));assert.equal(f.state.gets.length,0);f.transport.close();
});

test('The named human Connect uses the last failed observed image and a private restricted source session',async()=>{
  const f=fixture();await f.transport.registerImages([{url:image},{url:second}]);
  assert.throws(()=>f.transport.stop(second,403),code('SOURCE_VERIFICATION_REQUIRED',403));assert.equal(f.state.created.length,0);
  const opening=f.transport.connect();assert.equal(f.transport.connect(),opening);await opening;
  assert.deepEqual(f.state.connects,[{url:second,parent:null}]);assert.equal(f.transport.accessMode(second),'verified');
  const settings=f.state.created[0];assert.equal(settings.origin,'https://chikorita.red-and-blue.net');assert.equal(settings.homePath,'/chapter/second.webp');assert.match(settings.partition,/^persist:source-mangaball-[0-9a-f]{16}$/);assert.equal(settings.maxBodyBytes,20*1024*1024);assert.deepEqual(settings.allowedResourceHosts,['chikorita.red-and-blue.net','challenges.cloudflare.com']);
  const result=await f.transport.fetch(second,signal());assert.equal(result.status,200);assert.equal(result.headers.get('set-cookie'),null);assert.equal(result.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await result.arrayBuffer()),png);
  assert.equal(f.state.gets.length,1);assert.equal(f.state.gets[0][0],second);assert.equal(f.state.gets[0][3],'base64');f.transport.close();
});

test('403 and 429 stop the host with no reload, fallback or automatic repeated image request',async()=>{
  for(const status of [403,429]){
    const f=fixture();await f.transport.registerImages([{url:image}]);await f.transport.connect();f.setAnswer(response(status));
    const expected=status===403?'SOURCE_VERIFICATION_REQUIRED':'SOURCE_RATE_LIMITED';await assert.rejects(f.transport.fetch(image,signal()),code(expected,status));
    assert.equal(f.transport.accessMode(image),'blocked');await assert.rejects(f.transport.fetch(image,signal()),code(expected,status));assert.equal(f.state.gets.length,1);assert.equal(f.state.connects.length,1);
    if(status===429){await assert.rejects(f.transport.connect(),code('SOURCE_RATE_LIMITED',429));f.setNow(60001);}
    f.setAnswer(response());await f.transport.connect();await (await f.transport.fetch(image,signal())).body.cancel();assert.equal(f.state.connects.length,2);assert.equal(f.state.gets.length,2);f.transport.close();
  }
});

test('Image validation rejects error documents, wrong signatures, redirects and malformed or oversized bodies',async()=>{
  const f=fixture();await f.transport.registerImages([{url:image}]);await f.transport.connect();
  for(const invalid of [response(200,'text/html',Buffer.from('<html>check</html>').toString('base64')),response(200,'image/png',Buffer.from('<html>check</html>').toString('base64')),response(200,'image/jpeg'),response(302),response(200,'image/png',null),response(200,'image/png','bad base64'),response(200,'image/png','A'.repeat(Math.ceil(20*1024*1024/3)*4+4)),response(200,'image/svg+xml',Buffer.from('<svg/>').toString('base64'))]){
    f.setAnswer(invalid);await assert.rejects(f.transport.fetch(image,signal()),code('INVALID_PAGE_IMAGE',502));
  }
  f.setAnswer({...response(),headers:{'content-type':'image/png','cf-mitigated':'challenge'}});await assert.rejects(f.transport.fetch(image,signal()),code('SOURCE_VERIFICATION_REQUIRED',403));f.transport.close();
});

test('Cancellation closes only the source session and retains its busy slot until the read settles',async()=>{
  const f=fixture();await f.transport.registerImages([{url:image}]);await f.transport.connect();
  let finish;f.setPending(new Promise(resolve=>{finish=resolve;}));const controller=new AbortController();
  const result=f.transport.fetch(image,controller.signal);await flush();assert.equal(f.state.gets.length,1);controller.abort(new Error('secret source URL'));
  await assert.rejects(result,error=>error.name==='AbortError'&&!error.message.includes('secret'));
  assert.equal(f.state.closed,1);await assert.rejects(f.transport.connect(),/SERVICE_BUSY/);
  finish(response());await flush();f.setPending(undefined);await f.transport.connect();await(await f.transport.fetch(image,signal())).body.cancel();f.transport.close();
});

test('The registry is bounded, expires old exact URLs, and closes sessions when no registered image remains',async()=>{
  const f=fixture();for(let batch=0;batch<4;batch++)await f.transport.registerImages(Array.from({length:1000},(_,index)=>({url:`https://${host}/${batch}/${index}.png`})));
  await assert.rejects(f.transport.registerImages(Array.from({length:100},(_,index)=>({url:`https://${host}/overflow/${index}.png`}))),code('SERVICE_BUSY',503));
  await f.transport.connect();f.setNow(2*60*60*1000+1);assert.equal(f.transport.approvedOrigins().size,0);assert.equal(f.state.closed,1);
  await assert.rejects(f.transport.fetch(`https://${host}/0/0.png`,signal()),code('INVALID_PAGE_IMAGE',403));
  await f.transport.registerImages([{url:image}]);assert.equal(f.transport.accessMode(image),'public');f.transport.close();assert.throws(()=>f.transport.approvedOrigins(),code('SERVICE_UNAVAILABLE',503));
});

test('Concurrent page reads serialize; a security stop prevents every queued network read',async()=>{
  const f=fixture();await f.transport.registerImages([{url:image}]);await f.transport.connect();
  let finish;f.setPending(new Promise(resolve=>{finish=resolve;}));
  const first=f.transport.fetch(image,signal()),secondRead=f.transport.fetch(image,signal());
  const firstFailed=assert.rejects(first,code('SOURCE_VERIFICATION_REQUIRED',403)),secondFailed=assert.rejects(secondRead,code('SOURCE_VERIFICATION_REQUIRED',403));
  await flush();assert.equal(f.state.gets.length,1);finish(response(403));await Promise.all([firstFailed,secondFailed]);assert.equal(f.state.gets.length,1);f.transport.close();
});

test('Cancelling a queued page does not close another active page session',async()=>{
  const f=fixture();await f.transport.registerImages([{url:image}]);await f.transport.connect();
  let finish;f.setPending(new Promise(resolve=>{finish=resolve;}));const first=f.transport.fetch(image,signal()),waiting=new AbortController();
  const secondRead=f.transport.fetch(image,waiting.signal);await flush();waiting.abort();await assert.rejects(secondRead,error=>error.name==='AbortError');assert.equal(f.state.closed,0);assert.equal(f.state.gets.length,1);
  finish(response());await(await first).body.cancel();await flush();assert.equal(f.state.gets.length,1);f.transport.close();
});

test('A failed connection exposes no site address or diagnostic and never enables image reads',async()=>{
  const f=fixture({connectError:true});await f.transport.registerImages([{url:image}]);await assert.rejects(f.transport.connect(),code('SOURCE_VERIFICATION_REQUIRED',403));
  assert.equal(f.state.closed,1);assert.equal(f.transport.accessMode(image),'public');await assert.rejects(f.transport.fetch(image,signal()),code('SOURCE_VERIFICATION_REQUIRED',403));assert.equal(f.state.gets.length,0);f.transport.close();
});
