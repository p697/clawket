import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../theme', () => ({
  defaultAccentId: 'iceBlue',
  isBuiltInAccentId: jest.fn(() => false),
}));

import { StorageService, type DashboardCacheEntry } from './storage';

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;

describe('StorageService dashboard cache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stores cache entries in a scoped key', async () => {
    const entry: DashboardCacheEntry<{ cost: string }> = {
      version: 2,
      cacheKey: 'url:gateway-a:agent:main',
      savedAt: 123,
      source: 'network',
      connectionStateAtSave: 'ready',
      data: { cost: '1.23' },
    };

    await StorageService.setDashboardCache(entry.cacheKey, entry);

    expect(mockSetItem).toHaveBeenCalledWith(
      'clawket.dashboard.cache.v2:url:gateway-a:agent:main',
      JSON.stringify(entry),
    );
  });

  it('loads a scoped cache entry', async () => {
    const entry: DashboardCacheEntry<{ cost: string }> = {
      version: 2,
      cacheKey: 'url:gateway-a:agent:main',
      savedAt: 456,
      source: 'network',
      connectionStateAtSave: 'ready',
      data: { cost: '2.34' },
    };
    mockGetItem.mockResolvedValueOnce(JSON.stringify(entry));

    await expect(StorageService.getDashboardCache<{ cost: string }>(entry.cacheKey)).resolves.toEqual(entry);
    expect(mockGetItem).toHaveBeenCalledWith('clawket.dashboard.cache.v2:url:gateway-a:agent:main');
  });

  it('falls back to the legacy unscoped cache key', async () => {
    mockGetItem
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(JSON.stringify({ cost: '3.45' }));

    await expect(StorageService.getDashboardCache<{ cost: string }>('url:gateway-b:agent:main')).resolves.toEqual({
      version: 2,
      cacheKey: 'url:gateway-b:agent:main',
      savedAt: 0,
      source: 'network',
      connectionStateAtSave: 'unknown',
      data: { cost: '3.45' },
    });
  });
});
