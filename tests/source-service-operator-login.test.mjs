import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
registerHooks({
  resolve(specifier,context,next){if(specifier==='electron')return {url:'operator-login-test:electron',shortCircuit:true};try{return next(specifier,context);}catch(error){if(/^\.{1,2}\//.test(specifier)&&! /\.[a-z0-9]+$/i.test(specifier))return next(specifier+'.ts',context);throw error;}},
  load(url,context,next){if(url==='operator-login-test:electron')return {format:'module',shortCircuit:true,source:'export class BrowserWindow {static getAllWindows(){return [];}}'};if(url.includes('/apps/source-service/')&&url.endsWith('.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText};return next(url,context);},
});
const {SourceOperator}=await import('../apps/source-service/operator.ts');
const origin='https://operator.example.test',key='Operator_fixture_'.repeat(3),cookieName='__Secure-anitrack_operator';
const basic=value=>'Basic '+Buffer.from('operator:'+value).toString('base64');
const request=(path='/operator',init={})=>new Request(origin+path,init);
const get=(path='/operator',cookie)=>request(path,{headers:cookie?{Cookie:cookie}:{}});
const login=(password=key,headers={},cookie)=>request('/operator/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify({password})});
const cookie=response=>response.headers.get('set-cookie')?.split(';')[0];
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}){
  let now=0,calls=0;const operator=new SourceOperator(key,origin,()=>new Set(),{anichan:async()=>{calls++;}},{now:()=>now,...options});
  return {operator,setNow:value=>{now=value;},calls:()=>calls};
}

test('Unauthenticated browser navigation renders a sign-in form without any HTTP Basic challenge',async()=>{
  const {operator}=fixture(),response=await operator.handle(get()),html=await response.text();
  assert.equal(response.status,401);assert.equal(response.headers.has('www-authenticate'),false);assert.match(response.headers.get('content-type'),/^text\/html/);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.match(html,/type="password"/);assert.match(html,/method="post"/);assert.match(html,/action="\/operator\/login"/);assert.match(html,/autocomplete="off"/);assert.doesNotMatch(html,/id="sources"|id="windows"/);assert.ok(!html.includes(key));
  const csp=response.headers.get('content-security-policy');for(const rule of ["default-src 'none'","script-src 'self'","style-src 'self'","frame-ancestors 'none'","form-action 'none'"])assert.ok(csp.includes(rule));
});

test('The dedicated sign-in assets are public, static, non-caching and contain no passwords or browser-storage code',async()=>{
  const {operator}=fixture();
  for(const path of ['/operator/sign-in.js','/operator/sign-in.css']){const response=await operator.handle(get(path)),body=await response.text();assert.equal(response.status,200);assert.equal(response.headers.has('www-authenticate'),false);assert.equal(response.headers.get('cache-control'),'no-store');assert.ok(!body.includes(key));assert.doesNotMatch(body,/localStorage|sessionStorage|console\.(?:log|debug)|document\.cookie/);if(path.endsWith('.js')){assert.doesNotThrow(()=>new Function(body));assert.match(body,/field\.value=''/);}}
  assert.equal((await operator.handle(get('/operator/app.js'))).status,401);
});

test('Correct form credentials issue only an opaque bounded secure cookie and allow the normal operator APIs',async()=>{
  const f=fixture(),response=await f.operator.handle(login()),body=await response.text(),session=cookie(response),flags=response.headers.get('set-cookie');
  assert.equal(response.status,200);assert.deepEqual(JSON.parse(body),{ok:true});assert.ok(!body.includes(key));assert.match(session,new RegExp('^'+cookieName+'=[A-Za-z0-9_-]{32}$'));assert.ok(!session.includes(key));
  for(const flag of ['Path=/operator','Max-Age=900','Secure','HttpOnly','SameSite=Strict'])assert.ok(flags.includes(flag));assert.doesNotMatch(flags,/Domain=/i);
  const page=await f.operator.handle(get('/operator',session));assert.equal(page.status,200);assert.match(await page.text(),/id="sources"/);
  assert.equal((await f.operator.handle(get('/operator/api/sources',session))).status,200);
  assert.equal((await f.operator.handle(request('/operator/api/connect',{method:'POST',headers:{Cookie:session,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({source:'anichan'})}))).status,202);await flush();assert.equal(f.calls(),1);
});

test('Wrong credentials never issue a cookie, reveal the key, or show an HTTP authentication challenge',async()=>{
  const {operator}=fixture(),wrong='Wrong_fixture_'.repeat(3),response=await operator.handle(login(wrong)),body=await response.text();
  assert.equal(response.status,401);assert.equal(response.headers.has('set-cookie'),false);assert.equal(response.headers.has('www-authenticate'),false);assert.ok(!body.includes(key));assert.ok(!body.includes(wrong));
  assert.equal((await operator.handle(get('/operator/api/windows'))).status,401);
});

test('Login requires an exact same-origin JSON POST and refuses cross-site requests even with the correct key',async()=>{
  const {operator}=fixture();
  for(const badOrigin of ['', 'null','https://other.example.test',origin+'/']){const response=await operator.handle(login(key,{Origin:badOrigin}));assert.equal(response.status,403);assert.equal(response.headers.has('set-cookie'),false);}
  const noOrigin=request('/operator/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:key})});assert.equal((await operator.handle(noOrigin)).status,403);
  assert.equal((await operator.handle(login(key,{'Sec-Fetch-Site':'cross-site'}))).status,403);
  assert.equal((await operator.handle(login(key,{'Content-Type':'application/x-www-form-urlencoded'}))).status,415);
  assert.equal((await operator.handle(get('/operator?password='+key))).status,401);assert.equal((await operator.handle(get('/operator/api/sources?token='+key))).status,401);
});

test('Login bodies and object shape are bounded before any credential is accepted',async()=>{
  const {operator}=fixture();
  for(const value of [null,[],{}, {password:123},{password:key,token:'extra'},{password:'x'.repeat(257)}])assert.equal((await operator.handle(request('/operator/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(value)}))).status,400);
  assert.equal((await operator.handle(request('/operator/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'not-json'}))).status,400);
  assert.equal((await operator.handle(login(key,{'Content-Length':'1025'}))).status,413);
  const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(1025));controller.close();}});
  assert.equal((await operator.handle(request('/operator/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:stream,duplex:'half'}))).status,413);
});

test('Sessions expire without sliding renewal, and expired records do not exhaust session capacity',async()=>{
  const f=fixture({sessionTtlMs:1000,maxSessions:1}),first=await f.operator.handle(login()),session=cookie(first);assert.match(first.headers.get('set-cookie'),/Max-Age=1/);
  f.setNow(500);assert.equal((await f.operator.handle(get('/operator/api/sources',session))).status,200);
  f.setNow(1000);assert.equal((await f.operator.handle(get('/operator/api/sources',session))).status,401);
  assert.equal((await f.operator.handle(login())).status,200);
});

test('The session registry stays capped and reauthentication rotates only the presented session',async()=>{
  const f=fixture({maxSessions:2}),first=cookie(await f.operator.handle(login())),second=cookie(await f.operator.handle(login()));assert.notEqual(first,second);
  const rejected=await f.operator.handle(login());assert.equal(rejected.status,503);assert.equal(rejected.headers.has('set-cookie'),false);
  assert.equal((await f.operator.handle(get('/operator',first))).status,200);assert.equal((await f.operator.handle(get('/operator',second))).status,200);
  const replacement=await f.operator.handle(login(key,{},first));assert.equal(replacement.status,200);assert.notEqual(cookie(replacement),first);assert.equal((await f.operator.handle(get('/operator',first))).status,401);assert.equal((await f.operator.handle(get('/operator',second))).status,200);
});

test('Wrong-key guesses share the existing cooldown while a known key can still authenticate',async()=>{
  const f=fixture();for(let i=0;i<10;i++)assert.equal((await f.operator.handle(login('wrong'))).status,401);assert.equal((await f.operator.handle(login('wrong'))).status,429);
  assert.equal((await f.operator.handle(get())).status,401);assert.equal((await f.operator.handle(get('/operator/sign-in.js'))).status,200);
  assert.equal((await f.operator.handle(login())).status,200);assert.equal((await f.operator.handle(request('/operator',{headers:{Authorization:basic(key)}}))).status,200);
  assert.equal((await f.operator.handle(login('wrong'))).status,429);f.setNow(60001);assert.equal((await f.operator.handle(login('wrong'))).status,401);
});

test('A cookie session cannot reset guesses against the longer-lived operator key',async()=>{
  const f=fixture(),session=cookie(await f.operator.handle(login()));
  for(let i=0;i<10;i++){assert.equal((await f.operator.handle(login('wrong'))).status,401);assert.equal((await f.operator.handle(get('/operator/api/sources',session))).status,200);}
  assert.equal((await f.operator.handle(login('wrong'))).status,429);
});

test('Cookie-authenticated mutations retain exact-origin checks and logout revokes only that cookie',async()=>{
  const f=fixture(),first=cookie(await f.operator.handle(login())),second=cookie(await f.operator.handle(login()));
  assert.equal((await f.operator.handle(request('/operator/api/connect',{method:'POST',headers:{Cookie:first,Origin:'https://other.example.test','Content-Type':'application/json'},body:JSON.stringify({source:'anichan'})}))).status,403);assert.equal(f.calls(),0);
  assert.equal((await f.operator.handle(request('/operator/logout',{method:'POST',headers:{Cookie:first}}))).status,403);
  const response=await f.operator.handle(request('/operator/logout',{method:'POST',headers:{Cookie:first,Origin:origin}}));assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/Max-Age=0/);assert.equal((await f.operator.handle(get('/operator',first))).status,401);assert.equal((await f.operator.handle(get('/operator',second))).status,200);
});

test('Basic-auth API callers remain compatible and authenticated scripts parse without exposing credentials',async()=>{
  const f=fixture(),headers={Authorization:basic(key)};
  assert.equal((await f.operator.handle(request('/operator/api/sources',{headers}))).status,200);
  assert.equal((await f.operator.handle(request('/operator/api/connect',{method:'POST',headers:{...headers,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({source:'anichan'})}))).status,202);
  const script=await(await f.operator.handle(request('/operator/app.js',{headers}))).text();assert.doesNotThrow(()=>new Function(script));assert.match(script,/location\.replace\('\/operator'\)/);assert.ok(!script.includes(key));
});

test('Duplicate, malformed or oversized session cookies never authenticate',async()=>{
  const f=fixture(),session=cookie(await f.operator.handle(login()));
  for(const invalid of [session+'; '+cookieName+'=duplicate',cookieName+'=%41'.repeat(32),cookieName+'=short','unrelated='+'x'.repeat(4097)])assert.equal((await f.operator.handle(get('/operator',invalid))).status,401);
  assert.equal((await f.operator.handle(get('/operator','unrelated=value; '+session))).status,200);
});

test('Slow login bodies have bounded concurrency and cancellation releases their slots',async()=>{
  const f=fixture(),controls=[],pending=[];
  for(let i=0;i<4;i++){const control=new AbortController();controls.push(control);pending.push(f.operator.handle(request('/operator/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:new ReadableStream(),duplex:'half',signal:control.signal})));}
  await flush();assert.equal((await f.operator.handle(login())).status,429);
  controls.forEach(control=>control.abort());assert.ok((await Promise.all(pending)).every(response=>response.status===400));assert.equal((await f.operator.handle(login())).status,200);
});
