import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../apps/desktop/main/services/manga/comix-session.ts',import.meta.url),'utf8');
const protocolSource = readFileSync(new URL('../apps/desktop/main/services/manga/comix-protocol.ts',import.meta.url),'utf8');
const compile = input => ts.transpileModule(input,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const compiledSession = compile(source);
const compiledProtocol = compile(protocolSource);
const searchParams = () => ({keyword:'Fixture',page:1,limit:20,'order[relevance]':'desc'});
const transport = '/* fixture bundled transport */';
const connectionHelp = readFileSync(new URL('../apps/android/app/src/main/assets/comix_connection_help.js',import.meta.url),'utf8');
const smokeSource = readFileSync(new URL('../scripts/electron-comix-smoke.cjs',import.meta.url),'utf8');
const smokeRecoveryStart = smokeSource.indexOf('async function collectChapters(');
const smokeRecoveryEnd = smokeSource.indexOf('async function renderDecodedPage(',smokeRecoveryStart);
assert.ok(smokeRecoveryStart>0 && smokeRecoveryEnd>smokeRecoveryStart);

// Evaluate only the app-owned diagnostic's recovery helpers. No Electron,
// website JavaScript, installed profile, image requests or live network loads.
// The smoke script's paced chapter-traversal bound (see comix-protocol.ts).
const SMOKE_CHAPTER_DEADLINE_MS = Number(/const CHAPTER_DEADLINE_MS = ([0-9_]+);/.exec(smokeSource)[1].replace(/_/g,''));

function smokeRecovery(options={}) {
  const state={clock:1000,deadline:121000,calls:[],connects:0,arms:[],reports:[],counts:{chapterPages:0,chapters:0},continue:null};
  const checkDeadline=()=>{if(state.clock>=state.deadline)throw Object.assign(new Error('Fixture deadline'),{category:'deadline'});};
  const site={connect:()=>{
    state.connects++;
    return new Promise(resolve=>{state.continue=resolve;});
  }};
  const context=vm.createContext({Map,Number,Error,stage:'chapters',counts:state.counts,site,CHAPTER_DEADLINE_MS:SMOKE_CHAPTER_DEADLINE_MS,
    args:new Set(options.manual ? ['--manual-recovery'] : []),checkDeadline,
    armDeadline:milliseconds=>{state.arms.push(milliseconds);state.deadline=state.clock+milliseconds;},
    failure:category=>Object.assign(new Error('Fixture stopped'),{category}),
    report:(stage,details)=>state.reports.push({stage,...details}),
    read:async(path,params)=>{
      checkDeadline();
      state.calls.push({path,page:params.page,counts:{...state.counts}});
      const result=options.responses?.[state.calls.length-1];
      if(result instanceof Error)throw result;
      if(!result)throw new Error('Unexpected diagnostic read');
      state.clock+=result.delay || 0;
      checkDeadline();return result;
    },
  });
  vm.runInContext(smokeSource.slice(smokeRecoveryStart,smokeRecoveryEnd),context);
  return{state,run:()=>context.chaptersWithManualRecovery({id:'fixture'},payload=>payload.items,payload=>payload.meta.hasNext)};
}
const smokeChapterPage=(ids,page,last=page)=>({items:ids.map(id=>({id,number:1})),meta:{total:2,page,hasNext:page<last}});
const verificationError=()=>Object.assign(new Error('Private response omitted'),{verify:true});

function setup(options={}) {
  const state = {windows:[],timers:new Map(),clock:1000,normal:options.normal ?? true,initialized:options.initialized ?? true,
    starts:[],takes:0,cancels:0,scripts:[],responses:[],pendingEvaluations:[],sequence:0};
  class MockSession extends EventEmitter {
    constructor() {
      super();
      this.webRequest={onBeforeRequest:fn=>{this.before=fn;},onHeadersReceived:fn=>{this.headers=fn;}};
    }
    setPermissionRequestHandler(fn){this.permissionRequest=fn;}
    setPermissionCheckHandler(fn){this.permissionCheck=fn;}
  }
  class Contents extends EventEmitter {
    constructor(){super();this.session=new MockSession();this.url='https://comix.to/';}
    getURL(){return this.url;}
    setAudioMuted(value){this.muted=value;}
    setWindowOpenHandler(fn){this.popup=fn;}
    async executeJavaScript(code) {
      state.scripts.push(code);
      if(options.stall?.(code))return await new Promise(resolve=>state.pendingEvaluations.push(resolve));
      if(code===connectionHelp || code==="window.__anitrackComixConnectionHelp?.disable?.()")return undefined;
      if(code.includes('location.origin'))return state.normal;
      if(code===transport)return undefined;
      if(code==="typeof window.__anitrackComix === 'object'")return state.initialized;
      const start=code.match(/^window\.__anitrackComix\?\.start\((.*)\)$/s);
      if(start){const [id,path,params]=JSON.parse('['+start[1]+']');state.starts.push({id,path,params});return options.started ?? true;}
      if(code.startsWith('window.__anitrackComix?.take(')){state.takes++;return state.responses.length?state.responses.shift():null;}
      if(code.startsWith('window.__anitrackComix?.cancel(')){state.cancels++;return undefined;}
      throw Error('Unexpected reviewed session evaluation');
    }
  }
  class MockWindow extends EventEmitter {
    constructor(config){super();this.config=config;this.webContents=new Contents();this.destroyed=false;this.shows=0;this.focuses=0;this.hides=0;state.windows.push(this);}
    isDestroyed(){return this.destroyed;}
    show(){this.shows++;}
    focus(){this.focuses++;}
    hide(){this.hides++;}
    destroy(){if(this.destroyed)return;this.destroyed=true;this.emit('closed');}
    setMenu(menu){this.menu=menu;}
    async loadURL(url){this.loaded=url;this.webContents.url=url;if(options.loadReject)throw Error('private navigation detail');}
  }
  class ClockDate extends Date {static now(){return state.clock;}}
  const timers={
    setTimeout(fn,ms){const id=++state.sequence;state.timers.set(id,{fn,due:state.clock+ms});return id;},
    clearTimeout(id){state.timers.delete(id);}
  };
  const exports={};
  const protocolExports={};
  vm.runInNewContext(compiledProtocol,{exports:protocolExports,URL,Set,Map,Object,Number,Error});
  const context=vm.createContext({exports,require:name=>{
    if(name==='electron')return{app:{getAppPath:()=>'/fixture'},BrowserWindow:MockWindow,Menu:{buildFromTemplate:template=>template}};
    if(name==='./comix-protocol')return protocolExports;
    if(name==='node:crypto')return{randomUUID:()=>`fixture-${++state.sequence}`};
    if(name==='node:fs')return{readFileSync:path=>{
      if(options.missingAppAssets)throw Error('Fixture standalone app directory has no assets');
      return path.endsWith('comix_connection_help.js') ? connectionHelp : transport;
    }};
    if(name==='node:path')return{join:(...parts)=>parts.join('/')};
    throw Error('Unexpected native dependency '+name);
  },Buffer,URL,Date:ClockDate,...timers});
  vm.runInContext(compiledSession,context);
  const session=new exports.ComixSiteSession({script:options.script || (()=>transport),connectionHelp:options.connectionHelp});
  const advance=ms=>{
    state.clock+=ms;
    const due=[...state.timers.entries()].filter(([,timer])=>timer.due<=state.clock);
    for(const [id,timer]of due){state.timers.delete(id);timer.fn();}
  };
  return{session,state,advance,ErrorClass:exports.ComixSessionError};
}
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();await new Promise(setImmediate);};
async function connect(fixture){const promise=fixture.session.connect();fixture.state.windows.at(-1).webContents.emit('did-finish-load');await flush();assert.equal(await promise,true);return fixture.state.windows.at(-1);}
const envelope=value=>JSON.stringify({ok:true,value});

