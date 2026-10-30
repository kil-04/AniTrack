import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

registerHooks({
  resolve(specifier,context,next){
    if(specifier==='electron')return {url:'operator-resources-test:electron',shortCircuit:true};
    try{return next(specifier,context);}catch(error){if(/^\.{1,2}\//.test(specifier)&&! /\.[a-z0-9]+$/i.test(specifier))return next(specifier+'.ts',context);throw error;}
  },
  load(url,context,next){
    if(url==='operator-resources-test:electron')return {format:'module',shortCircuit:true,source:'export class BrowserWindow {static getAllWindows(){return globalThis.__operatorResourceWindows ?? [];}}'};
    if(url.includes('/apps/source-service/')&&url.endsWith('.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText};
    return next(url,context);
  },
});
const {SourceOperator}=await import('../apps/source-service/operator.ts');
const origin='https://operator.example.test',key='Operator_resources_fixture_'.repeat(2),sourceOrigin='https://anichan.to';
const authorization='Basic '+Buffer.from('operator:'+key).toString('base64');
const request=(path,body,init={})=>new Request(origin+path,{
  method:body===undefined?'GET':'POST',
  ...init,
  headers:{Authorization:authorization,...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'}),...init.headers},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),
});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};
const image=(width=900,height=700,bytes=Buffer.from([137,80,78,71]))=>({getSize:()=>({width,height}),isEmpty:()=>!width||!height,toPNG:()=>bytes});

function windowFixture(options={}){
  const events=new EventEmitter();
  const state={url:sourceOrigin+'/',visible:true,destroyed:false,width:900,height:700,captures:[],shows:0,focuses:0,contentFocuses:0,events:[],closes:0,destroys:0,...options};
  const win=Object.assign(events,{
    isDestroyed:()=>state.destroyed,
    isVisible:()=>state.visible,
    getContentSize:()=>[state.width,state.height],
    show:()=>{state.shows++;state.visible=true;},
    focus:()=>{state.focuses++;state.events.push('window-focus');},
    close:()=>{state.closes++;},
    destroy:()=>{state.destroys++;state.destroyed=true;events.emit('closed');},
    webContents:{
      isDestroyed:()=>state.destroyed,
      getURL:()=>state.url,
      capturePage:async(...args)=>{state.captures.push(args);return state.capture?state.capture(...args):image(state.width,state.height);},
      focus:()=>{state.contentFocuses++;state.events.push('contents-focus');},
      sendInputEvent:event=>{state.events.push(event.type);},insertText:async text=>{state.events.push('text:'+text);},
    },
  });
  return {win,state};
}

function fixture(options={}){
  const windows=options.windows??[windowFixture()];
  globalThis.__operatorResourceWindows=windows.map(row=>row.win);
  const operator=new SourceOperator(key,origin,()=>new Set([sourceOrigin]),options.connections??{});
  return {operator,windows,async id(index=0){return (await(await operator.handle(request('/operator/api/windows'))).json())[index].id;}};
}
const screen=(operator,id,init={})=>operator.handle(request('/operator/api/screen?id='+encodeURIComponent(id),undefined,init));
const input=(operator,id,type,init={})=>operator.handle(request('/operator/api/input',{id,type},init));

test('The operator provides manual preview and explicit source closing without a recurring screenshot loop',async()=>{
  const {operator}=fixture();
  const page=await(await operator.handle(request('/operator'))).text();
  assert.match(page,/id="refresh-preview"/);assert.match(page,/id="close-source"/);
  const script=await(await operator.handle(request('/operator/app.js'))).text();
  assert.doesNotThrow(()=>new Function(script));
  assert.doesNotMatch(script,/setInterval\([^;]*screen\(\)/);
  assert.doesNotMatch(script,/,\s*1500\s*\)/);
  assert.match(script,/refresh-preview/);assert.match(script,/close-source/);
});

test('Opening, refreshing, and polling window lists do not capture; explicit Connect selects the matching source preview',async()=>{
  const {operator}=fixture(),script=await(await operator.handle(request('/operator/app.js'))).text(),elements=new Map(),intervals=[],calls=[];
  class Element {
    value='';textContent='';src='';children=[];naturalWidth=900;naturalHeight=700;
    replaceChildren(...rows){this.children=rows;if(!rows.some(row=>row.value===this.value))this.value=rows[0]?.value??'';}
    append(row){this.children.push(row);}
    removeAttribute(name){if(name==='src')this.src='';}
    getBoundingClientRect(){return this.bounds??{left:0,top:0,width:900,height:700};}
  }
  const element=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const rows=[{id:'old-source',source:'mangadot',label:'mangadot.net',visible:true},{id:'chosen-source',source:'anichan',label:'anichan.to',visible:true}];
  runInNewContext(script,{
    document:{hidden:false,querySelector:element,createElement:()=>new Element()},window:{addEventListener(){}},
    Option:class {constructor(label,value){this.label=label;this.value=value;}},
    URL:{createObjectURL:()=> 'blob:preview',revokeObjectURL(){}},location:{replace(){throw Error('Unexpected sign-in redirect');}},
    setInterval(callback,delay){intervals.push({callback,delay});},
    fetch:async(path,init)=>{
      calls.push({path,init});
      if(path==='/operator/api/windows')return Response.json(rows);
      if(path==='/operator/api/sources')return Response.json([{source:'anichan',label:'AniChan',state:'connecting'},{source:'mangadot',label:'MangaDot',state:'idle'}]);
      if(path==='/operator/api/connect')return Response.json({ok:true,pending:true},{status:202});
      if(path==='/operator/api/input')return Response.json({ok:true});
      if(path.startsWith('/operator/api/screen?'))return new Response(new Uint8Array([137,80,78,71]),{headers:{'Content-Type':'image/png'}});
      throw Error('Unexpected operator request '+path);
    },
  });
  await flush();
  for(const interval of intervals){await interval.callback();await flush();await interval.callback();await flush();}
  await element('#refresh').onclick();await flush();
  element('#sources').value='mangadot';element('#sources').onchange();
  assert.equal(calls.filter(row=>row.path.includes('/screen?')).length,0,'listing and polling stay capture-free');
  assert.ok(intervals.every(interval=>interval.delay!==1500));
  element('#windows').value='old-source';await element('#refresh-preview').onclick();await flush();
  assert.equal(calls.filter(row=>row.path.includes('/screen?')).length,1,'Refresh preview explicitly captures');
  element('#sources').value='anichan';await element('#connect').onclick();await flush();
  const captures=calls.filter(row=>row.path.includes('/screen?'));assert.equal(captures.length,2);assert.match(captures[1].path,/id=chosen-source$/);
  assert.equal(element('#windows').value,'chosen-source');
  const preview=element('#screen');preview.bounds={left:10,top:20,width:450,height:350};
  preview.onclick({clientX:110,clientY:120});await flush();
  let click=JSON.parse(calls.filter(row=>row.path==='/operator/api/input').at(-1).init.body);assert.deepEqual(click,{id:'chosen-source',type:'click',x:200,y:200});
  preview.onclick({clientX:460,clientY:370});await flush();
  click=JSON.parse(calls.filter(row=>row.path==='/operator/api/input').at(-1).init.body);assert.deepEqual(click,{id:'chosen-source',type:'click',x:899,y:699});
  const inputCount=calls.filter(row=>row.path==='/operator/api/input').length;
  preview.bounds={left:10,top:20,width:0,height:350};preview.onclick({clientX:11,clientY:21});await flush();assert.equal(calls.filter(row=>row.path==='/operator/api/input').length,inputCount);
});

test('Validated human click, key, and text actions focus their visible source before dispatch',async()=>{
  const source=windowFixture(),f=fixture({windows:[source]}),id=await f.id();
  for(const [body,events] of [[{type:'click',x:10,y:15},['mouseDown','mouseUp']],[{type:'key',key:'Tab'},['keyDown','keyUp']],[{type:'text',text:'Fixture'},['text:Fixture']]]){
    source.state.events.length=0;
    const response=await f.operator.handle(request('/operator/api/input',{id,...body}));assert.equal(response.status,200);
    assert.deepEqual(source.state.events,['window-focus','contents-focus',...events]);
  }
  assert.equal(source.state.focuses,3);assert.equal(source.state.contentFocuses,3);assert.equal(source.state.shows,0);
});

test('Hidden retained sources reject human input without waking, focusing, or dispatching',async()=>{
  const source=windowFixture({visible:false}),f=fixture({windows:[source]}),id=await f.id();
  for(const body of [{type:'click',x:10,y:15},{type:'key',key:'Tab'},{type:'text',text:'Fixture'}]){
    const response=await f.operator.handle(request('/operator/api/input',{id,...body}));assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:'SOURCE_WINDOW_HIDDEN'});
  }
  assert.equal(source.state.focuses,0);assert.equal(source.state.contentFocuses,0);assert.equal(source.state.shows,0);assert.deepEqual(source.state.events,[]);
});

test('Invalid human input is rejected before a source is focused',async()=>{
  const source=windowFixture(),f=fixture({windows:[source]}),id=await f.id();
  for(const body of [{type:'click',x:-1,y:15},{type:'click',x:900,y:15},{type:'click',x:10.5,y:15},{type:'click',x:10,y:NaN},{type:'key',key:'F12'},{type:'text',text:'bad\u0000text'},{type:'text',text:'x'.repeat(201)},{type:'text',text:5},{type:'unknown'}]){
    const response=await f.operator.handle(request('/operator/api/input',{id,...body}));assert.equal(response.status,400);
  }
  assert.equal(source.state.focuses,0);assert.equal(source.state.contentFocuses,0);assert.equal(source.state.shows,0);assert.deepEqual(source.state.events,[]);
});

test('A hidden source cannot be shown, focused, or captured by a preview request',async()=>{
  const source=windowFixture({visible:false}),f=fixture({windows:[source]}),id=await f.id();
  const response=await screen(f.operator,id);
  assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:'SOURCE_WINDOW_HIDDEN'});
  assert.equal(source.state.shows,0);assert.equal(source.state.focuses,0);assert.equal(source.state.captures.length,0);assert.equal(source.state.visible,false);
});

