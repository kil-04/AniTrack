#!/usr/bin/env node
// App-owned, explicitly selected live integration diagnostic. It never opens
// AniTrack's installed profile, database, MAL/Gist accounts or app renderer.
// --manual-recovery permits one fresh chapter traversal only after the user
// reconnects through the same session's native AniTrack → Continue menu.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const electron = require('electron');
const args = new Set(process.argv.slice(2));
const out = process.stdout.write.bind(process.stdout);
const root = path.resolve(__dirname,'..');
const compiled = name => path.join(root,'dist-electron/apps/desktop/main/services/manga',name);
const safeStages = new Set(['startup','compiled','connect','search','identity','chapters','manual-recovery','pages','images','reader','screenshot','passed','failed']);
const safeCategories = new Set(['started','complete','verification-required','access-rejected','rate-limited','deadline','identity-unavailable',
  'invalid-catalogue','incomplete-chapters','chapter-unavailable','invalid-image','compiled-unavailable','opt-in-required','diagnostic-error',
  'module-load','module-url-origin','module-url-coordinates','module-url-path','module-fetch','website-policy','module-bounds','reference-missing','http-facade-ambiguous','http-facade','response-format','request-error','waiting-for-user','manual-continue']);
const safeSessionMessages = new Set(['Unsupported Comix catalogue request.','Comix is busy or its session changed. Retry manually.',
  'Invalid Comix catalogue response.','Comix catalogue did not complete. Retry manually.']);
const CHAPTER_DEADLINE_MS = 540_000;
let stage = 'startup';
let started = Date.now();
let deadline = 0;
let watchdog;
let site;
let reader;
let finished = false;
const controller = new AbortController();
const counts = {matches:0,details:0,chapterPages:0,chapters:0,pages:0,images:0};

function report(next,detail={}) {
  if (!safeStages.has(next)) return;
  const safe = {provider:'comix',stage:next,seconds:Math.round((Date.now()-started)/1000)};
  for (const [key,value] of Object.entries(detail)) {
    if (['matches','details','chapterPages','chapters','pages','images','width','height','bytes'].includes(key) && Number.isSafeInteger(value) && value>=0) safe[key]=value;
    if (['connected','exactIdentity','complete','decoded','rendered','saved'].includes(key) && typeof value==='boolean') safe[key]=value;
    if (key==='category' && safeCategories.has(value)) safe.category=value;
    if (key==='atStage' && safeStages.has(value)) safe.atStage=value;
    if (key==='sessionMessage' && safeSessionMessages.has(value)) safe.sessionMessage=value;
    if (key==='transportPhase' && ['website-module','catalogue','response-format'].includes(value)) safe.transportPhase=value;
  }
  out('[comix-smoke] '+JSON.stringify(safe)+'\n');
}
function failure(category) { const error=new Error('Comix diagnostic stopped.');error.category=category;return error; }
function category(error) {
  if (safeCategories.has(error?.category)) return error.category;
  if (error?.verify === true) return 'verification-required';
  const transport = /^Comix (?:website-module|catalogue|response-format) failed \((module-load|module-url-origin|module-url-coordinates|module-url-path|module-fetch|website-policy|module-bounds|reference-missing|http-facade-ambiguous|http-facade|response-format|request-error)\)\.$/.exec(String(error?.message || ''));
  if (transport) return transport[1];
  if (error?.status===403 || error?.status===401) return 'access-rejected';
  if (error?.status===429) return 'rate-limited';
  if (/limiting requests/i.test(String(error?.message || ''))) return 'rate-limited';
  if (/timed out|deadline|cancelled/i.test(String(error?.message || ''))) return 'deadline';
  if (/pagination|chapter page|partial|catalogue format/i.test(String(error?.message || ''))) return 'invalid-catalogue';
  if (/image|bitmap|scramble|grid|seed|dimensions/i.test(String(error?.message || ''))) return 'invalid-image';
  return 'diagnostic-error';
}
function finish(code,error) {
  if (finished) return;
  finished=true;
  clearTimeout(watchdog);
  controller.abort();
  try {site?.close();if(reader&&!reader.isDestroyed())reader.destroy();} catch {}
  const transportPhase = /^Comix (website-module|catalogue|response-format) failed \([a-z-]+\)\.$/.exec(String(error?.message || ''))?.[1];
  report(code ? 'failed':'passed',{...counts,complete:!code,...(code?{category:category(error),atStage:stage,sessionMessage:error?.message,transportPhase}:{})});
  if (electron.app) electron.app.exit(code);
  else process.exitCode=code;
}
function armDeadline(milliseconds) {
  clearTimeout(watchdog);
  deadline=Date.now()+milliseconds;
  watchdog=setTimeout(()=>finish(1,failure('deadline')),milliseconds);
}
function checkDeadline() {if(finished||controller.signal.aborted||Date.now()>=deadline)throw failure('deadline');}
async function read(pathname,params) {checkDeadline();const value=await site.read(pathname,params);checkDeadline();return value;}

