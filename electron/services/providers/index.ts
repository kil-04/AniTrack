import { StreamProvider, AnimeInfo, EpisodeInfo, StreamLink, StreamData } from "./types";
import { AnimePaheProvider } from "./animepahe";
import { AnikotoProvider } from "./anikoto";
import { getRuntimeConfig } from "../remote-config";

export class ProviderManager {
  private providers: Map<string, StreamProvider> = new Map();

  constructor() {
    this.registerProvider(new AnimePaheProvider());
    this.registerProvider(new AnikotoProvider());
  }

  registerProvider(provider: StreamProvider) {
    this.providers.set(provider.id, provider);
  }

  getProvider(id: string): StreamProvider {
    const p = this.providers.get(id);
    if (!p) throw new Error(`Provider not found: ${id}`);
    const runtime = getRuntimeConfig();
    const enabled = id === "anikoto"
      ? runtime.providers.anikoto.enabled && runtime.features.anikotoStreaming
      : runtime.providers.animepahe.enabled && runtime.features.animepaheStreaming;
    if (!enabled) throw new Error(`${p.name} is temporarily disabled by the automation configuration.`);
    return p;
  }

  async searchAll(query: string): Promise<AnimeInfo[]> {
    const runtime = getRuntimeConfig();
    const activeProviders = runtime.providerOrder
      .map((id) => this.providers.get(id))
      .filter((provider): provider is StreamProvider => Boolean(provider))
      .filter((provider) => provider.id === "anikoto"
        ? runtime.providers.anikoto.enabled && runtime.features.anikotoStreaming
        : runtime.providers.animepahe.enabled && runtime.features.animepaheStreaming);
    const promises = activeProviders.map(p =>
      p.search(query).catch(err => {
        console.error(`[ProviderManager] Search failed for ${p.id}:`, err);
        return [] as AnimeInfo[];
      })
    );
    
    const resultsArray = await Promise.all(promises);
    const flat = resultsArray.flat();

    const priority = new Map(runtime.providerOrder.map((id, index) => [id, index]));
    const sorted = [...flat].sort((a, b) => {
      const aId = a.providerId ?? "animepahe";
      const bId = b.providerId ?? "animepahe";
      return (priority.get(aId as "anikoto" | "animepahe") ?? 99) -
        (priority.get(bId as "anikoto" | "animepahe") ?? 99);
    });

    return sorted;
  }

  async getEpisodes(providerId: string, animeId: string, page = 1) {
    return this.getProvider(providerId).getEpisodes(animeId, page);
  }

  async getStreamLinks(providerId: string, episodeId: string, animeId: string) {
    return this.getProvider(providerId).getStreamLinks(episodeId, animeId);
  }

  async resolveStream(providerId: string, linkId: string) {
    return this.getProvider(providerId).resolveStream(linkId);
  }
}

export const providerManager = new ProviderManager();
