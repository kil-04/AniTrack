export interface SkipTimes {
  op?: { start: number; end: number };
  ed?: { start: number; end: number };
}

interface SkipTimesResult {
  skipTimes: SkipTimes;
  malId?: number;
}

export async function fetchAnimeSkipTimes(
  anilistId: number,
  episode: number,
  cachedMalId?: number | null,
): Promise<SkipTimesResult> {
  if (anilistId <= 0) return { skipTimes: {} };

  let malId = cachedMalId ?? undefined;
  if (!malId) {
    const query = `query($id:Int){Media(id:$id){idMal}}`;
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { id: anilistId } }),
    });
    const payload = await response.json();
    malId = payload?.data?.Media?.idMal;
  }
  if (!malId) return { skipTimes: {} };

  const response = await fetch(
    `https://api.aniskip.com/v2/skip-times/${malId}/${episode}?types[]=op&types[]=ed&episodeLength=0`,
  );
  if (!response.ok) return { skipTimes: {}, malId };

  const payload = await response.json();
  const skipTimes: SkipTimes = {};
  if (payload.found && Array.isArray(payload.results)) {
    for (const result of payload.results) {
      if (result.skipType === "op") {
        skipTimes.op = { start: result.interval.startTime, end: result.interval.endTime };
      } else if (result.skipType === "ed") {
        skipTimes.ed = { start: result.interval.startTime, end: result.interval.endTime };
      }
    }
  }
  return { skipTimes, malId };
}
