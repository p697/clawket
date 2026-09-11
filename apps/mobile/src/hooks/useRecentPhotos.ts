import { useCallback, useEffect, useRef, useState } from 'react';
import { Motion } from '../theme/tokens';
import {
  RECENT_PHOTO_STRIP_COUNT,
  getRecentPhotoAccess,
  loadRecentPhotos,
  recentPhotosSupported,
  requestRecentPhotoAccess,
  type RecentPhoto,
  type RecentPhotoAccess,
} from '../services/recent-photos';

export type RecentPhotosAccessState = RecentPhotoAccess | 'checking';

export type RecentPhotosState = Readonly<{
  access: RecentPhotosAccessState;
  photos: readonly RecentPhoto[];
  /** True until the first strip batch has resolved for the current open. */
  loading: boolean;
}>;

type Cache = Readonly<{
  access: RecentPhotoAccess;
  photos: readonly RecentPhoto[];
  limit: number;
}>;

/** Survives sheet remounts so the second open paints photos immediately. */
let cache: Cache | null = null;

/** Test-only reset for the module cache. */
export function resetRecentPhotosCacheForTests(): void {
  cache = null;
}

/** The sheet rise animation runs first; media resolution starts once it settles. */
export const RECENT_PHOTOS_FIRST_OPEN_DELAY_MS = Motion.duration.slow;
/** A cached strip refreshes quietly after the sheet is already showing it. */
export const RECENT_PHOTOS_CACHED_REFRESH_DELAY_MS = Motion.duration.slow * 3;

function initialState(): RecentPhotosState {
  if (cache) return { access: cache.access, photos: cache.photos, loading: false };
  return {
    access: recentPhotosSupported ? 'checking' : 'unavailable',
    photos: [],
    loading: recentPhotosSupported,
  };
}

/** Recent photo library access for the Add sheet; `active` follows sheet visibility. */
export function useRecentPhotos({
  active,
}: Readonly<{ active: boolean }>): RecentPhotosState & {
  request: () => Promise<RecentPhotoAccess>;
} {
  const [state, setState] = useState<RecentPhotosState>(initialState);
  const requestIdRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshedThisOpenRef = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cancelInFlight = useCallback(() => {
    requestIdRef.current += 1;
  }, []);

  const commit = useCallback((next: Cache) => {
    cache = next;
    setState({ access: next.access, photos: next.photos, loading: false });
  }, []);

  const load = useCallback(async (limit: number) => {
    const requestId = ++requestIdRef.current;
    const isCancelled = () => requestId !== requestIdRef.current;
    const access = await getRecentPhotoAccess();
    if (isCancelled()) return;
    if (access !== 'granted') {
      commit({ access, photos: [], limit: 0 });
      return;
    }
    try {
      const photos = await loadRecentPhotos({
        limit,
        isCancelled,
        onFirstBatch: (firstBatch) => {
          // Paint the first tiles without waiting for the whole page. A cached
          // list stays until the full refresh commits.
          setState((current) => (
            current.photos.length >= firstBatch.length
              ? current
              : { access: 'granted', photos: firstBatch, loading: false }
          ));
        },
      });
      if (isCancelled()) return;
      commit({ access: 'granted', photos, limit });
    } catch {
      if (isCancelled()) return;
      commit({ access: 'granted', photos: cache?.photos ?? [], limit: cache?.limit ?? 0 });
    }
  }, [commit]);

  useEffect(() => {
    if (!recentPhotosSupported) return undefined;
    if (!active) {
      clearTimer();
      cancelInFlight();
      refreshedThisOpenRef.current = false;
      return undefined;
    }
    const cached = cache;
    clearTimer();
    if (cached && refreshedThisOpenRef.current) return undefined;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (!activeRef.current) return;
      refreshedThisOpenRef.current = true;
      void load(RECENT_PHOTO_STRIP_COUNT);
    }, cached ? RECENT_PHOTOS_CACHED_REFRESH_DELAY_MS : RECENT_PHOTOS_FIRST_OPEN_DELAY_MS);
    return clearTimer;
  }, [active, cancelInFlight, clearTimer, load]);

  useEffect(() => () => {
    clearTimer();
    cancelInFlight();
  }, [cancelInFlight, clearTimer]);

  const request = useCallback(async () => {
    if (!recentPhotosSupported) return 'unavailable' as const;
    clearTimer();
    cancelInFlight();
    setState((current) => ({ ...current, access: 'checking', loading: true }));
    const access = await requestRecentPhotoAccess();
    if (access !== 'granted') {
      commit({ access, photos: [], limit: 0 });
      return access;
    }
    refreshedThisOpenRef.current = true;
    await load(RECENT_PHOTO_STRIP_COUNT);
    return access;
  }, [cancelInFlight, clearTimer, commit, load]);

  return { ...state, request };
}
