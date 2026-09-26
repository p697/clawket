import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { Motion } from '../theme/tokens';
import {
  RECENT_PHOTO_STRIP_COUNT,
  getRecentPhotoPermission,
  loadRecentPhotos,
  recentPhotosSupported,
  requestRecentPhotoAccess,
  subscribeToRecentPhotoChanges,
  type RecentPhoto,
  type RecentPhotoAccess,
} from '../services/recent-photos';

export type RecentPhotosAccessState = RecentPhotoAccess | 'checking';

export type RecentPhotosState = Readonly<{
  access: RecentPhotosAccessState;
  photos: readonly RecentPhoto[];
  /** True while access is unknown, or granted without a resolved photo list. */
  loading: boolean;
}>;

/** The sheet rise animation runs first; media resolution starts once it settles. */
export const RECENT_PHOTOS_FIRST_OPEN_DELAY_MS = Motion.duration.slow;
/** A cached strip refreshes quietly after the sheet is already showing it. */
export const RECENT_PHOTOS_CACHED_REFRESH_DELAY_MS = Motion.duration.slow * 3;
/**
 * Loads while the sheet is closed wait out the host screen's own mount work and
 * coalesce a burst of library changes (a screenshot series, iCloud sync).
 */
export const RECENT_PHOTOS_BACKGROUND_DELAY_MS = 1_000;

// One process-wide store: every Add sheet paints the freshest snapshot on its
// first frame, and a load started by one host warms every other.
let snapshot: RecentPhotosState = emptySnapshot();
/** A photo list, or a non-granted access, has been committed. */
let filled = false;
/** Bumped by library changes; a load that started before the latest change is stale. */
let changeGeneration = 0;
let stale = false;
let requestId = 0;
let loadInFlight = false;
let accessReadInFlight = false;
/** Null until the first permission read. */
let limitedLibrary: boolean | null = null;
/** PhotoKit has been read in this launch. */
let libraryRead = false;
const listeners = new Set<() => void>();

