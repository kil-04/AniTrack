import { app } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ANICHAN, AniChanError, aniChanTitleUrl, type AniChanCategory, type AniChanTier } from "../../../../../packages/shared/anichan";
import { VerifiedPageSession } from "./verified-page-session";

export interface AniChanServerRequest {
  animeId: number; episode: number; category: AniChanCategory; tier: AniChanTier;
}
export type AniChanReader = (request: AniChanServerRequest) => Promise<unknown>;

/** The ordinary website establishes its own session in a source-only profile. */
export function aniChanPageReader(page: Pick<VerifiedPageSession, "readPage" | "requireVerification"> = new VerifiedPageSession({
  origin: ANICHAN.ORIGIN, partition: "persist:anichan", label: "AniChan", world: 1216,
  allowedResourceHosts: ["anichan.to", "challenges.cloudflare.com"],
})): AniChanReader {
  let script: string | undefined;
  let pageUrl: string | undefined;
  let connectionId: number | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;
  let cooldown = 0;
  const program = (request: unknown, waitForSession = false) => {
    script ??= readFileSync(join(app.getAppPath(), "apps/android/app/src/main/assets/anichan_page.js"), "utf8");
    return script + (waitForSession
      ? "\n(async()=>{const until=Date.now()+20000;let s;do{s=await AniTrackAniChan.read({operation:'state'});if(s.ready)return s;await new Promise(r=>setTimeout(r,500));}while(Date.now()<until);return s;})()"
      : "\nAniTrackAniChan.read(" + JSON.stringify(request) + ")");
  };
  const result = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(value).length > 600_000) {
      throw new AniChanError("AniChan returned an unreadable response.");
    }
    return value as Record<string, unknown>;
  };
  return request => {
    if (pending >= 16) return Promise.reject(new AniChanError("AniChan is busy. Retry in a moment."));
    pending++;
    const run = tail.then(async () => {
      if (Date.now() < cooldown) throw new AniChanError("AniChan asked to wait. Try again in a minute.");
      connectionId ??= request.animeId;
      pageUrl ??= aniChanTitleUrl(connectionId);
      // Poll local state only. Normal page scripts perform any invisible check;
      // a visible check is always left to the user. Website media is blocked.
      const state = result(await page.readPage(pageUrl, program({ operation: "state" }, true)));
      if (!state.ready) throw page.requireVerification();
      // Next.js replaces the /watch/ alias with the real slug. Keep that exact
      // document, including its hydrated protocol chunk and website session.
      const canonical = typeof state.pageUrl === "string" ? new URL(state.pageUrl) : null;
      if (!canonical || canonical.origin !== ANICHAN.ORIGIN || canonical.username || canonical.password || canonical.search || canonical.hash ||
        !new RegExp(`^/anime/${connectionId}/[a-z0-9-]{1,200}/1$`).test(canonical.pathname)) {
        throw new AniChanError("AniChan connection left its watch page. Reconnect.");
      }
      pageUrl = canonical.href;
      const response = result(await page.readPage(pageUrl, program({ operation: "servers", ...request })));
      if (response.status === "connect") throw page.requireVerification();
      if (response.status === "rate-limit") {
        cooldown = Date.now() + Math.min(300, Math.max(1, Number(response.retryAfter) || 60)) * 1000;
        throw new AniChanError("AniChan asked to wait. Try again shortly.");
      }
      if (response.status !== "ok" || !response.data) throw new AniChanError("AniChan's page response could not be read. Reconnect or choose another source.");
      return response.data;
    }).finally(() => { pending--; });
    tail = run.catch(() => {});
    return run;
  };
}
