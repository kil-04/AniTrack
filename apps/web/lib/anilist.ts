import { alGql, mapMedia, MEDIA_FIELDS, rankByRelevance } from '../source/apps/desktop/renderer/lib/capacitor-anilist';
import {classicEraBoost,classicEraLabel} from '../source/packages/shared/recommendations';
import {planStory} from '../source/packages/shared/story-bridge';
import {gemPopularityFloor,timeMachineCandidate,timeMachineQuery,timeMachineVariables,type TimeMachineList,type TimeMachinePart} from '../source/packages/shared/time-machine';
export const webAniList = {
      async premieredOn(month: number, day: number) {
        const like = `%${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
        const data = await alGql<any>(`
          query($like: String) {
            Page(perPage: 24) {
              media(type: ANIME, isAdult: false, startDate_like: $like, sort: POPULARITY_DESC, popularity_greater: 2000) {
                ${MEDIA_FIELDS} startDate { year }
              }
            }
          }`, { like });
        return (data.Page?.media ?? [])
          .filter((m: any) => (m.startDate?.year ?? 0) > 1900)
          .map((m: any) => ({ anime: mapMedia(m), year: m.startDate.year as number }));
      },
      async timeMachineYear(year: number, part: TimeMachinePart) {
        const list = async (name: TimeMachineList, minPopularity = 0, priority: "high" | "low" = "high") =>
          (await alGql<any>(timeMachineQuery(MEDIA_FIELDS), timeMachineVariables(year, name, minPopularity), priority)).Page?.media ?? [];
        const candidate = (m: any, source: "sample" | "gems") =>
          timeMachineCandidate({ anime: mapMedia(m), year, startMonth: m.startDate?.month, relations: m.relations?.edges, source });
        if (part === "main") {
          const pages = await Promise.all([list("popular"), list("popular-2"), list("films")]);
          return pages.flat().map((m: any) => candidate(m, "sample"));
        }
        const top = Math.max(0, ...(await list("popular")).map((m: any) => m.popularity ?? 0));
        return (await list("gems", gemPopularityFloor(top), "low")).map((m: any) => candidate(m, "gems"));
      },
      async search(q: string) {
        const data = await alGql<any>(`
          query($q: String) {
            Page(perPage: 25) {
              media(search: $q, type: ANIME, sort: SEARCH_MATCH, isAdult: false) { ${MEDIA_FIELDS} }
            }
          }`, { q });
        return rankByRelevance(q, data.Page?.media ?? []).map((m: any) => mapMedia(m));
      },
      async advancedSearch(filters: any) {
        const page = filters.page || 1;
        const queryArgs = [];
        const mediaArgs = [];
        const variables: Record<string, any> = {};

        if (filters.query?.trim()) {
          queryArgs.push("$q: String");
          mediaArgs.push("search: $q");
          variables.q = filters.query.trim();
        }
        if (filters.genre && filters.genre.length > 0) {
          queryArgs.push("$genre: [String]");
          mediaArgs.push("genre_in: $genre");
          variables.genre = filters.genre;
        }
        if (filters.tag && filters.tag.length > 0) {
          queryArgs.push("$tag: [String]");
          mediaArgs.push("tag_in: $tag");
          mediaArgs.push("minimumTagRank: 50");
          variables.tag = filters.tag;
        }
        if (filters.season) {
          queryArgs.push("$season: MediaSeason");
          mediaArgs.push("season: $season");
          variables.season = filters.season;
        }
        if (filters.year) {
          queryArgs.push("$year: Int");
          mediaArgs.push("seasonYear: $year");
          variables.year = filters.year;
        }
        if (filters.startYear) {
          queryArgs.push("$started: String");
          mediaArgs.push("startDate_like: $started", "isAdult: false");
          variables.started = `${filters.startYear}%`;
        }
        if (filters.format) {
          queryArgs.push("$format: MediaFormat");
          mediaArgs.push("format: $format");
          variables.format = filters.format;
        }
        if (filters.status) {
          queryArgs.push("$status: MediaStatus");
          mediaArgs.push("status: $status");
          variables.status = filters.status;
        }
        if (filters.source) {
          queryArgs.push("$source: MediaSource");
          mediaArgs.push("source: $source");
          variables.source = filters.source;
        }
        if (filters.episodesGreater != null) {
          queryArgs.push("$epGt: Int");
          mediaArgs.push("episodes_greater: $epGt");
          variables.epGt = Math.max(0, filters.episodesGreater - 1);
        }
        if (filters.episodesLesser != null) {
          queryArgs.push("$epLt: Int");
          mediaArgs.push("episodes_lesser: $epLt");
          variables.epLt = filters.episodesLesser + 1;
        }

        const isRelevanceSearch = !!filters.query?.trim() && !filters.sort;
        queryArgs.push("$sort: [MediaSort]");
        mediaArgs.push("sort: $sort");
        variables.sort = filters.sort ? [filters.sort] : (filters.query?.trim() ? ["SEARCH_MATCH"] : ["TRENDING_DESC", "POPULARITY_DESC"]);

        queryArgs.push("$page: Int");
        const qArgsStr = queryArgs.length > 0 ? `(${queryArgs.join(", ")})` : "";
        const mArgsStr = mediaArgs.length > 0 ? `(${mediaArgs.join(", ")}, type: ANIME)` : "(type: ANIME)";

        const data = await alGql<any>(
          `query${qArgsStr} {
            Page(page: $page, perPage: 36) {
              pageInfo { hasNextPage lastPage total }
              media${mArgsStr} { ${MEDIA_FIELDS} }
            }
          }`,
          { ...variables, page }
        );

        const rawMedia = data.Page?.media ?? [];
        const media = isRelevanceSearch ? rankByRelevance(filters.query.trim(), rawMedia) : rawMedia;
        return {
          results: media.map((m: any) => mapMedia(m)),
          hasNextPage: data.Page?.pageInfo?.hasNextPage ?? false,
          lastPage: data.Page?.pageInfo?.lastPage ?? (data.Page?.pageInfo?.total ? Math.ceil(data.Page.pageInfo.total / 36) : undefined),
        };
      },
      async trending() {
        const data = await alGql<any>(`
          query {
            Page(perPage: 20) {
              media(type: ANIME, sort: TRENDING_DESC, status_in: [RELEASING, NOT_YET_RELEASED]) { ${MEDIA_FIELDS} }
            }
          }`, {}, "low");
        return (data.Page?.media ?? []).map((m: any) => mapMedia(m));
      },
      async get(id: number) {
        if (id <= 0 || id > 1_000_000_000) return null;
        try {
          const data = await alGql<any>(`
            query($id: Int) { Media(id: $id, type: ANIME) { ${MEDIA_FIELDS} } }`, { id });
          return data.Media ? mapMedia(data.Media) : null;
        } catch { return null; }
      },
      async airing(ids: number[]) {
        const unique = Array.from(new Set((ids ?? []).filter((n) => Number.isInteger(n) && n > 0)));
        if (unique.length === 0) return [];
        const out: any[] = [];
        for (let i = 0; i < unique.length; i += 50) {
          const chunk = unique.slice(i, i + 50);
          try {
            const data = await alGql<any>(`
              query($ids: [Int]) {
                Page(perPage: 50) {
                  media(id_in: $ids, type: ANIME) {
                    id title { romaji english } coverImage { large }
                    nextAiringEpisode { airingAt episode }
                  }
                }
              }`, { ids: chunk }, "low");
            for (const m of (data.Page?.media ?? [])) {
              if (!m.nextAiringEpisode) continue;
              out.push({
                animeId: m.id,
                title: m.title?.english || m.title?.romaji || "Untitled",
                coverImage: m.coverImage?.large ?? null,
                episode: m.nextAiringEpisode.episode,
                airingAt: m.nextAiringEpisode.airingAt,
              });
            }
          } catch { /* skip chunk on error */ }
        }
        return out;
      },
      async recent(page = 1) {
        const safePage = Number.isInteger(page) && page > 0 ? page : 1;
        const data = await alGql<any>(`
          query($to: Int, $page: Int) {
            Page(page: $page, perPage: 30) {
              pageInfo { hasNextPage }
              airingSchedules(airingAt_lesser: $to, sort: TIME_DESC) {
                airingAt episode
                media { ${MEDIA_FIELDS} isAdult }
              }
            }
          }`, { to: Math.floor(Date.now() / 1000), page: safePage }, "low");
        const seen = new Set<number>();
        return {
          data: (data.Page?.airingSchedules ?? []).flatMap((schedule: any) => {
            const media = schedule.media;
            if (!media || media.isAdult || seen.has(media.id)) return [];
            seen.add(media.id);
            return [{
              anime: mapMedia(media),
              episode: schedule.episode,
              airingAt: schedule.airingAt,
            }];
          }),
          page: safePage,
          hasNextPage: data.Page?.pageInfo?.hasNextPage ?? false,
        };
      },
      async airingBetween(from: number, to: number) {
        const out: import("../source/packages/shared/types").RecentEpisode[] = [];
        for (let page = 1; page <= 3; page++) {
          const data = await alGql<any>(`
            query($from: Int, $to: Int, $page: Int) {
              Page(page: $page, perPage: 50) {
                pageInfo { hasNextPage }
                airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) {
                  airingAt episode
                  media { ${MEDIA_FIELDS} isAdult }
                }
              }
            }`, { from, to, page }, "high");
          for (const schedule of data.Page?.airingSchedules ?? []) {
            if (!schedule.media || schedule.media.isAdult) continue;
            out.push({ anime: mapMedia(schedule.media), episode: schedule.episode, airingAt: schedule.airingAt });
          }
          if (!data.Page?.pageInfo?.hasNextPage) break;
        }
        return out;
      },
      async recommendations(seedIds: number[], excludedIds: number[]) {
        const seeds = Array.from(new Set((seedIds ?? []).filter((id) => Number.isInteger(id) && id > 0))).slice(0, 8);
        if (seeds.length === 0) return [];
        const excluded = new Set((excludedIds ?? []).filter((id) => Number.isInteger(id) && id > 0));
        seeds.forEach((id) => excluded.add(id));
        const data = await alGql<any>(`
          query($ids: [Int]) {
            Page(perPage: 8) {
              media(id_in: $ids, type: ANIME) {
                id title { romaji english }
                recommendations(sort: RATING_DESC, perPage: 12) {
                  nodes { rating mediaRecommendation { ${MEDIA_FIELDS} isAdult } }
                }
              }
            }
          }`, { ids: seeds }, "low");
        const ranked = new Map<number, any>();
        for (const seed of (data.Page?.media ?? [])) {
          const seedTitle = seed.title?.english || seed.title?.romaji || "a show in your list";
          for (const node of (seed.recommendations?.nodes ?? [])) {
            const media = node.mediaRecommendation;
            if (!media || media.isAdult || excluded.has(media.id) || node.rating <= 0) continue;
            const edgeScore = Math.log2(node.rating + 1);
            const existing = ranked.get(media.id);
            if (existing) {
              existing.score += edgeScore;
              existing.sources.add(seed.id);
              if (node.rating > existing.bestRating) {
                existing.bestRating = node.rating;
                existing.reason = `Because you liked ${seedTitle}`;
              }
            } else {
              ranked.set(media.id, {
                anime: mapMedia(media),
                score: edgeScore,
                bestRating: node.rating,
                reason: `Because you liked ${seedTitle}`,
                sources: new Set([seed.id]),
              });
            }
          }
        }
        return Array.from(ranked.values())
          .map((item) => {
            const graphReason = item.sources.size > 1
              ? `${item.reason} and ${item.sources.size - 1} more from your list`
              : item.reason;
            const classicLabel = classicEraLabel(item.anime.year);
            return {
              anime: item.anime,
              reason: classicLabel ? `${classicLabel} · ${graphReason}` : graphReason,
              score: item.score + (item.sources.size - 1) * 2 + classicEraBoost(item.anime.year),
            };
          })
          .sort((a, b) => b.score - a.score || (b.anime.averageScore ?? 0) - (a.anime.averageScore ?? 0))
          .slice(0, 20);
      },
      async relations(id: number) {
        if (id <= 0) return [];
        try {
          const data = await alGql<any>(`
            query($id: Int) {
              Media(id: $id) {
                relations { edges { relationType(version: 2) node { ${MEDIA_FIELDS} } } }
              }
            }`, { id }, "low");
          return (data.Media?.relations?.edges ?? []).map((edge: any) => ({
            relationType: edge.relationType,
            anime: mapMedia(edge.node),
          }));
        } catch { return []; }
      },
      async story(id: number) {
        if (id <= 0) return planStory(null, []);
        try {
          const data = await alGql<any>(`
            query($id: Int) {
              Media(id: $id, type: ANIME) {
                source
                relations { edges { relationType(version: 2) node {
                  id type format status chapters volumes popularity isAdult countryOfOrigin
                  title { romaji english native } coverImage { extraLarge large } startDate { year }
                } } }
              }
            }`, { id }, "low");
          const links = (data.Media?.relations?.edges ?? [])
            .filter((edge: any) => edge.node?.type === "MANGA" && !edge.node.isAdult)
            .map((edge: any) => ({
              relationType: edge.relationType,
              book: {
                id: edge.node.id,
                title: edge.node.title?.english || edge.node.title?.romaji || edge.node.title?.native || "Untitled",
                coverImage: edge.node.coverImage?.extraLarge || edge.node.coverImage?.large || null,
                format: edge.node.format ?? null,
                status: edge.node.status ?? null,
                chapters: edge.node.chapters ?? null,
                volumes: edge.node.volumes ?? null,
                year: edge.node.startDate?.year ?? null,
                popularity: edge.node.popularity ?? null,
                country: edge.node.countryOfOrigin ?? null,
              },
            }));
          return planStory(data.Media?.source ?? null, links);
        } catch { return planStory(null, []); }
      },
    };
