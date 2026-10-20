const ENDPOINT = "https://graphql.anilist.co";

interface AniListResponse {
  status: number;
  retryAfter: string | null;
  errorText?: string;
  json?: { data?: unknown; errors?: unknown };
}

/** The deadline includes the body: a stalled response must release the serial queue. */
export async function fetchAniListResponse(
  query: string,
  variables: Record<string, unknown>,
  { fetcher = fetch, timeoutMs = 15_000 }: { fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<AniListResponse> {
  const controller = new AbortController();
  let response: Response | undefined;
  const discardBody = () => { void response?.body?.cancel().catch(() => {}); };
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error("AniList request timed out. Please try again."));
      controller.abort();
      discardBody();
    }, timeoutMs);
  });
  const request = (async (): Promise<AniListResponse> => {
    response = await fetcher(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    if (controller.signal.aborted) {
      discardBody();
      throw new Error("AniList request timed out. Please try again.");
    }
    const result = { status: response.status, retryAfter: response.headers.get("retry-after") };
    if (response.status === 429) {
      discardBody();
      return result;
    }
    if (!response.ok) return { ...result, errorText: await response.text() };
    return { ...result, json: await response.json() as AniListResponse["json"] };
  })();
  try {
    // Race as well as abort: a broken transport that ignores abort cannot hold the queue.
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer!);
  }
}