test('standalone desktop diagnostic can supply both bundled assets outside app.getAppPath',async()=>{
  const f=setup({missingAppAssets:true,connectionHelp:()=>connectionHelp});
  const win=await connect(f);
  assert.equal(win.destroyed,false);
  f.session.close();
});

test('a missing standalone connection helper cannot be counted as a connected session',async()=>{
  const f=setup({missingAppAssets:true});
  const pending=f.session.connect();
  f.state.windows.at(-1).webContents.emit('did-finish-load');
  await flush();
  assert.equal(await pending,false);
  f.session.close();
});

// Execute only our bundled DOM helper; the fixture has no website JS, app
// bridge, network, cookie/storage API, timers or verification callbacks.
function connectionHelpFixture(url='https://comix.to/title/eqr1e-overgeared',subframe=false) {
  const location=new URL(url),listeners=new Map(),elements=[];
  const window={
    addEventListener:(type,fn,capture)=>{assert.equal(type,'click');assert.equal(capture,true);listeners.set(fn,true);},
    removeEventListener:(type,fn,capture)=>{assert.equal(type,'click');assert.equal(capture,true);listeners.delete(fn);},
  };
  window.top=subframe ? {} : window;
  const document={body:{appendChild:node=>{elements.push(node);node.isConnected=true;}},
    createElement:name=>{assert.equal(name,'div');const attrs={};return{attrs,style:{},isConnected:false,
      setAttribute:(key,value)=>{attrs[key]=value;},remove(){this.isConnected=false;const i=elements.indexOf(this);if(i>=0)elements.splice(i,1);}};}};
  const context=vm.createContext({window,location,document,URL,Object,RegExp});
  const install=()=>vm.runInContext(connectionHelp,context);
  const click=(href,asText=false)=>{
    const anchor={getAttribute:key=>{assert.equal(key,'href');return href;}};
    const node={closest:selector=>{assert.equal(selector,'a[href]');return anchor;}};
    const state={prevented:0,stopped:0};
    const event={target:asText?{nodeType:3,parentElement:node}:node,
      preventDefault:()=>state.prevented++,stopImmediatePropagation:()=>state.stopped++};
    for(const fn of [...listeners.keys()])fn(event);
    return state;
  };
  return{window,location,listeners,elements,install,click};
}

