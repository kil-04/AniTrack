import {createReadStream} from 'node:fs';
import {readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {rpc,mediaResponse,pageImage,archiveMedia} from '../lib/gateway';
import {configureRuntime} from './runtime';

const MIME:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.woff2':'font/woff2','.woff':'font/woff','.mp3':'audio/mpeg','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8'};
const SAFE={'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'};
const MAX_BODY=65536,MAX_API=8,INPUT_DEADLINE_MS=10000,API_DEADLINE_MS=125000,CHUNK=65536;
export interface WebsiteOptions {directory:string;origin:string;environment:Record<string,unknown>;sourceFetch:typeof fetch}
class WebsiteError extends Error {constructor(public readonly status:number,message:string){super(message);}}
const cancelled=()=>new WebsiteError(499,'Request cancelled.');
const failure=(error:unknown)=>{
  const sourceStatus=error&&typeof error==='object'&&'sourceStatus'in error?error.sourceStatus:undefined;
  const status=error instanceof WebsiteError?error.status:sourceStatus===401||sourceStatus===403||sourceStatus===429?sourceStatus:502;
  const message=status===429?'This source is busy (HTTP 429). Wait before trying again.':error instanceof WebsiteError?error.message:error instanceof Error&&error.message.startsWith('PROVIDER_ACCESS_DENIED:')?'PROVIDER_ACCESS_DENIED: This source needs its website check. Choose another source.':sourceStatus===401?'This connection needs authorization (HTTP 401). Reconnect your account.':sourceStatus===403?'This source needs its website check. Choose another source.':'The source could not be reached.';
  const raw=error&&typeof error==='object'&&'retryAfter'in error?error.retryAfter:undefined;
  const retryAfter=typeof raw==='number'&&Number.isFinite(raw)&&raw>0?Math.max(1,Math.min(86400,Math.ceil(raw))):60;
  return Response.json({error:message},{status,headers:{...SAFE,'Cache-Control':'no-store',...(status===429?{'Retry-After':String(retryAfter)}:{})}});
};

async function input(request:Request){
  if(request.signal.aborted)throw cancelled();
  if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new WebsiteError(415,'Expected a JSON request.');
  if(Number(request.headers.get('content-length'))>MAX_BODY)throw new WebsiteError(413,'Request is too large.');
  const reader=request.body?.getReader();if(!reader)throw new WebsiteError(400,'Invalid request.');
  let timer:ReturnType<typeof setTimeout>|undefined,onAbort=()=>{};
  const interrupted=new Promise<never>((_,reject)=>{
    onAbort=()=>reject(cancelled());request.signal.addEventListener('abort',onAbort,{once:true});
    if(request.signal.aborted)onAbort();
    timer=setTimeout(()=>reject(new WebsiteError(408,'Request body took too long.')),INPUT_DEADLINE_MS);timer.unref?.();
  });
  const parts:Uint8Array[]=[];let length=0;
  try{
    for(;;){const part=await Promise.race([reader.read(),interrupted]);if(part.done)break;length+=part.value.byteLength;if(length>MAX_BODY)throw new WebsiteError(413,'Request is too large.');parts.push(part.value);}
    try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new WebsiteError(400,'Invalid request.');}
  }finally{
    if(timer)clearTimeout(timer);request.signal.removeEventListener('abort',onAbort);
    // A hostile/failed producer's cancel hook must not hold the request open.
    void reader.cancel().catch(()=>{});
  }
}

function pathname(url:URL):string|undefined{
  if(/%2f|%5c/i.test(url.pathname))return;
  let decoded:string;try{decoded=decodeURIComponent(url.pathname);}catch{return;}
  if(decoded.includes('\\')||/[\x00-\x1f\x7f]/.test(decoded)||decoded.split('/').some(part=>part==='.'||part==='..'||part.startsWith('.')))return;
  return decoded;
}

