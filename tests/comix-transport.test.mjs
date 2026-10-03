import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script = fs.readFileSync(new URL('../apps/android/app/src/main/assets/comix_transport.js',import.meta.url),'utf8');
// Replace ONLY the remote-module loading boundary with an offline fixture.
// The complete locally reviewed transport otherwise runs unchanged.
assert.equal(script.split('await import(url.href)').length,2);
const offlineScript = script.replace('await import(url.href)','await moduleLoader(url.href)');

function setup(get, moduleUrl='https://comix.to/assets/t3/dist/env-fixture.js', origin='https://comix.to') {
  const window = {};
  const context = vm.createContext({window,location:{origin,pathname:'/'},URL,Map,JSON,Object,Array,Number,Error,
    document:{querySelectorAll:()=>[{href:moduleUrl}]},moduleLoader:async url => {
      assert.equal(url,moduleUrl);
      return {renamedFacade:{get,post(){},put(){},patch(){},delete(){}},
        rawAxios:{get,post(){},put(){},patch(){},delete(){},interceptors:{}}};
    }});
  vm.runInContext(offlineScript,context);
  return window.__anitrackComix;
}

async function finish(api,id) {
  for (let i=0;i<20;i++) {
    const result = api.take(id);
    if (result !== null) return JSON.parse(result);
    await new Promise(resolve=>setImmediate(resolve));
  }
  throw new Error('Fixture never completed');
}

test('Comix exports only public catalogue fields, never account/cipher fields',async()=>{
  const api = setup(async ()=>({items:[{hid:'sample',title:'Fixture title',links:{al:'https://anilist.co/manga/1',token:'private'},account:'private',signature:'private'}],cookie:'private'}));
  assert.equal(api.start('one','/manga',{keyword:'Fixture'}),true);
  const result = await finish(api,'one');
  assert.equal(result.ok,true);
  assert.deepEqual(result.value,{items:[{hid:'sample',title:'Fixture title',links:{al:'https://anilist.co/manga/1'}}]});
  assert.equal(JSON.stringify(result).includes('private'),false);
});

test('homepage without an env preload discovers only a bounded same-origin static import',async()=>{
  const window = {};
  let loads=0, fetches=0;
  const moduleUrl = 'https://comix.to/assets/t3/dist/env-fixture.js';
  const body = new TextEncoder().encode('import{b}from"./env-fixture.js";');
  const context = vm.createContext({window,location:{origin:'https://comix.to',href:'https://comix.to/',pathname:'/'},URL,Map,JSON,Object,Array,Number,Error,TextDecoder,
    document:{querySelectorAll:selector=>selector.startsWith('link')?[]:[{src:'https://comix.to/assets/t3/dist/main-fixture.js'}]},
    fetch:async(url,options)=>{
      fetches++;
      assert.equal(url,'https://comix.to/assets/t3/dist/main-fixture.js');
      assert.equal(options.redirect,'error');
      let read=false;
      return {ok:true,headers:{get:()=>null},body:{getReader:()=>({read:async()=>read?{done:true}:(read=true,{done:false,value:body}),cancel:async()=>{}})}};
    },
    moduleLoader:async url=>{loads++;assert.equal(url,moduleUrl);return {facade:{get:async()=>({items:[]}),post(){},put(){},patch(){},delete(){}}};}
  });
  vm.runInContext(offlineScript,context);
  window.__anitrackComix.start('one','/manga',{});
  assert.equal((await finish(window.__anitrackComix,'one')).ok,true);
  assert.equal(fetches,1);assert.equal(loads,1);
});

test('Comix refuses account paths, external module origins and non-Comix page contexts',async()=>{
  const api = setup(async()=>{throw new Error('Must not run');});
  assert.equal(api.start('bad','/user',{}),false);
  assert.equal(api.start('bad','https://other.example/manga',{}),false);
  const foreign = setup(async()=>{throw new Error('Must not run');},'https://other.example/assets/env-fixture.js');
  assert.equal(foreign.start('one','/manga',{}),true);
  assert.equal((await finish(foreign,'one')).ok,false);
  assert.equal(setup(async()=>({}),undefined,'https://other.example'),undefined);
});

test('one pending request, cancellation and late responses do not poison the session',async()=>{
  let release;
  const api = setup(()=>new Promise(resolve=>{release=resolve;}));
  assert.equal(api.start('old','/manga',{}),true);
  assert.equal(api.phase('old'),'website-module');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(api.phase('old'),'catalogue');
  assert.equal(api.start('busy','/manga',{}),false);
  api.cancel('old');
  assert.equal(api.phase('old'),'idle');
  release({items:[]});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(JSON.parse(api.take('old')).ok,false);
  assert.equal(api.start('new','/manga',{}),true);
  await new Promise(resolve=>setImmediate(resolve));
  release({items:[]});
  assert.equal((await finish(api,'new')).ok,true);
  assert.equal(api.phase('new'),'idle');
});

test('security rejection reports status only and performs no retry',async()=>{
  let calls=0;
  const api = setup(async()=>{calls++;throw {response:{status:403,data:{token:'secret'}},message:'secret'};});
  api.start('one','/manga',{});
  const result = await finish(api,'one');
  assert.equal(result.status,403);
  assert.equal(result.error,'Comix HTTP 403');
  assert.equal(JSON.stringify(result).includes('secret'),false);
  assert.equal(calls,1);
});

test('oversized catalogue payload fails rather than crossing the process boundary',async()=>{
  const api = setup(async()=>({pages:[{url:'a'.repeat(210000)}]}));
  api.start('one','/chapters/123',{});
  assert.equal((await finish(api,'one')).ok,false);
});
