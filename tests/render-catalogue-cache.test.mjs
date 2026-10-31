import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
registerHooks({load(url,context,next){if(url.endsWith('/apps/web/server/catalogue.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText};return next(url,context);}});
const {PublicCatalogueCache}=await import('../apps/web/server/catalogue.ts');
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('Public successes are cached for120seconds without sliding expiration or caller mutation',async()=>{
  let now=0,calls=0;const cache=new PublicCatalogueCache({now:()=>now}),load=async()=>({data:{title:'First'},call:++calls});
  const first=await cache.get('query Q',{},load);first.data.title='Mutated';now=119999;const hit=await cache.get('query Q',{},load);assert.equal(hit.data.title,'First');assert.equal(calls,1);now=120000;assert.equal((await cache.get('query Q',{},load)).call,2);
});
test('Distinct query text and variables remain isolated, including prototype-shaped keys',async()=>{
  const cache=new PublicCatalogueCache();let calls=0;const load=async()=>({call:++calls});
  for(const [query,variables]of [['query A',{id:1}],['query A',{id:2}],['query B',{id:1}],['__proto__',JSON.parse('{"__proto__":{"id":1}}')],['query A',null],['query A',undefined]])await cache.get(query,variables,load);
  assert.equal(calls,6);await cache.get('query A',{id:1},load);assert.equal(calls,6);assert.equal({}.id,undefined);
  await cache.get('query C',{id:1,filter:{year:2026,genre:'Drama'}},load);await cache.get('query C',{filter:{genre:'Drama',year:2026},id:1},load);assert.equal(calls,7,'equivalent variable property ordering shares metadata');
});
test('Identical in-flight loads coalesce and each caller receives an independent success',async()=>{
  const cache=new PublicCatalogueCache(),pending=deferred();let calls=0;const load=()=>{calls++;return pending.promise;};
  const a=cache.get('query Q',{id:1},load),b=cache.get('query Q',{id:1},load);await flush();assert.equal(calls,1);pending.resolve({data:{id:1}});const [one,two]=await Promise.all([a,b]);one.data.id=9;assert.equal(two.data.id,1);assert.equal((await cache.get('query Q',{id:1},load)).data.id,1);
});
test('Rejected and GraphQL error loads never become cached failures',async()=>{
  for(const response of [{errors:[{message:'limited'}]},{error:'unavailable'},Error('failure')]){
    const cache=new PublicCatalogueCache();let calls=0;const load=async()=>{calls++;return response;};await cache.get('Q',{},load);await cache.get('Q',{},load);assert.equal(calls,2);
  }
  const cache=new PublicCatalogueCache(),pending=deferred();let calls=0;const load=()=>{calls++;return pending.promise;};const a=cache.get('Q',{},load),b=cache.get('Q',{},load);pending.reject(Error('limited'));await Promise.all([assert.rejects(a),assert.rejects(b)]);assert.equal(calls,1);assert.deepEqual(await cache.get('Q',{},async()=>({ok:true})),{ok:true});
});
test('Entry count evicts least recently used successful metadata',async()=>{
  const cache=new PublicCatalogueCache({maxEntries:2});let calls=0;const load=async()=>({call:++calls});await cache.get('A',{},load);await cache.get('B',{},load);await cache.get('A',{},load);await cache.get('C',{},load);await cache.get('A',{},load);assert.equal(calls,3);await cache.get('B',{},load);assert.equal(calls,4);
});
test('Total byte budget includes keys; oversized values or keys are not retained',async()=>{
  const cache=new PublicCatalogueCache({maxBytes:220,maxEntryBytes:170});let calls=0;const load=async()=>({text:'x'.repeat(90),call:++calls});await cache.get('A',{},load);await cache.get('B',{},load);await cache.get('A',{},load);assert.equal(calls,3);
  const tooLarge=new PublicCatalogueCache({maxBytes:300,maxEntryBytes:100});let largeCalls=0;const huge=async()=>({text:'x'.repeat(101),call:++largeCalls});await tooLarge.get('A',{},huge);await tooLarge.get('A',{},huge);assert.equal(largeCalls,2);
  let keyCalls=0;const small=async()=>({call:++keyCalls});await tooLarge.get('x'.repeat(101),{},small);await tooLarge.get('x'.repeat(101),{},small);assert.equal(keyCalls,2);
});
test('Pending key capacity remains bounded and failures free admission',async()=>{
  const cache=new PublicCatalogueCache({maxEntries:1}),pending=deferred();let first=0,other=0;const a=cache.get('A',{},()=>{first++;return pending.promise;});const b=cache.get('B',{},async()=>({call:++other}));await b;await cache.get('B',{},async()=>({call:++other}));assert.equal(other,2);pending.resolve({ok:true});await a;await cache.get('A',{},async()=>{first++;return {ok:true};});assert.equal(first,1);
});
test('Concurrent distinct completions retain correct byte accounting through eviction',async()=>{
  const cache=new PublicCatalogueCache({maxBytes:230,maxEntryBytes:170}),a=deferred(),b=deferred();
  const one=cache.get('A',{},()=>a.promise),two=cache.get('B',{},()=>b.promise);a.resolve({text:'a'.repeat(90)});b.resolve({text:'b'.repeat(90)});await Promise.all([one,two]);
  let calls=0;const load=async()=>({text:'x'.repeat(90),call:++calls});await cache.get('C',{},load);await cache.get('D',{},load);await cache.get('C',{},load);assert.equal(calls,3,'completed values cannot undercount keys to retain over-budget entries');
});
