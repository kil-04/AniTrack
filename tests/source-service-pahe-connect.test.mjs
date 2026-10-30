import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

function fixture(initialTitle='AnimePahe'){
  const state={base:'https://animepahe.test',title:initialTitle,windows:[],requests:[],responses:[],timers:new Map(),sequence:0,now:10000,autoLoad:true},app=new EventEmitter();
  class WebsiteWindow extends EventEmitter {
    dead=false;visible=false;url='';loads=0;reloads=0;loading=false;
    constructor(options){
      super();this.options=options;state.windows.push(this);const contents=new EventEmitter(),session=new EventEmitter();
      Object.assign(session,{setPermissionRequestHandler(){},setPermissionCheckHandler(){}});
      Object.assign(contents,{session,getURL:()=>this.url,isDestroyed:()=>this.dead,isLoadingMainFrame:()=>this.loading,setWindowOpenHandler(){},
        executeJavaScript:async()=>state.title,reloadIgnoringCache:()=>{this.reloads++;},
        executeJavaScriptInIsolatedWorld:async(_world,[script])=>{const data=JSON.parse(/^\/\* request \*\/ (.*)$/m.exec(script.code)[1]);state.requests.push({win:this,path:data.path});assert.ok(state.responses.length,'unexpected source request');return state.responses.shift();}});
      this.webContents=contents;
    }
    isDestroyed(){return this.dead;}isVisible(){return this.visible;}show(){this.visible=true;}hide(){this.visible=false;}focus(){}setTitle(){}setParentWindow(parent){this.parent=parent;}
    async loadURL(url){this.url=url;this.loads++;if(state.autoLoad)this.webContents.emit('did-finish-load');}
    close(){const event={defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};this.emit('close',event);if(!event.defaultPrevented)this.destroy();}
    destroy(){if(this.dead)return;this.dead=true;this.emit('closed');}
  }
  const config={animePaheEnabled:()=>true,assertAnimePaheEnabled(){},getPaheBaseUrl:()=>state.base,getManualPaheBaseUrl:()=>undefined,paheBaseUrl:()=>state.base,
    savePaheBaseUrl:value=>{state.base=value;},selectConfiguredPaheBase:value=>{const changed=state.base!==value;state.base=value;return changed;},paheRoute:(name,values={})=>name==='home'?'/':'/api?'+new URLSearchParams({name,...values})};
  function compile(relative,modules){const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL(relative,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,URL,URLSearchParams,Buffer,DOMException,console,Date:class extends Date{static now(){return state.now;}},require:name=>{assert.ok(Object.hasOwn(modules,name),name);return modules[name];},
      setTimeout:(fn,ms)=>{const timer={id:++state.sequence,unref(){}};state.timers.set(timer,{fn,ms});return timer;},clearTimeout:timer=>state.timers.delete(timer)});return exports;}
  const verification=compile('../apps/desktop/main/services/providers/animepahe-session.ts',{});
  const kwik={prefetchKwik(){},resetKwikForBaseChange(){},resolveKwik(){},syncPaheRuntimeConfig(){}};
  const provider=compile('../apps/desktop/main/services/providers/animepahe.ts',{electron:{app,BrowserWindow:WebsiteWindow},'./animepahe-session':verification,'./animepahe-config':config,'./animepahe-kwik':kwik,'../remote-config':{getRuntimeConfig:()=>({features:{animepaheStreaming:true},providers:{animepahe:{enabled:true,baseUrls:[state.base],selectors:{},streamHostFragments:[]}}})}});
  return {state,app,provider};
}
async function flush(){for(let n=0;n<16;n++)await Promise.resolve();}
function response(status=200,body='{"data":[]}',retryAfter){return {status,body,retryAfter};}

test('Human Finish preserves the exact verified Pahe document for the next provider read',async()=>{
  const {state,provider}=fixture();
  const connecting=provider.connectPahe(null);
  await flush();const win=state.windows[0];assert.ok(win);win.close();await connecting;
  assert.equal(win.dead,false,'Finish must preserve the verified window instead of destroying and resetting it');
  state.responses.push(response());assert.deepEqual(Array.from(await new provider.AnimePaheProvider().search('Bebop')),[]);
  assert.equal(state.windows.length,1);assert.equal(state.requests[0].win,win);assert.equal(win.loads,1);assert.equal(win.visible,false);win.destroy();
});

test('Explicit Connect reuses a retained challenge, stays pending through human completion, and deduplicates',async()=>{
  const {state,provider}=fixture('Just a moment...');provider.prewarm();await flush();const win=state.windows[0];
  assert.equal(win.visible,false);let finished=false;const first=provider.connectPahe(null);first.then(()=>{finished=true;});
  assert.equal(provider.connectPahe(null),first);await flush();assert.equal(finished,false);assert.equal(win.visible,true);assert.equal(state.windows.length,1);
  state.title='AnimePahe';win.webContents.emit('did-finish-load');await flush();assert.equal(finished,false);assert.equal(win.visible,true,'normal readiness must not dismiss an active human transaction');
  win.close();win.close();assert.equal(await first,true);assert.equal(win.dead,false);assert.equal(win.visible,false);assert.equal(win.loads,1);assert.equal(win.reloads,0);
  state.responses.push(response());await new provider.AnimePaheProvider().search('Bebop');assert.equal(state.requests[0].win,win);
  const second=provider.connectPahe(null);await flush();win.close();assert.equal(await second,true);assert.equal(state.windows.length,1);assert.equal(win.loads,1);win.destroy();
});

