import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import {once} from 'node:events';
import ts from 'typescript';

registerHooks({
  resolve(specifier,context,next){if(specifier==='electron')return {url:'native-media-test:electron',shortCircuit:true};try{return next(specifier,context);}catch(error){if(/^\.{1,2}\//.test(specifier)&&! /\.[a-z0-9]+$/i.test(specifier))return next(specifier+'.ts',context);throw error;}},
  load(url,context,next){if(url==='native-media-test:electron')return {format:'module',shortCircuit:true,source:'export const session={fromPartition(){throw Error("Unexpected default session factory");}}'};if(url.includes('/apps/source-service/')&&url.endsWith('.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText};return next(url,context);},
});
const {NativeMediaTransport}=await import('../apps/source-service/native-media.ts');
const url='https://cdn.example.test/media/first.m3u8?token=fixture';
const signal=()=>new AbortController().signal;
const code=(expected,status)=>error=>error.code===expected&&(status===undefined||error.status===status);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){for(let i=0;i<1000&&!check();i++)await new Promise(resolve=>setTimeout(resolve,2));assert.ok(check());}

function fixture(options={}){
  let answers=[{address:'8.8.8.8',family:4}],fetcher=options.fetch??(async()=>new Response('media'));
  const state={partitions:[],proxies:[],lookups:[],connects:[],fetches:[],closed:0,cleared:0};
  const native={
    async setProxy(config){state.proxies.push(config);if(options.proxyFailure)throw Error('private proxy setup diagnostic');if(options.proxyWait)await options.proxyWait;},
    async closeAllConnections(){state.closed++;},async clearStorageData(){state.cleared++;},
    setPermissionCheckHandler(handler){state.checkPermission=handler;},setPermissionRequestHandler(handler){state.requestPermission=handler;},
    webRequest:{onBeforeRequest(_filter,handler){state.filter=handler;}},
    async fetch(input,init){state.fetches.push({input,init});return fetcher(input,init,state);},
  };
  const transport=new NativeMediaTransport({
    createSession:partition=>{state.partitions.push(partition);return native;},
    lookup:async host=>{state.lookups.push(host);return options.lookup?await options.lookup(host):answers;},
    connect:destination=>{state.connects.push(destination);if(!options.connect)throw Error('Unexpected outgoing socket');return options.connect(destination);},
    ...Object.fromEntries(['maxRequests','maxTunnels','lookupTimeoutMs','connectTimeoutMs','idleTimeoutMs','leaseTimeoutMs'].filter(key=>options[key]!==undefined).map(key=>[key,options[key]])),
  });
  return {transport,state,setAnswers:value=>{answers=value;},setFetch:value=>{fetcher=value;}};
}
const proxyPort=state=>Number(/https=127\.0\.0\.1:(\d+)/.exec(state.proxies[0].proxyRules)[1]);
const allowed=(state,requested,method='GET')=>{let answer;state.filter({url:requested,method},value=>{answer=!value.cancel;});return answer;};
async function connectProxy(port,authority,head=Buffer.alloc(0)){
  const socket=net.connect({host:'127.0.0.1',port});
  return await new Promise((resolve,reject)=>{
    let bytes=Buffer.alloc(0),settled=false;
    const fail=()=>{if(!settled){settled=true;socket.destroy();reject(Error('CONNECT denied'));}};
    socket.setTimeout(1500,fail);socket.once('error',fail);socket.once('close',fail);
    socket.once('connect',()=>socket.write(Buffer.concat([Buffer.from(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`),head])));
    const receive=chunk=>{bytes=Buffer.concat([bytes,chunk]);const end=bytes.indexOf('\r\n\r\n');if(end<0)return;settled=true;socket.removeListener('data',receive);socket.removeListener('error',fail);socket.removeListener('close',fail);socket.setTimeout(0);if(!bytes.subarray(0,end).toString().startsWith('HTTP/1.1 200')){socket.destroy();reject(Error('CONNECT denied'));}else resolve({socket,head:bytes.subarray(end+4)});};
    socket.on('data',receive);
  });
}
async function echoServer(t){
  const sockets=new Set(),server=net.createServer(socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('data',chunk=>socket.write(chunk));socket.once('close',()=>sockets.delete(socket));});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));});
  return server.address().port;
}

test('A private session leases only the current exact HTTPS GET, preserves authorized headers, and releases after body consumption',async t=>{
  const f=fixture();t.after(()=>f.transport.close());
  const response=await f.transport.fetch(url,new Headers({Referer:'https://anichan.to/',Cookie:'source-scoped=fixture',Range:'bytes=0-9','Proxy-Authorization':'must-strip',Host:'must-strip'}),signal());
  assert.match(f.state.partitions[0],/^source-media-/);assert.ok(!f.state.partitions[0].startsWith('persist:'));
  assert.equal(f.state.proxies[0].mode,'fixed_servers');assert.equal(f.state.proxies[0].proxyBypassRules,'<-loopback>');assert.match(f.state.proxies[0].proxyRules,/^http=127\.0\.0\.1:\d+;https=127\.0\.0\.1:\d+$/);
  assert.equal(f.state.checkPermission(),false);let permission;f.state.requestPermission(null,'media',value=>{permission=value;});assert.equal(permission,false);
  assert.equal(allowed(f.state,url),true);for(const denied of ['http://cdn.example.test/media','file:///private','https://cdn.example.test/media/other.m3u8','https://other.example.test/'])assert.equal(allowed(f.state,denied),false);assert.equal(allowed(f.state,url,'POST'),false);
  const init=f.state.fetches[0].init;assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert.equal(init.bypassCustomProtocolHandlers,true);assert.equal(init.headers.get('Range'),'bytes=0-9');assert.equal(init.headers.get('Cookie'),'source-scoped=fixture');assert.equal(init.headers.get('Referer'),'https://anichan.to/');assert.equal(init.headers.get('Accept-Encoding'),'identity');assert.equal(init.headers.has('proxy-authorization'),false);assert.equal(init.headers.has('host'),false);
  assert.equal(await response.text(),'media');assert.equal(allowed(f.state,url),false);
});

test('Every DNS answer is checked; malformed, private, mapped and mixed answers stop before Chromium or sockets',async t=>{
  const f=fixture();t.after(()=>f.transport.close());
  for(const bad of ['http://cdn.example.test/a','file:///private','https://user:password@cdn.example.test/a','https://cdn.example.test:444/a','https://cdn.example.test/a#fragment','https://127.0.0.1/a','https://2130706433/a','https://[::1]/a'])await assert.rejects(f.transport.fetch(bad,new Headers(),signal()),code('INVALID_MEDIA_DESTINATION',502));
  for(const answers of [[],[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}],[{address:'::ffff:8.8.8.8',family:6}],[{address:'8.8.8.8',family:6}],[{address:'2001:db8::1',family:6}]]){f.setAnswers(answers);await assert.rejects(f.transport.fetch(url,new Headers(),signal()),code('INVALID_MEDIA_DESTINATION',502));}
  assert.equal(f.state.partitions.length,0);assert.equal(f.state.fetches.length,0);assert.equal(f.state.connects.length,0);
});

test('The CONNECT proxy pins a literal public address and forwards opaque browser TLS bytes unchanged, including head bytes',async t=>{
  const echo=await echoServer(t),hello=Buffer.from([22,3,1,0,7,1,2,3,4,5,6,7]);
  const f=fixture({connect:()=>net.connect({host:'127.0.0.1',port:echo}),fetch:async(input,_init,state)=>{
    const connection=await connectProxy(proxyPort(state),new URL(input).hostname+':443',hello);
    const returned=connection.head.length?connection.head:(await once(connection.socket,'data'))[0];assert.deepEqual(returned,hello);connection.socket.destroy();return new Response('video');
  }});t.after(()=>f.transport.close());
  f.setAnswers([{address:'2606:4700:4700::1111',family:6},{address:'8.8.8.8',family:4}]);
  assert.equal(await(await f.transport.fetch(url,new Headers(),signal())).text(),'video');
  assert.deepEqual(f.state.connects,[{host:'8.8.8.8',family:4,port:443}]);
});

test('Unknown CONNECT authorities, alternate ports and plain HTTP never reach an upstream socket',async t=>{
  let stream;const f=fixture({fetch:async()=>new Response(new ReadableStream({start(controller){stream=controller;controller.enqueue(new Uint8Array([1]));}}))});t.after(()=>f.transport.close());
  const response=await f.transport.fetch(url,new Headers(),signal()),port=proxyPort(f.state);
  for(const authority of ['unknown.example.test:443','cdn.example.test:80','127.0.0.1:443','cdn.example.test:443/path','user@cdn.example.test:443'])await assert.rejects(connectProxy(port,authority),/CONNECT denied/);
  const status=await new Promise((resolve,reject)=>{const req=http.get({host:'127.0.0.1',port,path:'http://169.254.169.254/'},res=>{res.resume();resolve(res.statusCode);});req.once('error',reject);});
  assert.equal(status,403);assert.equal(f.state.connects.length,0);await response.body.cancel();assert.equal(allowed(f.state,url),false);
});

test('Redirects reject without following; 403/429 return their status without fallback or another request',async t=>{
  const f=fixture();t.after(()=>f.transport.close());
  for(const status of [301,302,307,308]){f.setFetch(async()=>new Response(null,{status,headers:{Location:'https://other.example.test/private'}}));await assert.rejects(f.transport.fetch(url,new Headers(),signal()),code('NATIVE_MEDIA_REDIRECT',502));}
  for(const status of [403,429]){let cancelled=false;f.setFetch(async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{status,headers:{'set-cookie':'private=fixture'}}));const before=f.state.fetches.length,response=await f.transport.fetch(url,new Headers(),signal());assert.equal(response.status,status);assert.equal(cancelled,true);assert.equal(response.headers.has('set-cookie'),false);assert.equal(f.state.fetches.length,before+1);assert.equal(allowed(f.state,url),false);}
});

test('A fresh request resolves DNS again and cannot reuse a lease after DNS changes to a private address',async t=>{
  const f=fixture();t.after(()=>f.transport.close());await(await f.transport.fetch(url,new Headers(),signal())).text();
  f.setAnswers([{address:'10.0.0.1',family:4}]);await assert.rejects(f.transport.fetch(url,new Headers(),signal()),code('INVALID_MEDIA_DESTINATION',502));assert.equal(f.state.fetches.length,1);assert.equal(f.state.lookups.length,2);await assert.rejects(connectProxy(proxyPort(f.state),'cdn.example.test:443'));
});

test('A followed redirect or unexpected final response URL fails even if a fetch implementation ignores redirect:error',async t=>{
  const f=fixture();t.after(()=>f.transport.close());
  for(const [finalUrl,redirected] of [['https://other.example.test/private',false],[url,true]]){
    f.setFetch(async()=>{const response=new Response('must-not-deliver');Object.defineProperty(response,'url',{value:finalUrl});Object.defineProperty(response,'redirected',{value:redirected});return response;});
    const before=f.state.fetches.length;await assert.rejects(f.transport.fetch(url,new Headers(),signal()),code('NATIVE_MEDIA_REDIRECT',502));assert.equal(f.state.fetches.length,before+1);assert.equal(allowed(f.state,url),false);
  }
});

test('Cancellation before headers releases the lease immediately and cancels a late body',async t=>{
  let reply,cancelled=false;const f=fixture({fetch:()=>new Promise(resolve=>{reply=resolve;})});t.after(()=>f.transport.close());
  const control=new AbortController(),pending=f.transport.fetch(url,new Headers(),control.signal);await until(()=>f.state.fetches.length===1);control.abort();await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(allowed(f.state,url),false);
  reply(new Response(new ReadableStream({cancel(){cancelled=true;}})));await flush();assert.equal(cancelled,true);
});

test('A caller can cancel while the shared proxy is still initializing, without issuing a media request',async t=>{
  let release;const proxyWait=new Promise(resolve=>{release=resolve;}),f=fixture({proxyWait,connectTimeoutMs:1000});t.after(()=>f.transport.close());
  const control=new AbortController(),pending=f.transport.fetch(url,new Headers(),control.signal);await until(()=>f.state.proxies.length===1);control.abort();
  let timer;try{
    const outcome=await Promise.race([pending.then(()=> 'delivered',error=>error.name),new Promise(resolve=>{timer=setTimeout(()=>resolve('delayed'),100);})]);
    assert.equal(outcome,'AbortError');assert.equal(f.state.fetches.length,0);
  }finally{clearTimeout(timer);release();await pending.catch(()=>{});}
});

test('Cancelling or expiring an active body rejects its reader and frees request capacity',async t=>{
  let cancelled=0;const f=fixture({maxRequests:1,leaseTimeoutMs:100,fetch:async()=>new Response(new ReadableStream({cancel(){cancelled++;}}))});t.after(()=>f.transport.close());
  const control=new AbortController(),response=await f.transport.fetch(url,new Headers(),control.signal);
  await assert.rejects(f.transport.fetch(url,new Headers(),signal()),code('NATIVE_MEDIA_BUSY',503));const reading=response.text();control.abort();await assert.rejects(reading,error=>error.name==='AbortError');assert.equal(cancelled,1);assert.equal(allowed(f.state,url),false);
  const expired=await f.transport.fetch(url,new Headers(),signal());await assert.rejects(expired.text(),error=>error.name==='AbortError');assert.equal(cancelled,2);
});

test('DNS and CONNECT stalls are bounded and never trigger a second address or transport',async t=>{
  const slow=fixture({lookup:()=>new Promise(()=>{}),lookupTimeoutMs:30});t.after(()=>slow.transport.close());await assert.rejects(slow.transport.fetch(url,new Headers(),signal()),code('INVALID_MEDIA_DESTINATION',502));assert.equal(slow.state.partitions.length,0);
  const f=fixture({connect:()=>new net.Socket(),connectTimeoutMs:30,fetch:async()=>new Response(new ReadableStream())});t.after(()=>f.transport.close());
  const response=await f.transport.fetch(url,new Headers(),signal());await assert.rejects(connectProxy(proxyPort(f.state),'cdn.example.test:443'));assert.equal(f.state.connects.length,1);await response.body.cancel();
});

test('The tunnel count is bounded and closing the transport destroys active resources and rejects future calls',async t=>{
  const echo=await echoServer(t),f=fixture({maxTunnels:1,connect:()=>net.connect({host:'127.0.0.1',port:echo}),fetch:async()=>new Response(new ReadableStream())});t.after(()=>f.transport.close());
  const response=await f.transport.fetch(url,new Headers(),signal()),port=proxyPort(f.state),first=await connectProxy(port,'cdn.example.test:443');await assert.rejects(connectProxy(port,'cdn.example.test:443'));assert.equal(f.state.connects.length,1);
  const closed=once(first.socket,'close');await f.transport.close();await closed;await assert.rejects(response.text(),error=>error.name==='AbortError');assert.equal(f.state.cleared,1);await assert.rejects(f.transport.fetch(url,new Headers(),signal()),code('NATIVE_MEDIA_CLOSED',503));await assert.rejects(connectProxy(port,'cdn.example.test:443'));
});