test('bundled connection helper intercepts only known chapter anchors and points to AniTrack native reader',()=>{
  const f=connectionHelpFixture();assert.equal(f.install(),true);
  for(const href of ['/title/eqr1e-overgeared/11480837-chapter-343','https://comix.to/title/eqr1e-overgeared/11480837-chapter-343']) {
    assert.deepEqual(f.click(href,true),{prevented:1,stopped:1});
    assert.equal(f.elements.length,1);assert.equal(f.elements[0].attrs.role,'status');
    assert.equal(f.elements[0].textContent,'This window is for connecting Comix. Tap Continue to AniTrack above, then open the chapter in AniTrack.');
  }
  // A fresh SPA-rendered anchor is handled by the same delegated listener.
  f.location.pathname='/title/other-saga';
  assert.deepEqual(f.click('/title/other-saga/123-chapter-1.5'),{prevented:1,stopped:1});
  f.install();assert.equal(f.listeners.size,1);assert.equal(f.elements.length,0);
  assert.deepEqual(f.click('/title/other-saga/123-chapter-2'),{prevented:1,stopped:1});
  f.window.__anitrackComixConnectionHelp.disable();assert.equal(f.listeners.size,0);assert.equal(f.elements.length,0);
  assert.deepEqual(f.click('/title/other-saga/123-chapter-3'),{prevented:0,stopped:0});
});

test('connection helper fails closed on foreign, account, malformed and unknown links without changing navigation policy',()=>{
  const f=connectionHelpFixture();f.install();
  for(const href of ['/title/eqr1e-overgeared','/browse','/@waf/challenge','/account','/title/eqr1e/unknown',
    'https://other.example/title/eqr1e/1-chapter-1','http://comix.to/title/eqr1e/1-chapter-1',
    'https://user@comix.to/title/eqr1e/1-chapter-1','https://comix.to:8443/title/eqr1e/1-chapter-1',
    '/title/../title/eqr1e/1-chapter-1','/title/%65qr1e/1-chapter-1','//comix.to/title/eqr1e/1-chapter-1',
    '/title/eqr1e/1-chapter-1?secret=hidden','/title/eqr1e/1-chapter-1#other','javascript:alert(1)',
    '/title/eqr1e/1234567890123456-chapter-1','/title/eqr_1/1-chapter-1',null])
    assert.deepEqual(f.click(href),{prevented:0,stopped:0},String(href));
  assert.equal(f.elements.length,0);
  f.location.pathname='/@waf/challenge';
  assert.deepEqual(f.click('/title/eqr1e/1-chapter-1'),{prevented:0,stopped:0});
  for(const [url,subframe] of [['https://comix.to/@waf/challenge',false],['https://other.example/',false],['https://comix.to/',true]]) {
    const blocked=connectionHelpFixture(url,subframe);assert.equal(blocked.install(),false);assert.equal(blocked.listeners.size,0);
  }
});

