import { act, renderHook } from '@testing-library/react-native';

const getRecentPhotoAccessMock = jest.fn();
const requestRecentPhotoAccessMock = jest.fn();
const loadRecentPhotosMock = jest.fn();
const subscribeMock = jest.fn();
const unsubscribeMock = jest.fn();
let emitLibraryChange: () => void = () => undefined;
let mockLimitedLibrary = false;

jest.mock('../services/recent-photos', () => ({
  RECENT_PHOTO_STRIP_COUNT: 12,
  recentPhotosSupported: true,
  getRecentPhotoPermission: async () => ({
    access: await getRecentPhotoAccessMock(),
    limited: mockLimitedLibrary,
  }),
  requestRecentPhotoAccess: (...args: unknown[]) => requestRecentPhotoAccessMock(...args),
  loadRecentPhotos: (...args: unknown[]) => loadRecentPhotosMock(...args),
  subscribeToRecentPhotoChanges: (listener: () => void) => {
    subscribeMock(listener);
    emitLibraryChange = listener;
    return unsubscribeMock;
  },
}));

import {
  RECENT_PHOTOS_BACKGROUND_DELAY_MS,
  RECENT_PHOTOS_CACHED_REFRESH_DELAY_MS,
  RECENT_PHOTOS_FIRST_OPEN_DELAY_MS,
  resetRecentPhotosCacheForTests,
  useRecentPhotos,
} from './useRecentPhotos';

