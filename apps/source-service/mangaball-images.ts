import {lookup} from 'node:dns/promises';
import {createHash} from 'node:crypto';
import {VerifiedPageSession,type VerifiedPageSessionOptions,type VerifiedPageResponse} from '../desktop/main/services/providers/verified-page-session';
import {publicAddress} from './public-media';
import {reject,ServiceError} from './protocol';

/** Exact reviewed hosts named in packages/shared/manga.ts; changes need review. */
const CDN_HOSTS=new Set(['bulbasaur.poke-black-and-white.net','chikorita.red-and-blue.net']);
const MAX_IMAGES=4096,MAX_HOSTS=2,MAX_BYTES=20*1024*1024,TTL=2*60*60*1000;
const ACCEPT='image/avif,image/webp,image/png,image/jpeg,image/gif,image/bmp';
interface ImageSession {
  isConnected():boolean;
  get(url:string,accept:string,headers:string[],encoding:'base64'):Promise<VerifiedPageResponse>;
  connect(url:string,parent:null):Promise<void>;
  close():void;
}
export interface MangaBallImageOptions {
  createSession?:(options:VerifiedPageSessionOptions)=>ImageSession;
  resolveHost?:(host:string)=>Promise<readonly string[]>;
  now?:()=>number;
}
type Host={session?:ImageSession;ready:boolean;stopped?:403|429;retryAt?:number;busy:boolean;connecting?:Promise<void>;queued:number;tail:Promise<void>};
type Registration={host:string;expires:number};
const aborted=()=>new DOMException('The image request was cancelled.','AbortError');

function imageUrl(raw:string):URL {
  if(typeof raw!=='string'||raw.length>16384||raw!==raw.trim()||/[\x00-\x1f\x7f]/.test(raw))return reject(502,'INVALID_PAGE_IMAGE');
  let url:URL;try{url=new URL(raw);}catch{return reject(502,'INVALID_PAGE_IMAGE');}
  if(url.protocol!=='https:'||url.username||url.password||url.hash||url.port&&url.port!=='443'||
    !CDN_HOSTS.has(url.hostname))return reject(502,'INVALID_PAGE_IMAGE');
  return url;
}
function validImage(type:string,bytes:Buffer):boolean {
  const head=bytes.subarray(0,64),ascii=head.toString('ascii');
  if(type==='image/jpeg')return head.length>=3&&head[0]===255&&head[1]===216&&head[2]===255;
  if(type==='image/png')return head.length>=8&&head.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if(type==='image/gif')return /^GIF8[79]a/.test(ascii);
  if(type==='image/webp')return head.length>=12&&ascii.slice(0,4)==='RIFF'&&ascii.slice(8,12)==='WEBP';
  if(type==='image/avif')return head.length>=16&&ascii.slice(4,8)==='ftyp'&&/(?:avif|avis)/.test(ascii.slice(8));
  return type==='image/bmp'&&head.length>=14&&ascii.startsWith('BM');
}

/**
 * Browser transport for explicitly registered native MangaBall pageImages only.
 * A failed ordinary image request must call stop(); it never falls back to this
 * session automatically. Only the separate operator's named Connect may open it.
 * DNS answers are checked before use; VerifiedPageSession does not pin Chromium's
 * own resolver. Deployment must retain its network private-address deny policy;
 * these checks alone are not an absolute DNS-rebinding guarantee.
 */