test('desktop connection installs the bundled help only while visible and removes it before native reads',async()=>{
  const f=setup();const win=await connect(f);
  assert.equal(f.state.scripts.includes(connectionHelp),true);
  assert.equal(f.state.scripts.includes("window.__anitrackComixConnectionHelp?.disable?.()"),true);
  const installs=f.state.scripts.filter(code=>code===connectionHelp).length;
  win.webContents.emit('did-finish-load');await flush();
  assert.equal(f.state.scripts.filter(code=>code===connectionHelp).length,installs);
  f.session.close();
  const blocked=setup({normal:false});const pending=blocked.session.connect();const bad=blocked.state.windows[0];
  bad.webContents.url='https://comix.to/@waf/challenge';bad.webContents.emit('did-finish-load');await flush();
  assert.equal(blocked.state.scripts.includes(connectionHelp),false);blocked.session.close();assert.equal(await pending,false);
});

test('Comix connection is sandboxed, dedicated, and has no app/account/preload bridge',async()=>{
  const f=setup();const win=await connect(f);
  assert.deepEqual(JSON.parse(JSON.stringify(win.config.webPreferences)),{partition:'persist:comix',nodeIntegration:false,contextIsolation:true,sandbox:true});
  assert.equal(win.loaded,'https://comix.to/');assert.equal(win.webContents.muted,true);assert.equal(win.hides,1);
  assert.deepEqual(JSON.parse(JSON.stringify(win.webContents.popup())),{action:'deny'});
  assert.equal(win.webContents.session.permissionCheck(),false);
  let allowed=true;win.webContents.session.permissionRequest(null,'camera',value=>{allowed=value;});assert.equal(allowed,false);
  const before=win.webContents.session.before;
  for(const url of ['https://comix.to/api/v1/user','https://other.example/assets/script.js','https://comix.to/api/v1/auth/login']) {
    let cancelled=false;before({url,method:'GET',resourceType:'xhr'},value=>{cancelled=value.cancel;});assert.equal(cancelled,true);
  }
  let cancelled=true;before({url:'https://comix.to/api/v1/manga/sample',method:'GET',resourceType:'xhr'},value=>{cancelled=value.cancel;});assert.equal(cancelled,false);
  f.session.close();assert.equal(win.webContents.session.before,null);assert.equal(win.webContents.session.headers,null);
});

test('pending connection shares one window and homepage initialization; ready reconnect is a no-op',async()=>{
  const f=setup();const first=f.session.connect();const second=f.session.connect();assert.equal(first,second);assert.equal(f.state.windows.length,1);
  const win=f.state.windows[0];assert.equal(win.shows,1);assert.equal(win.focuses,1);
  win.webContents.emit('did-finish-load');await flush();assert.equal(await first,true);assert.equal(await f.session.connect(),true);assert.equal(f.state.windows.length,1);
  f.session.close();
});

test('verification page stays visible and sends no catalogue read until user completion',async()=>{
  const f=setup({normal:false});const promise=f.session.connect();const win=f.state.windows[0];win.webContents.emit('did-finish-load');await flush();
  assert.equal(win.hides,0);assert.equal(win.isDestroyed(),false);assert.equal(f.state.starts.length,0);assert.equal(f.state.scripts.includes(transport),false);
  await assert.rejects(f.session.read('/manga',searchParams()),error=>error.verify===true);
  win.webContents.session.headers({statusCode:403,url:'https://comix.to/api/v1/manga/sample/chapters'},()=>{});
  let cancelled=true;win.webContents.session.before({url:'https://comix.to/api/v1/manga/sample/chapters',method:'GET',resourceType:'xhr'},value=>{cancelled=value.cancel;});
  assert.equal(cancelled,false); // Visible site's ordinary retry after the user's own check is not a hidden native retry.
  f.state.normal=true;win.webContents.emit('did-finish-load');await flush();assert.equal(await promise,true);assert.equal(win.hides,1);f.session.close();
});

