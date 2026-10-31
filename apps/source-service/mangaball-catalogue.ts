import {app,BrowserWindow} from 'electron';
import {lookup} from 'node:dns/promises';
import {MANGABALL,isMangaBallId,mangaBallListingUrl} from '../../packages/shared/manga';
import {publicAddress} from './public-media';
import {reject,ServiceError} from './protocol';

const ORIGIN=new URL(MANGABALL.API).origin,API='/api/v1',WORLD=1224;
const PROBE=`${MANGABALL.API}/title/search-advanced?keyword=One%20Piece&page=1&limit=10&adult_mode=no_18`;
type Kind='search'|'detail'|'chapters'|'pages';
type Target={url:URL;kind:Kind;limit:number};
type Answer={status:number;body:string|null;headers:Record<string,string>};
export interface MangaBallCatalogueOptions {
  createWindow?:(options:Electron.BrowserWindowConstructorOptions)=>BrowserWindow;
  resolveHost?:(host:string)=>Promise<readonly string[]>;
  now?:()=>number;
  verificationWaitMs?:number;
  requestTimeoutMs?:number;
  idleCloseMs?:number;
}
const aborted=()=>new DOMException('Catalogue request cancelled.','AbortError');
function bound(value:number|undefined,fallback:number,max:number){const result=value??fallback;if(!Number.isSafeInteger(result)||result<1||result>max)throw Error('Invalid catalogue time bound.');return result;}
function target(raw:string):Target {
  if(typeof raw!=='string'||raw.length>2048||raw!==raw.trim()||/[\x00-\x1f\x7f]/.test(raw))return reject(400,'INVALID_SOURCE_REQUEST');
  let url:URL;try{url=new URL(raw);}catch{return reject(400,'INVALID_SOURCE_REQUEST');}
  if(url.origin!==ORIGIN||url.protocol!=='https:'||url.username||url.password||url.hash||url.port||url.href!==raw)return reject(400,'INVALID_SOURCE_REQUEST');
  const keys=[...url.searchParams.keys()];if(new Set(keys).size!==keys.length)return reject(400,'INVALID_SOURCE_REQUEST');
  const exact=(names:string[])=>keys.length===names.length&&names.every(name=>url.searchParams.has(name));
  let expected:string|undefined,kind:Kind='detail',limit=2*1024*1024;
  const id=url.pathname.slice((API+'/title/detail/').length);
  if(url.pathname.startsWith(API+'/title/detail/')&&isMangaBallId(id)&&!url.search)expected=`${MANGABALL.API}/title/detail/${id}`;
  else if(url.pathname===API+'/title/search-advanced'&&exact(['keyword','page','limit','adult_mode'])){
    const query=url.searchParams.get('keyword')??'';
    if(query===query.trim()&&query.length>=2&&query.length<=120&&!/[\x00-\x1f\x7f]/.test(query))expected=`${MANGABALL.API}/title/search-advanced?keyword=${encodeURIComponent(query)}&page=1&limit=10&adult_mode=no_18`;
    kind='search';limit=4*1024*1024;
  }else if(url.pathname===API+'/title/chapter-listing'&&exact(['title_id','page','limit','group_by','sort_order','language','search'])){
    const titleId=url.searchParams.get('title_id')??'',page=Number(url.searchParams.get('page'));
    if(isMangaBallId(titleId)&&Number.isInteger(page)&&page>=1&&page<=100){
      if(url.searchParams.get('limit')==='100')expected=mangaBallListingUrl(titleId,page);
      else if(page===1&&url.searchParams.get('limit')==='10')expected=`${MANGABALL.API}/title/chapter-listing?title_id=${titleId}&page=1&limit=10&group_by=flat&sort_order=desc&language=en&search=`;
    }
    kind='chapters';limit=url.searchParams.get('limit')==='10'?1024*1024:16*1024*1024;
  }else if(url.pathname===API+'/chapter-detail'&&exact(['chapter_id','user_id'])){
    const chapterId=url.searchParams.get('chapter_id')??'';
    if(isMangaBallId(chapterId))expected=`${MANGABALL.API}/chapter-detail?chapter_id=${chapterId}&user_id=demo_user`;
    kind='pages';
  }
  if(!expected||raw!==expected)return reject(400,'INVALID_SOURCE_REQUEST');
  return {url,kind,limit};
}
function validJson(body:string,kind:Kind):boolean {
  let value:any;try{value=JSON.parse(body);}catch{return false;}
  if(!value||typeof value!=='object'||Array.isArray(value)||value.error||value.errors||value.status!==undefined&&!['success',true,200].includes(value.status))return false;
  if(kind==='search'||kind==='chapters')return Array.isArray(value.data);
  if(kind==='pages')return !!value.data&&typeof value.data==='object'&&Array.isArray(value.data.chapter?.pages);
  return !!value.data&&typeof value.data==='object'&&!Array.isArray(value.data)&&isMangaBallId(String(value.data.id??value.data._id??''));
}
function retryAt(raw:string|undefined,now:number):number {
  if(raw&&raw.length<=128){
    const seconds=/^\d+$/.test(raw)?Number(raw):NaN;
    if(Number.isFinite(seconds))return Math.max(now+60000,Math.min(Number.MAX_SAFE_INTEGER,now+seconds*1000));
    const date=Date.parse(raw);if(Number.isFinite(date)&&date>now)return Math.max(now+60000,date);
  }
  return now+60000;
}
async function timeout<T>(operation:Promise<T>,ms:number):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([operation,new Promise<never>((_,fail)=>{timer=setTimeout(()=>fail(Error('Catalogue operation timed out.')),ms);timer.unref?.();})]);}finally{if(timer)clearTimeout(timer);}}

