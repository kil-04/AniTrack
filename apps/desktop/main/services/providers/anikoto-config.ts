import { getRuntimeConfig } from "../remote-config";

let _activeAnikotoBase = "";

export function anikotoBases(): string[] {
  return getRuntimeConfig().providers.anikoto.baseUrls.map((base) => base.replace(/\/+$/, ""));
}

export function anikotoBaseUrl(): string {
  const config = getRuntimeConfig();
  if (!config.providers.anikoto.enabled || !config.features.anikotoStreaming) {
    throw new Error("Anikoto is temporarily disabled by the automation configuration.");
  }
  const bases = anikotoBases();
  if (!bases.includes(_activeAnikotoBase)) _activeAnikotoBase = bases[0];
  return _activeAnikotoBase;
}

export function anikotoRoute(name: string, values: Record<string, string | number> = {}): string {
  const template = getRuntimeConfig().providers.anikoto.routes[name];
  if (!template) throw new Error(`Missing signed Anikoto route: ${name}`);
  const route = template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_match, key: string) => {
    if (!(key in values)) throw new Error(`Missing Anikoto route value: ${key}`);
    return encodeURIComponent(String(values[key]));
  });
  if (route.includes("{")) throw new Error(`Unresolved Anikoto route: ${name}`);
  return route;
}

export function anikotoUrl(name: string, values: Record<string, string | number> = {}): string {
  return `${anikotoBaseUrl()}${anikotoRoute(name, values)}`;
}

export function anikotoSelector(name: string): string {
  const value = getRuntimeConfig().providers.anikoto.selectors[name];
  if (!value) throw new Error(`Missing signed Anikoto selector: ${name}`);
  return value;
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function htmlAttribute(tag: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${escapeRegex(name)}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(tag);
  return match?.[2] ?? null;
}

export function elementAttributeById(html: string, id: string, attribute: string): string | null {
  const tag = new RegExp(`<[^>]+\\sid\\s*=\\s*(["'])${escapeRegex(id)}\\1[^>]*>`, "i").exec(html)?.[0];
  return tag ? htmlAttribute(tag, attribute) : null;
}

export function extractRouteValue(value: string, routeName: string, key: string): string | null {
  const template = getRuntimeConfig().providers.anikoto.routes[routeName];
  const marker = `{${key}}`;
  const at = template?.indexOf(marker) ?? -1;
  if (!template || at < 0) return null;
  const pattern = new RegExp(`${escapeRegex(template.slice(0, at))}([^/?&#]+)${escapeRegex(template.slice(at + marker.length))}`);
  const match = pattern.exec(value);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

export function selectAnikotoBase(base: string): boolean {
  const clean = base.replace(/\/+$/, "");
  const changed = Boolean(_activeAnikotoBase && _activeAnikotoBase !== clean);
  _activeAnikotoBase = clean;
  return changed;
}