test('normal title navigation can return to root only through an explicit safe native menu action',async()=>{
  const f=setup({normal:false});const pending=f.session.connect();const win=f.state.windows[0];
  win.webContents.url='https://comix.to/title/xg6r1-berserk';win.webContents.emit('did-finish-load');await flush();
  assert.equal(win.hides,0);assert.equal(win.config.autoHideMenuBar,false);
  const continueItem=win.menu[0].submenu[0];assert.equal(continueItem.label,'Continue to AniTrack');
  continueItem.click();await flush();assert.equal(win.loaded,'https://comix.to/');assert.equal(win.hides,0); // Visible check is not dismissed.
  f.state.normal=true;continueItem.click();await flush();assert.equal(win.loaded,'https://comix.to/');
  assert.equal(await pending,true);assert.equal(win.hides,1);assert.equal(f.state.starts.length,0);f.session.close();
});

test('Continue never navigates from a challenge/account page or accepts a solved event as readiness',async()=>{
  const f=setup();const pending=f.session.connect();const win=f.state.windows[0];const continueItem=win.menu[0].submenu[0];
  for(const url of ['https://comix.to/@waf/challenge','https://comix.to/account','https://comix.to/title/id/chapter-1','https://other.example/']) {
    win.webContents.url=url;continueItem.click();await flush();assert.equal(win.hides,0);assert.equal(win.loaded,'https://comix.to/');
  }
  win.webContents.emit('waf-captcha-solved');await flush();assert.equal(win.hides,0);assert.equal(f.state.scripts.includes(transport),false);
  win.menu[0].submenu[1].click();await flush();assert.equal(await pending,false);assert.equal(win.isDestroyed(),true);
});

test('native security rejection leaves a fresh connection visible until the user chooses Continue',async()=>{
  for(const reject of [win=>win.webContents.session.headers({statusCode:403,url:'https://comix.to/api/v1/manga'},()=>{}),
    (win,f)=>{f.state.responses.push(JSON.stringify({ok:false,status:429,error:'Comix HTTP 429'}));return assert.rejects(f.session.read('/manga',searchParams()),error=>error.verify===true);}]) {
    const f=setup();const old=await connect(f);await reject(old,f);
    let nativeCancelled=false;old.webContents.session.before({url:'https://comix.to/api/v1/manga',method:'GET',resourceType:'xhr'},value=>{nativeCancelled=value.cancel;});assert.equal(nativeCancelled,true);
    const pending=f.session.connect();const win=f.state.windows.at(-1);
    win.webContents.emit('did-finish-load');await flush();assert.equal(win.hides,0);assert.equal(old.isDestroyed(),true);
    // A visible website API denial is not treated as a new native read/retry.
    win.webContents.session.headers({statusCode:403,url:'https://comix.to/api/v1/manga/sample/chapters'},()=>{});
    let cancelled=true;win.webContents.session.before({url:'https://comix.to/@waf/verify',method:'POST',resourceType:'xhr'},value=>{cancelled=value.cancel;});assert.equal(cancelled,false);
    win.menu[0].submenu[0].click();await flush();assert.equal(await pending,true);assert.equal(win.hides,1);
    assert.equal(await f.session.connect(),true);f.session.close();
  }
});

test('homepage readiness is probed again after transport initialization and after a modal closes in place',async()=>{
  const f=setup({normal:false});const pending=f.session.connect();const win=f.state.windows[0];win.webContents.emit('did-finish-load');await flush();
  f.state.normal=true;f.advance(501);await flush();assert.equal(await pending,true);assert.equal(win.hides,1);
  const probes=f.state.scripts.filter(code=>code.includes('script#initial-data'));
  assert.equal(probes.length>=3,true);assert.match(probes[0],/getBoundingClientRect/);assert.match(probes[0],/!Array\.isArray\(queries\)/);
  assert.match(probes[0],/security check/);assert.match(probes[0],/challenges\.cloudflare\.com/);f.session.close();
});

