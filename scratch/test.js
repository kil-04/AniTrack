const https = require('https');

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
  });
}

async function run() {
  const search = await fetch('https://animepahe.ru/api?m=search&q=City+Hunter+2');
  const searchData = JSON.parse(search.data);
  const animeSession = searchData.data[0].session;
  console.log("Anime:", animeSession);

  const eps = await fetch(`https://animepahe.ru/api?m=release&id=${animeSession}`);
  const epsData = JSON.parse(eps.data);
  const epSession = epsData.data[0].session;
  console.log("Ep:", epSession);

  const play = await fetch(`https://animepahe.ru/play/${animeSession}/${epSession}`);
  const html = play.data;
  
  const kwikM = /data-src="([^"]+kwik[^"]+)"/.exec(html);
  if (!kwikM) {
    console.log("No kwik url found in play page (Cloudflare blocked?)");
    return;
  }
  const kwikUrl = kwikM[1];
  console.log("Kwik:", kwikUrl);

  const kwikReq = await fetch(kwikUrl);
  let kwikHtml = kwikReq.data;
  
  // extract evals
  const evals = [];
  let s = 0;
  while(true) {
    let rel = kwikHtml.slice(s).search(/eval\(function\(p,a,c,k,e/);
    if(rel===-1) break;
    let abs = s + rel;
    let depth = 0, inStr = null, escape = false;
    let found = false;
    for(let i = abs+4; i<kwikHtml.length; i++) {
        let ch = kwikHtml[i];
        if(escape) { escape=false; continue; }
        if(inStr) { if(ch==='\\') escape=true; else if(ch===inStr) inStr=null; continue; }
        if(ch==='"' || ch==="'" || ch==="`") { inStr=ch; continue; }
        if(ch==='(') { depth++; continue; }
        if(ch===')') {
            depth--;
            if(depth===0) { evals.push(kwikHtml.slice(abs, i+1)); s = i+1; found=true; break; }
        }
    }
    if(!found) break;
  }
  
  console.log("Found evals:", evals.length);
  for(let ev of evals) {
    let m = ev.match(/}\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/);
    if(m) {
        let [_, p, a, c, k] = m;
        a = parseInt(a); c = parseInt(c); k = k.split('|');
        function e(c) { return (c < a ? '' : e(parseInt(c / a))) + ((c = c % a) > 35 ? String.fromCharCode(c + 29) : c.toString(36)); }
        let unpacked = p.replace(/\b\w+\b/g, c => k[e(c)] || c);
        console.log("UNPACKED:", unpacked.substring(0, 100) + "...");
        let act = unpacked.match(/action\s*=\s*["']([^"']+)["']/);
        let tok = unpacked.match(/name\s*=\s*["']_token["']\s+value\s*=\s*["']([^"']+)["']/) || unpacked.match(/value\s*=\s*["']([^"']+)["']\s+name\s*=\s*["']_token["']/);
        console.log("Action:", act?.[1], "Token:", tok?.[1] || tok?.[2]);
    }
  }
}
run();
