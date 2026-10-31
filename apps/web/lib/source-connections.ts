/** The server exposes source identifiers only; service addresses/keys stay private. */
const known = new Set(['animepahe','anikoto','shonen','anichan','mangadot','mangaball','xcomic','toonkotsu']);
let ready = new Set<string>();
export function setStandaloneSources(ids: unknown) {
  ready = new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && known.has(id)) : []);
}
export const standaloneSourceReady = (id: string) => ready.has(id);
export const standaloneSourceIds = () => [...ready];
