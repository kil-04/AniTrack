export const isElectron = typeof window !== "undefined" && !!(window as any).__ELECTRON__;
export const isCapacitor = typeof window !== "undefined" && !!(window as any).Capacitor;
export const isAndroid = isCapacitor && (window as any).Capacitor?.getPlatform?.() === "android";
export const isWeb = !isElectron && !isCapacitor;