test('Preview requests capture only approved visible windows and bounded dimensions',async()=>{
  const source=windowFixture(),f=fixture({windows:[source]}),id=await f.id();
  const response=await screen(f.operator,id);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^image\/png/);
  assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array([137,80,78,71]));
  assert.equal(source.state.captures.length,1);
  assert.deepEqual(source.state.captures[0][0],{x:0,y:0,width:900,height:700});
  assert.equal(source.state.shows,0);assert.equal(source.state.focuses,0);
  source.state.url='https://unapproved.example/';assert.equal((await screen(f.operator,id)).status,404);assert.equal(source.state.captures.length,1);
});

test('Oversized and invalid source dimensions stop before allocating a screenshot',async()=>{
  for(const [width,height] of [[1201,700],[900,901],[0,700],[900,0],[NaN,700],[-1,700],[900.5,700]]){
    const source=windowFixture({width,height}),f=fixture({windows:[source]}),response=await screen(f.operator,await f.id());
    assert.equal(response.status,413,`dimensions ${width}x${height}`);assert.equal(source.state.captures.length,0);
  }
});

test('Actual image dimensions and PNG bytes are bounded and rejected captures release admission',async()=>{
  const source=windowFixture(),f=fixture({windows:[source]}),id=await f.id();
  for(const result of [image(1201,700),image(900,901),image(0,700),image(900,700,Buffer.alloc(0)),image(900,700,Buffer.alloc(4*1024*1024+1))]){
    source.state.capture=async()=>result;assert.equal((await screen(f.operator,id)).status,413);
  }
  source.state.capture=async()=>image();const response=await screen(f.operator,id);assert.equal(response.status,200);await response.body.cancel();
});

