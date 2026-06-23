// Provider-result matching heuristics shared by PahePanel and StreamPlayer.

export function getSeasonNumber(title: string): number | null {
  const clean = title.toLowerCase();

  // Pattern 1: "season 4" or "season iv" or "ss 4"
  const seasonMatch = clean.match(/\b(season|ss|part|cour)\s+(\d+|ii|iii|iv|v|vi|vii|viii|ix|x)\b/);
  if (seasonMatch) {
    const val = seasonMatch[2];
    if (/^\d+$/.test(val)) return parseInt(val, 10);
    const romanMap: Record<string, number> = {
      i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10
    };
    if (romanMap[val] !== undefined) return romanMap[val];
  }

  // Pattern 2: "4th season" or "2nd season"
  const ordinalMatch = clean.match(/\b(\d+)(st|nd|rd|th)\s+(season|part|ss|cour)\b/);
  if (ordinalMatch) {
    return parseInt(ordinalMatch[1], 10);
  }

  // Pattern 3: Lone Roman numerals at the end of the title
  const endRomanMatch = clean.match(/\b(ii|iii|iv|v|vi|vii|viii|ix|x)\b\s*$/);
  if (endRomanMatch) {
    const romanMap: Record<string, number> = {
      ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10
    };
    return romanMap[endRomanMatch[1]];
  }

  // Pattern 4: Lone digits at the end
  const endDigitMatch = clean.match(/\b(\d+)\b\s*$/);
  if (endDigitMatch) {
    return parseInt(endDigitMatch[1], 10);
  }

  return null;
}

export function scoreMatch(candidate: any, targetTitle: string, targetYear?: number, targetEpisodes?: number, targetStatus?: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
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
    const overlap = cw.filter((w: string) => tw.has(w)).length;
    score += Math.round((overlap / Math.max(tw.size, cw.length)) * 30);
  }

  // Add a prefix match bonus if the first few words match exactly.
  // This helps match shows that differ in season suffix (e.g. "Classroom of the Elite IV" and "Classroom of the Elite 4th Season")
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
    const diff = Math.abs(Number(candidate.year) - targetYear);
    if (diff === 0) score += 8;
    else if (diff === 1) score += 2;
    else if (diff <= 3) score -= 30; // 2 or 3 years difference gets a penalty
    else return -100; // 4+ years difference is rejected
  }

  // Season number mismatch check
  const candidateSeason = getSeasonNumber(candidate.title) || 1;
  const targetSeason = getSeasonNumber(targetTitle) || 1;
  if (candidateSeason !== targetSeason) {
    score -= 50; // Heavy penalty for mismatched seasons
  }

  // Episode mismatch check
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
        // No penalty if the show is currently airing and has fewer episodes on the provider
      } else {
        if (diff <= 1) {
          score -= 2;
        } else if (diff <= 3) {
          score -= 5;
        } else {
          score -= 40; // Heavy penalty for mismatch
        }
      }
    }
  }

  return score;
}