export class MangaBallImages {
  private images=new Map<string,Registration>();
  private hosts=new Map<string,Host>();
  private lastRegistered?:string;
  private lastFailed?:string;
  private closed=false;
  private readonly createSession:(options:VerifiedPageSessionOptions)=>ImageSession;
  private readonly resolveHost:(host:string)=>Promise<readonly string[]>;
  private readonly now:()=>number;
  constructor(options:MangaBallImageOptions={}){
    this.createSession=options.createSession??(settings=>new VerifiedPageSession(settings));
    this.resolveHost=options.resolveHost??(async host=>(await lookup(host,{all:true,verbatim:true})).map(row=>row.address));
    this.now=options.now??Date.now;
  }
  private prune(){
    if(this.closed)return reject(503,'SERVICE_UNAVAILABLE');
    const now=this.now();for(const [url,row] of this.images)if(row.expires<=now)this.images.delete(url);
    const live=new Set([...this.images.values()].map(row=>row.host));
    for(const [host,row] of this.hosts)if(!live.has(host)&&!row.queued&&!row.busy&&!row.connecting){row.session?.close();this.hosts.delete(host);}
  }
  private async publicHost(host:string){
    let addresses:readonly string[];try{addresses=await this.resolveHost(host);}catch{return reject(502,'INVALID_MEDIA_DESTINATION');}
    if(!addresses.length||addresses.some(address=>!publicAddress(address)))return reject(502,'INVALID_MEDIA_DESTINATION');
  }
  private registered(raw:string):{url:URL;host:Host}{
    this.prune();const url=imageUrl(raw),registration=this.images.get(url.href),host=this.hosts.get(url.hostname);
    if(!registration||registration.expires<=this.now()||!host)return reject(403,'INVALID_PAGE_IMAGE');
    return {url,host};
  }
  /** Call only with the existing native connector's returned pageImages list. */
  async registerImages(pages:readonly {url:string}[]):Promise<void>{
    this.prune();if(!pages.length||pages.length>1000)return reject(502,'INVALID_PAGE_LIST');
    const urls=[...new Set(pages.map(page=>imageUrl(page.url).href))],hosts=[...new Set(urls.map(raw=>new URL(raw).hostname))];
    const newImages=urls.filter(url=>!this.images.has(url)).length,newHosts=hosts.filter(host=>!this.hosts.has(host)).length;
    if(this.images.size+newImages>MAX_IMAGES||this.hosts.size+newHosts>MAX_HOSTS)return reject(503,'SERVICE_BUSY');
    for(const host of hosts)await this.publicHost(host);
    this.prune();
    // Check bounds again after asynchronous DNS, before making the entire list visible.
    if(this.images.size+urls.filter(url=>!this.images.has(url)).length>MAX_IMAGES||this.hosts.size+hosts.filter(host=>!this.hosts.has(host)).length>MAX_HOSTS)return reject(503,'SERVICE_BUSY');
    for(const raw of urls){const host=new URL(raw).hostname;this.images.set(raw,{host,expires:this.now()+TTL});if(!this.hosts.has(host))this.hosts.set(host,{ready:false,busy:false,queued:0,tail:Promise.resolve()});}
    this.lastRegistered=urls[0];
  }
  /** Only these exact, observed public CDN origins may enter the service operator. */
  approvedOrigins():Set<string>{this.prune();return new Set([...this.hosts.keys()].map(host=>'https://'+host));}
  accessMode(raw:string):'public'|'verified'|'blocked'{
    const {host}=this.registered(raw);return host.stopped?'blocked':host.ready?'verified':'public';
  }
  /** Record an actual 403/429; throw immediately without any browser load or retry. */
  stop(raw:string,status:403|429):never{
    const {url,host}=this.registered(raw);
    if(status!==403&&status!==429)return reject(502,'INVALID_PAGE_IMAGE');
    host.ready=false;host.stopped=status;host.retryAt=status===429?this.now()+60000:undefined;this.lastFailed=url.href;
    return reject(status,status===429?'SOURCE_RATE_LIMITED':'SOURCE_VERIFICATION_REQUIRED');
  }
  /** Explicit human operation, with no caller-supplied URL or browser code. */
  connect():Promise<void>{
    this.prune();const raw=this.lastFailed&&this.images.has(this.lastFailed)?this.lastFailed:this.lastRegistered;
    if(!raw)return Promise.reject(new ServiceError(409,'SOURCE_CONNECTION_UNAVAILABLE'));
    const {url,host}=this.registered(raw);
    if(host.connecting)return host.connecting;
    if(host.queued||host.busy)return Promise.reject(new ServiceError(503,'SERVICE_BUSY'));
    if(host.stopped===429&&this.now()<(host.retryAt??0))return Promise.reject(new ServiceError(429,'SOURCE_RATE_LIMITED'));
    host.ready=false;
    const pending=(async()=>{
      await this.publicHost(url.hostname);
      if(this.closed)return reject(503,'SERVICE_UNAVAILABLE');
      host.session?.close();
      const partition='persist:source-mangaball-'+createHash('sha256').update(url.origin).digest('hex').slice(0,16);
      host.session=this.createSession({origin:url.origin,partition,label:'MangaBall images',world:1222,homePath:url.pathname+url.search,
        maxBodyBytes:MAX_BYTES,requestTimeoutMs:25000,verificationWaitMs:180000,idleCloseMs:600000,
        allowedResourceHosts:[url.hostname,'challenges.cloudflare.com']});
      await host.session.connect(url.href,null);
      if(this.closed)return reject(503,'SERVICE_UNAVAILABLE');
      host.ready=true;host.stopped=undefined;host.retryAt=undefined;if(this.lastFailed===raw)this.lastFailed=undefined;
    })().catch(()=>{host.ready=false;host.session?.close();host.session=undefined;return reject(403,'SOURCE_VERIFICATION_REQUIRED');})
      .finally(()=>{if(host.connecting===pending)host.connecting=undefined;});
    host.connecting=pending;return pending;
  }
  /** Bounded serialization preserves page order without retrying failed reads. */
  async fetch(raw:string,signal:AbortSignal):Promise<Response>{
    const {host}=this.registered(raw);
    if(signal.aborted)throw aborted();
    if(host.stopped)return reject(host.stopped,host.stopped===429?'SOURCE_RATE_LIMITED':'SOURCE_VERIFICATION_REQUIRED');
    if(!host.ready||!host.session)return reject(403,'SOURCE_VERIFICATION_REQUIRED');
    if(!host.session.isConnected())return this.stop(raw,403);
    if(host.queued>=16)return reject(503,'SERVICE_BUSY');
    const previous=host.tail;let release!:()=>void;
    host.tail=new Promise<void>(resolve=>{release=resolve;});host.queued++;
    const queued=previous.then(()=>this.read(raw,signal)).finally(()=>{host.queued--;release();});
    return await new Promise<Response>((resolve,rejectRequest)=>{
      const cancel=()=>rejectRequest(aborted());
      signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
      queued.then(resolve,rejectRequest).finally(()=>signal.removeEventListener('abort',cancel));
    });
  }
  /** One reviewed same-origin image read, never an automatic ordinary-HTTP fallback. */
  private async read(raw:string,signal:AbortSignal):Promise<Response>{
    const {url,host}=this.registered(raw);
    if(signal.aborted)throw aborted();
    if(host.stopped)return reject(host.stopped,host.stopped===429?'SOURCE_RATE_LIMITED':'SOURCE_VERIFICATION_REQUIRED');
    if(!host.ready||!host.session)return reject(403,'SOURCE_VERIFICATION_REQUIRED');
    if(host.busy||host.connecting)return reject(429,'SOURCE_RATE_LIMITED');
    host.busy=true;const session=host.session;
    let cancelled=false,onAbort:()=>void=()=>{};
    const result=(async()=>{
      await this.publicHost(url.hostname);if(signal.aborted||this.closed)throw aborted();
      if(!session.isConnected())return this.stop(raw,403);
      const answer=await session.get(url.href,ACCEPT,['content-type','cf-mitigated'],'base64');
      if(signal.aborted||this.closed)throw aborted();
      if(answer.status===403||answer.status===429)return this.stop(raw,answer.status);
      if(answer.headers['cf-mitigated']?.toLowerCase()==='challenge')return this.stop(raw,403);
      if(answer.status!==200||answer.body===null||typeof answer.body!=='string'||answer.body.length>Math.ceil(MAX_BYTES/3)*4||
        answer.body.length%4!==0||/[^A-Za-z0-9+/=]/.test(answer.body)||/=[^=]/.test(answer.body)||answer.body.endsWith('==='))return reject(502,'INVALID_PAGE_IMAGE');
      const bytes=Buffer.from(answer.body,'base64'),type=(answer.headers['content-type']??'').split(';')[0].trim().toLowerCase();
      if(!bytes.length||bytes.length>MAX_BYTES||!validImage(type,bytes))return reject(502,'INVALID_PAGE_IMAGE');
      return new Response(new Uint8Array(bytes),{headers:{'Content-Type':type,'Content-Length':String(bytes.length),'Cache-Control':'private, no-store'}});
    })().catch(error=>{
      if(signal.aborted||cancelled)throw aborted();
      if(error&&typeof error==='object'&&'code'in error&&['SOURCE_VERIFICATION_REQUIRED','SOURCE_RATE_LIMITED','INVALID_PAGE_IMAGE','INVALID_MEDIA_DESTINATION'].includes(String(error.code)))throw error;
      return reject(502,'SOURCE_IMAGE_UNAVAILABLE');
    }).finally(()=>{host.busy=false;signal.removeEventListener('abort',onAbort);});
    return await new Promise<Response>((resolve,rejectRequest)=>{
      onAbort=()=>{cancelled=true;host.ready=false;host.session=undefined;session.close();rejectRequest(aborted());};
      signal.addEventListener('abort',onAbort,{once:true});
      if(signal.aborted)onAbort();
      result.then(resolve,rejectRequest);
    });
  }
  close():void{
    this.closed=true;for(const host of this.hosts.values())host.session?.close();this.hosts.clear();this.images.clear();this.lastFailed=undefined;this.lastRegistered=undefined;
  }
}
