import { useSyncExternalStore } from "react";

/**
 * The app's look, per device: the midnight default, or Pixel mode (retrowave pixel art across the
 * app, index.css `[data-skin="pixel"]`) in neon pink or a retrowave AniTrack blue. Set on <html>
 * before the first render (main.tsx).
 */
export type Skin = "default" | "pixel";
export type PixelPalette = "neon" | "blue";

const KEY = "anitrack.skin";
const PALETTE_KEY = "anitrack.skin.palette";
const MOTION_KEY = "anitrack.skin.motion";
const listeners = new Set<() => void>();

export function readSkin(): Skin {
  try { return localStorage.getItem(KEY) === "pixel" ? "pixel" : "default"; } catch { return "default"; }
}

export function readPalette(): PixelPalette {
  try { return localStorage.getItem(PALETTE_KEY) === "blue" ? "blue" : "neon"; } catch { return "neon"; }
}

/** Pixel mode's animated background (components/PixelAmbient.tsx): on unless turned off. */
export function readMotion(): boolean {
  try { return localStorage.getItem(MOTION_KEY) !== "off"; } catch { return true; }
}

let current: Skin = readSkin();
let palette: PixelPalette = readPalette();
let motion = readMotion();

export function applySkin(skin: Skin = current) {
  document.documentElement.dataset.skin = skin;
  document.documentElement.dataset.palette = palette;
  document.documentElement.dataset.motion = motion ? "on" : "off";
}

function save(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable: this session only */ }
}

export function setSkin(skin: Skin) {
  current = skin;
  save(KEY, skin);
  applySkin(skin);
  listeners.forEach((listener) => listener());
}

export function setPalette(next: PixelPalette) {
  palette = next;
  save(PALETTE_KEY, next);
  applySkin();
  listeners.forEach((listener) => listener());
}

export function setMotion(on: boolean) {
  motion = on;
  save(MOTION_KEY, on ? "on" : "off");
  applySkin();
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useSkin(): Skin {
  return useSyncExternalStore(subscribe, () => current);
}

export function usePalette(): PixelPalette {
  return useSyncExternalStore(subscribe, () => palette);
}

export function useMotion(): boolean {
  return useSyncExternalStore(subscribe, () => motion);
}
