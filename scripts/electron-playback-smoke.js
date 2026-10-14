#!/usr/bin/env node
// App-owned live integration check. Never uses the installed app's profile or MAL.
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { publicHttpsUrl, safeMessage, verificationIdsMatch } = require("./electron-provider-smoke-common");
const args = process.argv.slice(2);
const providerId = args.find(arg => arg.startsWith("--provider="))?.slice(11) || "anikoto";
const staged = args.includes("--staged");
const selectedServer = args.find(arg => arg.startsWith("--server="))?.slice(9);
const selectedSource = args.find(arg => arg.startsWith("--source="))?.slice(9);
const selectedTrack = args.find(arg => arg.startsWith("--track="))?.slice(8) || "ssub";
const selectedTitle = args.find(arg => arg.startsWith("--title="))?.slice(8) || "Cowboy Bebop";
const selectedAnilistId = Number(args.find(arg => arg.startsWith("--anilist-id="))?.slice(13) || 1);
const selectedMalId = Number(args.find(arg => arg.startsWith("--mal-id="))?.slice(9)
  || (selectedTitle === "Cowboy Bebop" && selectedAnilistId === 1 ? 1 : 0));
const switchSource = args.find(arg => arg.startsWith("--switch-source="))?.slice(16);
const switchServer = args.find(arg => arg.startsWith("--switch-server="))?.slice(16);
const log = console.log.bind(console);
console.log = console.warn = console.error = () => {}; // No expiring URLs/credentials in connector logs.
app.setPath("userData", path.join(os.tmpdir(), "anitrack-provider-smoke"));
app.userAgentFallback = app.userAgentFallback.replace(/\s?Electron\/[\d.]+/i, "").replace(/\s?anitrack\/[\d.]+/i, "");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
let window, server, finished = false;
const statuses = {};
const pendingMedia = new Map();
let rejected = false;
const started = Date.now();
const watchdog = setTimeout(() => finish(1, "Playback diagnostic reached its 200-second deadline."), 200_000);
app.on("window-all-closed", () => {});
function report(stage, value) { log("[playback] " + JSON.stringify({ provider: providerId, stage, seconds: Math.round((Date.now() - started) / 1000), ...value })); }
function finish(code, message) {
  if (finished) return;
  finished = true;
  clearTimeout(watchdog);
  report(code ? "failed" : "passed", { message: safeMessage(message), statuses,
    pendingMedia: [...pendingMedia.values()].map(item=>({kind:item.kind,seconds:Math.round((Date.now()-item.start)/1000)})) });
  try { window?.destroy(); server?.close(); } catch {}
  app.exit(code);
}

