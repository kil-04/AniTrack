import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { COMIX_CHAPTER_LIST_DEADLINE_MS, comixChapters, comixHasNext } from '../apps/desktop/main/services/manga/comix-protocol.ts';

// Exercise the actual locally authored production collector without loading
// Electron, accounts, persistence, the website, or downloaded JavaScript.
const source = readFileSync(new URL('../apps/desktop/main/services/manga/sources.ts',import.meta.url),'utf8');
const start = source.indexOf('const comix: Source = {');
assert.ok(start>=0);
const methodStart = source.indexOf('  async chapters(title) {',start);
const methodEnd = source.indexOf('  pages: viaProtocol("comix",',methodStart);
assert.ok(methodStart>start && methodEnd>methodStart);
const method = source.slice(methodStart,methodEnd).trim().replace(/,$/,'');
const ts = createRequire(import.meta.url)('typescript');
const compiled = ts.transpileModule('exports.collector={'+method+'}.chapters',{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
const title = {sourceId:'comix',id:'abc123',title:'Fixture'};
const row = (id,number=Number(id)) => ({id:Number(id),number});
const page = (items,total,current=1,last=1) => ({items,meta:{total,page:current,lastPage:last,hasNext:current<last}});

function setup(pages,delays=[]) {
  const state = {clock:1000,calls:[],cache:new Map(),saved:[]};
  class ClockDate extends Date {static now(){return state.clock;}}
  class MangaSourceError extends Error {}
  const exports = {};
  const context = vm.createContext({exports,Date:ClockDate,Map,MangaSourceError,
    comixLists:state.cache,CHAPTERS_TTL_MS:300000,COMIX_CHAPTER_LIST_DEADLINE_MS,comixChapters,comixHasNext,
    comixTitleId:value=>{assert.equal(value.sourceId,'comix');return value.id;},
    comixRead:async(path,params)=>{
      const index=state.calls.length;
      state.calls.push({path,params});
      assert.equal(path,'/manga/abc123/chapters');assert.equal(params.page,index+1);
      assert.equal(params.limit,100);assert.equal(params['order[number]'],'asc');
      if(index>=pages.length)throw Error('Unexpected additional chapter request');
      state.clock+=delays[index] || 0;
      return structuredClone(pages[index]);
    },
    keepList:(value,rows)=>state.saved.push({title:value,rows}),
  });
  vm.runInContext(compiled,context);
  return{collect:()=>exports.collector(title),state};
}

test('Comix collector caches only a complete stable-ID total, preserving distinct uploads',async()=>{
  const f=setup([page([row(1,1),row(2,1)],3,1,2),page([row(3,1.5)],3,2,2)]);
  const result=await f.collect();
  assert.deepEqual(Array.from(result,r=>r.id),['1','2','3']);assert.deepEqual(Array.from(result,r=>r.number),[1,1,1.5]);
  assert.equal(f.state.calls.length,2);assert.equal(f.state.cache.get('abc123').list,result);assert.equal(f.state.saved.length,1);
  assert.equal(await f.collect(),result);assert.equal(f.state.calls.length,2);
});

test('Comix collector accepts a genuine empty title but never invents chapters',async()=>{
  const f=setup([page([],0)]);assert.equal((await f.collect()).length,0);assert.equal(f.state.calls.length,1);assert.equal(f.state.cache.size,0);
});

test('incomplete and duplicated final pages never become cache or disk successes',async()=>{
  for(const pages of [
    [page([row(1)],2)],
    [page([row(1)],2,1,2),page([row(1)],2,2,2)],
    [page([row(1),row(1)],2)],
    [page([{id:'invalid',number:1}],1)],
  ]) {
    const f=setup(pages);await assert.rejects(f.collect(),/incomplete|repeated/);
    assert.equal(f.state.cache.size,0);assert.equal(f.state.saved.length,0);
  }
});

test('missing, invalid, changing and overflowing totals fail without partial caching',async()=>{
  for(const pages of [
    [{items:[row(1)],meta:{page:1,lastPage:1}}],
    [page([row(1)],'1')],
    [page([row(1)],-1)],
    [page([row(1)],1.5)],
    [page([row(1)],20001)],
    [page([row(1)],3,1,2),page([row(2)],4,2,2)],
    [page([row(1),row(2)],1)],
  ]) {
    const f=setup(pages);await assert.rejects(f.collect(),/chapter total/);
    assert.equal(f.state.cache.size,0);assert.equal(f.state.saved.length,0);
  }
});

test('contradictory progress and repeated page metadata stop before another read',async()=>{
  for(const pages of [[page([],1,1,2)],[page([row(1)],1,1,2)],
    [page([row(1)],2,1,2),page([row(2)],2,1,2)]]) {
    const f=setup(pages);await assert.rejects(f.collect(),/pagination|repeated a chapter page/);
    assert.equal(f.state.calls.length,pages.length);assert.equal(f.state.cache.size,0);assert.equal(f.state.saved.length,0);
  }
});

test('a final read that reaches/exceeds the traversal deadline is not cached',async()=>{
  for(const [pages,delays]of [
    [[page([row(1)],1)],[COMIX_CHAPTER_LIST_DEADLINE_MS]],
    [[page([row(1)],1)],[COMIX_CHAPTER_LIST_DEADLINE_MS+35000]],
    [[page([row(1)],2,1,2),page([row(2)],2,2,2)],[COMIX_CHAPTER_LIST_DEADLINE_MS-1,2]],
  ]) {
    const f=setup(pages,delays);for(let i=0;i<20;i++)f.state.cache.set('other'+i,{at:0,list:[]});
    await assert.rejects(f.collect(),/timed out/);assert.equal(f.state.calls.length,pages.length);
    assert.equal(f.state.cache.size,20);assert.equal(f.state.cache.has('abc123'),false);assert.equal(f.state.saved.length,0);
  }
});
