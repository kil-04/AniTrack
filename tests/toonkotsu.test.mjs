import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { TOONKOTSU, toonkotsuDetail, toonkotsuSearch, toonkotsuChapters, toonkotsuPageUrl, toonkotsuPageRef } from '../packages/shared/toonkotsu.ts';
import { isSourceChapterId } from '../packages/shared/manga.ts';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/toonkotsu/catalogue.json', import.meta.url), 'utf8'));
test('toonkotsu: real catalogue metadata confirms the tracker id and expected series', () => {
  const value = fixture(), d = toonkotsuDetail(value, 'ktm04-one-piece');
  assert.equal(d.anilistId, 30013); assert.equal(d.malId, 13); assert.equal(d.title, 'One Piece');
  assert.equal(toonkotsuDetail(value, 'abcde-other'), null);
  value.series.trackers = {}; value.series.externalIds = {};
  assert.equal(toonkotsuDetail(value, 'ktm04-one-piece').anilistId, null);
});
test('toonkotsu: search preserves valid source refs and removes duplicates', () => {
  assert.deepEqual(toonkotsuSearch({items:[{hid:'ktm04',slug:'one-piece'},{hid:'ktm04',slug:'one-piece'},{hid:'../bad',slug:'escape'},{hid:'pwaij',slug:'one-piece-aces-story'}]}), ['ktm04-one-piece','pwaij-one-piece-aces-story']);
  assert.throws(()=>toonkotsuSearch({}));
});
test('toonkotsu: alternate uploads inherit numbers and keep their groups, counts and times', () => {
  const chapters = toonkotsuChapters(fixture());
  assert.equal(chapters.length, 8);
  assert.deepEqual(chapters.find(c=>c.id==='4706277'), {id:'4706277',number:1196,title:'Chapter 1196',group:'Official',pageCount:16,uploadedAt:1792169980000});
  assert.equal(chapters[0].pageCount,17);
});
test('toonkotsu: fractions, volume-only entries, invalid counts and bounded complete lists', () => {
  const value={chapters:[{id:1,n:3.5,label:'Chapter 3.5 [Group]',pages:12,at:123},{id:2,n:null,label:'Volume 1'},{id:3,n:4,pages:501},{id:'../bad',n:5}]};
  const chapters=toonkotsuChapters(value);
  assert.equal(chapters.length,2);assert.equal(chapters[0].number,3.5);assert.equal(chapters[0].group,'Group');assert.equal(chapters[1].pageCount,null);
  assert.throws(()=>toonkotsuChapters({chapters:Array.from({length:TOONKOTSU.MAX_CHAPTERS+1},(_,i)=>({id:i+1,n:i}))}),/limit/);
  assert.throws(()=>toonkotsuChapters({chapters:[{id:1,n:1,alts:{}}]}));
});
test('toonkotsu: page handles stay on the exact selected reader and host', () => {
  const url=toonkotsuPageUrl('ktm04-one-piece',toonkotsuChapters(fixture())[0],17);
  assert.deepEqual(toonkotsuPageRef(new URL(url)),{ref:'ktm04-one-piece',chapterId:'4675553',page:17});
  for(const bad of [url.replace('https:','http:'),url.replace('toonkotsu.com','toonkotsu.com.evil.test'),url+'?token=1',url+'#x',url.replace('/17','/501'),url.replace('https://','https://user@')]) assert.equal(toonkotsuPageRef(new URL(bad)),null);
  assert.equal(isSourceChapterId('toonkotsu','4675553'),true);assert.equal(isSourceChapterId('toonkotsu','../1'),false);
});
const reader=readFileSync(new URL('../apps/android/app/src/main/assets/toonkotsu_page.js',import.meta.url),'utf8');
const evaluate=(request,scope={})=>vm.runInNewContext(reader.replace('/*ANITRACK_REQUEST*/',JSON.stringify(request)),{location:{origin:TOONKOTSU.ORIGIN,pathname:'/title/ktm04-one-piece/4675553-chapter-1196/1'},document:{title:'Reader',body:{innerText:''},images:[]},setTimeout,clearTimeout,AbortController,...scope});
test('toonkotsu: shared website reader stops at Quick Check without fetching', async()=>{
  let calls=0;
  const result=await evaluate({operation:'image',page:1},{document:{title:'Reader',body:{innerText:'Quick Check'},images:[]},fetch:()=>{calls++;}});
  assert.equal(result.error,'check');assert.equal(calls,0);
});
test('toonkotsu: shared website reader rejects a wrong chapter and non-catalogue requests', async()=>{
  assert.equal((await evaluate({operation:'image',ref:'other',chapterId:'2',page:1})).error,'chapter');
  assert.equal((await evaluate({operation:'get',path:'/api/auth/me'})).error,'path');
});
test('toonkotsu: shared website reader exports only a selected decoded image blob', async()=>{
  const image={alt:'Page 1',complete:true,naturalWidth:1100,naturalHeight:1606,currentSrc:'blob:https://toonkotsu.com/test'};
  const result=await evaluate({operation:'image',ref:'ktm04-one-piece',chapterId:'4675553',page:1},{document:{title:'Reader',body:{innerText:''},images:[image]},fetch:async()=>({blob:async()=>({size:3,type:'image/jpeg'})}),FileReader:class { readAsDataURL(){this.result='data:image/jpeg;base64,YWJj';this.onload();} }});
  assert.equal(result.data,'data:image/jpeg;base64,YWJj');assert.equal(result.page,1);assert.equal(result.width,1100);
  image.currentSrc='https://evil.test/image.jpg';
  assert.equal((await evaluate({operation:'image',ref:'ktm04-one-piece',chapterId:'4675553',page:1},{document:{title:'Reader',body:{innerText:''},images:[image]}})).error,'image');
});