test('The maximum allowed viewport and PNG size remain usable',async()=>{
  const bytes=Buffer.alloc(4*1024*1024),source=windowFixture({width:1200,height:900,capture:async()=>image(1200,900,bytes)}),f=fixture({windows:[source]}),id=await f.id();
  const response=await screen(f.operator,id);assert.equal(response.status,200);assert.equal(response.headers.get('content-length'),String(bytes.length));assert.equal((await response.arrayBuffer()).byteLength,bytes.length);
  const next=await screen(f.operator,id);assert.equal(next.status,200);await next.body.cancel();
});

test('One capture is admitted across windows until its response is consumed or cancelled',async()=>{
  const first=windowFixture(),second=windowFixture(),f=fixture({windows:[first,second]}),rows=await(await f.operator.handle(request('/operator/api/windows'))).json();
  const capture=deferred();first.state.capture=()=>capture.promise;
  const pending=screen(f.operator,rows[0].id);await flush();
  const busy=await screen(f.operator,rows[1].id);assert.equal(busy.status,429);assert.deepEqual(await busy.json(),{error:'OPERATOR_CAPTURE_BUSY'});assert.equal(second.state.captures.length,0);
  capture.resolve(image());const response=await pending;assert.equal(response.status,200);
  await flush();assert.equal((await screen(f.operator,rows[1].id)).status,429,'unread response retains admission');
  const reader=response.body.getReader(),firstChunk=await reader.read();assert.equal(firstChunk.done,false);
  assert.equal((await screen(f.operator,rows[1].id)).status,429,'a partial body read retains admission');
  assert.equal((await reader.read()).done,true);reader.releaseLock();
  const next=await screen(f.operator,rows[1].id);assert.equal(next.status,200);assert.equal(second.state.captures.length,1);
  assert.equal((await screen(f.operator,rows[0].id)).status,429,'second unread response retains admission');
  await next.body.cancel();const last=await screen(f.operator,rows[0].id);assert.equal(last.status,200);await last.body.cancel();
});

