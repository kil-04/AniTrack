import type {
  AnimeInfo,
  EpisodeInfo,
  ProviderApi,
  ProviderDescriptor,
  ProviderEpisodePage,
  ProviderFeed,
  ProviderFeedResult,
  StreamData,
  StreamLink,
} from "../../shared/provider-types";

type CompatibleEpisode = EpisodeInfo & {
  /** Temporary alias returned by the legacy Capacitor connector bridge. */
  episode?: number;
  session?: string;
};

type CompatibleEpisodePage = Omit<ProviderEpisodePage, "data"> & {
  data: CompatibleEpisode[];
};

const LEGACY_PROVIDER_DESCRIPTORS: ProviderDescriptor[] = [
  { id: "anikoto", name: "Anikoto", capabilities: {} },
  { id: "animepahe", name: "AnimePahe", capabilities: { configurableBaseUrl: true } },
];

function providerApi(): ProviderApi | undefined {
  return window.api.providers;
}

/**
 * The Electron preload exposes the provider-neutral bridge. The legacy bridge
 * remains as a fallback for the Capacitor renderer while it is migrated.
 */
export const providerClient = {
  async list(): Promise<ProviderDescriptor[]> {
    const api = providerApi();
    if (!api) return LEGACY_PROVIDER_DESCRIPTORS;
    try {
      return await api.list();
    } catch {
      return LEGACY_PROVIDER_DESCRIPTORS;
    }
  },

  search(query: string): Promise<AnimeInfo[]> {
    return providerApi()?.search(query) ?? window.api.pahe.search(query);
  },

  episodes(providerId: string, animeId: string, page: number): Promise<CompatibleEpisodePage> {
    const request = providerApi()?.episodes(providerId, animeId, page)
      ?? window.api.pahe.episodes(providerId, animeId, page);
    return request as Promise<CompatibleEpisodePage>;
  },

  links(providerId: string, episodeId: string, animeId: string): Promise<StreamLink[]> {
    return providerApi()?.links(providerId, episodeId, animeId)
      ?? window.api.pahe.links(providerId, episodeId, animeId);
  },

  resolve(providerId: string, linkId: string): Promise<StreamData> {
    return providerApi()?.resolve(providerId, linkId)
      ?? window.api.pahe.resolve(providerId, linkId);
  },

  prefetch(providerId: string, linkId: string): Promise<{ ok: boolean }> {
    return providerApi()?.prefetch(providerId, linkId)
      ?? window.api.pahe.prefetch(providerId, linkId);
  },

  async feed(feed: ProviderFeed, page = 1, count = 30): Promise<ProviderFeedResult> {
    const api = providerApi();
    if (api) return api.feed(feed, page, count);
    if (feed !== "top") throw new Error(`The legacy bridge does not support the ${feed} feed`);
    const result = await window.api.pahe.anikotoTop();
    return {
      providerId: "anikoto",
      feed,
      page,
      total: [...result.day, ...result.week, ...result.month].length,
      lastPage: 1,
      groups: (["day", "week", "month"] as const).map((id) => ({
        id,
        title: id === "day" ? "Day" : id === "week" ? "Week" : "Month",
        items: result[id].slice(0, count).map((item: any) => ({
          id: item.showId || item.slug,
          providerId: "anikoto",
          animeId: item.slug,
          title: item.title,
          titleAlternatives: item.titleJp ? [item.titleJp] : undefined,
          poster: item.poster,
          subCount: item.sub ?? undefined,
          dubCount: item.dub ?? undefined,
        })),
      })),
    };
  },

  findByExternalId(anilistId?: number, malId?: number): Promise<AnimeInfo | null> {
    return providerApi()?.findByExternalId(anilistId, malId)
      ?? window.api.pahe.findById(anilistId, malId);
  },
};

export function streamVariant(link: StreamLink): string | undefined {
  if (link.variant) return link.variant;
  const label = `${link.quality} ${link.audio}`.toLowerCase();
  if (label.includes("soft")) return "soft";
  if (label.includes("hard")) return "hard";
  if (label.includes("dub") || label.includes("eng")) return "dub";
  // Compatibility with older Anikoto link payloads during a rolling update.
  try {
    const parsed = JSON.parse(link.id) as { subType?: string };
    return parsed.subType;
  } catch {
    return undefined;
  }
}

export function preferredStreamLinkIndex(
  links: StreamLink[],
  descriptor?: ProviderDescriptor,
  preferredVariant = "soft",
): number {
  if (links.length === 0) return -1;
  if (descriptor?.capabilities.streamVariants === "subtitle-type") {
    const index = links.findIndex((link) => streamVariant(link) === preferredVariant);
    return index >= 0 ? index : 0;
  }
  if (descriptor?.capabilities.streamVariants === "quality") {
    let bestIndex = 0;
    let bestScore = -1;
    links.forEach((link, index) => {
      const quality = Number.parseInt(link.quality.replace(/[^0-9]/g, ""), 10) || 0;
      const originalAudio = !link.audio.toLowerCase().includes("eng");
      const score = quality * 10 + (originalAudio ? 1 : 0);
      if (score > bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    });
    return bestIndex;
  }
  return 0;
}

export function providerVariantPreference(providerId: string): string {
  const key = `anitrack-provider-${providerId}-variant`;
  const legacy = providerId === "anikoto" ? localStorage.getItem("anitrack-anikoto-subtype") : null;
  return localStorage.getItem(key) || legacy || "soft";
}

export function saveProviderVariantPreference(providerId: string, variant: string): void {
  localStorage.setItem(`anitrack-provider-${providerId}-variant`, variant);
}

export function providerName(
  descriptors: ProviderDescriptor[],
  providerId: string,
): string {
  return descriptors.find((provider) => provider.id === providerId)?.name ?? providerId;
}

export function orderProviderIds(
  providerIds: string[],
  descriptors: ProviderDescriptor[],
): string[] {
  const positions = new Map(descriptors.map((provider, index) => [provider.id, index]));
  return [...providerIds].sort((a, b) => {
    const aIndex = positions.get(a) ?? Number.MAX_SAFE_INTEGER;
    const bIndex = positions.get(b) ?? Number.MAX_SAFE_INTEGER;
    return aIndex - bIndex || a.localeCompare(b);
  });
}