test('the actual readiness DOM probe rejects visible manual checks and malformed initial-data',async()=>{
  const f=setup({normal:false});const pending=f.session.connect();const win=f.state.windows[0];win.webContents.emit('did-finish-load');await flush();
  const probe=f.state.scripts.find(code=>code.includes('script#initial-data'));assert.ok(probe);
  const run=({title='Comix',body='',initial='{"queries":{}}',frames=[],path='/',search=''}={})=>vm.runInNewContext(probe,{
    location:{origin:'https://comix.to',pathname:path,search,hash:'',href:'https://comix.to'+path+search},URL,
    document:{title,body:{innerText:body},querySelector:()=>initial===null?null:{textContent:initial},querySelectorAll:()=>frames},
    getComputedStyle:frame=>frame.style||{display:'block',visibility:'visible'},
  });
  const frame=(src,shown=true)=>({src,getBoundingClientRect:()=>({width:shown?500:0,height:shown?400:0}),style:{display:'block',visibility:'visible'}});
  assert.equal(run(),true);
  for(const initial of [null,'','not json','{"queries":true}','{"queries":[]}','{"queries":null}','[]','{"queries":"yes"}'])assert.equal(run({initial}),false);
  for(const title of ['Security check','Just a moment...','Verify you are human'])assert.equal(run({title}),false);
  assert.equal(run({body:'Please enable JavaScript and cookies to continue'}),false);
  for(const path of ['/@waf/challenge','/cdn-cgi/challenge-platform/test','/title/id'])assert.equal(run({path}),false);
  assert.equal(run({search:'?other=1'}),false);
  assert.equal(run({frames:[frame('/@waf/challenge')]}),false);
  assert.equal(run({frames:[frame('https://challenges.cloudflare.com/turnstile/v0/a')]}),false);
  assert.equal(run({frames:[frame('/@waf/challenge',false)]}),true);
  assert.equal(run({frames:[{...frame('/@waf/challenge'),style:{display:'none',visibility:'visible'}}]}),true);
  assert.equal(run({frames:[frame('https://other.example/@waf/challenge')]}),true); // Foreign embeds are denied by network policy, not a readiness signal.
  f.session.close();assert.equal(await pending,false);
});

test('connection cancellation, navigation failure, transport failure and deadline close only owned window',async()=>{
  for(const options of [{},{loadReject:true},{initialized:false},{script:()=>{throw Error('secret');}},{script:()=> 'a'.repeat(128001)}]) {
    const f=setup(options);const promise=f.session.connect();const win=f.state.windows[0];
    if(!Object.keys(options).length)win.destroy();else win.webContents.emit('did-finish-load');
    await flush();assert.equal(await promise,false);assert.equal(win.isDestroyed(),true);assert.equal(f.state.starts.length,0);
  }
  const f=setup({normal:false});const promise=f.session.connect();f.advance(180001);await flush();assert.equal(await promise,false);assert.equal(f.state.windows[0].isDestroyed(),true);
});

test('only strict public operations reach bundled transport and each read is cancelled after completion',async()=>{
  const f=setup();await connect(f);
  for(const [path,params]of [['/manga',searchParams()],['/manga/sample',{}],['/manga/sample/chapters',{page:1,limit:100,'order[number]':'asc'}],['/chapters/123',{}]]) {
    f.state.responses.push(envelope({items:[]}));await f.session.read(path,params);
  }
  assert.equal(f.state.starts.length,4);assert.equal(f.state.cancels,4);
  for(const [path,params]of [['/user',{}],['/manga/sample/like',{}],['/manga',{...searchParams(),token:'private'}],['/manga',{}],['/chapters/1',{method:'POST'}]]) {
    await assert.rejects(f.session.read(path,params),/Unsupported Comix catalogue request/);
  }
  assert.equal(f.state.starts.length,4);f.session.close();
});

test('diagnostic stops on the first chapter verification unless manual recovery is explicitly selected',async()=>{
  const rejection=verificationError();const f=smokeRecovery({responses:[rejection]});
  await assert.rejects(f.run(),error=>error===rejection);
  assert.equal(f.state.calls.length,1);assert.equal(f.state.connects,0);assert.deepEqual(f.state.arms,[]);
});

