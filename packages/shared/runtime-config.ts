export interface RuntimeProviderConfig {
  enabled: boolean;
  baseUrls: string[];
  streamHostFragments: string[];
  mediaExtensions: string[];
  routes: Record<string, string>;
  selectors: Record<string, string>;
}

export interface RuntimeFeatureFlags {
  anikotoStreaming: boolean;
  animepaheStreaming: boolean;
  downloads: boolean;
  malSync: boolean;
  gistSync: boolean;
}

export interface RuntimeConfig {
  schemaVersion: 1;
  revision: number;
  issuedAt: string;
  providerOrder: string[];
  providers: Record<string, RuntimeProviderConfig>;
  features: RuntimeFeatureFlags;
  notice: string | null;
}

export interface RuntimeConfigStatus {
  revision: number;
  source: "built-in" | "cache" | "remote";
  lastCheckedAt: number | null;
  lastUpdatedAt: number | null;
  error: string | null;
  config: RuntimeConfig;
}

export const BUILTIN_RUNTIME_CONFIG: RuntimeConfig = {
  schemaVersion: 1,
  revision: 0,
  issuedAt: "2026-08-17T00:00:00.000Z",
  providerOrder: ["anikoto", "animepahe"],
  providers: {
    anikoto: {
      enabled: true,
      baseUrls: ["https://anikototv.to", "https://anikoto.cz"],
      streamHostFragments: [
        "megap.", "megaplay", "vidtube", "mewcdn", "mewstream",
        "nekostream", "vibeplayer", "lostproject", "streamzone",
      ],
      mediaExtensions: [".m3u8", ".mp4", ".ts", ".m4s", ".vtt", ".key"],
      routes: {
        home: "/home",
        search: "/filter?keyword={query}&page={page}",
        watch: "/watch/{animeId}",
        episodeList: "/ajax/episode/list/{showId}",
        serverList: "/ajax/server/list?servers={servers}",
        serverResolve: "/ajax/server?get={linkId}",
        sources: "/stream/getSources?id={playerId}",
      },
      selectors: {
        searchItemClass: "item",
        searchTitleAttribute: "data-jp",
        totalClass: "total",
        subClass: "sub",
        dubClass: "dub",
        watchContainerId: "watch-main",
        showIdAttribute: "data-id",
        episodeIdAttribute: "data-id",
        episodeSlugAttribute: "data-slug",
        episodeNumberAttribute: "data-num",
        episodeServersAttribute: "data-ids",
        malIdAttribute: "data-mal",
        serverLinkAttribute: "data-link-id",
        playerContainerId: "megaplay-player",
        playerIdAttribute: "data-id",
      },
    },
    animepahe: {
      enabled: true,
      baseUrls: ["https://animepahe.pw"],
      streamHostFragments: ["owocdn.top", "owocdn.com", "uwucdn.top", "llnwi.net", "kwik.si", "kwik.cx"],
      mediaExtensions: [".m3u8", ".mp4", ".ts", ".m4s", ".vtt", ".key"],
      routes: {
        home: "/",
        search: "/api?m=search&q={query}",
        latest: "/api?m=airing&l={count}&sort=session_id_desc&page={page}",
        episodes: "/api?m=release&id={animeId}&sort=episode_asc&page={page}",
        anime: "/anime/{session}",
        play: "/play/{animeId}/{episodeId}",
      },
      selectors: {
        streamUrlAttribute: "data-src",
        resolutionAttribute: "data-resolution",
        audioAttribute: "data-audio",
      },
    },
  },
  features: {
    anikotoStreaming: true,
    animepaheStreaming: true,
    downloads: true,
    malSync: true,
    gistSync: true,
  },
  notice: null,
};
