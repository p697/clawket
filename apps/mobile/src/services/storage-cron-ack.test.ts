import AsyncStorage from '@react-native-async-storage/async-storage';

// Mock theme module to avoid TSX parsing issues
jest.mock('../theme', () => ({
  defaultAccentId: 'iceBlue',
  isBuiltInAccentId: jest.fn(() => false),
}));

import { StorageService } from './storage';

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;
const mockRemoveItem = AsyncStorage.removeItem as jest.Mock;

const ACKED_KEY = 'clawket.cron.acked-failures';

describe('StorageService cron failure acknowledgment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAckedCronFailures', () => {
    it('returns empty set when nothing stored', async () => {
      mockGetItem.mockResolvedValueOnce(null);
      const result = await StorageService.getAckedCronFailures();
      expect(result).toEqual(new Set());
      expect(mockGetItem).toHaveBeenCalledWith(ACKED_KEY);
    });

    it('returns set of stored IDs', async () => {
      mockGetItem.mockResolvedValueOnce(JSON.stringify(['job-1', 'job-2']));
      const result = await StorageService.getAckedCronFailures();
      expect(result).toEqual(new Set(['job-1', 'job-2']));
    });

    it('filters out non-string values', async () => {
      mockGetItem.mockResolvedValueOnce(JSON.stringify(['job-1', 42, null, 'job-2']));
      const result = await StorageService.getAckedCronFailures();
      expect(result).toEqual(new Set(['job-1', 'job-2']));
    });

    it('returns empty set for invalid JSON', async () => {
      mockGetItem.mockResolvedValueOnce('not-json');
      const result = await StorageService.getAckedCronFailures();
      expect(result).toEqual(new Set());
    });

    it('returns empty set for non-array JSON', async () => {
      mockGetItem.mockResolvedValueOnce(JSON.stringify({ id: 'job-1' }));
      const result = await StorageService.getAckedCronFailures();
      expect(result).toEqual(new Set());
    });

    it('returns empty set when AsyncStorage throws', async () => {
      mockGetItem.mockRejectedValueOnce(new Error('storage error'));
      const result = await StorageService.getAckedCronFailures();
      expect(result).toEqual(new Set());
    });
  });

  describe('ackCronFailures', () => {
    it('stores current failed IDs', async () => {
      await StorageService.ackCronFailures(['job-1', 'job-3']);
      expect(mockSetItem).toHaveBeenCalledWith(ACKED_KEY, expect.any(String));
      const stored = JSON.parse(mockSetItem.mock.calls[0][1]);
      expect(stored.sort()).toEqual(['job-1', 'job-3'].sort());
    });

    it('removes storage key when no failures', async () => {
      await StorageService.ackCronFailures([]);
      expect(mockRemoveItem).toHaveBeenCalledWith(ACKED_KEY);
      expect(mockSetItem).not.toHaveBeenCalled();
    });

    it('deduplicates IDs', async () => {
      await StorageService.ackCronFailures(['job-1', 'job-1', 'job-2']);
      const stored = JSON.parse(mockSetItem.mock.calls[0][1]);
      expect(stored.length).toBe(2);
      expect(new Set(stored)).toEqual(new Set(['job-1', 'job-2']));
    });
  });
});