// This script is local diagnostic code, not downloaded player/extractor code.
const html = `<!doctype html><meta charset="utf-8"><title>AniTrack playback test</title>
<style>body{background:#111;color:white;font:16px system-ui;margin:16px}video{width:100%;height:540px}pre{white-space:pre-wrap}</style>
<h2>AniTrack isolated playback test</h2><video id="video" crossorigin="anonymous" playsinline></video><pre id="result"></pre>
<script src="/hls.js"></script><script>
const video=document.getElementById('video');
const state={fatal:[],fragments:0,audioCodec:'',videoCodec:'',audioEnergySamples:0,waits:0,captionCues:0,captionError:false};
let activeHls=null,audioReady=false;
video.addEventListener('waiting',()=>state.waits++);
video.addEventListener('error',()=>state.fatal.push('mediaError:'+video.error?.code));
window.startCheck=async (url,isHls,subtitles=[],resume=0)=>{
  activeHls?.destroy();activeHls=null;state.fatal=[];state.captionCues=0;state.captionError=false;
  for(const track of video.querySelectorAll('track'))track.remove();
  if(subtitles.length){const track=document.createElement('track');track.kind='subtitles';track.label=subtitles[0].label||'English';track.srclang='en';track.src=subtitles[0].file;
    track.addEventListener('load',()=>state.captionCues=track.track.cues?.length||0);track.addEventListener('error',()=>state.captionError=true);
    video.appendChild(track);track.track.mode='showing';}
  video.addEventListener('loadedmetadata',()=>{if(resume>0)video.currentTime=resume;},{once:true});
  if(!audioReady){audioReady=true;
  const context=new AudioContext(),analyser=context.createAnalyser(),samples=new Float32Array(1024),silent=context.createGain();
  analyser.fftSize=1024;silent.gain.value=0;
  context.createMediaElementSource(video).connect(analyser);analyser.connect(silent);silent.connect(context.destination);await context.resume();
  setInterval(()=>{analyser.getFloatTimeDomainData(samples);if(samples.some(value=>Math.abs(value)>0.0001))state.audioEnergySamples++;},250);
  }
  if(!isHls){video.src=url;await video.play();return true;}
  if(!Hls.isSupported()) throw new Error('HLS unavailable');
  const hls=new Hls({enableWorker:true,maxBufferLength:30,maxMaxBufferLength:60,
    manifestLoadingMaxRetry:0,levelLoadingMaxRetry:0,fragLoadingMaxRetry:0,
    xhrSetup:xhr=>{xhr.withCredentials=false;}});
  activeHls=hls;
  hls.on(Hls.Events.BUFFER_CODECS,(_,data)=>{state.audioCodec=data.audio?.codec||state.audioCodec;state.videoCodec=data.video?.codec||state.videoCodec;});
  hls.on(Hls.Events.FRAG_LOADED,()=>state.fragments++);
  hls.on(Hls.Events.ERROR,(_,data)=>{const status=Number(data.response?.code||data.networkDetails?.status||0);
    if(data.fatal||status===403||status===429){state.fatal.push({details:data.details,status,
      loaded:data.frag?.stats?.loaded||0,firstByte:!!data.frag?.stats?.loading?.first});hls.destroy();}});
  hls.on(Hls.Events.MANIFEST_PARSED,()=>video.play().catch(()=>state.fatal.push('playRejected')));
  hls.attachMedia(video);hls.loadSource(url);return true;
};
window.seekCheck=time=>{video.currentTime=time;video.play().catch(()=>state.fatal.push('seekPlayRejected'));};
window.checkState=()=>{const quality=video.getVideoPlaybackQuality();const result={...state,time:video.currentTime,
  duration:Number.isFinite(video.duration)?video.duration:0,paused:video.paused,seeking:video.seeking,
  width:video.videoWidth,height:video.videoHeight,frames:quality.totalVideoFrames,dropped:quality.droppedVideoFrames};
  document.getElementById('result').textContent=JSON.stringify(result,null,2);return result;};
</script>`;

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function snapshot() {
  const state = await window.webContents.executeJavaScript("window.checkState()", true);
  if (rejected || state.fatal.length) throw new Error("Media request/playback failed; diagnostic stopped without retry: " + JSON.stringify(state.fatal));
  return state;
}
async function waitFor(stage, predicate, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = await snapshot();
    if (predicate(state)) { report(stage, state); return state; }
    await pause(500);
  }
  throw new Error(stage + " timed out");
}