/** One pull at a time; no prefetch, and no chunk pins a larger upstream buffer. */
function responseBody(response:Response,signal:AbortSignal,complete:()=>void):Response{
  const headers=new Headers(response.headers);for(const [name,value] of Object.entries(SAFE))headers.set(name,value);
  for(const name of [...headers.keys()])if(name.startsWith('access-control-'))headers.delete(name);
  if(!response.body){complete();return new Response(null,{status:response.status,statusText:response.statusText,headers});}
  const reader=response.body.getReader();let pending:Uint8Array|undefined,offset=0,finished=false;
  let control:ReadableStreamDefaultController<Uint8Array>|undefined;
  const finish=(error?:unknown)=>{
    if(finished)return;finished=true;pending=undefined;signal.removeEventListener('abort',abort);
    if(error){try{control?.error(error);}catch{}}
    void reader.cancel(error).catch(()=>{});complete();
  };
  const abort=()=>finish(cancelled());
  const body=new ReadableStream<Uint8Array>({
    start(controller){control=controller;signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();},
    async pull(controller){
      if(finished)return;
      try{
        let empty=0;
        while(!pending||offset>=pending.byteLength){const part=await reader.read();if(finished)return;if(part.done){controller.close();finish();return;}if(!part.value.byteLength){if(++empty>32)throw Error('Invalid empty source stream.');continue;}pending=part.value;offset=0;}
        const end=Math.min(offset+CHUNK,pending.byteLength);controller.enqueue(pending.slice(offset,end));offset=end;
        if(offset===pending.byteLength){pending=undefined;offset=0;}
      }catch(error){finish(error);}
    },
    cancel(reason){finish(reason);},
  },{highWaterMark:0});
  try{return new Response(body,{status:response.status,statusText:response.statusText,headers});}
  catch(error){finish(error);throw error;}
}

