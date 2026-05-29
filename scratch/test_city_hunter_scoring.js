const https = require("https");

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

function post(url, postData) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

// Mimic scoreMatch from PahePanel.tsx
function getSeasonNumber(title) {
  const clean = title.toLowerCase();
  const seasonMatch = clean.match(/\b(season|ss|part|cour)\s+(\d+|ii|iii|iv|v|vi|vii|viii|ix|x)\b/);
  if (seasonMatch) {
    const val = seasonMatch[2];
    if (/^\d+$/.test(val)) return parseInt(val, 10);
    const romanMap = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
    if (romanMap[val] !== undefined) return romanMap[val];
  }
  const ordinalMatch = clean.match(/\b(\d+)(st|nd|rd|th)\s+(season|part|ss|cour)\b/);
  if (ordinalMatch) return parseInt(ordinalMatch[1], 10);
  const endRomanMatch = clean.match(/\b(ii|iii|iv|v|vi|vii|viii|ix|x)\b\s*$/);
  if (endRomanMatch) {
    const romanMap = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
    return romanMap[endRomanMatch[1]];
  }
  const endDigitMatch = clean.match(/\b(\d+)\b\s*$/);
  if (endDigitMatch) return parseInt(endDigitMatch[1], 10);
  return null;
}

function scoreMatch(candidate, targetTitle, targetYear, targetEpisodes, targetStatus) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
  const t = norm(targetTitle);
  const c = norm(candidate.title ?? "");
  let score = 0;
  if (c === t) {
    score += 100;
  } else if (c.includes(t) || t.includes(c)) {
    const ratio = Math.min(c.length, t.length) / Math.max(c.length, t.length);
    score += Math.round(40 * ratio);
  } else {
    const tw = new Set(t.split(/\s+/));
    const cw = c.split(/\s+/);
    const overlap = cw.filter((w) => tw.has(w)).length;
    score += Math.round((overlap / Math.max(tw.size, cw.length)) * 30);
  }

  const tw_arr = t.split(/\s+/);
  const cw_arr = c.split(/\s+/);
  let prefixMatch = 0;
  for (let i = 0; i < Math.min(3, tw_arr.length, cw_arr.length); i++) {
    if (tw_arr[i] === cw_arr[i]) prefixMatch++;
    else break;
  }
  if (prefixMatch >= 2) {
    score += prefixMatch * 10;
  }

  if (targetYear && candidate.year) {
    if (Number(candidate.year) === targetYear) score += 8;
    else if (Math.abs(Number(candidate.year) - targetYear) <= 1) score += 2;
    else return -100; // Ignore completely if year differs by more than 1
  }

  const candidateSeason = getSeasonNumber(candidate.title) || 1;
  const targetSeason = getSeasonNumber(targetTitle) || 1;
  if (candidateSeason !== targetSeason) {
    score -= 50;
  }

  if (targetEpisodes && candidate.episodes) {
    const diff = Math.abs(candidate.episodes - targetEpisodes);
    if (diff > 0) {
      const isTargetAiring = targetStatus === "RELEASING" || targetStatus === "releasing";
      const isCandidateAiring = candidate.status && (
        candidate.status.toLowerCase().includes("airing") ||
        candidate.status.toLowerCase().includes("releasing") ||
        candidate.status.toLowerCase().includes("current")
      );
      const isAiring = isTargetAiring || isCandidateAiring;

      if (isAiring && candidate.episodes < targetEpisodes) {
        // No penalty
      } else {
        if (diff <= 1) score -= 2;
        else if (diff <= 3) score -= 5;
        else score -= 40;
      }
    }
  }

  return score;
}

async function main() {
  const targetTitle = "City Hunter";
  const targetYear = 1987;
  const targetEpisodes = 51;
  const targetStatus = "FINISHED";

  console.log(`Target: "${targetTitle}" (${targetYear}), ${targetEpisodes} eps, status=${targetStatus}\n`);

  // 1. Fetch from Anikoto
  const anikotoResults = [];
  try {
    const html = await get("https://anikoto.cz/filter?keyword=City+Hunter");
    const blocks = html.split(/<div class="item\s*/);
    for (let i = 1; i < blocks.length; i++) {
      const block = blocks[i];
      const hrefM = /href="[^"]*\/watch\/([^/"]+)/.exec(block);
      const href = hrefM ? hrefM[1] : null;
      if (!href) continue;
      
      const imgM = /<img src="([^"]+)" alt="([^"]+)"/.exec(block);
      const imgAlt = imgM ? imgM[2] : null;
      const jpM = /data-jp="([^"]+)"/.exec(block);
      const dataJp = jpM ? jpM[1].replace(/&#039;/g, "'") : null;
      
      const totalM = /class="ep-status total"[^>]*>\s*<span>\s*(\d+)\s*<\/span>/.exec(block);
      const totalEps = totalM ? parseInt(totalM[1], 10) : undefined;

      // Check if there is year inside watch page or anywhere?
      // For now, anikoto search results don't have year property.
      anikotoResults.push({
        id: href,
        providerId: "anikoto",
        title: dataJp || imgAlt || "Untitled",
        episodes: totalEps,
        year: undefined // currently undefined
      });
    }
  } catch (e) {
    console.error("Anikoto fetch error:", e);
  }

  // 2. Fetch from AnimePahe (simulated API response)
  const paheResults = [];
  try {
    // animepahe search uses a POST or GET request
    // let's fetch animepahe search API
    // Actually, we can fetch from their API, but we might get blocked if we don't have a Cloudflare session.
    // Let's just run with Anikoto results first since the issue is specifically about "shows 13eps city hunter 91 instead of 51ep city hunter on anikoto".
  } catch (e) {}

  console.log("--- ANIKOTO RESULTS SCORING ---");
  anikotoResults.forEach(r => {
    const score = scoreMatch(r, targetTitle, targetYear, targetEpisodes, targetStatus);
    console.log(`Title: "${r.title}"`);
    console.log(`  ID: ${r.id}`);
    console.log(`  Eps: ${r.episodes}`);
    console.log(`  Year: ${r.year}`);
    console.log(`  Season: ${getSeasonNumber(r.title) || 1}`);
    console.log(`  Score: ${score}`);
    console.log("------------------------");
  });
}

main();