async function collectChapters(selected,comixChapters,comixHasNext) {
  stage='chapters';
  const chapters=new Map();
  let expectedTotal=null;
  let complete=false;
  for(let page = 1; page <= 200; page++) {
    const payload=await read('/manga/'+selected.id+'/chapters',{page,limit:100,'order[number]':'asc'});
    const rows=comixChapters(payload);
    const meta=payload.meta || payload.pagination;
    if(!meta || !Number.isSafeInteger(meta.total)||meta.total<1||meta.total>20000)throw failure('invalid-catalogue');
    if(expectedTotal===null)expectedTotal=meta.total;
    else if(expectedTotal!==meta.total)throw failure('incomplete-chapters');
    for(const chapter of rows) {
      if(chapters.has(chapter.id))throw failure('incomplete-chapters');
      chapters.set(chapter.id,chapter);
    }
    counts.chapterPages=page;counts.chapters=chapters.size;
    if(!comixHasNext(payload,page)) {complete=true;break;}
    if(rows.length===0)throw failure('incomplete-chapters');
  }
  if(!complete||chapters.size!==expectedTotal)throw failure('incomplete-chapters');
  report(stage,{chapterPages:counts.chapterPages,chapters:counts.chapters,complete:true});
  return chapters;
}

async function chaptersWithManualRecovery(selected,comixChapters,comixHasNext) {
  try {
    return await collectChapters(selected,comixChapters,comixHasNext);
  } catch(error) {
    if(!args.has('--manual-recovery') || error?.verify!==true)throw error;
    checkDeadline();
    stage='manual-recovery';report(stage,{category:'waiting-for-user'});
    // A rejected native read makes ComixSiteSession.connect() stay visible until
    // the user completes any website check and explicitly chooses its native
    // Continue menu. Do not invoke website challenge controls or retry reads.
    armDeadline(185_000);
    if(!await site.connect())throw failure('verification-required');
    checkDeadline();
    report(stage,{category:'manual-continue',connected:true});
    counts.chapterPages=0;counts.chapters=0;
    armDeadline(CHAPTER_DEADLINE_MS);
    // Discard the incomplete map and start at page 1. Deliberately no catch or
    // loop surrounds this second attempt: another refusal stops the diagnostic.
    return collectChapters(selected,comixChapters,comixHasNext);
  }
}

async function renderDecodedPage(buffer,type,screenshot) {
  stage='reader';report(stage,{category:'started'});
  const isolated=electron.session.fromPartition('comix-smoke-reader-'+randomUUID());
  isolated.setPermissionCheckHandler(()=>false);
  isolated.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  isolated.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,callback)=>callback({cancel:!details.url.startsWith('data:')}));
  isolated.on('will-download',event=>event.preventDefault());
  reader=new electron.BrowserWindow({show:args.has('--display')||screenshot,width:1000,height:850,title:'AniTrack — decoded Comix page',autoHideMenuBar:true,
    webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,nodeIntegrationInWorker:false,nodeIntegrationInSubFrames:false,
      webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,devTools:false}});
  reader.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  reader.webContents.on('will-navigate',event=>event.preventDefault());
  reader.webContents.on('will-attach-webview',event=>event.preventDefault());
  const image='data:'+type+';base64,'+buffer.toString('base64');
  const html='<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" '+
    'content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; connect-src \'none\'; frame-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">'+
    '<title>AniTrack — decoded Comix page</title><style>body{margin:0;background:#101018;color:#eee;font:15px system-ui}header{padding:16px;text-align:center}'+
    'img{display:block;max-width:90%;height:auto;margin:0 auto 24px}</style></head><body><header>Native-reader diagnostic · selected chapter 1 · decoded page 1</header>'+
    '<img id="page" alt="Decoded manga page" src="'+image+'"></body></html>';
  await reader.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
  checkDeadline();
  const size=await reader.webContents.executeJavaScript(`(async()=>{const page=document.getElementById('page');await page.decode();return{width:page.naturalWidth,height:page.naturalHeight};})()`);
  if(!size||!Number.isSafeInteger(size.width)||!Number.isSafeInteger(size.height)||size.width<1||size.height<1)throw failure('invalid-image');
  report(stage,{rendered:true,width:size.width,height:size.height});
  if(screenshot) {
    stage='screenshot';
    const output=path.join(root,'out','tmp');
    fs.mkdirSync(output,{recursive:true});
    const png=(await reader.webContents.capturePage()).toPNG();
    if(!png.length)throw failure('invalid-image');
    fs.writeFileSync(path.join(output,'comix-smoke-reader-'+Date.now()+'.png'),png,{flag:'wx'});
    report(stage,{saved:true});
  }
  if(args.has('--display')) {
    // Optional short viewing period; no further network requests or site actions.
    await Promise.race([new Promise(resolve=>reader.once('closed',resolve)),new Promise(resolve=>setTimeout(resolve,10000))]);
  }
}