export async function createWebsite(options:WebsiteOptions){
  const root=path.resolve(options.directory),parsedOrigin=new URL(options.origin),origin=parsedOrigin.origin;
  if(origin!==options.origin||!['https:','http:'].includes(parsedOrigin.protocol))throw Error('Invalid website origin.');
  configureRuntime(options.environment,options.sourceFetch);
  const files=new Map<string,{file:string;size:number;type:string}>();
  async function collect(directory:string,prefix=''){
    for(const entry of await readdir(directory,{withFileTypes:true})){
      if(entry.name.startsWith('.'))continue;
      const relative=prefix+entry.name,absolute=path.join(directory,entry.name);
      if(entry.isDirectory())await collect(absolute,relative+'/');
      else if(entry.isFile()&&MIME[path.extname(entry.name)])files.set('/'+relative,{file:absolute,size:(await stat(absolute)).size,type:MIME[path.extname(entry.name)]});
    }
  }
  await collect(root);if(!files.has('/index.html'))throw Error('The website build is missing.');
  let apiActive=0;
  return async(request:Request):Promise<Response>=>{
    const url=new URL(request.url);
    if(url.origin!==origin)return failure(new WebsiteError(403,'Invalid request origin.'));
    if(url.pathname.startsWith('/api/')){
      const supplied=request.headers.get('origin');
      if(supplied&&supplied!==origin||request.headers.get('sec-fetch-site')==='cross-site')return failure(new WebsiteError(403,'Invalid request origin.'));
      const isRpc=url.pathname==='/api/rpc'&&request.method==='POST';
      const isMedia=request.method==='GET'&&['/api/media','/api/page','/api/archive'].includes(url.pathname);
      if(!isRpc&&!isMedia)return failure(new WebsiteError(404,'Not found.'));
      if(request.signal.aborted)return failure(cancelled());
      if(apiActive>=MAX_API)return failure(new WebsiteError(429,'AniTrack is busy. Try again shortly.'));
      apiActive++;
      const scope=new AbortController();let operationSettled=false,bodySettled=false,released=false;
      let timer:ReturnType<typeof setTimeout>|undefined,onAbort=()=>{},interrupt:(error:WebsiteError)=>void=()=>{};
      const release=()=>{if(!released&&operationSettled&&bodySettled){released=true;apiActive--;if(timer)clearTimeout(timer);request.signal.removeEventListener('abort',onAbort);}};
      const interrupted=new Promise<never>((_,reject)=>{
        interrupt=error=>{scope.abort(error);reject(error);};
        onAbort=()=>interrupt(cancelled());request.signal.addEventListener('abort',onAbort,{once:true});
        if(request.signal.aborted)onAbort();
        timer=setTimeout(()=>interrupt(new WebsiteError(504,'The source request took too long.')),API_DEADLINE_MS);timer.unref?.();
      });
      const operation=(async()=>{
        if(scope.signal.aborted)throw scope.signal.reason;
        const scoped=new Request(request,{signal:scope.signal});
        if(isRpc){
          const body=await input(scoped);
          if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['operation','args'].includes(key))||typeof body.operation!=='string'||!body.operation||body.operation.length>120||!Array.isArray(body.args)||body.args.length>8)throw new WebsiteError(400,'Invalid request.');
          if(scope.signal.aborted)throw scope.signal.reason;
          const encoded=JSON.stringify({value:await rpc(body.operation,body.args)});
          if(Buffer.byteLength(encoded)>8*1024*1024)throw new WebsiteError(502,'The source returned too much data.');
          return new Response(encoded,{headers:{...SAFE,'Content-Type':'application/json','Cache-Control':'no-store'}});
        }
        if(url.pathname==='/api/media')return mediaResponse(scoped);
        if(url.pathname==='/api/page')return pageImage(scoped);
        return archiveMedia(scoped);
      })();
      // Do not release an uninterruptible source operation's slot on timeout.
      const tracked=operation.then(response=>{operationSettled=true;release();return response;},error=>{operationSettled=true;release();throw error;});
      try{
        const response=await Promise.race([tracked,interrupted]);
        if(scope.signal.aborted){void response.body?.cancel().catch(()=>{});bodySettled=true;release();return failure(scope.signal.reason);}
        return responseBody(response,scope.signal,()=>{bodySettled=true;release();});
      }catch(error){
        bodySettled=true;release();
        // If cancellation won, a later response must not retain an unread body.
        void tracked.then(response=>response.body?.cancel().catch(()=>{}),()=>{});
        return failure(error);
      }
    }
    if(!['GET','HEAD'].includes(request.method))return new Response('Not found',{status:404,headers:SAFE});
    if(request.signal.aborted)return failure(cancelled());
    const decoded=pathname(url),selected=decoded?files.get(decoded==='/'?'/index.html':decoded):undefined;
    if(!selected)return new Response('Not found',{status:404,headers:SAFE});
    const headers=new Headers({...SAFE,'Content-Type':selected.type,'Accept-Ranges':'bytes','Cache-Control':decoded?.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache'});
    let start=0,end=selected.size-1,status=200;
    const range=request.headers.get('range');
    if(range){
      const invalid=()=>new Response(null,{status:416,headers:{...SAFE,'Accept-Ranges':'bytes','Content-Range':'bytes */'+selected.size}});
      const match=/^bytes=(\d*)-(\d*)$/.exec(range);
      if(!match||!match[1]&&!match[2])return invalid();
      const first=match[1]?Number(match[1]):undefined,last=match[2]?Number(match[2]):undefined;
      if(first!==undefined&&!Number.isSafeInteger(first)||last!==undefined&&!Number.isSafeInteger(last))return invalid();
      if(first===undefined){if(!last)return invalid();start=Math.max(0,selected.size-last);}
      else{start=first;if(last!==undefined)end=Math.min(last,end);}
      if(start<0||start>end||start>=selected.size)return invalid();
      status=206;headers.set('Content-Range','bytes '+start+'-'+end+'/'+selected.size);
    }
    headers.set('Content-Length',String(Math.max(0,end-start+1)));
    if(request.method==='HEAD'||!selected.size)return new Response(null,{status,headers});
    const stream=createReadStream(selected.file,{start,end,highWaterMark:CHUNK});
    const source=new Response(Readable.toWeb(stream,{strategy:{highWaterMark:0}}) as ReadableStream,{status,headers});
    return responseBody(source,request.signal,()=>{});
  };
}