test('Large previews stream independent chunks of at most 64 KiB and retain admission until read or cancelled',async()=>{
  const bytes=Buffer.alloc(128*1024+17);for(let index=0;index<bytes.length;index++)bytes[index]=index%251;
  const source=windowFixture({capture:async()=>image(900,700,bytes)}),f=fixture({windows:[source]}),id=await f.id();
  const response=await screen(f.operator,id);assert.equal(response.status,200);
  const reader=response.body.getReader(),first=await reader.read();assert.equal(first.done,false);assert.equal(first.value.byteLength,65536);assert.ok(first.value.buffer.byteLength<=65536);
  assert.equal((await screen(f.operator,id)).status,429,'a buffered partial preview retains admission');
  const chunks=[first.value];
  for(;;){const part=await reader.read();if(part.done)break;assert.ok(part.value.byteLength>0&&part.value.byteLength<=65536);assert.ok(part.value.buffer.byteLength<=65536,'a chunk never retains the full PNG backing buffer');chunks.push(part.value);}
  reader.releaseLock();assert.deepEqual(Buffer.concat(chunks),bytes);
  const cancellable=await screen(f.operator,id);assert.equal(cancellable.status,200);const cancellingReader=cancellable.body.getReader();assert.equal((await cancellingReader.read()).value.byteLength,65536);
  assert.equal((await screen(f.operator,id)).status,429);await cancellingReader.cancel();
  const next=await screen(f.operator,id);assert.equal(next.status,200);await next.body.cancel();
});

test('Aborting a pending screenshot cannot admit another capture before the underlying capture settles',async()=>{
  const source=windowFixture(),f=fixture({windows:[source]}),id=await f.id(),capture=deferred(),controller=new AbortController();source.state.capture=()=>capture.promise;
  const pending=screen(f.operator,id,{signal:controller.signal});await flush();controller.abort();await flush();
  assert.equal((await screen(f.operator,id)).status,429);assert.equal(source.state.captures.length,1);
  capture.resolve(image());const cancelled=await pending;assert.notEqual(cancelled.status,200);await cancelled.body?.cancel();
  source.state.capture=async()=>image();const next=await screen(f.operator,id);assert.equal(next.status,200);await next.body.cancel();
});

test('Aborting a returned preview releases response admission and a failed capture releases its slot',async()=>{
  const source=windowFixture(),f=fixture({windows:[source]}),id=await f.id(),controller=new AbortController();
  const response=await screen(f.operator,id,{signal:controller.signal});assert.equal(response.status,200);controller.abort();await flush();
  source.state.capture=async()=>{throw Error('private capture diagnostics');};const failed=await screen(f.operator,id);assert.equal(failed.status,502);assert.doesNotMatch(await failed.text(),/private capture/);
  source.state.capture=async()=>image();const next=await screen(f.operator,id);assert.equal(next.status,200);await next.body.cancel();
});

test('A preview deadline does not free admission while its native capture is still running',async context=>{
  context.mock.timers.enable({apis:['setTimeout']});
  const source=windowFixture(),f=fixture({windows:[source]}),id=await f.id(),capture=deferred();source.state.capture=()=>capture.promise;
  const pending=screen(f.operator,id);await flush();context.mock.timers.tick(10001);
  const timeout=await pending;assert.equal(timeout.status,504);assert.deepEqual(await timeout.json(),{error:'OPERATOR_CAPTURE_TIMEOUT'});
  assert.equal((await screen(f.operator,id)).status,429);assert.equal(source.state.captures.length,1);
  capture.resolve(image());await flush();source.state.capture=async()=>image();const next=await screen(f.operator,id);assert.equal(next.status,200);await next.body.cancel();
});

