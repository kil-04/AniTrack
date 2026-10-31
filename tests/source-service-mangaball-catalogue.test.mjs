import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
registerHooks({
  resolve(specifier,context,next){if(specifier==='electron')return {url:'mangaball-catalogue-test:electron',shortCircuit:true};try{return next(specifier,context);}catch(error){if(/^\.{1,2}\//.test(specifier)&&!/\.[a-z0-9]+$/i.test(specifier))return next(specifier+'.ts',context);throw error;}},
  load(url,context,next){if(url==='mangaball-catalogue-test:electron')return {format:'module',shortCircuit:true,source:"import {EventEmitter} from 'node:events';export const app=new EventEmitter();export class BrowserWindow {}"};if(url.includes('/apps/source-service/')&&url.endsWith('.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText};return next(url,context);},
});
const {MangaBallCatalogue}=await import('../apps/source-service/mangaball-catalogue.ts');
const origin='https://api.mangaball.com',api=origin+'/api/v1',id='685158ff702284f834178c9b';
const search=api+'/title/search-advanced?keyword=One%20Piece&page=1&limit=10&adult_mode=no_18';
const detail=api+'/title/detail/'+id;
const chapters=api+'/title/chapter-listing?title_id='+id+'&page=100&limit=100&group_by=flat&sort_order=asc&language=en&search=';
const latest=api+'/title/chapter-listing?title_id='+id+'&page=1&limit=10&group_by=flat&sort_order=desc&language=en&search=';
const pages=api+'/chapter-detail?chapter_id='+id+'&user_id=demo_user';
const body=JSON.stringify({data:[]}),answer=(over={})=>({status:200,body,headers:{'content-type':'application/json'},...over});
const code=(name,status)=>error=>error.code===name&&(status===undefined||error.status===status);
const flush=()=>new Promise(resolve=>setImmediate(resolve)),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(options={}){
  let now=0,addresses=['8.8.8.8'],readAnswer=answer(),pending;
  const state={windows:[],settings:[],loads:[],dns:[],reads:[],probes:[],documentBody:body,documentStatus:200,documentType:'application/json',documentChallenge:false};
  class WebsiteWindow extends EventEmitter {
    dead=false;visible=true;url='';title='';
    constructor(settings){
      super();state.windows.push(this);state.settings.push(settings);
      const session=new EventEmitter();session.webRequest={onBeforeRequest:fn=>{this.beforeRequest=fn;},onHeadersReceived:fn=>{this.headersReceived=fn;}};
      session.setPermissionCheckHandler=fn=>{state.permissionCheck=fn;};session.setPermissionRequestHandler=fn=>{state.permissionRequest=fn;};
      const contents=new EventEmitter();Object.assign(contents,{session,isDestroyed:()=>this.dead,getURL:()=>this.url,setAudioMuted:value=>{state.muted=value;},setWindowOpenHandler:fn=>{state.popup=fn;},executeJavaScriptInIsolatedWorld:async(world,scripts)=>{const text=scripts[0].code;if(text.includes('document.querySelector')){state.probes.push({world,text});return state.documentBody;}state.reads.push({world,text});return pending?await pending:readAnswer;}});this.webContents=contents;
    }
    async loadURL(url){this.url=url;state.loads.push(url);this.webContents.emit('did-start-navigation',{},url,false,true);this.headersReceived({url,resourceType:'mainFrame',statusCode:state.documentStatus,responseHeaders:{'Content-Type':[state.documentType],...(state.documentChallenge?{'cf-mitigated':['challenge']}:{}),...(state.documentLength?{'Content-Length':[String(state.documentLength)]}:{}),...(state.documentRetryAfter?{'Retry-After':[state.documentRetryAfter]}:{})}},()=>{});this.webContents.emit('did-finish-load');}
    close(){let prevented=false;this.emit('close',{preventDefault(){prevented=true;}});if(!prevented)this.destroy();}
    destroy(){if(this.dead)return;this.dead=true;this.emit('closed');}
    isDestroyed(){return this.dead;}isVisible(){return this.visible;}show(){this.visible=true;}hide(){this.visible=false;}focus(){}setTitle(value){this.title=value;}
    allows(url,method='GET',resourceType='xhr'){let result;this.beforeRequest({url,method,resourceType},value=>{result=!value.cancel;});return result;}
  }
  const catalogue=new MangaBallCatalogue({now:()=>now,resolveHost:async host=>{state.dns.push(host);return addresses;},createWindow:settings=>new WebsiteWindow(settings),...options});
  return {catalogue,state,setNow:value=>{now=value;},setAddresses:value=>{addresses=value;},setAnswer:value=>{readAnswer=value;},setPending:value=>{pending=value;},async connect(){const opening=catalogue.connect();await flush();state.windows.at(-1).close();await opening;}};
}

test('No catalogue request opens a browser; explicit Connect and human Finish are both required',async()=>{
  const f=fixture();try{
    assert.equal((await f.catalogue.fetch(search)).status,403);assert.equal(f.state.windows.length,0);assert.equal(f.state.dns.length,0);
    const opening=f.catalogue.connect();assert.equal(f.catalogue.connect(),opening);await flush();
    const win=f.state.windows[0];assert.equal(win.visible,true);assert.equal(f.state.probes.length,0);assert.equal((await f.catalogue.fetch(search)).status,403);assert.equal(f.state.windows.length,1);
    win.close();await opening;assert.equal(win.visible,false);assert.equal(f.state.probes.length,1);
    const response=await f.catalogue.fetch(search);assert.equal(response.status,200);assert.equal(await response.text(),body);assert.equal(f.state.loads.length,1);
    assert.deepEqual([...f.catalogue.approvedOrigins()],[origin]);
  }finally{f.catalogue.close();}
});

test('Only the canonical native GET routes and bounded query shapes reach the configured transport',async()=>{
  const f=fixture();try{
    for(const url of [search,detail,chapters,latest,pages])assert.equal((await f.catalogue.fetch(url)).status,403);
    const bad=[search.replace('One%20Piece','A'),search.replace('One%20Piece','One+Piece'),search+'&extra=1',search+'&page=1',search.replace('page=1','page=01'),search.replace('keyword=One%20Piece','keyword=%0AOne%20Piece'),search.replace('no_18','all'),search.replace('limit=10','limit=100'),detail+'?x=1',detail.replace(id,id.toUpperCase()),detail.replace('/title/detail/','/title/../title/detail/'),detail.replace('/title/detail/','/title/%64etail/'),chapters.replace('page=100','page=101'),chapters.replace('language=en','language=ja'),latest.replace('page=1','page=2'),pages.replace('demo_user','private_user'),pages+'&chapter_id='+id,api+'/account',origin+'/cdn-cgi/challenge',search+'#x',search.replace('https:','http:'),search.replace(origin,'https://user:pass@api.mangaball.com'),search.replace(origin,origin+':443'),search.replace(origin,origin+':8443'),search.replace(origin,'https://api.mangaball.com.evil.example')];
    for(const url of bad)await assert.rejects(f.catalogue.fetch(url),code('INVALID_SOURCE_REQUEST',400),url);
    for(const init of [{method:'POST'},{method:'get'},{body:'data'}])await assert.rejects(f.catalogue.fetch(search,init),code('INVALID_SOURCE_REQUEST',400));
    assert.equal(f.state.windows.length,0);assert.equal(f.state.dns.length,0);
  }finally{f.catalogue.close();}
});

test('Manual API windows preserve browser identity and allow only reviewed routes and normal challenge resources',async()=>{
  const f=fixture();try{
    const opening=f.catalogue.connect();await flush();const win=f.state.windows[0],settings=f.state.settings[0];
    assert.deepEqual(settings.webPreferences,{partition:'persist:source-mangaball-catalogue',nodeIntegration:false,contextIsolation:true,sandbox:true});assert.equal(f.state.muted,true);assert.equal(f.state.permissionCheck(),false);assert.deepEqual(f.state.popup(),{action:'deny'});
    assert.equal(win.allows(search,'GET','mainFrame'),true);assert.equal(win.allows(origin+'/cdn-cgi/challenge-platform/test','POST'),true);assert.equal(win.allows('https://challenges.cloudflare.com/turnstile/v0/api.js'),true);assert.equal(win.allows('data:image/png,local','GET','image'),true);
    for(const [url,method,type] of [['https://example.test/api','GET','xhr'],[api+'/account','GET','xhr'],[search,'POST','xhr'],['https://challenges.cloudflare.com/','GET','mainFrame'],['data:text/html,local','GET','mainFrame']])assert.equal(win.allows(url,method,type),false);
    win.close();await opening;
    assert.equal(win.allows('https://challenges.cloudflare.com/turnstile/v0/api.js'),false);assert.equal(win.allows(origin+'/cdn-cgi/challenge-platform/test','POST'),false);
    await f.catalogue.fetch(search,{headers:{Authorization:'private-token',Cookie:'private-cookie','User-Agent':'pretend-browser'},credentials:'include'});
    const script=f.state.reads[0].text;assert.match(script,/credentials:'same-origin'/);assert.match(script,/redirect:'error'/);assert.ok(!script.includes('private-token'));assert.ok(!script.includes('private-cookie'));assert.ok(!script.includes('pretend-browser'));assert.ok(!script.includes('User-Agent'));
  }finally{f.catalogue.close();}
});

test('A JSON API document needs neither an HTML title nor a second request, but must prove successful reviewed data',async()=>{
  for(const change of [{documentStatus:403},{documentType:'text/html'},{documentChallenge:true},{documentBody:'<html>check</html>'},{documentBody:'{"error":"denied","data":[]}'},{documentBody:'{"status":"error","data":[]}'},{documentBody:'{"data":{}}'}]){
    const f=fixture();try{Object.assign(f.state,change);const opening=f.catalogue.connect();await flush();f.state.windows[0].close();await assert.rejects(opening,code('SOURCE_VERIFICATION_REQUIRED',403));assert.equal((await f.catalogue.fetch(search)).status,403);assert.equal(f.state.reads.length,0);}finally{f.catalogue.close();}
  }
  const f=fixture();try{await f.connect();assert.ok(!f.state.probes[0].text.includes('document.title'));assert.equal(f.state.loads.length,1);assert.equal(f.state.reads.length,0);}finally{f.catalogue.close();}
});

test('Empty, mixed, private and mapped DNS answers stop Connect and every subsequent catalogue read',async()=>{
  for(const addresses of [[],['127.0.0.1'],['8.8.8.8','10.0.0.1'],['::ffff:8.8.8.8'],['fc00::1']]){
    const f=fixture();try{f.setAddresses(addresses);await assert.rejects(f.catalogue.connect(),code('INVALID_MEDIA_DESTINATION'));assert.equal(f.state.windows.length,0);}finally{f.catalogue.close();}
  }
  const f=fixture();try{await f.connect();f.setAddresses(['169.254.169.254']);await assert.rejects(f.catalogue.fetch(search),code('INVALID_MEDIA_DESTINATION'));assert.equal(f.state.reads.length,0);}finally{f.catalogue.close();}
});

test('A visible normal website challenge can finish on its same API document before human Finish grants readiness',async()=>{
  const f=fixture();try{f.state.documentStatus=403;f.state.documentType='text/html';f.state.documentChallenge=true;const opening=f.catalogue.connect();await flush();assert.equal(f.state.windows[0].visible,true);assert.equal(f.state.probes.length,0);assert.equal(f.state.reads.length,0);
    f.state.documentStatus=200;f.state.documentType='application/json';f.state.documentChallenge=false;await f.state.windows[0].loadURL(search);f.state.windows[0].close();await opening;assert.equal((await f.catalogue.fetch(search)).status,200);
  }finally{f.catalogue.close();}
});

test('Oversized declared connection documents stop before a DOM JSON copy, and connection 429 honors HTTP-date cooldown',async()=>{
  const tooLarge=fixture();try{tooLarge.state.documentLength=4*1024*1024+1;await assert.rejects(tooLarge.catalogue.connect(),code('SOURCE_VERIFICATION_REQUIRED',403));assert.equal(tooLarge.state.probes.length,0);assert.equal(tooLarge.state.reads.length,0);}finally{tooLarge.catalogue.close();}
  const limited=fixture();try{limited.state.documentStatus=429;limited.state.documentRetryAfter=new Date(180000).toUTCString();await assert.rejects(limited.catalogue.connect(),code('SOURCE_RATE_LIMITED',429));limited.setNow(179999);await assert.rejects(limited.catalogue.connect(),code('SOURCE_RATE_LIMITED',429));assert.equal(limited.state.loads.length,1);
    limited.setNow(180000);limited.state.documentStatus=200;limited.state.documentRetryAfter=undefined;await limited.connect();assert.equal(limited.state.loads.length,2);
  }finally{limited.catalogue.close();}
});

test('A 403 stops the selected browser transport and does not reload, reopen, retry or use ordinary HTTP',async()=>{
  const f=fixture();try{await f.connect();f.setAnswer(answer({status:403,body:null}));assert.equal((await f.catalogue.fetch(search)).status,403);assert.equal((await f.catalogue.fetch(search)).status,403);assert.equal(f.state.reads.length,1);assert.equal(f.state.loads.length,1);assert.equal(f.state.windows.length,1);
    f.setAnswer(answer());await f.connect();assert.equal(f.state.loads.length,2,'only the new explicit Connect can refresh a rejected document');assert.equal((await f.catalogue.fetch(search)).status,200);
  }finally{f.catalogue.close();}
});

test('A 429 honors Retry-After even for explicit Connect and never renews itself through a catalogue retry',async()=>{
  const f=fixture();try{await f.connect();f.setAnswer(answer({status:429,body:null,headers:{'content-type':'application/json','retry-after':'120'}}));assert.equal((await f.catalogue.fetch(search)).status,429);
    f.setNow(119999);await assert.rejects(f.catalogue.connect(),code('SOURCE_RATE_LIMITED',429));f.setNow(120000);assert.equal((await f.catalogue.fetch(search)).status,429);assert.equal(f.state.reads.length,1);
    f.setAnswer(answer());await f.connect();assert.equal((await f.catalogue.fetch(search)).status,200);assert.equal(f.state.reads.length,2);
  }finally{f.catalogue.close();}
});

test('Malformed, active, redirected, oversized and wrong-shape API results cannot become catalogue JSON',async()=>{
  const f=fixture();try{await f.connect();for(const invalid of [answer({status:0}),answer({status:302}),answer({body:null}),answer({body:'no-json'}),answer({headers:{'content-type':'text/html'}}),answer({body:'{"data":{}}'}),answer({body:'x'.repeat(4*1024*1024+1)})]){f.setAnswer(invalid);await assert.rejects(f.catalogue.fetch(search),code('INVALID_SERVICE_RESPONSE',502));}
    f.setAnswer(answer({body:JSON.stringify({data:{id,name:'Example'}})}));assert.equal((await f.catalogue.fetch(detail)).status,200);
    f.setAnswer(answer({body:JSON.stringify({data:{chapter:{pages:[]}}})}));assert.equal((await f.catalogue.fetch(pages)).status,200);
  }finally{f.catalogue.close();}
});

test('Cancelling a pending read closes only its window and retains its busy slot until that read settles',async()=>{
  const f=fixture();try{await f.connect();const ac=new AbortController();let settle;f.setPending(new Promise(resolve=>{settle=resolve;}));const reading=f.catalogue.fetch(search,{signal:ac.signal});await flush();ac.abort();await assert.rejects(reading,error=>error.name==='AbortError');assert.equal(f.state.windows[0].dead,true);await assert.rejects(f.catalogue.connect(),code('SERVICE_BUSY',503));settle(answer());await flush();f.setPending(undefined);await f.connect();assert.equal(f.state.windows.length,2);assert.equal((await f.catalogue.fetch(search)).status,200);}finally{f.catalogue.close();}
});

test('Verification timeout keeps the human document visible without granting readiness or making another request',async()=>{
  const f=fixture({verificationWaitMs:15});try{const opening=f.catalogue.connect();await Promise.all([assert.rejects(opening,code('SOURCE_VERIFICATION_REQUIRED',403)),sleep(25)]);assert.equal(f.state.windows[0].visible,true);assert.equal(f.state.windows[0].dead,false);assert.equal((await f.catalogue.fetch(search)).status,403);assert.equal(f.state.loads.length,1);await f.connect();assert.equal(f.state.windows.length,1);}finally{f.catalogue.close();}
});

test('Idle release closes only hidden inactive readers; a new request never reopens one silently',async()=>{
  const f=fixture({idleCloseMs:15});try{await f.connect();await sleep(25);assert.equal(f.state.windows[0].dead,true);assert.equal((await f.catalogue.fetch(search)).status,403);assert.equal(f.state.windows.length,1);await f.connect();assert.equal(f.state.windows.length,2);}finally{f.catalogue.close();}
});

test('Closing the transport rejects pending operations and cannot create another session',async()=>{
  const f=fixture();const opening=f.catalogue.connect();await flush();f.catalogue.close();await assert.rejects(opening,code('SOURCE_VERIFICATION_REQUIRED',403));assert.equal(f.state.windows[0].dead,true);await assert.rejects(f.catalogue.fetch(search),code('SERVICE_UNAVAILABLE',503));await assert.rejects(f.catalogue.connect(),code('SERVICE_UNAVAILABLE',503));
});

test('Native transport composition preserves the public default and rejects late or repeated replacement',()=>{
  const source=readFileSync(new URL('../apps/desktop/main/services/manga/sources.ts',import.meta.url),'utf8');
  const block=source.slice(source.indexOf('export type MangaBallCatalogueFetcher'),source.indexOf('const ballChapters'));
  const compiled=ts.transpileModule(block,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const native=()=>{},installed=()=>{};
  function load(){const module={exports:{}};const getter=new Function('SourceHttp','net','honestAgent','module','exports',compiled+';return ballHttp.fetcher;')(class{constructor(_label,_hosts,_spacing,fetcher){this.fetcher=fetcher;}},{fetch:native},()=>null,module,module.exports);return {getter,configure:module.exports.configureMangaBallCatalogueTransport};}
  const desktop=load();assert.equal(desktop.getter(),native);assert.throws(()=>desktop.configure(installed),/before its first request/);
  const service=load();service.configure(installed);assert.equal(service.getter(),installed);assert.throws(()=>service.configure(native),/configured once/);
  const invalid=load();assert.throws(()=>invalid.configure(null),/configured once/);assert.equal(invalid.getter(),native);
  assert.ok(!source.includes('source-mangaball-catalogue'));
});
