import type {NovelHome} from '../source/packages/shared/novel';

/** Older saved feeds and the raw NovelBuddy home response omit some shelves. */
export function normalizeNovelHome(value: Partial<NovelHome> | null | undefined): NovelHome {
  return {
    trending: Array.isArray(value?.trending) ? value.trending : [],
    popular: Array.isArray(value?.popular) ? value.popular : [],
    latest: Array.isArray(value?.latest) ? value.latest : [],
    completed: Array.isArray(value?.completed) ? value.completed : [],
    favourites: Array.isArray(value?.favourites) ? value.favourites : [],
    ...(value?.notice ? {notice: value.notice} : {}),
  };
}
