import AsyncStorage from '@react-native-async-storage/async-storage';
import { addRecentSearch, normalizeRecentSearches } from './model';

const RECENT_SEARCHES_KEY = 'clawket.search.recent.v1';

export interface RecentSearchStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export async function loadRecentSearches(
  storage: RecentSearchStorage = AsyncStorage,
): Promise<ReadonlyArray<string>> {
  try {
    const raw = await storage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return Object.freeze([]);
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return Object.freeze([]);
    return normalizeRecentSearches(
      parsed.filter((value): value is string => typeof value === 'string'),
    );
  } catch {
    return Object.freeze([]);
  }
}

export async function rememberRecentSearch(
  query: string,
  storage: RecentSearchStorage = AsyncStorage,
): Promise<ReadonlyArray<string>> {
  const current = await loadRecentSearches(storage);
  const next = addRecentSearch(current, query);
  await storage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  return next;
}
