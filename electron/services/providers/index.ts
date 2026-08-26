import type { RuntimeFeatureFlags, RuntimeProviderConfig } from "../../../shared/runtime-config";
import { getRuntimeConfig } from "../remote-config";
import { AnimePaheProvider } from "./animepahe";
import { AnikotoProvider } from "./anikoto";
import { ProviderRegistry } from "./registry";
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
  if (!rules?.enabled) return false;
  const legacyFlag = LEGACY_STREAM_FLAGS[provider.id];
  return !legacyFlag || runtime.features[legacyFlag];
}

export const providerManager = new ProviderRegistry(
  [new AnimePaheProvider(), new AnikotoProvider()],
  {
    order: () => getRuntimeConfig().providerOrder,
    isEnabled: providerEnabled,
  },
);

export { ProviderRegistry } from "./registry";
export type { ProviderRegistryOptions } from "./registry";
export type * from "./types";
