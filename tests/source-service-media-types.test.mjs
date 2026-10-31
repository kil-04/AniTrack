import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

registerHooks({
  resolve(specifier,context,next){try{return next(specifier,context);}catch(error){if(/^\.{1,2}\//.test(specifier)&&! /\.[a-z0-9]+$/i.test(specifier))return next(specifier+'.ts',context);throw error;}},
  load(url,context,next){if(url.includes('/apps/source-service/')&&url.endsWith('.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText};return next(url,context);},
});
const {AssetVault}=await import('../apps/source-service/assets.ts');
const origin='https://service.example.test';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function transportStream(packets=8){
  const bytes=new Uint8Array(packets*188);bytes.fill(0x66);
  for(let offset=0;offset<bytes.length;offset+=188){bytes[offset]=0x47;bytes[offset+1]=0x40;bytes[offset+2]=0x11;bytes[offset+3]=0x10;}
  return bytes;
}
function fixture(fetcher,kind='media',url='https://cdn.example.test/segment'){
  const vault=new AssetVault(),path=vault.register(url,kind,fetcher),id=path.split('/').at(-1);
  return {vault,path,id,request:init=>new Request(origin+path,init),respond:init=>vault.respond(id,new Request(origin+path,init))};
}
function chunksStream(chunks){
  let pulls=0,cancels=0,reason;
  const body=new ReadableStream({pull(controller){pulls++;if(chunks.length)controller.enqueue(chunks.shift());else controller.close();},cancel(value){cancels++;reason=value;}},{highWaterMark:0});
  return {body,pulls:()=>pulls,cancels:()=>cancels,reason:()=>reason};
}
function trackAbort(signal){
  let balance=0;const add=signal.addEventListener.bind(signal),remove=signal.removeEventListener.bind(signal);
  signal.addEventListener=(type,...rest)=>{if(type==='abort')balance++;return add(type,...rest);};
  signal.removeEventListener=(type,...rest)=>{if(type==='abort')balance--;return remove(type,...rest);};
  return ()=>balance;
}

test('Proven full MPEG-TS audio and video receive video/mp2t despite wrong upstream MIME labels',async()=>{
  const bytes=transportStream();
  for(const [name,type] of [['audio','application/javascript'],['video','image/png'],['audio-xml','application/xml'],['video-html','text/html; charset=utf-8'],['video-json','application/problem+json']]){
    const f=fixture(async()=>new Response(bytes,{headers:{'Content-Type':type,'Content-Length':String(bytes.byteLength),'Accept-Ranges':'bytes'}}),'media','https://cdn.example.test/'+name);
    const response=await f.respond();assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'video/mp2t');assert.equal(response.headers.get('content-length'),String(bytes.byteLength));assert.equal(response.headers.get('accept-ranges'),'bytes');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
  }
});

test('The bounded prefix spans tiny chunks and all bytes are replayed in their original order',async()=>{
  const bytes=transportStream(12),chunks=[...bytes.subarray(0,752)].map(value=>Uint8Array.of(value));chunks.push(bytes.subarray(752));
  const source=chunksStream(chunks),f=fixture(async()=>new Response(source.body,{headers:{'Content-Type':'text/javascript'}}));
  const response=await f.respond();assert.equal(source.pulls(),752);assert.equal(response.headers.get('content-type'),'video/mp2t');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);assert.equal(source.cancels(),0);assert.equal(source.body.locked,false);
});

test('One large source chunk is replayed whole and no later chunk is pulled until requested',async()=>{
  const first=transportStream(10000),last=transportStream(),source=chunksStream([first,last]),f=fixture(async()=>new Response(source.body,{headers:{'Content-Type':'application/javascript'}}));
  const response=await f.respond();assert.equal(source.pulls(),1);await flush();assert.equal(source.pulls(),1);
  const reader=response.body.getReader();assert.deepEqual((await reader.read()).value,first);assert.equal(source.pulls(),1);assert.deepEqual((await reader.read()).value,last);assert.equal(source.pulls(),2);assert.equal((await reader.read()).done,true);reader.releaseLock();assert.equal(source.body.locked,false);
});

test('HTML, JavaScript, XML, SVG and JSON bodies never acquire a trusted media MIME type',async()=>{
  for(const [type,text] of [['text/html','<html>verification required</html>'],['application/javascript','function denied(){return "check";}'],['text/javascript','globalThis.denied=true;'],['application/ecmascript','alert("denied")'],['application/xml','<error>denied</error>'],['application/xhtml+xml','<html>denied</html>'],['image/svg+xml','<svg onload="alert(1)"/>'],['application/json','{"error":"denied"}']]){
    const source=chunksStream([new TextEncoder().encode(text)]),f=fixture(async()=>new Response(source.body,{headers:{'Content-Type':type}}));
    await assert.rejects(f.respond(),/INVALID_MEDIA/);assert.equal(source.cancels(),1);assert.equal(source.body.locked,false);
  }
});

test('Short, misaligned, corrupt and reserved-control TS prefixes do not normalize',async()=>{
  const badSync=transportStream();badSync[564]=0x46;
  const reserved=transportStream();reserved[3]=0;
  const leading=new Uint8Array(753);leading.set(transportStream(4),1);
  for(const bytes of [transportStream(3),transportStream(4).subarray(0,565),badSync,reserved,leading]){
    const f=fixture(async()=>new Response(bytes,{headers:{'Content-Type':'application/octet-stream'}})),response=await f.respond();assert.equal(response.headers.get('content-type'),'application/octet-stream');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
    await assert.rejects(fixture(async()=>new Response(bytes,{headers:{'Content-Type':'application/javascript'}})).respond(),/INVALID_MEDIA/);
  }
});

test('Range requests and partial or Content-Range responses are passed through without a prefix read',async()=>{
  const bytes=transportStream();
  for(const [status,requestHeaders,responseHeaders] of [[206,{Range:'bytes=0-1503'},{'Content-Range':'bytes 0-1503/3008'}],[200,{Range:'bytes=0-'},{}],[206,{},{}],[200,{}, {'Content-Range':'bytes 0-1503/3008'}]]){
    const source=chunksStream([bytes]);let receivedRange;
    const f=fixture(async(_url,_signal,range)=>{receivedRange=range;return new Response(source.body,{status,headers:{'Content-Type':'application/octet-stream','Accept-Ranges':'bytes',...responseHeaders}});});
    const response=await f.respond({headers:requestHeaders});assert.equal(source.pulls(),0);assert.equal(source.body.locked,false);assert.equal(response.status,status);assert.equal(response.headers.get('content-type'),'application/octet-stream');assert.equal(response.headers.get('content-range'),responseHeaders['Content-Range']??null);assert.equal(receivedRange,requestHeaders.Range??null);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
  }
  const blocked=chunksStream([bytes]);await assert.rejects(fixture(async()=>new Response(blocked.body,{status:206,headers:{'Content-Type':'application/javascript'}})).respond({headers:{Range:'bytes=0-'}}),/INVALID_MEDIA/);assert.equal(blocked.pulls(),0);assert.equal(blocked.cancels(),1);
});

test('Image and direct subtitle receipts never become transport streams',async()=>{
  for(const [kind,type] of [['image','image/png'],['subtitle','text/vtt']]){
    const bytes=transportStream(),source=chunksStream([bytes]),response=await fixture(async()=>new Response(source.body,{headers:{'Content-Type':type}}),kind).respond();assert.equal(source.pulls(),0);assert.equal(response.headers.get('content-type'),type);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
  }
});

test('HLS keys and subtitle leaves retain their context, ordering and bytes',async()=>{
  const bytes=transportStream(),sources=[];
  const master='#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=AES-128,URI="session.key"\n#EXT-X-MEDIA:GROUP-ID="subs",NAME="English",TYPE=SUBTITLES,URI="subs.m3u8"\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=100,SUBTITLES="subs",AUDIO="a"\nvideo.m3u8\n';
  const playlists={'/master.m3u8':master,'/subs.m3u8':'#EXTM3U\n#EXTINF:5,\nsubtitle.vtt\n','/audio.m3u8':'#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="segment.key"\n#EXTINF:5,\naudio.ts\n','/video.m3u8':'#EXTM3U\n#EXTINF:5,\nvideo.ts\n'};
  const fetcher=async url=>{const path=new URL(url).pathname;if(playlists[path])return new Response(playlists[path],{headers:{'Content-Type':'application/vnd.apple.mpegurl'}});const source=chunksStream([bytes]);sources.push({path,source});return new Response(source.body,{headers:{'Content-Type':path.endsWith('.vtt')?'text/vtt':'application/octet-stream'}});};
  const f=fixture(fetcher,'playlist','https://cdn.example.test/master.m3u8');
  async function read(path){return f.vault.respond(path.split('/').at(-1),new Request(origin+path));}
  const rewritten=await(await f.respond()).text(),children=[...rewritten.matchAll(/\/v1\/assets\/[A-Za-z0-9_-]{32}/g)].map(match=>match[0]);assert.equal(children.length,4);
  const key=await read(children[0]);assert.equal(key.headers.get('content-type'),'application/octet-stream');assert.equal(sources.at(-1).source.pulls(),0);assert.deepEqual(new Uint8Array(await key.arrayBuffer()),bytes);
  const subPlaylist=await(await read(children[1])).text(),subPath=subPlaylist.match(/\/v1\/assets\/[A-Za-z0-9_-]{32}/)[0],subtitle=await read(subPath);assert.equal(subtitle.headers.get('content-type'),'text/vtt');assert.equal(sources.at(-1).source.pulls(),0);assert.deepEqual(new Uint8Array(await subtitle.arrayBuffer()),bytes);
  const audioPlaylist=await(await read(children[2])).text(),audioPaths=[...audioPlaylist.matchAll(/\/v1\/assets\/[A-Za-z0-9_-]{32}/g)].map(match=>match[0]);
  const segmentKey=await read(audioPaths[0]);assert.equal(segmentKey.headers.get('content-type'),'application/octet-stream');assert.equal(sources.at(-1).source.pulls(),0);await segmentKey.body.cancel();
  const audio=await read(audioPaths[1]);assert.equal(audio.headers.get('content-type'),'video/mp2t');assert.deepEqual(new Uint8Array(await audio.arrayBuffer()),bytes);
  const videoPlaylist=await(await read(children[3])).text(),video=await read(videoPlaylist.match(/\/v1\/assets\/[A-Za-z0-9_-]{32}/)[0]);assert.equal(video.headers.get('content-type'),'video/mp2t');await video.body.cancel();
  assert.deepEqual(sources.map(row=>row.path),['/session.key','/subtitle.vtt','/segment.key','/audio.ts','/video.ts']);
});

test('Cancelling the replay cancels its upstream reader once and releases the reader and abort listener',async()=>{
  const source=chunksStream([transportStream(4),transportStream()]),f=fixture(async()=>new Response(source.body,{headers:{'Content-Type':'application/javascript'}})),request=f.request(),balance=trackAbort(request.signal),response=await f.vault.respond(f.id,request);
  assert.equal(balance(),1);assert.equal(source.pulls(),1);await response.body.cancel('viewer stopped');assert.equal(source.cancels(),1);assert.equal(source.reason(),'viewer stopped');assert.equal(source.body.locked,false);assert.equal(balance(),0);await flush();assert.equal(source.pulls(),1);
});

test('Request cancellation interrupts a pending prefix read without waiting for more bytes',async()=>{
  let pulls=0,cancelled=0;const source=new ReadableStream({pull(controller){if(++pulls===1)controller.enqueue(transportStream(1));},cancel(){cancelled++;}},{highWaterMark:0});
  const f=fixture(async()=>new Response(source,{headers:{'Content-Type':'application/javascript'}})),abort=new AbortController(),request=f.request({signal:abort.signal}),balance=trackAbort(request.signal),pending=f.vault.respond(f.id,request);
  await flush();assert.equal(pulls,2);abort.abort(new DOMException('Stopped by viewer','AbortError'));await assert.rejects(pending,{name:'AbortError'});assert.equal(cancelled,1);assert.equal(source.locked,false);assert.equal(balance(),0);
});

test('Request cancellation after the prefix interrupts a pending downstream read and frees resources',async()=>{
  let pulls=0,cancelled=0;const source=new ReadableStream({pull(controller){if(++pulls===1)controller.enqueue(transportStream(4));},cancel(){cancelled++;}},{highWaterMark:0});
  const f=fixture(async()=>new Response(source,{headers:{'Content-Type':'application/javascript'}})),abort=new AbortController(),request=f.request({signal:abort.signal}),balance=trackAbort(request.signal),response=await f.vault.respond(f.id,request),reader=response.body.getReader();
  assert.equal((await reader.read()).value.byteLength,752);const pending=reader.read();await flush();assert.equal(pulls,2);abort.abort(new DOMException('Stopped by viewer','AbortError'));await assert.rejects(pending,{name:'AbortError'});reader.releaseLock();assert.equal(cancelled,1);assert.equal(source.locked,false);assert.equal(balance(),0);
});

test('Upstream prefix errors and later stream errors release locks and abort listeners',async()=>{
  for(const afterPrefix of [false,true]){
    const failure=new Error('fixture stream failed');let pulls=0;
    const source=new ReadableStream({pull(controller){if(afterPrefix&&++pulls===1)controller.enqueue(transportStream(4));else controller.error(failure);}},{highWaterMark:0});
    const f=fixture(async()=>new Response(source,{headers:{'Content-Type':'application/javascript'}})),request=f.request(),balance=trackAbort(request.signal);
    if(afterPrefix){const response=await f.vault.respond(f.id,request);await assert.rejects(response.arrayBuffer(),error=>error===failure);}else await assert.rejects(f.vault.respond(f.id,request),error=>error===failure);
    assert.equal(source.locked,false);assert.equal(balance(),0);
  }
});

test('Normal completion releases its reader and abort listener without cancelling the source',async()=>{
  const bytes=transportStream(),source=chunksStream([bytes]),f=fixture(async()=>new Response(source.body,{headers:{'Content-Type':'application/javascript'}})),request=f.request(),balance=trackAbort(request.signal),response=await f.vault.respond(f.id,request);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);assert.equal(source.cancels(),0);assert.equal(source.body.locked,false);assert.equal(balance(),0);
});

test('Empty successful responses retain their status and type without creating a stream',async()=>{
  const response=await fixture(async()=>new Response(null,{status:204,headers:{'Content-Type':'video/mp4'}})).respond();assert.equal(response.status,204);assert.equal(response.headers.get('content-type'),'video/mp4');assert.equal(response.body,null);
});