async function main() {
  if (selectedTitle.length>200 || !Number.isSafeInteger(selectedAnilistId) || selectedAnilistId<=0) throw new Error("Invalid verification title or AniList identity.");
  if ((switchSource||switchServer) && providerId!=="miruro") throw new Error("The explicit server-switch diagnostic currently supports Miruro only.");
  if (!["anikoto", "animepahe"].includes(providerId) && !(staged && ["miruro", "mkissa"].includes(providerId))) {
    throw new Error("Staged providers require explicit --staged diagnostic opt-in; no release configuration is changed.");
  }
  await app.whenReady();
  const compiled = name => require(path.join(__dirname, "../dist-electron/apps/desktop/main/services", name));
  await compiled("remote-config").initRuntimeConfig();
  const pahe = compiled("providers/animepahe");
  const Provider = { animepahe: pahe.AnimePaheProvider, anikoto: compiled("providers/anikoto").AnikotoProvider,
    miruro: compiled("providers/miruro").MiruroProvider, mkissa: compiled("providers/mkissa").MkissaProvider }[providerId];
  const provider = new Provider();
  const registry = new (compiled("providers/registry").ProviderRegistry)([provider]);
  const matches = await registry.get(providerId).search(selectedTitle);
  let show = ["miruro","mkissa"].includes(providerId) ? matches.find(item => Number(item.externalLookupId) === selectedAnilistId) : null;
  if(!show) {
    const named = matches.find(item => item.title.toLowerCase() === selectedTitle.toLowerCase());
    const ids = named && await provider.getExternalIds?.(named.id,named.externalLookupId);
    if(verificationIdsMatch(ids,{anilistId:selectedAnilistId,malId:selectedMalId})) show=named;
  }
  if (!show) throw new Error("Exact verification title unavailable; no substitute selected.");
  const episodes = await registry.getEpisodes(providerId, show.id, 1);
  const episode = episodes.data.find(item => Number(item.episodeNumber) === 1);
  if (!episode) throw new Error("Episode 1 unavailable.");
  const links = await registry.getStreamLinks(providerId, episode.id, show.id);
  report("server-choices", { choices: links.map(item => ({ label:item.quality, audio:item.audio })) });
  const link = providerId === "miruro" ? links.find(item => {
    const token=JSON.parse(item.id);
    return token.c===selectedTrack && (!selectedSource||token.p===selectedSource) && (!selectedServer||token.s===selectedServer);
  }) : providerId === "mkissa" ? links.find(item=>item.audio!=="eng" && (!selectedServer||item.quality===selectedServer))
    : providerId === "anikoto" ? links.find(item => item.variant === "soft")
    : links.filter(item => item.audio !== "eng").sort((a,b)=>(parseInt(b.quality)||0)-(parseInt(a.quality)||0))[0];
  if (!link) throw new Error("Requested stream variant unavailable.");
  report("selected-server", {label:link.quality});
  const source = await registry.resolveStream(providerId, link.id);
  const mediaUrl = publicHttpsUrl(source.url);
  const genericAuth = compiled("providers/stream-authorization").getResolvedStreamAuthorization;
  function authorization(url) {
    if (providerId !== "animepahe") return genericAuth(url);
    const headers = pahe.getAuthorizedPaheRequestHeaders(url);
    return headers ? { headers: { Referer: headers.referer + "/", Origin: new URL(headers.referer).origin,
      ...(headers.cookie ? { Cookie: headers.cookie } : {}) }, cors: true } : null;
  }
  if (!authorization(mediaUrl)) throw new Error("Media authorization was not registered.");
  session.defaultSession.webRequest.onBeforeSendHeaders({urls:["*://*/*"]}, (details, callback) => {
    const scoped = authorization(details.url), headers = {...details.requestHeaders};
    if (scoped) pendingMedia.set(details.id,{start:Date.now(),kind:new URL(details.url).pathname.endsWith(".m3u8")?"playlist":"segment/key"});
    for (const [name,value] of Object.entries(scoped?.headers || {})) {
      for (const existing of Object.keys(headers)) if (existing.toLowerCase() === name.toLowerCase()) delete headers[existing];
      headers[name] = value;
    }
    callback({requestHeaders:headers});
  });
  session.defaultSession.webRequest.onHeadersReceived({urls:["*://*/*"]}, (details, callback) => {
    if (!authorization(details.url)?.cors) return callback({responseHeaders:details.responseHeaders});
    statuses[details.statusCode] = (statuses[details.statusCode] || 0) + 1;
    if ([403,429].includes(details.statusCode)) { rejected = true; return callback({cancel:true}); }
    const headers = Object.fromEntries(Object.entries(details.responseHeaders || {}).filter(([name])=>!name.toLowerCase().startsWith("access-control-")));
    headers["Access-Control-Allow-Origin"] = ["*"];
    headers["Access-Control-Allow-Headers"] = ["*"];
    headers["Access-Control-Allow-Methods"] = ["GET, HEAD, OPTIONS"];
    headers["Access-Control-Expose-Headers"] = ["*"];
    callback({responseHeaders:headers});
  });
  session.defaultSession.webRequest.onCompleted({urls:["*://*/*"]}, details=>pendingMedia.delete(details.id));
  session.defaultSession.webRequest.onErrorOccurred({urls:["*://*/*"]}, details=>{
    const pending=pendingMedia.get(details.id);
    if(pending) report("media-request-error",{kind:pending.kind,error:safeMessage(details.error),secondsWaiting:Math.round((Date.now()-pending.start)/1000)});
    pendingMedia.delete(details.id);
  });
  server = http.createServer((request,response) => {
    const route = new URL(request.url,"http://127.0.0.1").pathname;
    if (route === "/") { response.writeHead(200,{"Content-Type":"text/html"}); response.end(html); }
    else if (route === "/hls.js") { response.writeHead(200,{"Content-Type":"text/javascript"}); response.end(fs.readFileSync(path.join(__dirname,"../node_modules/hls.js/dist/hls.min.js"))); }
    else { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  window = new BrowserWindow({show:true,width:1100,height:780,title:"AniTrack — isolated playback check",
    webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  window.webContents.setWindowOpenHandler(()=>({action:"deny"}));
  window.webContents.on("will-navigate",(event,url)=>{if(new URL(url).origin !== origin) event.preventDefault();});
  await window.loadURL(origin);
  await window.webContents.executeJavaScript("window.startCheck(" + JSON.stringify(mediaUrl) + "," + JSON.stringify(mediaUrl.includes(".m3u8")) + "," + JSON.stringify(source.subtitles||[]) + ")",true);
  const initial = await waitFor("video-and-audio", state=>!state.paused && state.time>=2 && state.frames>=30 && state.audioEnergySamples>0,25_000);
  if(source.subtitles?.length) await waitFor("captions-loaded",state=>state.captionCues>0&&!state.captionError,10_000);
  const sustainStart = Date.now();
  let current = initial, lastProgress = Date.now(), previous = initial.time;
  while (current.time-initial.time < 65 && Date.now()-sustainStart < 100_000) {
    await pause(1000); current = await snapshot();
    if (current.time > previous+0.1) lastProgress=Date.now();
    if (Date.now()-lastProgress>12_000) throw new Error("Playback stalled for more than 12 seconds.");
    previous=current.time;
    if (Math.round((Date.now()-sustainStart)/1000)%15 === 0) report("sustained-progress",current);
  }
  if (current.time-initial.time<65 || current.frames-initial.frames<900) throw new Error("Video did not progress through 65 seconds of media.");
  report("sustained-65-media-seconds",current);
  for (const [stage,target] of [["seek-forward", Math.min(current.duration*0.55,current.duration-30)],["seek-back",15]]) {
    if (current.duration<150) throw new Error("Media duration too short for seeking verification.");
    const before=current;
    await window.webContents.executeJavaScript("window.seekCheck("+JSON.stringify(target)+")",true);
    current=await waitFor(stage,state=>!state.paused&&!state.seeking&&state.time>=target+4&&state.time<target+15
      &&state.frames>=before.frames+30&&state.audioEnergySamples>before.audioEnergySamples,18_000);
  }
  if(switchSource||switchServer){
    const next=links.find(item=>{const token=JSON.parse(item.id);return token.c===selectedTrack
      &&(!switchSource||token.p===switchSource)&&(!switchServer||token.s===switchServer)&&item.id!==link.id;});
    if(!next)throw new Error("Requested switch server unavailable; no substitute selected.");
    const position=current.time,beforeAudio=current.audioEnergySamples;
    const switched=await registry.resolveStream(providerId,next.id);
    const nextUrl=publicHttpsUrl(switched.url);
    if(!authorization(nextUrl))throw new Error("Switch server media authorization missing.");
    report("server-switch-start",{label:next.quality,position});
    await window.webContents.executeJavaScript("window.startCheck("+JSON.stringify(nextUrl)+","+JSON.stringify(nextUrl.includes(".m3u8"))+","+JSON.stringify(switched.subtitles||[])+","+position+")",true);
    current=await waitFor("server-switch-resumed",state=>!state.paused&&!state.seeking&&state.time>=position+4&&state.time<position+20
      &&state.frames>=30&&state.audioEnergySamples>beforeAudio,25_000);
    if(switched.subtitles?.length)await waitFor("switched-captions-loaded",state=>state.captionCues>0&&!state.captionError,10_000);
  }
  finish(0,"Video/audio sustained beyond 65 seconds; forward/backward seeking resumed"+(switchSource||switchServer?" and the selected server switch retained position.":"."));
}
main().catch(error=>finish(1,error));
