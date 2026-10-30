import {BrowserWindow} from 'electron';
import {authenticates, boundedJson, errorResponse, opaqueId, reject, ServiceError} from './protocol';

const CONNECTION_SOURCES = {animepahe: 'AnimePahe', anikoto: 'Anikoto', anichan: 'AniChan', mangadot: 'MangaDot', 'mangaball-catalogue': 'MangaBall catalogue', mangaball: 'MangaBall images', toonkotsu: 'Toonkotsu'} as const;
type ConnectionSource = keyof typeof CONNECTION_SOURCES;
export type SourceConnections = Partial<Record<ConnectionSource, () => Promise<boolean | void>>>;
type ConnectionState = 'idle' | 'connecting' | 'finished' | 'failed' | 'cancelled';
// Presentation/connection ownership only. Every window must independently pass
// approvedOrigins(); unknown configured alternatives require manual selection.
const CONNECTION_ORIGINS: Record<ConnectionSource, readonly string[]> = {
  animepahe: ['https://animepahe.pw'], anikoto: ['https://anikototv.to','https://anikoto.cz'],
  anichan: ['https://anichan.to'], mangadot: ['https://mangadot.net'],
  'mangaball-catalogue': ['https://api.mangaball.com'],
  mangaball: ['https://bulbasaur.poke-black-and-white.net','https://chikorita.red-and-blue.net'],
  toonkotsu: ['https://toonkotsu.com'],
};
const CAPTURE_WIDTH=1200,CAPTURE_HEIGHT=900,CAPTURE_BYTES=4*1024*1024,CAPTURE_DEADLINE_MS=10000;

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AniTrack source checks</title><style>body{font:16px system-ui;background:#11101a;color:#eee;max-width:1100px;margin:24px auto;padding:16px}button,input,select{font:inherit;margin:6px;padding:10px;background:#242232;color:#eee;border:1px solid #555;border-radius:8px}img{display:block;max-width:100%;border:1px solid #555;cursor:crosshair}#message{min-height:2em;color:#d9b7ff}</style></head><body><h1>Source website checks</h1><p>Complete the source's normal verification manually, then return to AniTrack and retry. Only source windows are available here.</p><select id="windows"></select><button id="refresh">Refresh windows</button><button id="finish">Finish check</button><p id="message"></p><img id="screen" alt="Selected source website"><form id="typing"><input id="text" maxlength="200" autocomplete="off" aria-label="Type into the selected source window"><button>Type text</button></form><div id="keys"></div><script src="/operator/app.js"></script></body></html>`;
const SCRIPT = `
const selector=document.querySelector('#windows'),image=document.querySelector('#screen'),message=document.querySelector('#message');
let loading=false,previewUrl='',previewId='',previewGeneration=0;
function clearPreview(){previewGeneration++;previewId='';image.removeAttribute('src');if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl='';}
async function api(path,body){
  const response=await fetch('/operator/api/'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
  if(response.status===401){location.replace('/operator');throw Error('Sign in again to continue.');}
  if(!response.ok){const result=await response.json().catch(()=>({}));const messages={SOURCE_WINDOW_HIDDEN:'This connection is in the background. Choose its source and Connect to open a check.',OPERATOR_CAPTURE_BUSY:'Another preview is loading. Try Refresh preview in a moment.',OPERATOR_CONNECTION_BUSY:'Finish or close the current source check before connecting another source.',OPERATOR_CAPTURE_TIMEOUT:'The preview took too long. Close the source or try Refresh preview later.',OPERATOR_CAPTURE_TOO_LARGE:'This source preview is too large to display.'};throw Error(messages[result.error]||'The source window is unavailable. Refresh and retry.');}
  return response;
}
async function action(body){
  try{await api('input',{id:selector.value,...body});if(body.type==='finish'||body.type==='close'){clearPreview();await windows();if(typeof connections==='function')await connections();}else await screen();}
  catch(error){message.textContent=error.message;}
}
async function windows(preferredSource){
  try{
    const rows=await(await api('windows')).json(),selected=selector.value;
    selector.replaceChildren(...rows.map(row=>new Option(row.label,row.id)));
    const preferred=preferredSource&&rows.find(row=>row.source===preferredSource&&row.visible);
    selector.value=preferred?preferred.id:rows.some(row=>row.id===selected)?selected:'';
    if(previewId&&previewId!==selector.value)clearPreview();
    message.textContent=rows.length?'Select a website and use Refresh preview to view its check.':'No source website currently needs a check.';
    return !!preferred;
  }catch(error){message.textContent=error.message;return false;}
}
async function screen(){
  if(loading||!selector.value)return;loading=true;
  const id=selector.value,generation=previewGeneration;
  try{
    const response=await api('screen?id='+encodeURIComponent(id)),blob=await response.blob();
    if(selector.value!==id||previewGeneration!==generation)return;
    const old=previewUrl;previewUrl=URL.createObjectURL(blob);previewId=id;image.src=previewUrl;
    if(old)URL.revokeObjectURL(old);
    message.textContent='Preview refreshed. Use Refresh preview again after the website changes.';
  }catch(error){if(selector.value===id&&previewGeneration===generation)message.textContent=error.message;}
  finally{loading=false;}
}
selector.onchange=()=>{clearPreview();void screen();};
document.querySelector('#refresh').onclick=()=>windows();
document.querySelector('#refresh-preview').onclick=()=>screen();
document.querySelector('#finish').onclick=()=>action({type:'finish'});
document.querySelector('#close-source').onclick=()=>action({type:'close'});
image.onclick=event=>{if(previewId!==selector.value||!image.naturalWidth)return;const box=image.getBoundingClientRect();void action({type:'click',x:Math.round((event.clientX-box.left)*image.naturalWidth/box.width),y:Math.round((event.clientY-box.top)*image.naturalHeight/box.height)});};
document.querySelector('#typing').onsubmit=event=>{event.preventDefault();const text=document.querySelector('#text');void action({type:'text',text:text.value});text.value='';};
for(const key of ['Tab','Enter','Backspace','Escape','Up','Down','PageUp','PageDown']){const button=document.createElement('button');button.textContent=key;button.onclick=()=>action({type:'key',key});document.querySelector('#keys').append(button);}
window.addEventListener('pagehide',clearPreview);
void windows();
`;

const CONNECTION_PAGE = PAGE.replace('<select id="windows">', '<div><label for="sources">Source connection</label><select id="sources"></select><button id="connect">Connect</button><p id="connection-message">Choose a source and Connect. Complete its normal check, then use Finish check to keep its connection. Close source ends the connection.</p></div><select id="windows">')
  .replace('<button id="finish">Finish check</button>','<button id="refresh-preview">Refresh preview</button><button id="finish">Finish check</button><button id="close-source">Close source</button>');
const CONNECTION_SCRIPT = `
const sourceSelector=document.querySelector('#sources'),connectButton=document.querySelector('#connect'),connectionMessage=document.querySelector('#connection-message');
let connectionRows=[],refreshingConnections=false,refreshConnectionWindowsUntil=0;
function sourceState(){
  const row=connectionRows.find(row=>row.source===sourceSelector.value);
  connectButton.disabled=!row||row.state==='connecting'||connectionRows.some(other=>other.source!==row.source&&other.state==='connecting');
  connectionMessage.textContent=!row?'No source connections are configured.':row.state==='connecting'?'Complete the source check, then use Finish check to keep its connection.':row.state==='failed'?'The connection could not finish. Close its window or choose Connect to try again.':row.state==='cancelled'?'Cancelled. Choose Connect when you want to use this source again.':row.state==='finished'?'Return to AniTrack and retry the source. Close source ends this connection.':'Choose Connect, complete any source check, then use Finish check.';
}
async function connections(){
  if(refreshingConnections)return;refreshingConnections=true;
  try{
    connectionRows=await(await api('sources')).json();
    const selected=sourceSelector.value;
    sourceSelector.replaceChildren(...connectionRows.map(row=>new Option(row.label,row.source)));
    if(connectionRows.some(row=>row.source===selected))sourceSelector.value=selected;
    sourceState();
  }catch(error){connectionMessage.textContent=error.message;}
  finally{refreshingConnections=false;}
}
sourceSelector.onchange=sourceState;
connectButton.onclick=async()=>{
  connectButton.disabled=true;
  try{
    const source=sourceSelector.value;
    await api('connect',{source});
    refreshConnectionWindowsUntil=Date.now()+30000;
    clearPreview();selector.value='';await connections();
    if(await windows(source))await screen();else message.textContent='The source window is opening. Use Refresh windows, select its website, then Refresh preview.';
  }catch(error){connectionMessage.textContent=error.message;connectButton.disabled=false;}
};
void connections();
setInterval(async()=>{
  if(!document.hidden){
    await connections();
    if(Date.now()<refreshConnectionWindowsUntil||connectionRows.some(row=>row.state==='connecting'))await windows();
  }
},2000);
`;

const SESSION_COOKIE='__Secure-anitrack_operator';
const SAFE={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",'Referrer-Policy':'no-referrer','Vary':'Cookie, Authorization'};
const SIGN_IN_SAFE={...SAFE,'Content-Security-Policy':SAFE['Content-Security-Policy'].replace("style-src 'unsafe-inline'","style-src 'self'")};
const SIGN_IN_PAGE=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · AniTrack source checks</title><link rel="stylesheet" href="/operator/sign-in.css"><script src="/operator/sign-in.js" defer></script></head><body><main><h1>AniTrack source checks</h1><p>Sign in to complete the sources' normal website checks.</p><form id="sign-in" method="post" action="/operator/login"><label for="operator-key">Operator key</label><input id="operator-key" name="password" type="password" required minlength="32" maxlength="256" autocomplete="off" spellcheck="false"><button id="sign-in-button" type="submit">Sign in</button><p id="sign-in-message" role="alert" aria-live="polite"></p></form><p class="hint">Use the separate operator key for this service. Your key stays out of links and browser storage. Sign-in expires after a short time.</p></main></body></html>`;
const SIGN_IN_STYLE=`:root{color-scheme:dark}body{margin:0;background:#11101a;color:#eee;font:16px system-ui}main{max-width:440px;margin:8vh auto;padding:24px}h1{font-size:1.7rem}p{line-height:1.5;color:#c9c3d7}label,input,button{display:block;width:100%;box-sizing:border-box}label{margin:28px 0 8px}input,button{font:inherit;border:1px solid #686075;border-radius:8px;padding:12px;background:#242232;color:#fff}button{margin-top:16px;background:#7050c4;cursor:pointer}button:disabled{opacity:.6;cursor:wait}input:focus-visible,button:focus-visible{outline:2px solid #b699ff;outline-offset:3px}#sign-in-message{min-height:1.5em;color:#eeb7bd}.hint{font-size:.85rem;color:#aaa1b9}`;
const SIGN_IN_SCRIPT=`const form=document.querySelector('#sign-in'),field=document.querySelector('#operator-key'),button=document.querySelector('#sign-in-button'),message=document.querySelector('#sign-in-message');form.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;message.textContent='';const password=field.value;field.value='';try{const response=await fetch('/operator/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',redirect:'error',body:JSON.stringify({password})});if(response.ok){location.replace('/operator');return;}message.textContent=response.status===429?'Too many attempts. Wait a minute and try again.':response.status===503?'Sign-in is busy. Wait a little and try again.':'Sign-in failed. Check the operator key and try again.';}catch{message.textContent='The service could not be reached. Try again.';}finally{button.disabled=false;}});`;
const SIGNED_IN_PAGE=CONNECTION_PAGE.replace('<h1>Source website checks</h1>','<h1>Source website checks</h1><button id="sign-out" type="button">Sign out</button>');
const SIGNED_IN_SCRIPT=SCRIPT+CONNECTION_SCRIPT+`document.querySelector('#sign-out').onclick=async()=>{try{await fetch('/operator/logout',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',redirect:'error',body:'{}'});}finally{clearPreview();location.replace('/operator');}};`;

export interface OperatorLoginOptions {now?:()=>number;sessionTtlMs?:number;maxSessions?:number}
async function loginInput(request:Request):Promise<unknown>{
  if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return reject(415,'INVALID_OPERATOR_LOGIN');
  if(Number(request.headers.get('content-length'))>1024)return reject(413,'REQUEST_TOO_LARGE');
  const reader=request.body?.getReader();if(!reader)return reject(400,'INVALID_OPERATOR_LOGIN');
  let timer:ReturnType<typeof setTimeout>|undefined,bytes=0,onAbort=()=>{};
  const interrupted=new Promise<never>((_,fail)=>{
    onAbort=()=>fail(Error('Login request cancelled.'));request.signal.addEventListener('abort',onAbort,{once:true});if(request.signal.aborted)onAbort();
    timer=setTimeout(()=>fail(Error('Login request timed out.')),5000);timer.unref?.();
  });
  try{
    const chunks:Uint8Array[]=[];
    for(;;){const part=await Promise.race([reader.read(),interrupted]);if(part.done)break;bytes+=part.value.byteLength;if(bytes>1024)return reject(413,'REQUEST_TOO_LARGE');chunks.push(part.value);}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }catch(error){if(error&&typeof error==='object'&&'code'in error)throw error;return reject(400,'INVALID_OPERATOR_LOGIN');}
  finally{if(timer)clearTimeout(timer);request.signal.removeEventListener('abort',onAbort);void reader.cancel().catch(()=>{});}
}

/** Human-operated verification only: no script evaluation or arbitrary URLs. */
export class SourceOperator {
  private windows = new Map<string, BrowserWindow>();
  private failures = 0;
  private retryAt = 0;
  private pendingConnections = new Map<ConnectionSource, Promise<void>>();
  private connectionStates = new Map<ConnectionSource, ConnectionState>();
  private connectionGenerations = new Map<ConnectionSource, number>();
  private captureBusy = false;
  private sessions=new Map<string,number>();
  private loginReads=0;
  private readonly now:()=>number;
  private readonly sessionTtlMs:number;
  private readonly maxSessions:number;
  constructor(private key: string, private origin: string, private approvedOrigins: () => Set<string>, private connections: SourceConnections = {}, options:OperatorLoginOptions={}) {
    if (key.length < 32 || key.length > 256 || !/^[A-Za-z0-9_-]+$/.test(key) || new URL(origin).protocol !== 'https:' || new URL(origin).origin !== origin) throw new Error('Configure the operator HTTPS origin and a separate random operator key.');
    this.now=options.now??Date.now;this.sessionTtlMs=options.sessionTtlMs??15*60000;this.maxSessions=options.maxSessions??16;
    if(!Number.isSafeInteger(this.sessionTtlMs)||this.sessionTtlMs<1000||this.sessionTtlMs>3600000||!Number.isSafeInteger(this.maxSessions)||this.maxSessions<1||this.maxSessions>32)throw Error('Invalid operator session bounds.');
  }
  private pruneSessions(){for(const [id,expires] of this.sessions)if(expires<=this.now())this.sessions.delete(id);}
  private sessionId(request:Request):string|undefined{
    const raw=request.headers.get('cookie')??'';if(raw.length>4096)return;
    const matches=raw.split(';').map(part=>part.trim()).filter(part=>part.startsWith(SESSION_COOKIE+'='));if(matches.length!==1)return;
    const id=matches[0].slice(SESSION_COOKIE.length+1);return /^[A-Za-z0-9_-]{32}$/.test(id)?id:undefined;
  }
  private cookie(id:string,seconds:number){return `${SESSION_COOKIE}=${id}; Path=/operator; Max-Age=${seconds}; Secure; HttpOnly; SameSite=Strict`;}
  private requireOrigin(request:Request){if(request.headers.get('origin')!==this.origin||request.headers.get('sec-fetch-site')==='cross-site')return reject(403,'INVALID_OPERATOR_ORIGIN');}
  private failedLogin(){
    if(this.now()<this.retryAt)return reject(429,'OPERATOR_LOGIN_COOLDOWN');
    if(++this.failures>=10){this.retryAt=this.now()+60000;this.failures=0;}
  }
  private permitted(win: BrowserWindow) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return false;
    // This process has no application renderer; all windows come from the
    // reviewed native connectors, with sandbox forced process-wide at startup.
    try {return this.approvedOrigins().has(new URL(win.webContents.getURL()).origin);} catch {return false;}
  }
  private window(id: unknown): BrowserWindow {
    const win = typeof id === 'string' ? this.windows.get(id) : undefined;
    if (!win || !this.permitted(win)) return reject(404, 'SOURCE_WINDOW_UNAVAILABLE');
    return win;
  }
  private windowSource(win:BrowserWindow):ConnectionSource|undefined {
    try {
      const origin=new URL(win.webContents.getURL()).origin;
      return (Object.keys(CONNECTION_ORIGINS) as ConnectionSource[]).find(source=>CONNECTION_ORIGINS[source].includes(origin));
    } catch {return;}
  }
  private async screenshot(request:Request,win:BrowserWindow):Promise<Response> {
    // Capturing a preview must never wake an idle reader or make it exempt from
    // its provider's hidden-window cleanup. Connect is the explicit show action.
    if(!win.isVisible())return reject(409,'SOURCE_WINDOW_HIDDEN');
    if(request.signal.aborted)return reject(499,'REQUEST_CANCELLED');
    if(this.captureBusy)return reject(429,'OPERATOR_CAPTURE_BUSY');
    const [width,height]=win.getContentSize();
    const bounded=(w:number,h:number)=>Number.isSafeInteger(w)&&Number.isSafeInteger(h)&&w>0&&h>0&&w<=CAPTURE_WIDTH&&h<=CAPTURE_HEIGHT;
    if(!bounded(width,height))return reject(413,'OPERATOR_CAPTURE_TOO_LARGE');
    this.captureBusy=true;
    let captureSettled=false,responseSettled=false,payload:Uint8Array|undefined,payloadOffset=0;
    let bodyController:ReadableStreamDefaultController<Uint8Array>|undefined;
    let timer:ReturnType<typeof setTimeout>|undefined,onAbort=()=>{},interrupt:(error:Error)=>void=()=>{};
    const release=()=>{if(captureSettled&&responseSettled)this.captureBusy=false;};
    const finishResponse=(error?:Error)=>{
      if(responseSettled)return;
      responseSettled=true;payload=undefined;
      if(timer)clearTimeout(timer);
      request.signal.removeEventListener('abort',onAbort);
      if(error&&bodyController){try{bodyController.error(error);}catch{/* already cancelled */}}
      release();
    };
    const interrupted=new Promise<never>((_,fail)=>{
      interrupt=error=>{finishResponse(error);fail(error);};
      onAbort=()=>interrupt(new ServiceError(499,'REQUEST_CANCELLED'));
      request.signal.addEventListener('abort',onAbort,{once:true});
      timer=setTimeout(()=>interrupt(new ServiceError(504,'OPERATOR_CAPTURE_TIMEOUT')),CAPTURE_DEADLINE_MS);timer.unref?.();
    });
    const capture=(async()=>{
      try{
        const image=await win.webContents.capturePage({x:0,y:0,width,height});
        if(responseSettled||request.signal.aborted)return reject(499,'REQUEST_CANCELLED');
        const size=image.getSize();
        if(!bounded(size.width,size.height))return reject(413,'OPERATOR_CAPTURE_TOO_LARGE');
        const png=image.toPNG();
        if(!png.length||png.length>CAPTURE_BYTES)return reject(413,'OPERATOR_CAPTURE_TOO_LARGE');
        // A view avoids copying the encoded PNG once more. There is no image
        // history; only this admitted response owns these bytes.
        return new Uint8Array(png.buffer,png.byteOffset,png.byteLength);
      }finally{captureSettled=true;release();}
    })();
    try{
      payload=await Promise.race([capture,interrupted]);
      if(request.signal.aborted)return reject(499,'REQUEST_CANCELLED');
      const length=payload.byteLength;
      const body=new ReadableStream<Uint8Array>({
        start(controller){bodyController=controller;},
        pull(controller){
          // Small copies respect HTTP backpressure without retaining the whole
          // PNG through a final socket-buffered view after this stream closes.
          if(payload&&payloadOffset<payload.byteLength){const end=Math.min(payload.byteLength,payloadOffset+65536);controller.enqueue(payload.slice(payloadOffset,end));payloadOffset=end;}
          else{controller.close();finishResponse();}
        },
        cancel(){finishResponse();},
      },{highWaterMark:0});
      return new Response(body,{headers:{...SAFE,'Content-Type':'image/png','Content-Length':String(length)}});
    }catch(error){finishResponse();throw error;}
    // A timeout/abort does not cancel Electron capturePage(). Its slot stays
    // occupied until that actual operation settles, even after the HTTP reply.
  }
  async handle(request: Request): Promise<Response> {
    try {
      const path=new URL(request.url).pathname;
      const origin=request.headers.get('origin');
      if(origin&&origin!==this.origin)return reject(403,'INVALID_OPERATOR_ORIGIN');
      this.pruneSessions();
      if(request.method==='GET'&&path==='/operator/sign-in.js')return new Response(SIGN_IN_SCRIPT,{headers:{...SIGN_IN_SAFE,'Content-Type':'text/javascript; charset=utf-8'}});
      if(request.method==='GET'&&path==='/operator/sign-in.css')return new Response(SIGN_IN_STYLE,{headers:{...SIGN_IN_SAFE,'Content-Type':'text/css; charset=utf-8'}});
      if(request.method==='POST'&&path==='/operator/login'){
        this.requireOrigin(request);
        if(this.loginReads>=4)return reject(429,'OPERATOR_LOGIN_BUSY');
        this.loginReads++;
        let input:any;try{input=await loginInput(request);}finally{this.loginReads--;}
        if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(name=>name!=='password')||typeof input.password!=='string'||input.password.length>256)return reject(400,'INVALID_OPERATOR_LOGIN');
        if(!authenticates(`Bearer ${input.password}`,this.key)){this.failedLogin();return reject(401,'OPERATOR_SIGN_IN_REQUIRED');}
        this.failures=0;
        const previous=this.sessionId(request);if(previous)this.sessions.delete(previous);
        if(this.sessions.size>=this.maxSessions)return reject(503,'OPERATOR_SESSION_LIMIT');
        const id=opaqueId();this.sessions.set(id,this.now()+this.sessionTtlMs);
        return Response.json({ok:true},{headers:{...SAFE,'Set-Cookie':this.cookie(id,Math.floor(this.sessionTtlMs/1000))}});
      }
      if(request.method==='POST'&&path==='/operator/logout'){
        this.requireOrigin(request);const id=this.sessionId(request);if(id)this.sessions.delete(id);
        return Response.json({ok:true},{headers:{...SAFE,'Set-Cookie':this.cookie('',0)}});
      }
      let password = '';
      try {
        const raw = request.headers.get('authorization') ?? '';
        const text = raw.startsWith('Basic ') ? Buffer.from(raw.slice(6),'base64').toString('utf8') : '';
        if (text.startsWith('operator:')) password = text.slice(9);
      } catch {}
      const session=this.sessionId(request);
      const basic=authenticates(`Bearer ${password}`,this.key);
      if (!basic&&!(session&&this.sessions.has(session))) {
        if(request.headers.has('authorization')||request.headers.has('cookie')||path!=='/operator')this.failedLogin();
        if(request.method==='GET'&&path==='/operator')return new Response(SIGN_IN_PAGE,{status:401,headers:{...SIGN_IN_SAFE,'Content-Type':'text/html; charset=utf-8'}});
        return reject(401,'OPERATOR_SIGN_IN_REQUIRED');
      }
      // A session cookie cannot reset guesses against the longer-lived key.
      if(basic)this.failures=0;
      if(request.method==='POST')this.requireOrigin(request);
      const safe=SAFE;
      if (request.method === 'GET' && path === '/operator') return new Response(SIGNED_IN_PAGE,{headers:{...safe,'Content-Type':'text/html; charset=utf-8'}});
      if (request.method === 'GET' && path === '/operator/app.js') return new Response(SIGNED_IN_SCRIPT,{headers:{...safe,'Content-Type':'text/javascript; charset=utf-8'}});
      if (request.method === 'GET' && path === '/operator/api/sources') {
        return Response.json((Object.entries(CONNECTION_SOURCES) as [ConnectionSource, string][])
          .filter(([source]) => typeof this.connections[source] === 'function')
          .map(([source,label]) => ({source,label,state:this.connectionStates.get(source) ?? 'idle'})), {headers:safe});
      }
      if (request.method === 'POST' && path === '/operator/api/connect') {
        const input = await boundedJson(request) as any;
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'source') ||
          typeof input.source !== 'string' || !Object.hasOwn(CONNECTION_SOURCES,input.source)) return reject(400,'INVALID_OPERATOR_INPUT');
        const source = input.source as ConnectionSource, connect = this.connections[source];
        if (typeof connect !== 'function') return reject(400,'INVALID_OPERATOR_INPUT');
        if (!this.pendingConnections.has(source)) {
          if([...this.connectionStates].some(([other,state])=>other!==source&&state==='connecting'))return reject(409,'OPERATOR_CONNECTION_BUSY');
          const generation=(this.connectionGenerations.get(source)??0)+1;
          this.connectionGenerations.set(source,generation);
          this.connectionStates.set(source,'connecting');
          const pending = Promise.resolve().then(connect).then(result => {
            if(this.connectionGenerations.get(source)===generation)this.connectionStates.set(source,result === false ? 'failed' : 'finished');
          }, () => {if(this.connectionGenerations.get(source)===generation)this.connectionStates.set(source,'failed');}).finally(() => {
            if (this.pendingConnections.get(source) === pending) this.pendingConnections.delete(source);
          });
          this.pendingConnections.set(source,pending);
        }
        // Native connect waits for the human to close the source window. Never
        // hold an HTTP request (or start another connect) while they do that.
        return Response.json({ok:true,pending:true},{status:202,headers:safe});
      }
      if (request.method === 'GET' && path === '/operator/api/windows') {
        for (const [id,win] of this.windows) if (!this.permitted(win)) this.windows.delete(id);
        for (const win of BrowserWindow.getAllWindows()) if (this.permitted(win) && ![...this.windows.values()].includes(win)) this.windows.set(opaqueId(),win);
        return Response.json([...this.windows].map(([id,win])=>({id,label:new URL(win.webContents.getURL()).hostname+(win.isVisible()?'':' (background)'),source:this.windowSource(win),visible:win.isVisible()})),{headers:safe});
      }
      if (request.method === 'GET' && path === '/operator/api/screen') {
        const win = this.window(new URL(request.url).searchParams.get('id'));
        return await this.screenshot(request,win);
      }
      if (request.method === 'POST' && path === '/operator/api/input') {
        const input = await boundedJson(request) as any;
        if (!input || typeof input !== 'object' || Object.keys(input).some(key=>!['id','type','x','y','key','text'].includes(key))) return reject(400,'INVALID_OPERATOR_INPUT');
        const win = this.window(input.id), contents = win.webContents;
        if (input.type === 'finish') {win.close();}
        else if(input.type==='close'){
          const source=this.windowSource(win);
          if(source){
            this.connectionGenerations.set(source,(this.connectionGenerations.get(source)??0)+1);
            this.connectionStates.set(source,'cancelled');this.pendingConnections.delete(source);
          }
          // Provider close handlers mean Finish/retain. Destroy instead invokes
          // their closed cleanup and ends only the selected approved connection.
          this.windows.delete(input.id);win.destroy();
        }
        else if (input.type === 'click') {
          const [width,height] = win.getContentSize();
          if (![input.x,input.y].every(Number.isInteger) || input.x < 0 || input.y < 0 || input.x >= width || input.y >= height) return reject(400,'INVALID_OPERATOR_INPUT');
          contents.sendInputEvent({type:'mouseDown',x:input.x,y:input.y,button:'left',clickCount:1});
          contents.sendInputEvent({type:'mouseUp',x:input.x,y:input.y,button:'left',clickCount:1});
        } else if (input.type === 'text' && typeof input.text === 'string' && input.text.length <= 200 && !/[\x00-\x1f\x7f]/.test(input.text)) await contents.insertText(input.text);
        else if (input.type === 'key' && ['Tab','Enter','Backspace','Escape','Up','Down','PageUp','PageDown'].includes(input.key)) {
          contents.sendInputEvent({type:'keyDown',keyCode:input.key}); contents.sendInputEvent({type:'keyUp',keyCode:input.key});
        } else return reject(400,'INVALID_OPERATOR_INPUT');
        return Response.json({ok:true},{headers:safe});
      }
      return reject(404,'NOT_FOUND');
    } catch (error) {const response=errorResponse(error);for(const [name,value] of Object.entries(SAFE))response.headers.set(name,value);return response;}
  }
}
