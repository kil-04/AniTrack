import { isCapacitor } from "./platform";

// Android WebView does NOT support the HTML video Picture-in-Picture Web API, and its
// <video> surface can't be composited into a PiP window. So on Capacitor we hand the
// resolved HLS stream to the native AniTrackSettings plugin, which plays it in a native
// ExoPlayer overlay and enters Android PiP. Desktop (Electron) uses the standard video
// PiP API instead. Referer is needed for CDN hotlink checks; position resumes playback.
export async function enterNativePip(opts: {
  url: string;
  referer?: string | null;
  position?: number;
}): Promise<boolean> {
  if (!isCapacitor || !opts.url) return false;
  try {
    const { registerPlugin } = await import("@capacitor/core");
    const AniTrackSettings = registerPlugin<{
      enterPip(o: { url: string; referer?: string; position?: number }): Promise<{ ok: boolean }>;
    }>("AniTrackSettings");
    const res = await AniTrackSettings.enterPip({
      url: opts.url,
      referer: opts.referer ?? undefined,
      position: opts.position ?? 0,
    });
    return !!res?.ok;
  } catch {
    return false;
  }
}
