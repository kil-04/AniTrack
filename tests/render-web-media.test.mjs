import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
registerHooks({
  resolve(specifier,context,next){try{return next(specifier,context);}catch(error){if(/^\.{1,2}\//.test(specifier)&&! /\.[a-z0-9]+$/i.test(specifier))return next(specifier+'.ts',context);throw error;}},
  load(url,context,next){if(url.endsWith('.ts')&&(url.includes('/apps/web/')||url.includes('/apps/source-service/')))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText};return next(url,context);},
});
const {safeMedia}=await import('../apps/web/server/media.ts');
const request=new Request('https://website.example/api/media');
test('Website media never serves source HTML, JavaScript, JSON or SVG as active app content',async()=>{
  for(const type of ['text/html','application/javascript','application/json','image/svg+xml'])await assert.rejects(safeMedia(new Response('<script>unsafe</script>',{headers:{'Content-Type':type}}),request),/unsupported/);
});
test('Genuine MPEG-TS with a source JavaScript label is replayed exactly with a video MIME',async()=>{
  const bytes=new Uint8Array(188*5);for(let i=0;i<bytes.length;i+=188){bytes[i]=0x47;bytes[i+3]=0x10;}
  const response=await safeMedia(new Response(new ReadableStream({start(controller){controller.enqueue(bytes.slice(0,300));controller.enqueue(bytes.slice(300));controller.close();}}),{headers:{'Content-Type':'application/javascript','Content-Length':String(bytes.length)}}),request);
  assert.equal(response.headers.get('content-type'),'video/mp2t');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
});
test('Safe video ranges and text captions preserve their bytes and status',async()=>{
  const response=await safeMedia(new Response(new Uint8Array([1,2,3]),{status:206,headers:{'Content-Type':'video/mp4','Content-Range':'bytes 1-3/100'}}),new Request(request,{headers:{Range:'bytes=1-3'}}));
  assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 1-3/100');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array([1,2,3]));
  const caption=await safeMedia(new Response('WEBVTT\n\n',{headers:{'Content-Type':'text/vtt'}}),request);assert.equal(await caption.text(),'WEBVTT\n\n');
});
test('Active content in a byte-range response is refused without treating a fragment as a file',async()=>{
  await assert.rejects(safeMedia(new Response('partial',{status:206,headers:{'Content-Type':'text/html'}}),new Request(request,{headers:{Range:'bytes=100-200'}})),/unsupported/);
});