async function main() {
  if(!args.has('--run'))throw failure('opt-in-required');
  if(!electron.app || !electron.BrowserWindow)throw failure('diagnostic-error');
  const missing=['comix-session','comix-protocol','comix-images','comix-image-codec'].some(name=>!fs.existsSync(compiled(name+'.js')));
  if(missing)throw failure('compiled-unavailable');
  stage='compiled';report(stage,{category:'complete'});
  const userData=fs.mkdtempSync(path.join(os.tmpdir(),'anitrack-comix-smoke-'));
  electron.app.setPath('userData',userData);
  electron.app.on('window-all-closed',()=>{});
  await electron.app.whenReady();
  const {ComixSiteSession}=require(compiled('comix-session.js'));
  const {comixSearchIds,comixDetail,comixChapters,comixHasNext,comixPages}=require(compiled('comix-protocol.js'));
  const {fetchComixImage}=require(compiled('comix-images.js'));
  const {COMIX_IMAGE_MAX_BYTES}=require(compiled('comix-image-codec.js'));
  const sharedScript=path.join(root,'apps/android/app/src/main/assets/comix_transport.js');
  const sharedHelp=path.join(root,'apps/android/app/src/main/assets/comix_connection_help.js');
  site=new ComixSiteSession({
    script:()=>fs.readFileSync(sharedScript,'utf8'),
    connectionHelp:()=>fs.readFileSync(sharedHelp,'utf8'),
  });
  stage='connect';report(stage,{category:'started'});
  // The visible normal website owns verification. The user completes any check;
  // the session hides itself only after finding its real homepage initial data.
  armDeadline(185_000);
  if(!await site.connect())throw failure('verification-required');
  report(stage,{connected:true});
  // Catalogue traversal and native-image tests share one bounded work deadline,
  // long enough for the session's paced chapter pages (see comix-protocol.ts).
  armDeadline(CHAPTER_DEADLINE_MS);
  stage='search';
  const search=await read('/manga',{keyword:'Berserk',page:1,limit:20,'order[relevance]':'desc'});
  const identities=comixSearchIds(search);
  counts.matches=identities.length;report(stage,{matches:counts.matches});
  stage='identity';
  let selected=null;
  for(const id of identities) {
    const detail=comixDetail(await read('/manga/'+id,{}),id);
    counts.details++;
    if(detail?.anilistId===30002) {selected=detail;break;}
  }
  if(!selected)throw failure('identity-unavailable');
  report(stage,{details:counts.details,exactIdentity:true});
  const chapters=await chaptersWithManualRecovery(selected,comixChapters,comixHasNext);
  const selectedChapter=[...chapters.values()].find(chapter=>chapter.number===1);
  if(!selectedChapter)throw failure('chapter-unavailable');
  stage='pages';
  const pages=comixPages(await read('/chapters/'+selectedChapter.id,{}));
  counts.pages=pages.length;report(stage,{pages:counts.pages});
  stage='images';
  let first=null;
  for(let index=0;index<Math.min(3, pages.length);index++) {
    checkDeadline();
    const response=await fetchComixImage(pages[index].url,controller.signal);
    if(!response.ok) {const error=failure(response.status===429?'rate-limited':'access-rejected');error.status=response.status;throw error;}
    const type=response.headers.get('content-type');
    if(!['image/png','image/jpeg','image/webp'].includes(type))throw failure('invalid-image');
    const bytes=Buffer.from(await response.arrayBuffer());
    if(!bytes.length||bytes.length>COMIX_IMAGE_MAX_BYTES)throw failure('invalid-image');
    counts.images++;
    if(!first)first={bytes,type};
    report(stage,{images:counts.images,decoded:true,bytes:bytes.length});
  }
  if(!first)throw failure('invalid-image');
  await renderDecodedPage(first.bytes,first.type,args.has('--screenshot'));
  checkDeadline();
}

// Imported connector messages may contain expiring coordinates. Only report()
// emits fixed categories, counts and booleans; raw Error/Response objects never log.
console.log=console.warn=console.error=()=>{};
process.on('uncaughtException',error=>finish(1,error));
process.on('unhandledRejection',error=>finish(1,error));
main().then(()=>finish(0)).catch(error=>finish(1,error));