test('diagnostic manual recovery waits for user Continue then traverses anew from page 1 without partial results',async()=>{
  const f=smokeRecovery({manual:true,responses:[smokeChapterPage(['first'],1,2),verificationError(),
    smokeChapterPage(['first'],1,2),smokeChapterPage(['final'],2)]});
  const pending=f.run();await flush();
  assert.deepEqual(f.state.calls.map(call=>call.page),[1,2]);assert.equal(f.state.connects,1);
  assert.deepEqual(f.state.arms,[185000]);assert.deepEqual(f.state.counts,{chapterPages:1,chapters:1});
  assert.deepEqual(f.state.reports,[{stage:'manual-recovery',category:'waiting-for-user'}]);
  // No timer/native retry starts reads during the user's manual website check.
  f.state.clock+=60000;await flush();assert.equal(f.state.calls.length,2);
  f.state.continue(true);
  const result=await pending;
  assert.deepEqual(f.state.calls.map(call=>call.page),[1,2,1,2]);
  assert.deepEqual(f.state.calls[2].counts,{chapterPages:0,chapters:0});
  assert.deepEqual(Array.from(result.keys()),['first','final']);
  assert.deepEqual(f.state.counts,{chapterPages:2,chapters:2});
  assert.deepEqual(f.state.arms,[185000,SMOKE_CHAPTER_DEADLINE_MS]);assert.equal(f.state.connects,1);
  assert.deepEqual(f.state.reports[1],{stage:'manual-recovery',category:'manual-continue',connected:true});
});

test('diagnostic manual recovery stops after cancellation or a second verification instead of looping',async()=>{
  const cancelled=smokeRecovery({manual:true,responses:[verificationError()]});
  const cancellation=cancelled.run();await flush();cancelled.state.continue(false);
  await assert.rejects(cancellation,error=>error.category==='verification-required');
  assert.equal(cancelled.state.calls.length,1);assert.equal(cancelled.state.connects,1);assert.deepEqual(cancelled.state.arms,[185000]);
  const second=verificationError();const f=smokeRecovery({manual:true,responses:[verificationError(),second]});
  const pending=f.run();await flush();f.state.continue(true);
  await assert.rejects(pending,error=>error===second);
  assert.deepEqual(f.state.calls.map(call=>call.page),[1,1]);assert.equal(f.state.connects,1);assert.deepEqual(f.state.arms,[185000,SMOKE_CHAPTER_DEADLINE_MS]);
});

test('diagnostic manual recovery does not retry format errors or revive expired work/verification deadlines',async()=>{
  const malformed=smokeRecovery({manual:true,responses:[{items:[],meta:{total:'invalid'}}]});
  await assert.rejects(malformed.run(),error=>error.category==='invalid-catalogue');assert.equal(malformed.state.connects,0);
  const expired=smokeRecovery({manual:true,responses:[verificationError()]});expired.state.clock=expired.state.deadline;
  await assert.rejects(expired.run(),error=>error.category==='deadline');assert.equal(expired.state.connects,0);assert.deepEqual(expired.state.arms,[]);
  const timeout=smokeRecovery({manual:true,responses:[verificationError()]});
  const waiting=timeout.run();await flush();timeout.state.clock=timeout.state.deadline;timeout.state.continue(true);
  await assert.rejects(waiting,error=>error.category==='deadline');assert.equal(timeout.state.calls.length,1);assert.deepEqual(timeout.state.arms,[185000]);
});

test('diagnostic second complete traversal retains its own paced-traversal deadline and never accepts a late final page',async()=>{
  const latePage={...smokeChapterPage(['one','two'],1),delay:SMOKE_CHAPTER_DEADLINE_MS};
  const f=smokeRecovery({manual:true,responses:[verificationError(),latePage]});
  const pending=f.run();await flush();f.state.continue(true);
  await assert.rejects(pending,error=>error.category==='deadline');
  assert.equal(f.state.calls.length,2);assert.equal(f.state.connects,1);assert.deepEqual(f.state.counts,{chapterPages:0,chapters:0});
});

test('queued catalogue operations are serialized, never simultaneous',async()=>{
  const f=setup();await connect(f);
  const first=f.session.read('/manga',searchParams());const second=f.session.read('/manga/sample',{});await flush();
  assert.equal(f.state.starts.length,1);f.state.responses.push(envelope({items:[]}));f.advance(100);await flush();await first;
  assert.equal(f.state.starts.length,2);f.state.responses.push(envelope({hid:'sample'}));f.advance(100);await flush();await second;f.session.close();
});

