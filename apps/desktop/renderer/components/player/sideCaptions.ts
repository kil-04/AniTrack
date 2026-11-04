/** What dropping a side caption needs from its `<track>` element. */
export interface SideCaptionTrack {
  readonly parentNode: unknown;
  getAttribute(name: string): string | null;
  addEventListener(type: "error", listener: () => void): void;
  remove(): void;
}

/**
 * Takes a side-loaded caption out of the player when its file doesn't load. A provider can
 * list a caption that is missing on its host (Xanime's Cowboy Bebop dub answers HTTP 404 for
 * its English track on every host); the video keeps playing, the browser doesn't retry a
 * failed track, and the menu stops offering an empty one.
 *
 * Chromium also reports an error for a track added before it has a source (the player adds
 * the track while it fetches the captions), so an error with no `src` yet is ignored.
 */
export function dropCaptionOnError(track: SideCaptionTrack, video: unknown, onDropped: () => void): void {
  track.addEventListener("error", () => {
    if (!track.getAttribute("src") || track.parentNode !== video) return;
    track.remove();
    onDropped();
  });
}
