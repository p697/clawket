import * as SecureStore from 'expo-secure-store';

jest.mock('../theme', () => ({
  defaultAccentId: 'iceBlue',
  isBuiltInAccentId: jest.fn(() => false),
}));

import { StorageService } from './storage';

const mockGetItemAsync = SecureStore.getItemAsync as jest.Mock;

describe('StorageService chat font size', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 16 when no chat font size has been saved', async () => {
    mockGetItemAsync.mockResolvedValueOnce(null);

    await expect(StorageService.getChatFontSize()).resolves.toBe(16);
  });

  it('returns 16 when the stored chat font size is invalid', async () => {
    mockGetItemAsync.mockResolvedValueOnce('abc');

    await expect(StorageService.getChatFontSize()).resolves.toBe(16);
  });
});