test('Unverified Finish fails without destroying, reloading, granting reads or orphaning its document',async()=>{
  const {state,provider}=fixture('Just a moment...');const first=provider.connectPahe(null);await flush();const win=state.windows[0];win.close();assert.equal(await first,false);
  assert.equal(win.dead,false);assert.equal(win.visible,true);assert.equal(win.listenerCount('close'),0);
  await assert.rejects(new provider.AnimePaheProvider().search('Bebop'),error=>error.code==='PAHE_SECURITY_CHECK');assert.equal(state.requests.length,0);
  const second=provider.connectPahe(null);await flush();assert.equal(state.windows.length,1);assert.equal(win.loads,1);assert.equal(win.reloads,0);
  state.title='AnimePahe';win.webContents.emit('did-finish-load');await flush();win.close();assert.equal(await second,true);win.destroy();
});

test('A fresh challenge title or loading document cannot finish using stale readiness',async()=>{
  for(const mode of ['challenge','loading','origin']){
    const {state,provider}=fixture();const pending=provider.connectPahe(null);await flush();const win=state.windows[0];
    if(mode==='challenge')state.title='Verify you are human';else if(mode==='loading')win.loading=true;else win.url='https://other.example.test/';
    win.close();assert.equal(await pending,false,mode);assert.equal(win.dead,false);assert.equal(state.requests.length,0);win.destroy();
  }
});

test('Rate limits block new and repeated Connect without source requests, navigation, or cooldown reset',async()=>{
  const {state,provider}=fixture();const first=provider.connectPahe(null);await flush();const win=state.windows[0];
  state.responses.push(response(429,'slow down','90'));
  await assert.rejects(new provider.AnimePaheProvider().search('Bebop'),error=>error.code==='PAHE_RATE_LIMITED');
  win.hide();await assert.rejects(provider.connectPahe(null),error=>error.code==='PAHE_RATE_LIMITED');assert.equal(win.visible,false);assert.equal(win.loads,1);assert.equal(win.reloads,0);assert.equal(state.requests.length,1);
  win.close();assert.equal(await first,false);await assert.rejects(provider.connectPahe(null),error=>error.code==='PAHE_RATE_LIMITED');
  state.now+=90001;const next=provider.connectPahe(null);await flush();win.close();assert.equal(await next,true);assert.equal(state.windows.length,1);win.destroy();
});

test('The desktop bootstrap deadline cannot destroy a human transaction; its own deadline preserves one blocked document',async()=>{
  const {state,provider}=fixture();state.autoLoad=false;const pending=provider.connectPahe(null);await flush();const win=state.windows[0];
  const bootstrap=[...state.timers].find(([,timer])=>timer.ms===30000);assert.ok(bootstrap);state.timers.delete(bootstrap[0]);bootstrap[1].fn();await flush();assert.equal(win.dead,false);assert.equal(win.visible,true);
  const manual=[...state.timers].find(([,timer])=>timer.ms===180000);assert.ok(manual);state.timers.delete(manual[0]);manual[1].fn();assert.equal(await pending,false);assert.equal(win.dead,false);
  await assert.rejects(new provider.AnimePaheProvider().search('Bebop'),error=>error.code==='PAHE_SECURITY_CHECK');assert.equal(state.windows.length,1);assert.equal(state.requests.length,0);
  const next=provider.connectPahe(null);state.autoLoad=true;win.webContents.emit('did-finish-load');await flush();win.close();assert.equal(await next,true);assert.equal(win.loads,1);win.destroy();
});

test('App quit removes the manual guard so native shutdown closes and resets normally',async()=>{
  const {state,app,provider}=fixture();const pending=provider.connectPahe(null);await flush();const win=state.windows[0];assert.equal(app.listenerCount('before-quit'),1);
  app.emit('before-quit');assert.equal(await pending,false);assert.equal(app.listenerCount('before-quit'),0);assert.equal(win.listenerCount('close'),0);win.close();assert.equal(win.dead,true);
});

test('Explicit destruction or changing the configured origin cancels pending Connect and cleans handlers',async()=>{
  for(const mode of ['destroy','base']){
    const {state,app,provider}=fixture();const pending=provider.connectPahe(null);await flush();const win=state.windows[0];
    if(mode==='destroy')win.destroy();else provider.setPaheBaseUrl('https://mirror.animepahe.test');
    assert.equal(await pending,false);assert.equal(win.dead,true);assert.equal(win.listenerCount('close'),0);assert.equal(app.listenerCount('before-quit'),0);assert.equal(state.windows.length,1);
  }
});

test('Idle reclamation is suspended during Connect, restored after Finish, and ordinary desktop closes still destroy',async()=>{
  const {state,provider}=fixture();provider.prewarm();await flush();const win=state.windows[0];assert.ok([...state.timers.values()].some(timer=>timer.ms===600000));
  const pending=provider.connectPahe(null);await flush();assert.equal([...state.timers.values()].some(timer=>timer.ms===600000),false);
  win.close();assert.equal(await pending,true);assert.equal([...state.timers.values()].filter(timer=>timer.ms===600000).length,1);assert.equal(win.dead,false);win.close();assert.equal(win.dead,true,'outside explicit Connect, desktop close behavior stays unchanged');
});