test('401/403/429 response stops queued operations, requires manual reconnect, never retries',async()=>{
  for(const status of [401,403,429]) {
    const f=setup();await connect(f);f.state.responses.push(JSON.stringify({ok:false,status,error:'Comix HTTP '+status}));
    const settled=await Promise.allSettled([f.session.read('/manga',searchParams()),f.session.read('/manga/sample',{})]);
    assert.equal(settled.every(r=>r.status==='rejected'&&r.reason.verify===true),true);assert.equal(f.state.starts.length,1);
    await assert.rejects(f.session.read('/manga',searchParams()),error=>error.verify===true);assert.equal(f.state.starts.length,1);f.session.close();
  }
});

test('native API security response and leaving homepage invalidate the catalogue session',async()=>{
  for(const invalidate of [win=>win.webContents.session.headers({statusCode:403,url:'https://comix.to/api/v1/manga'},()=>{}),
    win=>{win.webContents.url='https://comix.to/title/sample';},
    win=>win.webContents.emit('did-start-navigation',null,'https://comix.to/',false,true)]) {
    const f=setup();const win=await connect(f);invalidate(win);
    await assert.rejects(f.session.read('/manga',searchParams()),error=>error.verify===true);assert.equal(f.state.starts.length,0);f.session.close();
  }
});

test('malformed, oversized and non-object response envelopes never cross catalogue boundary',async()=>{
  for(const response of ['not json',undefined,123,envelope([]),envelope(null),JSON.stringify({ok:true,value:{large:'🎬'.repeat(60000)}})]) {
    const f=setup();await connect(f);f.state.responses.push(response);await assert.rejects(f.session.read('/manga',searchParams()),/Invalid Comix catalogue response/);
    assert.equal(f.state.starts.length,1);assert.equal(f.state.cancels,1);f.session.close();
  }
});

test('errors with URLs, cookies or signatures are replaced by fixed redacted messages',async()=>{
  const f=setup();await connect(f);f.state.responses.push(JSON.stringify({ok:false,error:'Comix https://provider.example/?signature=secret',cookies:'secret'}));
  await assert.rejects(f.session.read('/manga',searchParams()),error=>!error.message.includes('secret')&&!error.message.includes('https://')&&error.verify===false);
  assert.equal(f.state.starts.length,1);f.session.close();
});

test('busy transport and a stalled evaluation fail once, then cancel selected operation',async()=>{
  const busy=setup({started:false});await connect(busy);await assert.rejects(busy.session.read('/manga',searchParams()),/Comix is busy/);assert.equal(busy.state.starts.length,1);assert.equal(busy.state.cancels,1);busy.session.close();
  const held=setup({stall:code=>code.startsWith('window.__anitrackComix?.take(')});await connect(held);const pending=held.session.read('/manga',searchParams());await flush();held.advance(35001);await flush();
  await assert.rejects(pending,/Comix catalogue timed out/);assert.equal(held.state.starts.length,1);assert.equal(held.state.cancels,1);held.session.close();
});

test('renderer crash after successful connect invalidates readiness and prevents a fresh GET',async()=>{
  const f=setup();const win=await connect(f);win.webContents.emit('render-process-gone',null,{reason:'crashed'});
  await assert.rejects(f.session.read('/manga',searchParams()),error=>error.verify===true);assert.equal(f.state.starts.length,0);f.session.close();
});

test('live Comix smoke stays isolated, opt-in, identity checked, and bounds catalogue/images',()=>{
  const harness=readFileSync(new URL('../scripts/electron-comix-smoke.cjs',import.meta.url),'utf8');
  assert.equal(harness.includes('no-sandbox'),false);assert.equal(harness.includes('services/db'),false);assert.equal(harness.includes('services/mal'),false);
  assert.match(harness,/mkdtempSync/);assert.match(harness,/--run/);assert.match(harness,/30002/);assert.match(harness,/armDeadline\(CHAPTER_DEADLINE_MS\)/);
  assert.match(harness,/page <= 200/);assert.match(harness,/Math\.min\(3, pages\.length\)/);assert.match(harness,/fetchComixImage/);
});
