const _cap = typeof window !== "undefined" ? (window as any).Capacitor : undefined;

export const isElectron = typeof window !== "undefined" && !!(window as any).__ELECTRON__;
// Check the actual NATIVE platform, not just that the Capacitor global exists —
// importing @capacitor/core defines `window.Capacitor` on web/desktop too, so an
// existence check would wrongly report Capacitor on Electron.
export const isCapacitor = !!_cap?.isNativePlatform?.();
export const isAndroid = isCapacitor && _cap?.getPlatform?.() === "android";
export const isWeb = !isElectron && !isCapacitor;
