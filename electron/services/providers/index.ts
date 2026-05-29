import { StreamProvider, AnimeInfo, EpisodeInfo, StreamLink, StreamData } from "./types";
import { AnimePaheProvider } from "./animepahe";
import { AnikotoProvider } from "./anikoto";

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
    return p;
  }

  async searchAll(query: string): Promise<AnimeInfo[]> {
    const promises = Array.from(this.providers.values()).map(p => 
      p.search(query).catch(err => {
        console.error(`[ProviderManager] Search failed for ${p.id}:`, err);
        return [] as AnimeInfo[];
      })
    );
    
    const resultsArray = await Promise.all(promises);
    const flat = resultsArray.flat();

    // Prioritize AnimePahe first, so sort AnimePahe to the front
    const sorted = [...flat].sort((a, b) => {
      const aId = a.providerId ?? "animepahe";
      const bId = b.providerId ?? "animepahe";
      if (aId === "animepahe" && bId !== "animepahe") return -1;
      if (aId !== "animepahe" && bId === "animepahe") return 1;
      return 0;
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
