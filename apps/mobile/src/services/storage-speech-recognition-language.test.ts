import * as SecureStore from 'expo-secure-store';

jest.mock('../theme', () => ({
  defaultAccentId: 'iceBlue',
  isBuiltInAccentId: jest.fn(() => false),
}));

import { StorageService } from './storage';

const mockGetItemAsync = SecureStore.getItemAsync as jest.Mock;

describe('StorageService speech recognition language', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('defaults to system when no speech recognition language has been saved', async () => {
    mockGetItemAsync.mockResolvedValueOnce(null);

    await expect(StorageService.getSpeechRecognitionLanguage()).resolves.toBe('system');
  });

  it('falls back to system when the stored speech recognition language is invalid', async () => {
    mockGetItemAsync.mockResolvedValueOnce('fr');

    await expect(StorageService.getSpeechRecognitionLanguage()).resolves.toBe('system');
  });
});
