import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import ts from 'typescript';
registerHooks({
  resolve(specifier,context,next){try{return next(specifier,context);}catch(error){if(/^\.{1,2}\//.test(specifier)&&! /\.[a-z0-9]+$/i.test(specifier))return next(specifier+'.ts',context);throw error;}},
  load(url,context,next){if(url.includes('/apps/source-service/')&&url.endsWith('.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText};return next(url,context);},
});
const {OperatorClickRouter}=await import('../apps/source-service/operator-input.ts');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};
function fixture(options={}){
  const state={visible:true,destroyed:false,approved:true,url:'https://source.example/check',attached:false,attaches:[],detaches:0,commands:[],events:[],...options};
  const inspector=Object.assign(new EventEmitter(),{
    isAttached:()=>state.attached,
    attach(version){state.attaches.push(version);if(state.attachError)throw state.attachError;state.attached=true;},
    detach(){state.detaches++;if(state.detachError)throw state.detachError;state.attached=false;inspector.emit('detach',{},'fixture');},
    async sendCommand(method,params){state.commands.push({method,params});state.events.push(params.type);return state.send?.(method,params);},
  });
  const contents=Object.assign(new EventEmitter(),{debugger:inspector,isDestroyed:()=>state.destroyed,getURL:()=>state.url,focus:()=>{state.events.push('contents-focus');state.focus?.();}});
  const win={webContents:contents,isDestroyed:()=>state.destroyed,isVisible:()=>state.visible,getContentSize:()=>[1000,760],focus:()=>state.events.push('window-focus')};
  const controller=new AbortController(),router=new OperatorClickRouter();
  return {state,inspector,contents,win,controller,router,click:(x=25,y=35)=>router.click(win,x,y,controller.signal,()=>state.approved)};
}
const status=(error,value,code)=>{assert.equal(error.status,value);if(code)assert.equal(error.code,code);return true;};

test('A human click sends exactly two fixed ordered routed mouse events and detaches its own inspector',async()=>{
  const f=fixture(),press=deferred();f.state.send=(_method,params)=>params.type==='mousePressed'?press.promise:undefined;
  const click=f.click();await flush();assert.equal(f.state.commands.length,1);assert.equal(f.router.isBusy(),true);
  assert.deepEqual(f.state.events,['window-focus','contents-focus','mousePressed']);press.resolve();await click;
  assert.deepEqual(f.state.commands,[
    {method:'Input.dispatchMouseEvent',params:{type:'mousePressed',x:25,y:35,button:'left',buttons:1,clickCount:1}},
    {method:'Input.dispatchMouseEvent',params:{type:'mouseReleased',x:25,y:35,button:'left',buttons:0,clickCount:1}},
  ]);
  assert.deepEqual(f.state.attaches,['1.3']);assert.equal(f.state.detaches,1);assert.equal(f.state.attached,false);assert.equal(f.router.isBusy(),false);
  assert.equal(f.inspector.listenerCount('detach'),0);assert.equal(f.contents.listenerCount('did-start-navigation'),0);
});

test('Invalid coordinates, hidden/unapproved/destroyed windows, and pre-aborted input never focus or attach',async()=>{
  for(const [options,point,abort] of [[{},[-1,5]], [{},[1000,5]], [{},[1.5,5]], [{},[5,760]], [{},[NaN,5]], [{visible:false}], [{approved:false}], [{destroyed:true}], [{},undefined,true]]){
    const f=fixture(options);if(abort)f.controller.abort();await assert.rejects(f.click(...(point??[])));
    assert.deepEqual(f.state.attaches,[]);assert.deepEqual(f.state.commands,[]);assert.deepEqual(f.state.events,[]);assert.equal(f.state.detaches,0);assert.equal(f.router.isBusy(),false);
  }
});

test('A foreign inspector attachment is preserved and never receives operator commands',async()=>{
  const f=fixture({attached:true});await assert.rejects(f.click(),error=>status(error,409,'OPERATOR_INPUT_UNAVAILABLE'));
  assert.deepEqual(f.state.attaches,[]);assert.deepEqual(f.state.commands,[]);assert.equal(f.state.detaches,0);assert.equal(f.state.attached,true);assert.equal(f.router.isBusy(),false);
});

test('A pending routed pair rejects another window before changing its focus',async()=>{
  const f=fixture(),other=fixture(),press=deferred();f.state.send=(_method,params)=>params.type==='mousePressed'?press.promise:undefined;
  const click=f.click();await flush();
  await assert.rejects(f.router.click(other.win,5,5,other.controller.signal,()=>true),error=>status(error,429,'OPERATOR_INPUT_BUSY'));
  assert.deepEqual(other.state.events,[]);assert.deepEqual(other.state.attaches,[]);press.resolve();await click;
});

test('Attach, press, release, and detach errors are sanitized and never retry a press',async()=>{
  for(const phase of ['attach','press','release','detach']){
    const f=fixture();
    if(phase==='attach')f.state.attachError=Error('private fixture detail');
    else if(phase==='detach')f.state.detachError=Error('private fixture detail');
    else f.state.send=(_method,params)=>{if(params.type===(phase==='press'?'mousePressed':'mouseReleased'))throw Error('private fixture detail');};
    await assert.rejects(f.click(),error=>{status(error,502,'OPERATOR_INPUT_FAILED');assert.ok(!error.message.includes('private'));return true;});
    assert.equal(f.state.commands.filter(call=>call.params.type==='mousePressed').length,phase==='attach'?0:1);
    assert.equal(f.state.commands.length,phase==='attach'?0:phase==='press'?1:2);assert.equal(f.state.detaches,phase==='attach'?0:1);assert.equal(f.router.isBusy(),false);
  }
});

test('Cancellation during a pending admitted press retains admission and completes its one safe release',async()=>{
  const f=fixture(),press=deferred();f.state.send=(_method,params)=>params.type==='mousePressed'?press.promise:undefined;
  const outcome=f.click().then(()=>null,error=>error);await flush();f.controller.abort();
  status(await outcome,499,'REQUEST_CANCELLED');assert.equal(f.router.isBusy(),true);assert.equal(f.state.detaches,0);assert.equal(f.state.commands.length,1);
  press.resolve();await flush();await flush();assert.equal(f.state.commands.length,2);assert.equal(f.state.commands[1].params.type,'mouseReleased');assert.equal(f.state.detaches,1);assert.equal(f.router.isBusy(),false);
});

test('A click deadline retains admission until pending native input and its paired release actually settle',async context=>{
  context.mock.timers.enable({apis:['setTimeout']});
  const f=fixture(),press=deferred(),release=deferred();f.state.send=(_method,params)=>params.type==='mousePressed'?press.promise:release.promise;
  const outcome=f.click().then(()=>null,error=>error);await flush();context.mock.timers.tick(10001);
  status(await outcome,504,'OPERATOR_INPUT_TIMEOUT');assert.equal(f.router.isBusy(),true);assert.equal(f.state.detaches,0);
  press.resolve();await flush();assert.equal(f.state.commands.length,2);assert.equal(f.router.isBusy(),true);assert.equal(f.state.detaches,0);
  release.resolve();await flush();await flush();assert.equal(f.state.commands.length,2);assert.equal(f.router.isBusy(),false);assert.equal(f.state.detaches,1);
});

test('A hidden, destroyed, unapproved, or newly navigated document never receives a cleanup release',async()=>{
  for(const change of [f=>{f.state.visible=false;},f=>{f.state.destroyed=true;},f=>{f.state.approved=false;},f=>{f.state.url='https://source.example/another';},f=>f.contents.emit('did-start-navigation',{},f.state.url,false,true)]){
    const f=fixture(),press=deferred();f.state.send=()=>press.promise;const outcome=f.click().then(()=>null,error=>error);await flush();change(f);press.resolve();
    assert.ok(await outcome);assert.equal(f.state.commands.length,1);assert.equal(f.state.detaches,1);assert.equal(f.router.isBusy(),false);
  }
});

test('Subframe and in-place navigation do not invalidate the existing main document pair',async()=>{
  const f=fixture(),press=deferred();f.state.send=(_method,params)=>params.type==='mousePressed'?press.promise:undefined;
  const click=f.click();await flush();f.contents.emit('did-start-navigation',{},'https://other.example/frame',false,false);f.contents.emit('did-start-navigation',{},f.state.url,true,true);press.resolve();await click;assert.equal(f.state.commands.length,2);
});

test('Lost inspector ownership never detaches a replacement attachment or dispatches a release into it',async()=>{
  const f=fixture(),press=deferred();f.state.send=()=>press.promise;const outcome=f.click().then(()=>null,error=>error);await flush();
  f.state.attached=false;f.inspector.emit('detach',{},'fixture replaced');f.state.attached=true;
  status(await outcome,502,'OPERATOR_INPUT_UNAVAILABLE');assert.equal(f.router.isBusy(),true);press.resolve();await flush();await flush();
  assert.equal(f.state.commands.length,1);assert.equal(f.state.detaches,0);assert.equal(f.state.attached,true);assert.equal(f.router.isBusy(),false);
});

test('A focus-time cancellation stops before touching the debugger',async()=>{
  const f=fixture();f.state.focus=()=>f.controller.abort();await assert.rejects(f.click(),error=>status(error,499,'REQUEST_CANCELLED'));
  assert.deepEqual(f.state.attaches,[]);assert.deepEqual(f.state.commands,[]);assert.equal(f.router.isBusy(),false);
});
