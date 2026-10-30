import type { CityPopMode } from '../source/packages/shared/city-pop-api';
import { CITY_POP_PIXEL_WOFF } from '../source/packages/shared/city-pop-pixel-font';
interface PlayerItem {
    title: string;
    artist: string;
    source: string;
    media: string;
    kind: 'youtube' | 'audio' | 'video';
}
const htmlText = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
export function playerHtml(items: readonly PlayerItem[], start: number, mode: CityPopMode, cover: string | null): string {
    const APP_ORIGIN = location.origin;
    const youtube = items[0].kind === "youtube";
    const height = youtube ? (mode === "listen" ? 248 : 450) : 450;
    const surface = youtube
        ? `<div id="player"></div>`
        : `<div class="record" id="record"><span>♫${cover ? `<img id="cover" src="${htmlText(cover)}" alt="" referrerpolicy="no-referrer">` : ""}</span></div><audio id="audio" controls autoplay></audio><video id="video" controls autoplay playsinline hidden></video>`;
    const script = youtube ? `
function load(){if(player&&player.loadVideoById)player.loadVideoById(items[index].media);}
window.cityPopPause=function(){if(player&&player.pauseVideo)player.pauseVideo();};
window.onYouTubeIframeAPIReady=function(){player=new YT.Player('player',{videoId:items[index].media,width:'100%',height:'100%',playerVars:{autoplay:1,playsinline:1,rel:0,origin:${scriptJson(APP_ORIGIN)}},events:{
onStateChange:function(e){if(e.data===YT.PlayerState.PLAYING)say('');if(e.data===YT.PlayerState.ENDED){if(index+1<items.length)step(1);else say('Station finished.');}},
onError:function(e){say(e.data===101||e.data===150?"This video can't be played here. Try Next or open it on YouTube.":e.data===153?"YouTube couldn't verify this player. Open the video on YouTube.":'This video is unavailable. Try Next or open it on YouTube.',true);}}});};`
        : `
const audio=$('audio'),video=$('video');
function load(){const item=items[index],watching=MODE==='watch'&&item.kind==='video',media=watching?video:audio,other=watching?audio:video;
other.pause();other.removeAttribute('src');other.load();other.hidden=true;$('record').hidden=watching;media.hidden=false;media.src=item.media;media.play().catch(function(){});}
for(const m of [audio,video]){m.addEventListener('ended',function(){if(index+1<items.length)step(1);else say('Album finished.');});
m.addEventListener('error',function(){if(m.hidden||!m.getAttribute('src'))return;say('This file could not play. Try Next or open it on Internet Archive.',true);});
m.addEventListener('playing',function(){say('');});}
const art=$('cover');if(art){art.addEventListener('error',function(){art.remove();});if(art.complete&&!art.naturalWidth)art.remove();}
load();`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://www.youtube.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; media-src 'self' blob: https://archive.org https://*.archive.org; img-src https://archive.org https://*.archive.org; font-src data:; style-src 'unsafe-inline'"><title>City Pop</title><style>:root{color-scheme:dark}*{box-sizing:border-box}[hidden]{display:none!important}@font-face{font-family:Pixel;src:url(data:font/woff;base64,${CITY_POP_PIXEL_WOFF}) format("woff")}body{margin:0;padding:24px;min-height:100vh;background:linear-gradient(170deg,#1a0636,#0d0221 55%,#071226);color:#fff;font:15px system-ui}body::after{content:'';position:fixed;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(0,0,0,.14) 0 2px,transparent 2px 4px)}small,button,#count{font-family:Pixel,monospace;font-weight:400;text-transform:uppercase;letter-spacing:0;-webkit-font-smoothing:none}small{color:#ff7ac6;font-size:12px}h1{font-size:23px;margin:14px 0 5px;text-shadow:2px 2px 0 #3d0a63}p{color:#c9b8e8;margin:0 0 16px}#player{display:block;border:2px solid #ff2a9d;width:100%;height:${height}px;min-height:200px;background:#000;box-shadow:6px 6px 0 #3d0a2c}video{display:block;background:#000;max-height:65vh;width:100%;border:2px solid #ff2a9d;box-shadow:6px 6px 0 #3d0a2c}audio{display:block;width:100%;margin:18px 0 0}.record{margin:18px auto 0;width:190px;height:190px;border-radius:50%;display:grid;place-items:center;background:repeating-radial-gradient(#17161e 0 3px,#35303f 4px 5px);border:20px solid #17161e;box-shadow:0 0 0 2px #ff2a9d,0 0 40px #ff2a9d55}.record span{position:relative;display:grid;place-items:center;width:84px;height:84px;overflow:hidden;border-radius:50%;background:#ff7ac6;color:#12021f;font-size:30px}.record img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.controls{display:flex;align-items:center;justify-content:center;gap:14px;margin-top:18px}.controls button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-width:116px;padding:9px 14px;border:2px solid #2ee6ff;background:#12021f;color:#2ee6ff;font-size:12px;cursor:pointer;box-shadow:4px 4px 0 #0b4a55}.controls button:hover:enabled{background:#0b2a3a}.controls button:active:enabled{transform:translate(2px,2px);box-shadow:1px 1px 0 #0b4a55}.controls button:disabled{opacity:.35;cursor:default}#count{min-width:64px;text-align:center;color:#ffd319;font-size:12px}#status{min-height:18px;margin:14px 0 0;color:#c9b8e8;font-size:13px}#status.error{color:#ff9bb5}a{color:#2ee6ff}footer{font-size:12px;margin-top:12px;color:#ae9eb6}</style></head><body><small>CITY POP · ${mode.toUpperCase()}</small><h1 id="title"></h1><p id="byline"></p>${surface}<div class="controls" id="controls"${items.length > 1 ? "" : " hidden"}><button type="button" id="prev"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>Previous</button><span id="count"></span><button type="button" id="next">Next<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg></button></div><p id="status" role="status"></p><footer><span id="note"></span> <a id="source" target="_blank" rel="noopener"></a></footer><script>
const items=${scriptJson(items)},MODE=${scriptJson(mode)};let index=${start},player=null;
function $(id){return document.getElementById(id);}
function say(text,error){const s=$('status');s.textContent=text;s.className=error?'error':'';}
function show(){const item=items[index];$('title').textContent=item.title;$('byline').textContent=item.artist;document.title='City Pop · '+item.title;
$('count').textContent=(index+1)+' / '+items.length;$('prev').disabled=index===0;$('next').disabled=index===items.length-1;$('source').href=item.source;
$('source').textContent=item.kind==='youtube'?'Open on YouTube':'Open on Internet Archive';
$('note').textContent=item.kind==='youtube'?'YouTube player · Internet required. Keep the player visible while listening.':item.media.indexOf('anitrack-city-pop:')===0?'Saved on this device · Available offline.':'Full media from Internet Archive.';}
function step(by){const at=index+by;if(at<0||at>=items.length)return;index=at;say('');show();load();}
$('prev').addEventListener('click',function(){step(-1);});$('next').addEventListener('click',function(){step(1);});
show();${script}
document.addEventListener('visibilitychange',function(){if(document.hidden&&window.cityPopPause)window.cityPopPause();});
</script>${youtube ? `<script src="https://www.youtube.com/iframe_api"></script>` : ""}</body></html>`;
}