test('toonkotsu: the reader accepts the site redirecting our hid to its own series code (20 Oct 2026)', async()=>{
  const image={alt:'Page 5',complete:true,naturalWidth:1100,naturalHeight:1606,currentSrc:'blob:https://toonkotsu.com/p5'};
  const scope={location:{origin:TOONKOTSU.ORIGIN,pathname:'/title/lokbk2-one-piece/4675553-chapter-1196/5'},document:{title:'Reader',body:{innerText:''},images:[image]},fetch:async()=>({blob:async()=>({size:3,type:'image/webp'})}),FileReader:class { readAsDataURL(){this.result='data:image/webp;base64,YWJj';this.onload();} }};
  const result=await evaluate({operation:'image',ref:'ktm04-one-piece',chapterId:'4675553',page:5},scope);
  assert.equal(result.page,5);assert.equal(result.chapterId,'4675553');
  assert.equal((await evaluate({operation:'image',ref:'ktm04-one-piece',chapterId:'4675554',page:5},scope)).error,'chapter');
  assert.equal((await evaluate({operation:'image',ref:'ktm04-one-piece',chapterId:'1.*',page:5},scope)).error,'request');
});

test('toonkotsu: closing Connect preserves the verified reader document and its blobs', async()=>{
  const require=createRequire(import.meta.url);
  const ts=require('typescript');
  let win;
  class WebsiteWindow extends EventEmitter {
    visible=false;dead=false;url='';loads=0;
    constructor(){
      super();win=this;
      const contents=new EventEmitter(),session=new EventEmitter();
      Object.assign(session,{setPermissionRequestHandler(){},setPermissionCheckHandler(){}});
      Object.assign(contents,{session,getURL:()=>this.url,setAudioMuted(){},setWindowOpenHandler(){},executeJavaScript:async()=> 'One Piece',executeJavaScriptInIsolatedWorld:async()=>({document:this.loads}),reloadIgnoringCache(){}});
      this.webContents=contents;
    }
    async loadURL(url){this.url=url;this.loads++;this.webContents.emit('did-finish-load');}
    isDestroyed(){return this.dead;}isVisible(){return this.visible;}show(){this.visible=true;}hide(){this.visible=false;}focus(){}setTitle(){}setParentWindow(){}
    close(){let prevented=false;this.emit('close',{preventDefault(){prevented=true;}});if(!prevented)this.destroy();}
    destroy(){this.dead=true;this.emit('closed');}
  }
  const compiled=ts.transpileModule(readFileSync(new URL('../apps/desktop/main/services/providers/verified-page-session.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  const app=new EventEmitter();
  new Function('require','module','exports',compiled)(name=>name==='electron'?{app,BrowserWindow:WebsiteWindow}:require(name),module,module.exports);
  const session=new module.exports.VerifiedPageSession({origin:TOONKOTSU.ORIGIN,partition:'test',label:'Toonkotsu',world:1215});
  const url=toonkotsuPageUrl('ktm04-one-piece',toonkotsuChapters(fixture())[0],1);
  try {
    const before=await session.readPage(url,'local reader');
    const connected=session.connect(url,null);
    await new Promise(r=>setImmediate(r));
    assert.equal(win.visible,true);
    win.close();await connected;
    assert.equal(win.dead,false);assert.equal(win.visible,false);
    assert.equal((await session.readPage(url,'local reader')).document,before.document);
    assert.equal(app.listenerCount('before-quit'),0);
    const duringQuit=session.connect(url,null);
    await new Promise(r=>setImmediate(r));
    app.emit('before-quit');win.close();await duringQuit;
    assert.equal(win.dead,true);
  } finally {session.close();}
});

test('verified page: a timed-out human check keeps one window until its manual completion', async()=>{
  const require=createRequire(import.meta.url),ts=require('typescript');
  const windows=[],timers=new Map();let sequence=0,title='Just a moment...',reads=0,reloads=0;
  class WebsiteWindow extends EventEmitter {
    visible=false;dead=false;url='';loads=0;
    constructor(){
      super();windows.push(this);
      const contents=new EventEmitter(),session=new EventEmitter();
      Object.assign(session,{setPermissionRequestHandler(){},setPermissionCheckHandler(){}});
      Object.assign(contents,{session,isDestroyed:()=>this.dead,getURL:()=>this.url,setAudioMuted(){},setWindowOpenHandler(){},
        executeJavaScript:async()=>title,executeJavaScriptInIsolatedWorld:async()=>{reads++;return {document:this.loads};},reloadIgnoringCache(){reloads++;}});
      this.webContents=contents;
    }
    async loadURL(url){this.url=url;this.loads++;this.webContents.emit('did-finish-load');}
    isDestroyed(){return this.dead;}isVisible(){return this.visible;}show(){this.visible=true;}hide(){this.visible=false;}focus(){}setTitle(){}setParentWindow(){}
    destroy(){if(this.dead)return;this.dead=true;this.emit('closed');}
  }
  const compiled=ts.transpileModule(readFileSync(new URL('../apps/desktop/main/services/providers/verified-page-session.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}},app=new EventEmitter();
  new Function('require','module','exports','setTimeout','clearTimeout',compiled)(
    name=>name==='electron'?{app,BrowserWindow:WebsiteWindow}:require(name),module,module.exports,
    (fn,ms)=>{const id=++sequence;timers.set(id,{fn,ms});return id;},id=>timers.delete(id));
  const session=new module.exports.VerifiedPageSession({origin:TOONKOTSU.ORIGIN,partition:'test',label:'Toonkotsu',world:1215,verificationWaitMs:50});
  const isCheck=error=>error instanceof module.exports.PageVerificationError&&error.code==='SECURITY_CHECK';
  const flush=async()=>{for(let index=0;index<10;index++)await Promise.resolve();};
  const pending=[];
  try{
    const opening=assert.rejects(session.readPage(TOONKOTSU.ORIGIN+'/','local reader'),isCheck);pending.push(opening);
    await flush();
    const deadline=[...timers].find(([,timer])=>timer.ms===50);assert.ok(deadline,'the first check has a bounded wait');
    timers.delete(deadline[0]);deadline[1].fn();await opening;
    const original=windows[0];assert.equal(original.dead,false);assert.equal(original.visible,true);
    for(const retry of [()=>session.readPage(TOONKOTSU.ORIGIN+'/','local reader'),()=>session.get(TOONKOTSU.ORIGIN+'/api/search','application/json'),()=>session.connect(TOONKOTSU.ORIGIN+'/',null)]){
      const rejected=assert.rejects(retry(),isCheck);pending.push(rejected);await flush();
      assert.equal(windows.length,1,'retries must reuse the existing human-check window');
      await rejected;
    }
    assert.equal(original.loads,1,'a retry must not navigate or reload the challenge');assert.equal(reloads,0);assert.equal(reads,0);
    assert.equal(original.dead,false);assert.equal(original.visible,true);
    // Only a new load caused by the human completing the existing website check
    // may mark this exact document ready; a later explicit read then succeeds.
    title='One Piece';original.webContents.emit('did-finish-load');await flush();
    assert.equal(session.isConnected(),true);
    assert.equal((await session.readPage(TOONKOTSU.ORIGIN+'/','local reader')).document,1);
    assert.equal(windows.length,1);assert.equal(original.loads,1);assert.equal(reloads,0);assert.equal(reads,1);
  }finally{session.close();for(const win of windows)win.destroy();await Promise.allSettled(pending);}
});