/**
 * Explicit, human-operated API connection. No browser opens during a request.
 * DNS answers are checked before use, but Chromium still owns its resolver;
 * hosting must retain its private-destination deny policy, as for image sessions.
 */
export class MangaBallCatalogue {
  private readonly createWindow:NonNullable<MangaBallCatalogueOptions['createWindow']>;
  private readonly resolveHost:NonNullable<MangaBallCatalogueOptions['resolveHost']>;
  private readonly now:()=>number;
  private readonly verificationWaitMs:number;
  private readonly requestTimeoutMs:number;
  private readonly idleCloseMs:number;
  private win?:BrowserWindow;
  private ready=false;
  private manual=false;
  private closed=false;
  private busy=false;
  private stopped?:403|429;
  private retryAfter=0;
  private observed?:Target;
  private connection?:Promise<void>;
  private cancelConnection?:()=>void;
  private cancelRead?:()=>void;
  private idleTimer?:ReturnType<typeof setTimeout>;
  private document?:{url:string;status:number;type:string;challenge:boolean};
  constructor(options:MangaBallCatalogueOptions={}){
    this.createWindow=options.createWindow??(settings=>new BrowserWindow(settings));
    this.resolveHost=options.resolveHost??(async host=>(await lookup(host,{all:true,verbatim:true})).map(row=>row.address));
    this.now=options.now??Date.now;
    this.verificationWaitMs=bound(options.verificationWaitMs,180000,180000);
    this.requestTimeoutMs=bound(options.requestTimeoutMs,20000,25000);
    this.idleCloseMs=bound(options.idleCloseMs,600000,600000);
  }
  approvedOrigins():Set<string>{return new Set([ORIGIN]);}
  private connected(){return this.ready&&!!this.win&&!this.win.isDestroyed()&&!this.win.webContents.isDestroyed();}
  private async publicHost(host:string){let addresses:readonly string[];try{addresses=await timeout(this.resolveHost(host),5000);}catch{return reject(502,'INVALID_MEDIA_DESTINATION');}if(!addresses.length||addresses.some(address=>!publicAddress(address)))return reject(502,'INVALID_MEDIA_DESTINATION');}
  private touch(){if(this.idleTimer)clearTimeout(this.idleTimer);if(this.closed)return;this.idleTimer=setTimeout(()=>{this.idleTimer=undefined;if(this.win&&!this.win.isDestroyed()&&!this.win.isVisible()&&!this.busy&&!this.connection){this.ready=false;this.win.destroy();}},this.idleCloseMs);this.idleTimer.unref?.();}
  private stop(status:403|429,header?:string){this.ready=false;this.stopped=status;if(status===429)this.retryAfter=retryAt(header,this.now());}
  private allowed(raw:string,method:string,main:boolean):boolean {
    let url:URL;try{url=new URL(raw);}catch{return false;}
    if(url.protocol==='data:')return this.manual&&!main;
    if(url.protocol!=='https:'||url.username||url.password||url.hash||url.port)return false;
    if(url.hostname==='challenges.cloudflare.com')return this.manual&&!main&&['GET','POST'].includes(method);
    if(url.origin!==ORIGIN)return false;
    if(this.manual&&url.pathname.startsWith('/cdn-cgi/'))return ['GET','POST'].includes(method);
    if(method!=='GET'||!this.manual&&!this.ready)return false;
    try{target(raw);return true;}catch{return false;}
  }
  private window():BrowserWindow {
    if(this.win&&!this.win.isDestroyed())return this.win;
    const win=this.createWindow({show:true,width:1000,height:760,title:'MangaBall catalogue — complete the website check, then Finish check',webPreferences:{partition:'persist:source-mangaball-catalogue',nodeIntegration:false,contextIsolation:true,sandbox:true}});
    this.win=win;const contents=win.webContents,session=contents.session;
    contents.setAudioMuted(true);contents.setWindowOpenHandler(()=>({action:'deny'}));
    session.setPermissionCheckHandler(()=>false);session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    const denyDownload=(event:Electron.Event)=>event.preventDefault();session.on('will-download',denyDownload);
    session.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!this.allowed(details.url,details.method,details.resourceType==='mainFrame')}));
    session.webRequest.onHeadersReceived((details,callback)=>{
      const headers:Record<string,string>={};for(const [name,values] of Object.entries(details.responseHeaders??{}))headers[name.toLowerCase()]=values[0]??'';
      if(details.resourceType==='mainFrame'&&new URL(details.url).origin===ORIGIN){
        let limit=2*1024*1024;try{limit=target(details.url).limit;}catch{}
        if(Number(headers['content-length'])>limit){this.document=undefined;this.cancelConnection?.();callback({cancel:true});return;}
      }
      if(details.resourceType==='mainFrame'&&new URL(details.url).origin===ORIGIN)this.document={url:details.url,status:details.statusCode,type:headers['content-type']??'',challenge:headers['cf-mitigated']?.toLowerCase()==='challenge'};
      if(new URL(details.url).origin===ORIGIN&&details.statusCode===429){this.stop(429,headers['retry-after']);this.cancelConnection?.();}
      callback({});
    });
    const navigate=(event:Electron.Event,url:string)=>{if(!this.allowed(url,'GET',true))event.preventDefault();};
    contents.on('will-navigate',navigate);contents.on('will-redirect',navigate);
    contents.on('did-start-navigation',(_event,_url,inPlace,main)=>{if(main&&!inPlace){this.ready=false;this.document=undefined;}});
    win.once('closed',()=>{session.removeListener('will-download',denyDownload);if(this.win===win){this.win=undefined;this.ready=false;this.document=undefined;}this.cancelConnection?.();});
    return win;
  }
  /** The operator owns Finish; successful page loads never silently grant readiness. */
  connect():Promise<void>{
    if(this.closed)return Promise.reject(new ServiceError(503,'SERVICE_UNAVAILABLE'));
    if(this.connection){this.win?.show();this.win?.focus();return this.connection;}
    if(this.busy)return Promise.reject(new ServiceError(503,'SERVICE_BUSY'));
    if(this.stopped===429&&this.now()<this.retryAfter)return Promise.reject(new ServiceError(429,'SOURCE_RATE_LIMITED'));
    const selected=this.observed??target(PROBE);
    const operation=(async()=>{
      await this.publicHost(new URL(ORIGIN).hostname);await this.publicHost('challenges.cloudflare.com');
      if(this.closed)return reject(503,'SERVICE_UNAVAILABLE');
      const reload=this.stopped!==undefined||this.document?.status!==200||this.document.challenge;
      this.ready=false;this.manual=true;this.stopped=undefined;const win=this.window(),contents=win.webContents;
      let timer:ReturnType<typeof setTimeout>|undefined,finishRead=false,quitting=false;
      await new Promise<void>((resolve,fail)=>{
        let settled=false;
        const complete=(ok:boolean)=>{if(settled)return;settled=true;if(timer)clearTimeout(timer);win.removeListener('close',onClose);app.removeListener('before-quit',beforeQuit);this.cancelConnection=undefined;if(ok){this.ready=true;win.hide();resolve();}else fail(new ServiceError(this.stopped===429?429:403,this.stopped===429?'SOURCE_RATE_LIMITED':'SOURCE_VERIFICATION_REQUIRED'));};
        const beforeQuit=()=>{quitting=true;complete(false);};
        const onClose=(event:Electron.Event)=>{
          if(quitting)return;event.preventDefault();if(finishRead)return;finishRead=true;
          void this.checkDocument(win,selected).then(ok=>complete(ok),()=>complete(false));
        };
        this.cancelConnection=()=>complete(false);win.on('close',onClose);app.on('before-quit',beforeQuit);
        timer=setTimeout(()=>complete(false),this.verificationWaitMs);timer.unref?.();
        win.show();win.focus();
        if(reload||contents.getURL()!==selected.url.href)void win.loadURL(selected.url.href).catch(()=>complete(false));
      });
    })().finally(()=>{this.manual=false;if(this.connection===operation)this.connection=undefined;this.touch();});
    this.connection=operation;return operation;
  }
  private async checkDocument(win:BrowserWindow,selected:Target):Promise<boolean>{
    const doc=this.document;if(win.isDestroyed()||!doc||doc.status!==200||doc.challenge||doc.url!==selected.url.href||!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(doc.type))return false;
    const result=await timeout(win.webContents.executeJavaScriptInIsolatedWorld(WORLD,[{code:`(() => {const limit=${selected.limit};if(location.origin!==${JSON.stringify(ORIGIN)}||location.pathname+location.search!==${JSON.stringify(selected.url.pathname+selected.url.search)})return null;const text=document.querySelector('pre')?.textContent??document.body?.innerText??'';return text.length<=limit?text:null;})()`}]),5000);
    return !win.isDestroyed()&&this.win===win&&typeof result==='string'&&Buffer.byteLength(result)<=selected.limit&&validJson(result,selected.kind);
  }
  /** Native connector transport. Caller headers/cookies/UA never enter the website session. */
  fetch=async(raw:string,init:RequestInit={}):Promise<Response>=>{
    const selected=target(raw);if(init.method&&init.method!=='GET'||init.body!=null)return reject(400,'INVALID_SOURCE_REQUEST');
    const signal=init.signal??new AbortController().signal;if(signal.aborted)throw aborted();
    if(this.closed)return reject(503,'SERVICE_UNAVAILABLE');
    this.observed=selected;
    if(this.stopped===429)return Response.json({error:'SOURCE_RATE_LIMITED'},{status:429,headers:{'Retry-After':String(Math.max(1,Math.ceil((this.retryAfter-this.now())/1000)))}});
    if(this.stopped===403||!this.connected())return Response.json({error:'SOURCE_VERIFICATION_REQUIRED'},{status:403});
    if(this.busy||this.connection)return reject(503,'SERVICE_BUSY');
    this.busy=true;const win=this.win!;let cancelled=false,onAbort=()=>{},timer:ReturnType<typeof setTimeout>|undefined;
    const operation=(async()=>{
      await this.publicHost(selected.url.hostname);if(signal.aborted||this.closed||!this.connected())throw aborted();
      const input={path:selected.url.pathname+selected.url.search,limit:selected.limit,timeout:this.requestTimeoutMs};
      const result:Answer=await win.webContents.executeJavaScriptInIsolatedWorld(WORLD,[{code:`(async(request)=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),request.timeout);try{const response=await fetch(request.path,{method:'GET',headers:{Accept:'application/json'},credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal});const headers={};for(const name of ['content-type','cf-mitigated','retry-after']){const value=response.headers.get(name);if(value!==null)headers[name]=value;}if(response.url!==location.origin+request.path||response.redirected){await response.body?.cancel();return {status:0,body:null,headers:{}};}if(!response.ok||Number(response.headers.get('content-length'))>request.limit){await response.body?.cancel();return {status:response.status,body:null,headers};}const reader=response.body?.getReader();if(!reader)return {status:response.status,body:null,headers};let length=0;const parts=[];try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>request.limit){await reader.cancel();return {status:response.status,body:null,headers};}parts.push(part.value);}return {status:response.status,body:await new Blob(parts).text(),headers};}finally{reader.releaseLock();}}finally{clearTimeout(timer);}})(${JSON.stringify(input)})`}]);
      if(signal.aborted||cancelled||this.closed)throw aborted();
      if(!result||!Number.isInteger(result.status)||!result.headers||typeof result.headers!=='object')return reject(502,'INVALID_SERVICE_RESPONSE');
      if(result.status===403||result.status===429||String(result.headers['cf-mitigated']).toLowerCase()==='challenge'){const status=result.status===429?429:403;this.stop(status,result.headers['retry-after']);return Response.json({error:status===429?'SOURCE_RATE_LIMITED':'SOURCE_VERIFICATION_REQUIRED'},{status});}
      if(result.status!==200||typeof result.body!=='string'||Buffer.byteLength(result.body)>selected.limit||!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(result.headers['content-type']??'')||!validJson(result.body,selected.kind))return reject(502,'INVALID_SERVICE_RESPONSE');
      return new Response(result.body,{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    })().finally(()=>{this.busy=false;signal.removeEventListener('abort',onAbort);if(this.cancelRead===onAbort)this.cancelRead=undefined;if(timer)clearTimeout(timer);this.touch();});
    return await new Promise<Response>((resolve,fail)=>{
      onAbort=()=>{cancelled=true;this.ready=false;this.win=undefined;if(!win.isDestroyed())win.destroy();fail(aborted());};
      this.cancelRead=onAbort;
      signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();
      timer=setTimeout(onAbort,this.requestTimeoutMs+5000);timer.unref?.();operation.then(resolve,error=>{if(signal.aborted||cancelled)fail(aborted());else fail(error&&typeof error==='object'&&'code'in error?error:new ServiceError(502,'SOURCE_UNAVAILABLE'));});
    });
  };
  close():void{this.closed=true;this.ready=false;this.cancelConnection?.();this.cancelRead?.();if(this.idleTimer)clearTimeout(this.idleTimer);if(this.win&&!this.win.isDestroyed())this.win.destroy();this.win=undefined;}
}