function emptySnapshot(): RecentPhotosState {
  return {
    access: recentPhotosSupported ? 'checking' : 'unavailable',
    photos: [],
    loading: recentPhotosSupported,
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): RecentPhotosState {
  return snapshot;
}

function publish(next: RecentPhotosState): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function samePhotos(a: readonly RecentPhoto[], b: readonly RecentPhoto[]): boolean {
  return a.length === b.length && a.every((photo, index) => (
    photo.id === b[index].id && photo.uri === b[index].uri
  ));
}

function commit(access: RecentPhotoAccess, photos: readonly RecentPhoto[], generation: number): void {
  filled = true;
  stale = generation !== changeGeneration;
  // An unchanged refresh keeps the rendered list identity: no re-render, no reflow.
  const nextPhotos = samePhotos(snapshot.photos, photos) ? snapshot.photos : photos;
  if (snapshot.access === access && snapshot.photos === nextPhotos && !snapshot.loading) return;
  publish({ access, photos: nextPhotos, loading: false });
}

/**
 * iOS raises its limited-library selection alert on a launch's first library
 * read, so with limited access only a user-opened sheet may make that read;
 * full access warms in the background.
 */
function backgroundReadAllowed(): boolean {
  return limitedLibrary === false || libraryRead;
}

function cancelLoad(): void {
  requestId += 1;
  loadInFlight = false;
}

/** Permission reads never prompt; knowing access before an open decides the first frame's layout. */
function readAccess(): void {
  if (filled || snapshot.access !== 'checking' || accessReadInFlight || loadInFlight) return;
  accessReadInFlight = true;
  const startedAt = requestId;
  void getRecentPhotoPermission().then(({ access, limited }) => {
    accessReadInFlight = false;
    limitedLibrary = limited;
    // A load or permission request that started meanwhile owns the result.
    if (startedAt !== requestId || filled || snapshot.access !== 'checking') return;
    if (access === 'granted') {
      publish({ access, photos: [], loading: true });
    } else {
      commit(access, [], changeGeneration);
    }
  });
}

async function loadStrip(): Promise<void> {
  const id = ++requestId;
  const generation = changeGeneration;
  const isCancelled = () => id !== requestId;
  loadInFlight = true;
  try {
    const { access, limited } = await getRecentPhotoPermission();
    if (isCancelled()) return;
    limitedLibrary = limited;
    if (access !== 'granted') {
      commit(access, [], generation);
      return;
    }
    libraryRead = true;
    const photos = await loadRecentPhotos({
      limit: RECENT_PHOTO_STRIP_COUNT,
      isCancelled,
      onFirstBatch: (firstBatch) => {
        // Paint the first tiles without waiting for the whole page. A shown
        // list stays until the full refresh commits.
        if (isCancelled() || snapshot.photos.length >= firstBatch.length) return;
        publish({ access: 'granted', photos: firstBatch, loading: false });
      },
    });
    if (isCancelled()) return;
    commit('granted', photos, generation);
  } catch {
    if (isCancelled()) return;
    commit('granted', snapshot.photos, generation);
  } finally {
    if (id === requestId) loadInFlight = false;
  }
}

/** Test-only reset for the process-wide store. */
export function resetRecentPhotosCacheForTests(): void {
  cancelLoad();
  snapshot = emptySnapshot();
  filled = false;
  changeGeneration = 0;
  stale = false;
  accessReadInFlight = false;
  limitedLibrary = null;
  libraryRead = false;
}

/**
 * Recent photo library access for the Add sheet. `active` follows sheet
 * visibility; `prefetch` lets a mounted host warm the strip while the sheet is
 * closed, so an open paints its final layout on the first frame.
 */
export function useRecentPhotos({
  active,
  prefetch = false,
}: Readonly<{ active: boolean; prefetch?: boolean }>): RecentPhotosState & {
  request: () => Promise<RecentPhotoAccess>;
} {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshedThisOpenRef = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const warm = recentPhotosSupported && (active || prefetch);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleLoad = useCallback((delay: number) => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (activeRef.current) refreshedThisOpenRef.current = true;
      else if (!backgroundReadAllowed()) return;
      void loadStrip();
    }, delay);
  }, [clearTimer]);

  useEffect(() => {
    if (warm) readAccess();
  }, [warm]);

  useEffect(() => {
    if (!recentPhotosSupported) return undefined;
    if (active) {
      if (filled && !stale) {
        // Painted from the store; one quiet refresh per open, after the rise.
        if (!refreshedThisOpenRef.current) scheduleLoad(RECENT_PHOTOS_CACHED_REFRESH_DELAY_MS);
      } else if (!loadInFlight) {
        scheduleLoad(RECENT_PHOTOS_FIRST_OPEN_DELAY_MS);
      }
      return clearTimer;
    }
    refreshedThisOpenRef.current = false;
    if (prefetch && (!filled || stale) && !loadInFlight) {
      scheduleLoad(RECENT_PHOTOS_BACKGROUND_DELAY_MS);
      return clearTimer;
    }
    return undefined;
  }, [active, clearTimer, prefetch, scheduleLoad]);

  // New captures and screenshots reach the store before the next open, so the
  // strip does not shift under the user a moment after the sheet rises. Starting
  // the observer reads the library, so it waits for a resolved list.
  const observing = warm && state.access === 'granted' && !state.loading;
  useEffect(() => {
    if (!observing) return undefined;
    return subscribeToRecentPhotoChanges(() => {
      changeGeneration += 1;
      stale = true;
      scheduleLoad(activeRef.current ? RECENT_PHOTOS_FIRST_OPEN_DELAY_MS : RECENT_PHOTOS_BACKGROUND_DELAY_MS);
    });
  }, [observing, scheduleLoad]);

  useEffect(() => clearTimer, [clearTimer]);

  const request = useCallback(async (): Promise<RecentPhotoAccess> => {
    if (!recentPhotosSupported) return 'unavailable';
    clearTimer();
    cancelLoad();
    publish({ ...snapshot, access: 'checking', loading: true });
    const access = await requestRecentPhotoAccess();
    if (access !== 'granted') {
      commit(access, [], changeGeneration);
      return access;
    }
    refreshedThisOpenRef.current = true;
    await loadStrip();
    return access;
  }, [clearTimer]);

  return { ...state, request };
}
