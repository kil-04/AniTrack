import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import ts from 'typescript';
registerHooks({
  resolve(specifier,context,next){try{return next(specifier,context);}catch(error){if(/^\.{1,2}\//.test(specifier)&&! /\.[a-z0-9]+$/i.test(specifier))return next(specifier+'.ts',context);throw error;}},
  load(url,context,next){if((url.includes('/apps/web/server/')||url.includes('/apps/source-service/'))&&url.endsWith('.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText};return next(url,context);},
});
const {createServerFetch}=await import('../apps/web/server/network.ts');
const target='https://catalogue.example.test/api/items?q=one%20piece&page=2';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const errorCode=code=>error=>error.code===code;
function fixture(options={}){
  const state={lookups:[],requests:[],bodies:[],destroyed:0},answer=options.answers??[{address:'8.8.8.8',family:4}];
  const fetch=createServerFetch({
    timeoutMs:options.timeoutMs??30000,
    lookup:async host=>{state.lookups.push(host);return options.lookup?await options.lookup(host):answer;},
    request:(url,init,callback)=>{
      state.requests.push({url:url.href,init});
      const request=new EventEmitter();
      request.setTimeout=(_ms,handler)=>{state.idleTimeout=handler;};
      request.destroy=error=>{if(request.destroyed)return;request.destroyed=true;state.destroyed++;if(error)queueMicrotask(()=>request.emit('error',error));};
      request.end=body=>{state.bodies.push(body);if(options.noResponse)return;queueMicrotask(()=>{
        if(request.destroyed)return;
        if(options.error){request.emit('error',options.error);return;}
        const response=new PassThrough({highWaterMark:16384});state.response=response;
        response.statusCode=options.status??200;response.headers=options.headers??{'content-type':'application/json'};
        callback(response);if(!options.openBody)response.end(options.payload??'{"ok":true}');
      });};
      return request;
    },
  });
  return {fetch,state};
}
test('HTTPS requests preserve path/query/method/body and pin DNS without changing TLS identity',async()=>{
  const f=fixture({answers:[{address:'2606:4700:4700::1111',family:6},{address:'8.8.8.8',family:4}]});
  const response=await f.fetch(new URL(target),{method:'POST',body:'{"title":"雪"}',headers:{'Content-Type':'application/json',Authorization:'Bearer fixture',Host:'attacker.test','Content-Length':'999','Proxy-Authorization':'secret'}});
  assert.deepEqual(await response.json(),{ok:true});assert.equal(response.url,target);assert.deepEqual(f.state.lookups,['catalogue.example.test']);
  const {url,init}=f.state.requests[0];assert.equal(url,target);assert.equal(init.method,'POST');assert.equal(init.servername,'catalogue.example.test');assert.equal(init.rejectUnauthorized,true);assert.equal(init.agent,false);assert.equal(init.headers.authorization,'Bearer fixture');assert.equal(init.headers['accept-encoding'],'identity');assert.equal(init.headers['content-length'],String(Buffer.byteLength('{"title":"雪"}')));assert.equal(init.headers.host,undefined);assert.equal(init.headers['proxy-authorization'],undefined);assert.equal(init.headers['user-agent'],undefined);assert.equal(f.state.bodies[0].toString(),'{"title":"雪"}');
  const pinned=await new Promise((resolve,reject)=>init.lookup('different.test',{},(error,address,family)=>error?reject(error):resolve({address,family})));assert.deepEqual(pinned,{address:'8.8.8.8',family:4});
  const all=await new Promise(resolve=>init.lookup('different.test',{all:true},(_error,answers)=>resolve(answers)));assert.deepEqual(all,[{address:'8.8.8.8',family:4}]);
});
test('Restricted URLs and every mixed/private/reserved DNS answer fail before opening HTTPS',async()=>{
  for(const url of ['http://example.test','https://user:pass@example.test','https://example.test:8443/','https://example.test/#fragment','https://127.0.0.1/','https://[::ffff:8.8.8.8]/','https://[::1]/','file:///tmp/secret']){
    const f=fixture();await assert.rejects(f.fetch(url),errorCode('ERR_WEB_DESTINATION'));assert.equal(f.state.requests.length,0);
  }
  for(const answers of [[],[{address:'192.168.0.1',family:4}],[{address:'8.8.8.8',family:4},{address:'169.254.169.254',family:4}],[{address:'100.64.0.1',family:4}],[{address:'203.0.113.1',family:4}],[{address:'2001:db8::1',family:6}],[{address:'8.8.8.8',family:6}]]){
    const f=fixture({answers});await assert.rejects(f.fetch(target),errorCode('ERR_WEB_DESTINATION'));assert.equal(f.state.requests.length,0);
  }
});
test('Only GET/POST/PUT and bounded literal bodies are admitted; caller bytes are copied',async()=>{
  for(const init of [{method:'DELETE',body:'x'},{method:'PATCH',body:'x'},{method:'GET',body:'x'},{method:'POST',body:new URLSearchParams('x=y')},{method:'POST',body:'x'.repeat(65537)},{method:'POST',body:new Uint8Array(65537)},{method:'PUT',body:new Uint8Array(65537)}]){
    const f=fixture();await assert.rejects(f.fetch(target,init),errorCode('ERR_WEB_REQUEST'));assert.equal(f.state.lookups.length,0);
  }
  const f=fixture(),body=new Uint8Array([1,2,3]);const pending=f.fetch(target,{method:'post',body});body[0]=9;await(await pending).body.cancel();assert.deepEqual([...f.state.bodies[0]],[1,2,3]);
});
test('MyAnimeList progress PUT preserves its fixed endpoint, authorization and form bytes',async()=>{
  const f=fixture(),url='https://api.myanimelist.net/v2/anime/1/my_list_status',body='status=watching&num_watched_episodes=4&score=8';
  await(await f.fetch(url,{method:'PUT',body,headers:{Authorization:'Bearer fixture','Content-Type':'application/x-www-form-urlencoded'}})).body.cancel();
  const request=f.state.requests[0];assert.equal(request.url,url);assert.equal(request.init.method,'PUT');assert.equal(request.init.headers.authorization,'Bearer fixture');assert.equal(request.init.headers['content-type'],'application/x-www-form-urlencoded');assert.equal(f.state.bodies[0].toString(),body);
});
test('Redirects are returned without following even when follow is requested; response cookies are discarded',async()=>{
  const f=fixture({status:302,headers:{location:'https://127.0.0.1/private','set-cookie':['session=private'],'content-type':'text/plain','content-length':'3','accept-ranges':'bytes','content-range':'bytes 0-2/3'},payload:'abc'});
  const response=await f.fetch(target,{redirect:'follow'});assert.equal(response.status,302);assert.equal(response.redirected,false);assert.equal(response.headers.get('location'),'https://127.0.0.1/private');assert.equal(response.headers.has('set-cookie'),false);assert.equal(response.headers.get('content-range'),'bytes 0-2/3');assert.equal(await response.text(),'abc');assert.equal(f.state.requests.length,1);
});
test('An aborted or timed-out DNS lookup never becomes an outgoing request',async()=>{
  for(const mode of ['abort','timeout']){
    let finish;const f=fixture({timeoutMs:mode==='timeout'?15:1000,lookup:()=>new Promise(resolve=>{finish=resolve;})}),controller=new AbortController();
    const pending=f.fetch(target,{signal:controller.signal});if(mode==='abort')controller.abort('private reason');
    const keepAlive=setTimeout(()=>{},100);try{await assert.rejects(pending,errorCode(mode==='abort'?'ERR_WEB_ABORTED':'ERR_WEB_TIMEOUT'));}finally{clearTimeout(keepAlive);}
    finish([{address:'8.8.8.8',family:4}]);await flush();assert.equal(f.state.requests.length,0);
  }
});
test('Caller cancellation and total deadline interrupt a body after headers',async()=>{
  for(const mode of ['abort','timeout']){
    const f=fixture({openBody:true,timeoutMs:mode==='timeout'?15:1000}),controller=new AbortController(),response=await f.fetch(target,{signal:controller.signal}),reader=response.body.getReader();
    const pending=reader.read();if(mode==='abort')controller.abort('private reason');
    const keepAlive=setTimeout(()=>{},100);try{await assert.rejects(pending,errorCode(mode==='abort'?'ERR_WEB_ABORTED':'ERR_WEB_TIMEOUT'));}finally{clearTimeout(keepAlive);}
    assert.equal(f.state.response.destroyed,true);assert.equal(f.state.destroyed,1);
  }
});
test('Unread bodies do not flow eagerly and cancelling closes the owned transport',async()=>{
  const f=fixture({openBody:true}),response=await f.fetch(target);f.state.response.write(Buffer.alloc(32768));await flush();
  assert.ok(f.state.response.readableLength>0,'bytes remain under stream backpressure');await response.body.cancel();assert.equal(f.state.response.destroyed,true);assert.equal(f.state.destroyed,1);
});
test('Bodyless statuses remain valid and raw TLS/network diagnostics are not exposed',async()=>{
  const f=fixture({status:204});const response=await f.fetch(target);assert.equal(response.status,204);assert.equal(response.body,null);
  const failed=fixture({error:Error('Private TLS diagnostic and fixture secret')});await assert.rejects(failed.fetch(target),error=>{assert.equal(error.code,'ERR_WEB_NETWORK');assert.doesNotMatch(error.message,/private|secret|TLS/i);return true;});
  const broken=fixture({noResponse:true});const pending=broken.fetch(target);await flush();broken.state.idleTimeout();await assert.rejects(pending,errorCode('ERR_WEB_TIMEOUT'));
});
