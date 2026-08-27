import { SimpleStore } from "../store";
import { getRuntimeConfig } from "../remote-config";

interface PaheSettings {
  baseUrl?: string;
}

const store = new SimpleStore<PaheSettings>("anitrack-pahe-settings");
let activeConfiguredBase = "";

export function animePaheEnabled(): boolean {
  const runtime = getRuntimeConfig();
  return runtime.providers.animepahe.enabled && runtime.features.animepaheStreaming;
}

export function assertAnimePaheEnabled(): void {
  if (!animePaheEnabled()) {
    throw new Error("AnimePahe is temporarily disabled by the automation configuration.");
  }
}

export function getPaheBaseUrl(): string {
  const manual = store.get("baseUrl");
  if (manual) return manual;
  const bases = getRuntimeConfig().providers.animepahe.baseUrls.map((base) => base.replace(/\/+$/, ""));
  if (!bases.includes(activeConfiguredBase)) activeConfiguredBase = bases[0];
  return activeConfiguredBase;
}

export function getManualPaheBaseUrl(): string | undefined {
  return store.get("baseUrl");
}

export function selectConfiguredPaheBase(value: string): boolean {
  if (getManualPaheBaseUrl()) return false;
  const clean = value.replace(/\/+$/, "");
  const changed = Boolean(activeConfiguredBase) && activeConfiguredBase !== clean;
  activeConfiguredBase = clean;
  return changed;
}

export function normalizePaheBaseUrl(value: string): string {
  let clean = value.trim().replace(/\/$/, "");
  if (!/^https:\/\//i.test(clean)) clean = `https://${clean.replace(/^https?:\/\//i, "")}`;
  let parsed: URL;
  try {
    parsed = new URL(clean);
  } catch {
    throw new Error(`Invalid URL: ${value}`);
  }
  const host = parsed.hostname.toLowerCase();
  const second172 = /^172\.(\d+)\./.exec(host)?.[1];
  const private172 = second172 != null && Number(second172) >= 16 && Number(second172) <= 31;
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || parsed.pathname !== "/"
    || host === "localhost"
    || host === "::1"
    || host.endsWith(".local")
    || /^127\./.test(host)
    || /^10\./.test(host)
    || /^192\.168\./.test(host)
    || private172
  ) {
    throw new Error("AnimePahe URL must be a public HTTPS origin without a path, query, or credentials.");
  }
  return parsed.origin;
}

export function savePaheBaseUrl(value: string): string {
  const clean = normalizePaheBaseUrl(value);
  store.set("baseUrl", clean);
  return clean;
}

export function paheBaseUrl(): string {
  return getPaheBaseUrl();
}

export function paheRoute(name: string, values: Record<string, string | number> = {}): string {
  const template = getRuntimeConfig().providers.animepahe.routes[name];
  if (!template) throw new Error(`Missing signed AnimePahe route: ${name}`);
  const route = template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_match, key: string) => {
    if (!(key in values)) throw new Error(`Missing AnimePahe route value: ${key}`);
    return encodeURIComponent(String(values[key]));
  });
  if (route.includes("{")) throw new Error(`Unresolved AnimePahe route: ${name}`);
  return route;
}
