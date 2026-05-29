const { app } = require('electron');
const path = require('path');

function getSeasonNumber(title) {
  const clean = title.toLowerCase();
  
  const seasonMatch = clean.match(/\b(season|ss|part|cour)\s+(\d+|ii|iii|iv|v|vi|vii|viii|ix|x)\b/);
  if (seasonMatch) {
    const val = seasonMatch[2];
    if (/^\d+$/.test(val)) return parseInt(val, 10);
    const romanMap = {
      i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10
    };
    if (romanMap[val] !== undefined) return romanMap[val];
  }

  const ordinalMatch = clean.match(/\b(\d+)(st|nd|rd|th)\s+(season|part|ss|cour)\b/);
  if (ordinalMatch) {
    return parseInt(ordinalMatch[1], 10);
  }

  const endRomanMatch = clean.match(/\b(ii|iii|iv|v|vi|vii|viii|ix|x)\b\s*$/);
  if (endRomanMatch) {
    const romanMap = {
      ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10
    };
    return romanMap[endRomanMatch[1]];
  }

  const endDigitMatch = clean.match(/\b(\d+)\b\s*$/);
  if (endDigitMatch) {
    return parseInt(endDigitMatch[1], 10);
  }

  return null;
}

function scoreMatch(candidate, targetTitle, targetYear) {
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
    else score -= 5;
  }

  const candidateSeason = getSeasonNumber(candidate.title) || 1;
  const targetSeason = getSeasonNumber(targetTitle) || 1;
  if (candidateSeason !== targetSeason) {
    score -= 50; 
  }

  return score;
}

app.whenReady().then(async () => {
  try {
    const { providerManager } = require(path.join(__dirname, '../dist-electron/electron/services/providers/index.js'));
    const r = await providerManager.searchAll("City Hunter '91");
    const animeYear = 1991;
    const animeTitle = "City Hunter '91";

    const scored = r
      .map(item => ({ item, score: scoreMatch(item, animeTitle, animeYear) }))
      .sort((a, b) => b.score - a.score);
    
    console.log("Scored results:");
    scored.slice(0, 5).forEach(s => {
      console.log(`${s.item.providerId}: "${s.item.title}" (year: ${s.item.year}) - Score: ${s.score}`);
    });
  } catch(e) {
    console.error(e);
  }
  app.quit();
});
