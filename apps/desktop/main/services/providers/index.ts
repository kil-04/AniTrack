import type { RuntimeFeatureFlags, RuntimeProviderConfig } from "../../../../../packages/shared/runtime-config";
import { getRuntimeConfig } from "../remote-config";
import { AnimePaheProvider } from "./animepahe";
import { AnikotoProvider } from "./anikoto";
import { MiruroProvider } from "./miruro";
import { ProviderRegistry } from "./registry";
import { ShonenProvider } from "./shonen";
import { AniChanProvider } from "./anichan";
import type { StreamProvider } from "./types";

// Compatibility map for the v1 signed configuration. New providers only need
// their providers[id].enabled entry once the generic v2 schema is deployed.
const LEGACY_STREAM_FLAGS: Record<string, keyof RuntimeFeatureFlags> = {
  anikoto: "anikotoStreaming",
  animepahe: "animepaheStreaming",
};

function providerEnabled(provider: StreamProvider): boolean {
  const runtime = getRuntimeConfig();
  const rules = (runtime.providers as Record<string, RuntimeProviderConfig | undefined>)[provider.id];
  // Older signed configurations predate AniChan. An explicit kill switch wins.
  if (!(rules?.enabled ?? (provider.id === "anichan"))) return false;
  const legacyFlag = LEGACY_STREAM_FLAGS[provider.id];
  return !legacyFlag || runtime.features[legacyFlag];
}

export const providerManager = new ProviderRegistry(
  // MKissa was removed at the user's request (Oct 2026); its connector stays in mkissa.ts, unregistered.
  [new AnimePaheProvider(), new AnikotoProvider(), new MiruroProvider(), new ShonenProvider(), new AniChanProvider()],
  {
    order: () => getRuntimeConfig().providerOrder,
    isEnabled: providerEnabled,
  },
);

export { ProviderRegistry } from "./registry";
export type { ProviderRegistryOptions } from "./registry";
export type * from "./types";
