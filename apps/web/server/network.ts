import {lookup as dnsLookup} from 'node:dns/promises';
import {isIP,type LookupFunction} from 'node:net';
import {request as httpsRequest} from 'node:https';
import {Readable} from 'node:stream';
import type {IncomingMessage,ClientRequest} from 'node:http';
import {publicAddress} from '../../source-service/public-media';

interface Address {address:string;family:number}
export interface ServerNetworkOptions {
  lookup?:(hostname:string)=>Promise<readonly Address[]>;
  request?:typeof httpsRequest;
  timeoutMs?:number;
}
class NetworkError extends Error {
  constructor(readonly code:string,message:string){super(message);this.name='ServerNetworkError';}
}
const invalid=()=>new NetworkError('ERR_WEB_DESTINATION','Invalid source destination.');
const cancelled=()=>new NetworkError('ERR_WEB_ABORTED','Source request cancelled.');
const unavailable=()=>new NetworkError('ERR_WEB_NETWORK','The source could not be reached.');
const OMIT_RESPONSE=new Set(['set-cookie','set-cookie2','connection','keep-alive','transfer-encoding','proxy-authenticate','proxy-authorization','te','trailer','upgrade']);

/** HTTPS only, every DNS answer checked, with one checked address pinned to TLS. */
export function createServerFetch(options:ServerNetworkOptions={}){
  const resolve=options.lookup??(host=>dnsLookup(host,{all:true,verbatim:true}));
  const requestHttps=options.request??httpsRequest,timeoutMs=options.timeoutMs??30000;
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw new Error('Invalid network deadline.');
  return async function serverFetch(raw:string|URL,init:RequestInit={}):Promise<Response>{
    let url:URL;
    try{if(typeof raw!=='string'&&!(raw instanceof URL))throw invalid();url=new URL(String(raw));}catch{throw invalid();}
    if(url.protocol!=='https:'||url.username||url.password||url.hash||url.port&&url.port!=='443')throw invalid();
    if(init.method!==undefined&&typeof init.method!=='string')throw new NetworkError('ERR_WEB_REQUEST','Unsupported source request.');
    const method=(init.method??'GET').toUpperCase();
    if(!['GET','POST','PUT'].includes(method))throw new NetworkError('ERR_WEB_REQUEST','Unsupported source request.');
    let body:Buffer|undefined;
    if(init.body!=null){
      if(!['POST','PUT'].includes(method)||typeof init.body!=='string'&&!(init.body instanceof Uint8Array))throw new NetworkError('ERR_WEB_REQUEST','Unsupported source request body.');
      body=Buffer.from(init.body);if(body.byteLength>65536)throw new NetworkError('ERR_WEB_REQUEST','Source request body is too large.');
    }
    const headers=new Headers(init.headers);
    for(const name of ['host','connection','content-length','transfer-encoding','proxy-authorization','proxy-connection','upgrade','te','trailer'])headers.delete(name);
    headers.set('Accept-Encoding','identity');
    if(body)headers.set('Content-Length',String(body.byteLength));
    const scope=new AbortController();
    let request:ClientRequest|undefined,incoming:IncomingMessage|undefined,finished=false;
    const abort=()=>scope.abort(cancelled());
    const timer=setTimeout(()=>scope.abort(new NetworkError('ERR_WEB_TIMEOUT','Source request timed out.')),timeoutMs);timer.unref?.();
    init.signal?.addEventListener('abort',abort,{once:true});if(init.signal?.aborted)abort();
    const failure=()=>scope.signal.aborted?scope.signal.reason as NetworkError:unavailable();
    const cleanup=()=>{if(finished)return;finished=true;clearTimeout(timer);init.signal?.removeEventListener('abort',abort);scope.signal.removeEventListener('abort',stop);};
    const stop=()=>{const error=failure();request?.destroy(error);incoming?.destroy(error);};
    scope.signal.addEventListener('abort',stop,{once:true});
    let rejectAbort:(reason:Error)=>void=()=>{};
    const onAbort=()=>rejectAbort(failure());
    const interrupted=new Promise<never>((_,reject)=>{rejectAbort=reject;scope.signal.addEventListener('abort',onAbort,{once:true});if(scope.signal.aborted)onAbort();});
    try{
      const host=url.hostname.replace(/^\[|\]$/g,''),literal=isIP(host);
      const answers=literal?[{address:host,family:literal}]:await Promise.race([resolve(host),interrupted]);
      if(scope.signal.aborted)throw failure();
      if(!answers.length||answers.some(row=>!publicAddress(row.address)||isIP(row.address)!==row.family))throw invalid();
      const chosen=answers.find(row=>row.family===4)??answers[0];
      const pinned:LookupFunction=(_host,lookupOptions,callback)=>{
        if((lookupOptions as {all?:boolean}).all)(callback as (...args:any[])=>void)(null,[chosen]);
        else callback(null,chosen.address,chosen.family);
      };
      const response=await Promise.race([new Promise<Response>((resolveResponse,rejectResponse)=>{
        request=requestHttps(url,{method,headers:Object.fromEntries(headers),lookup:pinned,servername:literal?undefined:host,rejectUnauthorized:true,agent:false},response=>{try{
          incoming=response;
          if(scope.signal.aborted){response.destroy();rejectResponse(failure());return;}
          const status=response.statusCode??502,responseHeaders=new Headers();
          if(!Number.isInteger(status)||status<200||status>599)throw unavailable();
          for(const [name,value]of Object.entries(response.headers))if(value!==undefined&&!OMIT_RESPONSE.has(name.toLowerCase()))responseHeaders.set(name,Array.isArray(value)?value.join(', '):value);
          if([204,205,304].includes(status)){
            response.destroy();cleanup();const result=new Response(null,{status,headers:responseHeaders});Object.defineProperty(result,'url',{value:url.href});resolveResponse(result);return;
          }
          const reader=(Readable.toWeb(response,{strategy:{highWaterMark:0}}) as ReadableStream<Uint8Array>).getReader();
          const stream=new ReadableStream<Uint8Array>({
            async pull(controller){try{const part=await reader.read();if(part.done){cleanup();controller.close();}else controller.enqueue(part.value);}catch{cleanup();controller.error(failure());}},
            async cancel(){cleanup();response.destroy();request?.destroy();await reader.cancel().catch(()=>{});},
          },{highWaterMark:0});
          const result=new Response(stream,{status,headers:responseHeaders});Object.defineProperty(result,'url',{value:url.href});resolveResponse(result);
        }catch{response.destroy();cleanup();rejectResponse(failure());}
        });
        request.once('error',()=>{incoming?.destroy();cleanup();rejectResponse(failure());});
        request.setTimeout(timeoutMs,()=>scope.abort(new NetworkError('ERR_WEB_TIMEOUT','Source request timed out.')));
        if(scope.signal.aborted){request.destroy(failure());return;}
        request.end(body);
      }),interrupted]);
      return response;
    }catch(error){cleanup();request?.destroy();incoming?.destroy();throw error instanceof NetworkError?error:failure();}
    finally{scope.signal.removeEventListener('abort',onAbort);}
  };
}
export const serverFetch=createServerFetch();