const photo = (id: string) => ({ id, uri: `file:///${id}.jpg`, width: 10, height: 10 });

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useRecentPhotos', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetRecentPhotosCacheForTests();
    getRecentPhotoAccessMock.mockReset();
    requestRecentPhotoAccessMock.mockReset();
    loadRecentPhotosMock.mockReset();
    subscribeMock.mockReset();
    unsubscribeMock.mockReset();
    emitLibraryChange = () => undefined;
    mockLimitedLibrary = false;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('waits for the sheet to rise, then paints the first batch before the full strip', async () => {
    getRecentPhotoAccessMock.mockResolvedValue('granted');
    loadRecentPhotosMock.mockImplementation(async ({ limit, onFirstBatch }: { limit: number; onFirstBatch: (photos: unknown[]) => void }) => {
      onFirstBatch([photo('a')]);
      return [photo('a'), photo('b')].slice(0, limit);
    });

    const { result } = renderHook(() => useRecentPhotos({ active: true }));
    expect(result.current).toMatchObject({ access: 'checking', photos: [], loading: true });

    act(() => { jest.advanceTimersByTime(RECENT_PHOTOS_FIRST_OPEN_DELAY_MS - 1); });
    expect(loadRecentPhotosMock).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(1); });
    await flush();

    expect(loadRecentPhotosMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 12 }));
    expect(result.current.access).toBe('granted');
    expect(result.current.loading).toBe(false);
    expect(result.current.photos.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('reports denied access without loading assets', async () => {
    getRecentPhotoAccessMock.mockResolvedValue('denied');
    const { result } = renderHook(() => useRecentPhotos({ active: true }));
    act(() => { jest.advanceTimersByTime(RECENT_PHOTOS_FIRST_OPEN_DELAY_MS); });
    await flush();
    expect(result.current).toMatchObject({ access: 'denied', photos: [], loading: false });
    expect(loadRecentPhotosMock).not.toHaveBeenCalled();
  });

  it('serves the cache on the next open and refreshes quietly', async () => {
    getRecentPhotoAccessMock.mockResolvedValue('granted');
    loadRecentPhotosMock.mockImplementation(async ({ limit }: { limit: number }) => (
      Array.from({ length: limit }, (_, index) => photo(`p${index}`))
    ));

    const first = renderHook(() => useRecentPhotos({ active: true }));
    act(() => { jest.advanceTimersByTime(RECENT_PHOTOS_FIRST_OPEN_DELAY_MS); });
    await flush();
    expect(first.result.current.photos).toHaveLength(12);
    first.unmount();

    loadRecentPhotosMock.mockClear();
    const second = renderHook(() => useRecentPhotos({ active: true }));
    expect(second.result.current).toMatchObject({ access: 'granted', loading: false });
    expect(second.result.current.photos).toHaveLength(12);
    expect(loadRecentPhotosMock).not.toHaveBeenCalled();

    act(() => { jest.advanceTimersByTime(RECENT_PHOTOS_CACHED_REFRESH_DELAY_MS); });
    await flush();
    expect(loadRecentPhotosMock).toHaveBeenCalledTimes(1);
    expect(loadRecentPhotosMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 12 }));
    expect(second.result.current.photos).toHaveLength(12);
  });

  it('keeps a load that lands after the sheet closes for the next open', async () => {
    let resolveLoad: (photos: unknown[]) => void = () => undefined;
    getRecentPhotoAccessMock.mockResolvedValue('granted');
    loadRecentPhotosMock.mockImplementation(() => new Promise((resolve) => {
      resolveLoad = resolve;
    }));

    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useRecentPhotos({ active }),
      { initialProps: { active: true } },
    );
    act(() => { jest.advanceTimersByTime(RECENT_PHOTOS_FIRST_OPEN_DELAY_MS); });
    await flush();
    expect(loadRecentPhotosMock).toHaveBeenCalledTimes(1);

    rerender({ active: false });
    await act(async () => {
      resolveLoad([photo('late')]);
      await Promise.resolve();
    });
    expect(result.current).toMatchObject({ access: 'granted', loading: false });
    expect(result.current.photos.map((item) => item.id)).toEqual(['late']);

    const reopened = renderHook(() => useRecentPhotos({ active: true }));
    expect(reopened.result.current.photos.map((item) => item.id)).toEqual(['late']);
  });

  it('reads access on mount and warms the strip before the first open', async () => {
    getRecentPhotoAccessMock.mockResolvedValue('granted');
    loadRecentPhotosMock.mockResolvedValue([photo('a'), photo('b')]);

    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useRecentPhotos({ active, prefetch: true }),
      { initialProps: { active: false } },
    );
    await flush();
    // Granted access is known right away, so the sheet can draw the strip layout.
    expect(result.current).toMatchObject({ access: 'granted', photos: [], loading: true });
    expect(loadRecentPhotosMock).not.toHaveBeenCalled();

    act(() => { jest.advanceTimersByTime(RECENT_PHOTOS_BACKGROUND_DELAY_MS); });
    await flush();
    expect(loadRecentPhotosMock).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
    const warmed = result.current.photos;
    expect(warmed.map((item) => item.id)).toEqual(['a', 'b']);

    // Opening paints the warmed list; the quiet refresh keeps an unchanged list's identity.
    rerender({ active: true });
    expect(result.current.photos).toBe(warmed);
    act(() => { jest.advanceTimersByTime(RECENT_PHOTOS_CACHED_REFRESH_DELAY_MS); });
    await flush();
    expect(loadRecentPhotosMock).toHaveBeenCalledTimes(2);
    expect(result.current.photos).toBe(warmed);
  });

  it('knows denied access before the open without reading assets or observing the library', async () => {
    getRecentPhotoAccessMock.mockResolvedValue('denied');
    const { result } = renderHook(() => useRecentPhotos({ active: false, prefetch: true }));
    await flush();
    expect(result.current).toMatchObject({ access: 'denied', photos: [], loading: false });
    act(() => { jest.advanceTimersByTime(RECENT_PHOTOS_BACKGROUND_DELAY_MS); });
    await flush();
    expect(loadRecentPhotosMock).not.toHaveBeenCalled();
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it('reads nothing while closed without a prefetching host', async () => {
    renderHook(() => useRecentPhotos({ active: false }));
    act(() => { jest.advanceTimersByTime(RECENT_PHOTOS_BACKGROUND_DELAY_MS); });
    await flush();
    expect(getRecentPhotoAccessMock).not.toHaveBeenCalled();
    expect(loadRecentPhotosMock).not.toHaveBeenCalled();
  });

  it('reloads once after a burst of library changes, before the next open', async () => {
    getRecentPhotoAccessMock.mockResolvedValue('granted');
    loadRecentPhotosMock.mockResolvedValueOnce([photo('a')]);
    const { result, unmount } = renderHook(() => useRecentPhotos({ active: false, prefetch: true }));
    await flush();
    act(() => { jest.advanceTimersByTime(RECENT_PHOTOS_BACKGROUND_DELAY_MS); });
    await flush();
    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(result.current.photos.map((item) => item.id)).toEqual(['a']);

    loadRecentPhotosMock.mockResolvedValueOnce([photo('shot'), photo('a')]);
    act(() => { emitLibraryChange(); });
    act(() => { jest.advanceTimersByTime(RECENT_PHOTOS_BACKGROUND_DELAY_MS / 2); });
    act(() => { emitLibraryChange(); });
    act(() => { jest.advanceTimersByTime(RECENT_PHOTOS_BACKGROUND_DELAY_MS - 1); });
    expect(loadRecentPhotosMock).toHaveBeenCalledTimes(1);
    act(() => { jest.advanceTimersByTime(1); });
    await flush();
    expect(loadRecentPhotosMock).toHaveBeenCalledTimes(2);
    expect(result.current.photos.map((item) => item.id)).toEqual(['shot', 'a']);

    unmount();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes right after the rise when the library changed while closed', async () => {
    getRecentPhotoAccessMock.mockResolvedValue('granted');
    loadRecentPhotosMock.mockResolvedValueOnce([photo('a')]);
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useRecentPhotos({ active, prefetch: true }),
      { initialProps: { active: false } },
    );
    await flush();
    act(() => { jest.advanceTimersByTime(RECENT_PHOTOS_BACKGROUND_DELAY_MS); });
    await flush();

    // The sheet opens inside the change's debounce window.
    loadRecentPhotosMock.mockResolvedValueOnce([photo('new'), photo('a')]);
    act(() => { emitLibraryChange(); });
    rerender({ active: true });
    act(() => { jest.advanceTimersByTime(RECENT_PHOTOS_FIRST_OPEN_DELAY_MS); });
    await flush();
    expect(loadRecentPhotosMock).toHaveBeenCalledTimes(2);
    expect(result.current.photos.map((item) => item.id)).toEqual(['new', 'a']);
  });

  it('leaves the first read of a limited library to a user-opened sheet', async () => {
    // iOS may raise its limited-selection alert on a launch's first library read.
    mockLimitedLibrary = true;
    getRecentPhotoAccessMock.mockResolvedValue('granted');
    loadRecentPhotosMock.mockResolvedValue([photo('a')]);
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useRecentPhotos({ active, prefetch: true }),
      { initialProps: { active: false } },
    );
    await flush();
    expect(result.current).toMatchObject({ access: 'granted', photos: [], loading: true });
    act(() => { jest.advanceTimersByTime(RECENT_PHOTOS_BACKGROUND_DELAY_MS); });
    await flush();
    expect(loadRecentPhotosMock).not.toHaveBeenCalled();
    expect(subscribeMock).not.toHaveBeenCalled();

    rerender({ active: true });
    act(() => { jest.advanceTimersByTime(RECENT_PHOTOS_FIRST_OPEN_DELAY_MS); });
    await flush();
    expect(loadRecentPhotosMock).toHaveBeenCalledTimes(1);
    expect(result.current.photos.map((item) => item.id)).toEqual(['a']);
    expect(subscribeMock).toHaveBeenCalledTimes(1);

    // After that read, closed-sheet refreshes are allowed again.
    rerender({ active: false });
    loadRecentPhotosMock.mockResolvedValueOnce([photo('b'), photo('a')]);
    act(() => { emitLibraryChange(); });
    act(() => { jest.advanceTimersByTime(RECENT_PHOTOS_BACKGROUND_DELAY_MS); });
    await flush();
    expect(loadRecentPhotosMock).toHaveBeenCalledTimes(2);
    expect(result.current.photos.map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('requests access inline and loads on grant', async () => {
    getRecentPhotoAccessMock.mockResolvedValue('undetermined');
    const { result } = renderHook(() => useRecentPhotos({ active: true }));
    act(() => { jest.advanceTimersByTime(RECENT_PHOTOS_FIRST_OPEN_DELAY_MS); });
    await flush();
    expect(result.current.access).toBe('undetermined');

    requestRecentPhotoAccessMock.mockResolvedValue('granted');
    getRecentPhotoAccessMock.mockResolvedValue('granted');
    loadRecentPhotosMock.mockResolvedValue([photo('a')]);
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.request();
    });
    expect(outcome).toBe('granted');
    expect(result.current.access).toBe('granted');
    expect(result.current.photos.map((item) => item.id)).toEqual(['a']);

    requestRecentPhotoAccessMock.mockResolvedValue('denied');
    await act(async () => {
      outcome = await result.current.request();
    });
    expect(outcome).toBe('denied');
    expect(result.current).toMatchObject({ access: 'denied', photos: [], loading: false });
  });
});
