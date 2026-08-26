import type {
  AnimeInfo,
  ExternalIds,
  ProviderDescriptor,
  ProviderFeed,
  ProviderFeedResult,
  StreamProvider,
} from "./types";

export interface ProviderRegistryOptions {
  /** Returns provider ids in preferred order. Unlisted providers follow registration order. */
  order?: () => readonly string[];
  /** Central enablement policy. Defaults to enabled for isolated contract tests. */
  isEnabled?: (provider: StreamProvider) => boolean;
}

const PROVIDER_ID = /^[a-z][a-z0-9-]{1,31}$/;

/** Provider-neutral boundary used by IPC, UI, playback and downloads. */
export class ProviderRegistry {
  private readonly providers = new Map<string, StreamProvider>();
  private readonly registrationOrder: string[] = [];
  private readonly options: ProviderRegistryOptions;

  constructor(
    providers: readonly StreamProvider[] = [],
    options: ProviderRegistryOptions = {},
  ) {
    this.options = options;
    for (const provider of providers) this.register(provider);
  }

  register(provider: StreamProvider): void {
    if (!PROVIDER_ID.test(provider.id)) throw new Error(`Invalid provider id: ${provider.id}`);
    if (!provider.name.trim()) throw new Error(`Provider ${provider.id} has no display name`);
    if (this.providers.has(provider.id)) throw new Error(`Provider already registered: ${provider.id}`);
    this.providers.set(provider.id, provider);
    this.registrationOrder.push(provider.id);
  }

  private enabled(provider: StreamProvider): boolean {
    return this.options.isEnabled?.(provider) ?? true;
  }

  private ordered(includeDisabled = false): StreamProvider[] {
    const configured = this.options.order?.() ?? [];
    const ids = [...configured, ...this.registrationOrder.filter((id) => !configured.includes(id))];
    return ids
      .map((id) => this.providers.get(id))
      .filter((provider): provider is StreamProvider => Boolean(provider))
      .filter((provider) => includeDisabled || this.enabled(provider));
  }

  descriptors(includeDisabled = false): ProviderDescriptor[] {
    return this.ordered(includeDisabled).map((provider) => ({
      id: provider.id,
      name: provider.name,
      capabilities: { ...provider.capabilities },
    }));
  }

  private registered(id: string): StreamProvider {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`Provider not found: ${id}`);
    return provider;
  }

  get(id: string): StreamProvider {
    const provider = this.registered(id);
    if (!this.enabled(provider)) {
      throw new Error(`${provider.name} is temporarily disabled by the automation configuration.`);
    }
    return provider;
  }

  async searchAll(query: string): Promise<AnimeInfo[]> {
    const active = this.ordered();
    const results = await Promise.all(active.map((provider) =>
      provider.search(query).catch((error) => {
        console.error(`[ProviderRegistry] Search failed for ${provider.id}:`, error);
        return [] as AnimeInfo[];
      }),
    ));
    const priority = new Map(active.map((provider, index) => [provider.id, index]));
    return results.flat().sort((a, b) =>
      (priority.get(a.providerId) ?? Number.MAX_SAFE_INTEGER) -
      (priority.get(b.providerId) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  getEpisodes(providerId: string, animeId: string, page = 1) {
    return this.get(providerId).getEpisodes(animeId, page);
  }

  getStreamLinks(providerId: string, episodeId: string, animeId: string) {
    return this.get(providerId).getStreamLinks(episodeId, animeId);
  }

  resolveStream(providerId: string, linkId: string) {
    return this.get(providerId).resolveStream(linkId);
  }

  getExternalIds(providerId: string, animeId: string, lookupId?: string | number): Promise<ExternalIds> {
    const provider = this.get(providerId);
    if (!provider.getExternalIds) throw new Error(`${provider.name} does not support external-id lookup`);
    return provider.getExternalIds(animeId, lookupId);
  }

  async findByExternalId(anilistId?: number, malId?: number): Promise<AnimeInfo | null> {
    for (const provider of this.ordered()) {
      if (!provider.findByExternalId) continue;
      try {
        const match = await provider.findByExternalId(anilistId, malId);
        if (match) return match;
      } catch (error) {
        console.warn(`[ProviderRegistry] External-id lookup failed for ${provider.id}:`, error);
      }
    }
    return null;
  }

  async getPreferredFeed(feed: ProviderFeed, page = 1, count = 30): Promise<ProviderFeedResult> {
    const capability = feed === "latest" ? "latest" : "top";
    const provider = this.ordered().find((item) => item.capabilities[capability] && item.getFeed);
    if (!provider?.getFeed) throw new Error(`No enabled provider supports the ${feed} feed`);
    return provider.getFeed(feed, page, count);
  }

  prefetch(providerId: string, linkId: string): void {
    const provider = this.get(providerId);
    try {
      const task = provider.prefetch
        ? provider.prefetch(linkId)
        : provider.resolveStream(linkId).then(() => undefined);
      void Promise.resolve(task).catch((error) => {
        console.warn(`[ProviderRegistry] Prefetch failed for ${provider.id}:`, error);
      });
    } catch (error) {
      console.warn(`[ProviderRegistry] Prefetch failed for ${provider.id}:`, error);
    }
  }

  prewarmAll(): void {
    for (const provider of this.ordered()) provider.prewarm?.();
  }

  notifyConfigChanged(): void {
    for (const provider of this.ordered(true)) provider.onConfigChanged?.();
  }

  getBaseUrl(providerId: string): string {
    const provider = this.registered(providerId);
    if (!provider.capabilities.configurableBaseUrl || !provider.getBaseUrl) {
      throw new Error(`${provider.name} does not expose a configurable URL`);
    }
    return provider.getBaseUrl();
  }

  setBaseUrl(providerId: string, url: string): void {
    const provider = this.registered(providerId);
    if (!provider.capabilities.configurableBaseUrl || !provider.setBaseUrl) {
      throw new Error(`${provider.name} does not expose a configurable URL`);
    }
    provider.setBaseUrl(url);
  }
}
