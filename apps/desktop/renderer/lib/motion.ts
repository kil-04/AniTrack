import { startTransition, useEffect, useState } from "react";

/*
 * Motion helpers shared by every page. The rule they follow (and index.css's
 * animations with them): only opacity and transform move, so the compositor runs
 * them and a busy main thread never drops their frames; Pixel mode moves in steps
 * instead of easing; and nothing moves when the system asks for reduced motion.
 */

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
const pixelSkin = () => document.documentElement.dataset.skin === "pixel";

/**
 * The whole window fading in on its new look, right after a change that repaints all of
 * it: Anime / Manga / Novels, or Pixel mode on and off. The change itself is immediate;
 * this only softens its arrival. (A view transition cross-fades more truly, but it has to
 * photograph the window first, which took 0.5 to 0.9 s here before anything moved.)
 */
export function fadeInWindow(): void {
  if (reducedMotion() || typeof document.body.animate !== "function") return;
  // A veil in the background colour that lifts off the window. Fading the window itself would
  // redraw everything under it on every frame (blurred glass, Pixel mode's filtered art); a
  // veil on top is one flat layer the compositor fades on its own.
  const veil = document.createElement("div");
  veil.setAttribute("aria-hidden", "true");
  veil.style.cssText = "position:fixed;inset:0;z-index:2147483000;pointer-events:none;background:rgb(var(--bg));";
  document.body.appendChild(veil);
  const fade = veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 280, easing: pixelSkin() ? "steps(5, end)" : "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" });
  const done = () => veil.remove();
  fade.onfinish = done;
  fade.oncancel = done;
}

// ── Images fade in ────────────────────────────────────────────────────────────

const SEEN_MAX = 6000;
const seen = new Set<string>();

/**
 * Every image fades in the first time it arrives, instead of popping into its
 * frame (in steps in Pixel mode). One it has shown before is simply there, so
 * going back to a page doesn't flicker. Opt out with `data-fade="off"`.
 */
export function installImageFade(): void {
  document.addEventListener("load", (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || img.dataset.fade === "off") return;
    const src = img.currentSrc || img.src;
    if (!src || src.startsWith("data:") || seen.has(src)) return;
    if (seen.size >= SEEN_MAX) seen.clear();
    seen.add(src);
    if (reducedMotion() || typeof img.animate !== "function") return;
    // From nothing to whatever opacity the image has (a dimmed backdrop stays dimmed).
    img.animate([{ opacity: 0 }, {}], { duration: 320, easing: pixelSkin() ? "steps(4, end)" : "cubic-bezier(0.22, 1, 0.36, 1)" });
  }, true);
}

// ── Work after the first paint ────────────────────────────────────────────────

/**
 * False for a page's first frame, then true: what's below the fold mounts after the
 * top of the page is on screen (and as a transition, so it never blocks a click).
 */
export function useAfterPaint(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => startTransition(() => setReady(true)));
    return () => cancelAnimationFrame(id);
  }, []);
  return ready;
}
