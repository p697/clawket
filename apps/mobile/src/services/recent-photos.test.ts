const getPermissionsAsyncMock = jest.fn();
const requestPermissionsAsyncMock = jest.fn();
const getAssetsAsyncMock = jest.fn();
const getAssetInfoAsyncMock = jest.fn();

jest.mock('expo-media-library/legacy', () => ({
  MediaType: { photo: 'photo', video: 'video' },
  SortBy: { creationTime: 'creationTime' },
  getPermissionsAsync: (...args: unknown[]) => getPermissionsAsyncMock(...args),
  requestPermissionsAsync: (...args: unknown[]) => requestPermissionsAsyncMock(...args),
  getAssetsAsync: (...args: unknown[]) => getAssetsAsyncMock(...args),
  getAssetInfoAsync: (...args: unknown[]) => getAssetInfoAsyncMock(...args),
}));

import {
  RECENT_PHOTO_FIRST_BATCH,
  getRecentPhotoAccess,
  isRenderableLocalUri,
  loadRecentPhotos,
  normalizePhotoPermission,
  requestRecentPhotoAccess,
  resolveRecentPhotoSupport,
} from './recent-photos';

function asset(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    filename: `${id}.heic`,
    uri: `ph://${id}`,
    mediaType: 'photo',
    width: 3000,
    height: 4000,
    creationTime: 0,
    modificationTime: 0,
    duration: 0,
    ...overrides,
  };
}

describe('recent-photos', () => {
  beforeEach(() => {
    getPermissionsAsyncMock.mockReset();
    requestPermissionsAsyncMock.mockReset();
    getAssetsAsyncMock.mockReset();
    getAssetInfoAsyncMock.mockReset();
  });

  it('offers the strip on iOS only; Android keeps the system Photo Picker', () => {
    expect(resolveRecentPhotoSupport('ios')).toBe(true);
    expect(resolveRecentPhotoSupport('android')).toBe(false);
    expect(resolveRecentPhotoSupport('web')).toBe(false);
  });

  it('normalizes permission responses, treating limited access as granted', () => {
    expect(normalizePhotoPermission({ status: 'granted', granted: true, accessPrivileges: 'limited' })).toBe('granted');
    expect(normalizePhotoPermission({ status: 'granted', granted: true, accessPrivileges: 'all' })).toBe('granted');
    expect(normalizePhotoPermission({ status: 'granted', granted: true, accessPrivileges: 'none' })).toBe('denied');
    expect(normalizePhotoPermission({ status: 'denied', granted: false })).toBe('denied');
    expect(normalizePhotoPermission({ status: 'undetermined', granted: false })).toBe('undetermined');
  });

  it('reads and requests access without throwing when the module fails', async () => {
    getPermissionsAsyncMock.mockResolvedValueOnce({ status: 'undetermined', granted: false });
    await expect(getRecentPhotoAccess()).resolves.toBe('undetermined');
    getPermissionsAsyncMock.mockRejectedValueOnce(new Error('boom'));
    await expect(getRecentPhotoAccess()).resolves.toBe('unavailable');

    requestPermissionsAsyncMock.mockResolvedValueOnce({ status: 'granted', granted: true, accessPrivileges: 'all' });
    await expect(requestRecentPhotoAccess()).resolves.toBe('granted');
    requestPermissionsAsyncMock.mockRejectedValueOnce(new Error('boom'));
    await expect(requestRecentPhotoAccess()).resolves.toBe('unavailable');
  });

  it('only renders local file URIs', () => {
    expect(isRenderableLocalUri('file:///a.jpg')).toBe(true);
    expect(isRenderableLocalUri('content://media/1')).toBe(true);
    expect(isRenderableLocalUri('ph://abc')).toBe(false);
    expect(isRenderableLocalUri(undefined)).toBe(false);
  });

  it('resolves newest photos to local files, paints a first batch, and skips cloud-only assets', async () => {
    const assets = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => asset(id));
    getAssetsAsyncMock.mockResolvedValueOnce({ assets, endCursor: 'f', hasNextPage: false, totalCount: 6 });
    getAssetInfoAsyncMock.mockImplementation(async (input: { id: string }) => (
      input.id === 'c'
        ? { ...asset('c'), localUri: undefined }
        : { ...asset(input.id), localUri: `file:///photos/${input.id}.heic` }
    ));

    const onFirstBatch = jest.fn();
    const photos = await loadRecentPhotos({ limit: 12, onFirstBatch });

    expect(getAssetsAsyncMock).toHaveBeenCalledWith({
      first: 12,
      mediaType: 'photo',
      sortBy: [['creationTime', false]],
    });
    expect(getAssetInfoAsyncMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), { shouldDownloadFromNetwork: false });
    expect(onFirstBatch).toHaveBeenCalledTimes(1);
    expect(onFirstBatch.mock.calls[0][0].map((photo: { id: string }) => photo.id)).toEqual(
      ['a', 'b', 'd'].slice(0, RECENT_PHOTO_FIRST_BATCH),
    );
    expect(photos.map((photo) => photo.id)).toEqual(['a', 'b', 'd', 'e', 'f']);
    expect(photos[0]).toEqual({ id: 'a', uri: 'file:///photos/a.heic', width: 3000, height: 4000 });
  });

  it('keeps already-local URIs, drops non-photos, and stops when cancelled', async () => {
    getAssetsAsyncMock.mockResolvedValueOnce({
      assets: [asset('a', { uri: 'file:///local/a.jpg' }), asset('v', { mediaType: 'video' })],
      endCursor: 'v',
      hasNextPage: false,
      totalCount: 2,
    });
    const photos = await loadRecentPhotos({ limit: 12 });
    expect(getAssetInfoAsyncMock).not.toHaveBeenCalled();
    expect(photos).toEqual([{ id: 'a', uri: 'file:///local/a.jpg', width: 3000, height: 4000 }]);

    getAssetsAsyncMock.mockResolvedValueOnce({ assets: [asset('b')], endCursor: 'b', hasNextPage: false, totalCount: 1 });
    await expect(loadRecentPhotos({ limit: 12, isCancelled: () => true })).resolves.toEqual([]);
    expect(getAssetInfoAsyncMock).not.toHaveBeenCalled();
    await expect(loadRecentPhotos({ limit: 0 })).resolves.toEqual([]);
  });

  it('tolerates a failing asset lookup by skipping that photo', async () => {
    getAssetsAsyncMock.mockResolvedValueOnce({ assets: [asset('a'), asset('b')], endCursor: 'b', hasNextPage: false, totalCount: 2 });
    getAssetInfoAsyncMock
      .mockRejectedValueOnce(new Error('missing'))
      .mockResolvedValueOnce({ ...asset('b'), localUri: 'file:///photos/b.heic' });
    const photos = await loadRecentPhotos({ limit: 12 });
    expect(photos.map((photo) => photo.id)).toEqual(['b']);
  });
});