test('Close source requires authentication and exact origin, destroys only the selected approved window, and never means Finish',async()=>{
  const first=windowFixture(),second=windowFixture(),f=fixture({windows:[first,second]}),id=await f.id();
  assert.equal((await input(f.operator,id,'close',{headers:{Authorization:''}})).status,401);
  assert.equal((await input(f.operator,id,'close',{headers:{Origin:'https://attacker.example'}})).status,403);
  assert.equal((await input(f.operator,id,'close',{headers:{Origin:''}})).status,403);
  assert.equal((await input(f.operator,id,'close',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  assert.equal((await input(f.operator,'arbitrary-window','close')).status,404);assert.equal(first.state.destroys,0);
  const response=await input(f.operator,id,'close');assert.equal(response.status,200);assert.equal(first.state.destroys,1);assert.equal(first.state.closes,0);assert.equal(second.state.destroys,0);
  assert.equal((await screen(f.operator,id)).status,404);assert.equal((await(await f.operator.handle(request('/operator/api/windows'))).json()).length,1);
});

test('Closing a pending source check reports cancelled and ignores its stale completion',async()=>{
  const source=windowFixture(),connection=deferred(),f=fixture({windows:[source],connections:{anichan:()=>connection.promise}});
  assert.equal((await f.operator.handle(request('/operator/api/connect',{source:'anichan'}))).status,202);await flush();
  const id=await f.id();assert.equal((await input(f.operator,id,'close')).status,200);
  let state=(await(await f.operator.handle(request('/operator/api/sources'))).json())[0].state;assert.equal(state,'cancelled');
  connection.resolve();await flush();state=(await(await f.operator.handle(request('/operator/api/sources'))).json())[0].state;assert.equal(state,'cancelled');
});

test('A cancelled connection cannot complete or remove a newer connection for the same source',async()=>{
  const source=windowFixture(),oldConnection=deferred(),newConnection=deferred();let calls=0;
  const f=fixture({windows:[source],connections:{anichan:()=>++calls===1?oldConnection.promise:newConnection.promise,mangadot:async()=>{}}});
  assert.equal((await f.operator.handle(request('/operator/api/connect',{source:'anichan'}))).status,202);await flush();
  assert.equal((await input(f.operator,await f.id(),'close')).status,200);
  assert.equal((await f.operator.handle(request('/operator/api/connect',{source:'anichan'}))).status,202);await flush();
  oldConnection.resolve();await flush();
  const state=(await(await f.operator.handle(request('/operator/api/sources'))).json()).find(row=>row.source==='anichan').state;assert.equal(state,'connecting');
  assert.equal((await f.operator.handle(request('/operator/api/connect',{source:'anichan'}))).status,202);assert.equal(calls,2);
  assert.equal((await f.operator.handle(request('/operator/api/connect',{source:'mangadot'}))).status,409);
  newConnection.resolve();await flush();assert.equal((await(await f.operator.handle(request('/operator/api/sources'))).json()).find(row=>row.source==='anichan').state,'finished');
});

test('Only one different source check opens at a time while a repeated Connect is deduplicated',async()=>{
  const connection=deferred();let firstCalls=0,secondCalls=0;
  const f=fixture({connections:{anichan:()=>{firstCalls++;return connection.promise;},mangadot:async()=>{secondCalls++;}}});
  assert.equal((await f.operator.handle(request('/operator/api/connect',{source:'anichan'}))).status,202);await flush();
  assert.equal((await f.operator.handle(request('/operator/api/connect',{source:'anichan'}))).status,202);
  const busy=await f.operator.handle(request('/operator/api/connect',{source:'mangadot'}));assert.equal(busy.status,409);assert.deepEqual(await busy.json(),{error:'OPERATOR_CONNECTION_BUSY'});
  assert.equal(firstCalls,1);assert.equal(secondCalls,0);
  connection.resolve();await flush();assert.equal((await f.operator.handle(request('/operator/api/connect',{source:'mangadot'}))).status,202);await flush();assert.equal(secondCalls,1);
});
