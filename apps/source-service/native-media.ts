import {session as electronSessions} from 'electron';
import {lookup} from 'node:dns/promises';
import {createServer,type Server} from 'node:http';
import {connect as connectSocket,isIP,Socket} from 'node:net';
import type {Duplex} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {publicAddress} from './public-media';
import {reject} from './protocol';

export interface NativeMediaAddress {address:string;family:4|6}
export type NativeMediaSession=Pick<Electron.Session,'fetch'|'setProxy'|'closeAllConnections'|'clearStorageData'|'setPermissionCheckHandler'|'setPermissionRequestHandler'> & {
  webRequest:Pick<Electron.WebRequest,'onBeforeRequest'>;
};
export interface NativeMediaOptions {
  createSession?:(partition:string)=>NativeMediaSession;
  lookup?:(host:string)=>Promise<readonly NativeMediaAddress[]>;
  connect?:(target:{host:string;port:443;family:4|6})=>Socket;
  maxRequests?:number;
  maxTunnels?:number;
  lookupTimeoutMs?:number;
  connectTimeoutMs?:number;
  idleTimeoutMs?:number;
  leaseTimeoutMs?:number;
}
type Target={url:URL;authority:string;host:string};
type Lease=Target & {id:string;address:NativeMediaAddress};
type Tunnel={authority:string;client:Duplex;upstream?:Socket;close:()=>void};
const cancelled=()=>new DOMException('Media request cancelled.','AbortError');
function abortable<T>(operation:Promise<T>,signal:AbortSignal):Promise<T>{
  return new Promise((resolve,fail)=>{
    const stop=()=>fail(cancelled());signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();
    operation.then(resolve,fail).finally(()=>signal.removeEventListener('abort',stop));
  });
}
async function bounded<T>(operation:Promise<T>,ms:number):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([operation,new Promise<never>((_,fail)=>{timer=setTimeout(()=>fail(Error('Native media initialization stalled.')),ms);timer.unref?.();})]);}
  finally{if(timer)clearTimeout(timer);}
}
function positive(value:number|undefined,fallback:number,maximum:number):number {
  const result=value??fallback;if(!Number.isSafeInteger(result)||result<1||result>maximum)throw Error('Invalid native media bound.');return result;
}
function target(raw:string):Target {
  if(typeof raw!=='string'||raw.length>16384||raw!==raw.trim()||/[\x00-\x1f\x7f]/.test(raw))return reject(502,'INVALID_MEDIA_DESTINATION');
  let url:URL;try{url=new URL(raw);}catch{return reject(502,'INVALID_MEDIA_DESTINATION');}
  if(url.protocol!=='https:'||url.username||url.password||url.hash||url.port&&url.port!=='443')return reject(502,'INVALID_MEDIA_DESTINATION');
  return {url,authority:url.hostname+':443',host:url.hostname.replace(/^\[|\]$/g,'')};
}
function authority(raw:string|undefined):string|null {
  if(!raw||raw.length>512||/[\s\x00-\x1f\x7f/@?#\\]/.test(raw))return null;
  try{const parsed=target('https://'+raw);return raw.toLowerCase()===parsed.authority?parsed.authority:null;}catch{return null;}
}

/**
 * Chromium media delivery through a private CONNECT-only byte tunnel. Node pins
 * the TCP destination; Chromium retains the original TLS/SNI/certificate check.
 * Only active receipt fetches lease exact HTTPS URLs and :443 authorities. This
 * is explicitly selected before resolution, never a fallback after a denial.
 */
export class NativeMediaTransport {
  private readonly options:Required<NativeMediaOptions>;
  private native?:NativeMediaSession;
  private server?:Server;
  private starting?:Promise<void>;
  private readonly leases=new Map<string,Lease>();
  private readonly clients=new Set<Duplex>();
  private readonly tunnels=new Set<Tunnel>();
  private readonly controllers=new Set<AbortController>();
  private active=0;
  private closed=false;
  constructor(options:NativeMediaOptions={}){
    this.options={
      createSession:options.createSession??(partition=>electronSessions.fromPartition(partition,{cache:false})),
      lookup:options.lookup??(async host=>(await lookup(host,{all:true,verbatim:true})).map(row=>({address:row.address,family:isIP(row.address) as 4|6}))),
      connect:options.connect??(destination=>connectSocket({...destination,autoSelectFamily:false})),
      maxRequests:positive(options.maxRequests,16,32),maxTunnels:positive(options.maxTunnels,32,64),
      lookupTimeoutMs:positive(options.lookupTimeoutMs,5000,30000),connectTimeoutMs:positive(options.connectTimeoutMs,5000,30000),
      idleTimeoutMs:positive(options.idleTimeoutMs,30000,120000),leaseTimeoutMs:positive(options.leaseTimeoutMs,10*60000,30*60000),
    };
  }
  private leasedUrl(raw:string):boolean {
    let requested:Target;try{requested=target(raw);}catch{return false;}
    return [...this.leases.values()].some(lease=>lease.url.href===requested.url.href);
  }
  private async start():Promise<void>{
    if(this.closed)return reject(503,'NATIVE_MEDIA_CLOSED');
    if(this.starting)return this.starting;
    this.starting=(async()=>{
      const server=createServer({maxHeaderSize:8192},(_request,response)=>{response.writeHead(403,{'Connection':'close'});response.end();});
      this.server=server;server.maxConnections=this.options.maxTunnels+8;server.headersTimeout=5000;server.requestTimeout=5000;
      server.on('error',()=>{void this.close().catch(()=>{});});
      server.on('connection',socket=>{this.clients.add(socket);socket.setTimeout(5000,()=>socket.destroy());socket.on('error',()=>socket.destroy());socket.once('close',()=>this.clients.delete(socket));});
      server.on('clientError',(_error,socket)=>socket.destroy());
      server.on('connect',(request,client,head)=>this.tunnel(request.url,client,head));
      await bounded(new Promise<void>((resolve,rejectListen)=>{
        server.once('error',rejectListen);
        server.listen(0,'127.0.0.1',()=>{
          server.removeListener('error',rejectListen);
          // close() may run while Node's loopback listen callback is pending.
          if(this.closed){try{server.close();}catch{}rejectListen(Error('Native media closed.'));return;}
          resolve();
        });
      }),this.options.connectTimeoutMs);
      if(this.closed)return reject(503,'NATIVE_MEDIA_CLOSED');
      const address=server.address();if(!address||typeof address==='string'||address.address!=='127.0.0.1')return reject(503,'NATIVE_MEDIA_UNAVAILABLE');
      const native=this.options.createSession('source-media-'+randomUUID());this.native=native;
      native.setPermissionCheckHandler(()=>false);native.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
      native.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,callback)=>callback({cancel:this.closed||details.method!=='GET'||!this.leasedUrl(details.url)}));
      await bounded(native.setProxy({mode:'fixed_servers',proxyRules:`http=127.0.0.1:${address.port};https=127.0.0.1:${address.port}`,proxyBypassRules:'<-loopback>'}),this.options.connectTimeoutMs);
      await bounded(native.closeAllConnections(),this.options.connectTimeoutMs);
    })().catch(async()=>{await this.close();return reject(503,'NATIVE_MEDIA_UNAVAILABLE');});
    return this.starting;
  }
  private tunnel(raw:string|undefined,client:Duplex,head:Buffer):void {
    const key=authority(raw),lease=key&&[...this.leases.values()].find(row=>row.authority===key);
    if(this.closed||!lease||!(client instanceof Socket)||this.tunnels.size>=this.options.maxTunnels||head.length>65536){client.destroy();return;}
    let timer:ReturnType<typeof setTimeout>|undefined,finished=false;
    const row:Tunnel={authority:lease.authority,client,close:()=>{
      if(finished)return;finished=true;if(timer)clearTimeout(timer);this.tunnels.delete(row);client.destroy();row.upstream?.destroy();
    }};
    this.tunnels.add(row);client.on('error',row.close);client.once('close',row.close);
    try{
      const upstream=this.options.connect({host:lease.address.address,family:lease.address.family,port:443});row.upstream=upstream;
      timer=setTimeout(row.close,this.options.connectTimeoutMs);timer.unref?.();
      upstream.once('error',row.close);upstream.once('close',row.close);
      upstream.once('connect',()=>{
        if(finished||this.closed||![...this.leases.values()].some(current=>current.authority===row.authority)){row.close();return;}
        if(timer)clearTimeout(timer);client.setTimeout(this.options.idleTimeoutMs,row.close);upstream.setTimeout(this.options.idleTimeoutMs,row.close);
        upstream.setNoDelay(true);
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if(head.length)upstream.write(head);
        // Opaque byte forwarding only: no TLS termination, HTTP parsing, or header changes.
        client.pipe(upstream);upstream.pipe(client);
      });
    }catch{row.close();}
  }
  private async resolve(destination:Target,signal:AbortSignal):Promise<NativeMediaAddress>{
    if(signal.aborted)throw cancelled();
    let timer:ReturnType<typeof setTimeout>|undefined,onAbort:()=>void=()=>{};
    try{
      const addresses=await Promise.race([
        isIP(destination.host)?Promise.resolve([{address:destination.host,family:isIP(destination.host) as 4|6}]):this.options.lookup(destination.host),
        new Promise<never>((_,fail)=>{timer=setTimeout(()=>fail(Error('DNS unavailable.')),this.options.lookupTimeoutMs);timer.unref?.();}),
        new Promise<never>((_,fail)=>{onAbort=()=>fail(cancelled());signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();}),
      ]);
      if(!addresses.length||addresses.some(row=>!publicAddress(row.address)||isIP(row.address)!==row.family))return reject(502,'INVALID_MEDIA_DESTINATION');
      return addresses.find(row=>row.family===4)??addresses[0];
    }catch(error){if(signal.aborted)throw cancelled();return reject(502,'INVALID_MEDIA_DESTINATION');}
    finally{if(timer)clearTimeout(timer);signal.removeEventListener('abort',onAbort);}
  }
  private release(lease:Lease):void {
    this.leases.delete(lease.id);
    if(![...this.leases.values()].some(current=>current.authority===lease.authority))for(const tunnel of this.tunnels)if(tunnel.authority===lease.authority)tunnel.close();
  }
  async fetch(raw:string,headers:Headers,signal:AbortSignal):Promise<Response>{
    const destination=target(raw);
    if(signal.aborted)throw cancelled();
    if(this.closed)return reject(503,'NATIVE_MEDIA_CLOSED');
    if(this.active>=this.options.maxRequests)return reject(503,'NATIVE_MEDIA_BUSY');
    this.active++;
    const controller=new AbortController();this.controllers.add(controller);
    const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});
    let lease:Lease|undefined,timer:ReturnType<typeof setTimeout>|undefined,finished=false;
    const finish=()=>{if(finished)return;finished=true;if(timer)clearTimeout(timer);signal.removeEventListener('abort',abort);this.controllers.delete(controller);if(lease)this.release(lease);this.active--;};
    try{
      timer=setTimeout(()=>controller.abort(),this.options.leaseTimeoutMs);timer.unref?.();
      const address=await this.resolve(destination,controller.signal);await abortable(this.start(),controller.signal);
      if(controller.signal.aborted||this.closed)throw cancelled();
      lease={...destination,address,id:randomUUID()};this.leases.set(lease.id,lease);
      const outgoing=new Headers(headers);outgoing.set('Accept-Encoding','identity');
      for(const name of ['host','connection','content-length','transfer-encoding','proxy-authorization','proxy-connection','upgrade'])outgoing.delete(name);
      const request=this.native!.fetch(destination.url.href,{method:'GET',headers:outgoing,redirect:'error',credentials:'omit',signal:controller.signal,bypassCustomProtocolHandlers:true})
        .then(async response=>{if(controller.signal.aborted){await response.body?.cancel();throw cancelled();}return response;});
      const response=await abortable(request,controller.signal);
      if(controller.signal.aborted||this.closed){await response.body?.cancel();throw cancelled();}
      if(response.redirected||response.url&&response.url!==destination.url.href||response.status>=300&&response.status<400||response.status<200){await response.body?.cancel();return reject(502,'NATIVE_MEDIA_REDIRECT');}
      const responseHeaders=new Headers(response.headers);responseHeaders.delete('set-cookie');
      if(!response.ok){await response.body?.cancel();finish();return new Response(null,{status:response.status,headers:responseHeaders});}
      if(!response.body){finish();return new Response(null,{status:response.status,headers:responseHeaders});}
      const reader=response.body.getReader();
      let failBody:(error:Error)=>void=()=>{};
      const body=new ReadableStream<Uint8Array>({
        start(stream){failBody=error=>stream.error(error);},
        async pull(stream){try{const part=await reader.read();if(controller.signal.aborted)throw cancelled();if(part.done){finish();stream.close();}else stream.enqueue(part.value);}catch{finish();stream.error(controller.signal.aborted?cancelled():Error('NATIVE_MEDIA_UNAVAILABLE'));}},
        async cancel(reason){controller.abort();try{await reader.cancel(reason);}finally{finish();}},
      });
      // A caller abort must release the authority even if the consumer stops pulling.
      controller.signal.addEventListener('abort',()=>{failBody(cancelled());void reader.cancel().catch(()=>{});finish();},{once:true});
      return new Response(body,{status:response.status,headers:responseHeaders});
    }catch(error){finish();if(signal.aborted||controller.signal.aborted)throw cancelled();if(error&&typeof error==='object'&&'code'in error)throw error;return reject(502,'NATIVE_MEDIA_UNAVAILABLE');}
  }
  async close():Promise<void>{
    if(this.closed)return;this.closed=true;
    for(const controller of this.controllers)controller.abort();for(const tunnel of this.tunnels)tunnel.close();for(const client of this.clients)client.destroy();this.leases.clear();
    const native=this.native,server=this.server;
    if(server)await bounded(new Promise<void>(resolve=>{try{server.close(()=>resolve());}catch{resolve();}}),5000).catch(()=>{});
    if(native){await bounded(native.closeAllConnections(),5000).catch(()=>{});await bounded(native.clearStorageData(),5000).catch(()=>{});}
  }
}
