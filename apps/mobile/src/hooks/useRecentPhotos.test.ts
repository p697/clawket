import { act, renderHook } from '@testing-library/react-native';

const getRecentPhotoAccessMock = jest.fn();
const requestRecentPhotoAccessMock = jest.fn();
const loadRecentPhotosMock = jest.fn();

jest.mock('../services/recent-photos', () => ({
  RECENT_PHOTO_STRIP_COUNT: 12,
  recentPhotosSupported: true,
  getRecentPhotoAccess: (...args: unknown[]) => getRecentPhotoAccessMock(...args),
  requestRecentPhotoAccess: (...args: unknown[]) => requestRecentPhotoAccessMock(...args),
  loadRecentPhotos: (...args: unknown[]) => loadRecentPhotosMock(...args),
}));

import {
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

  it('cancels a pending load when the sheet closes and ignores late results', async () => {
    let resolveLoad: (photos: unknown[]) => void = () => undefined;
    getRecentPhotoAccessMock.mockResolvedValue('granted');
    loadRecentPhotosMock.mockImplementation(({ isCancelled }: { isCancelled: () => boolean }) => new Promise((resolve) => {
      resolveLoad = (photos) => resolve(isCancelled() ? [] : photos);
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
    expect(result.current.photos).toEqual([]);
    expect(result.current.access).toBe('checking');
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
