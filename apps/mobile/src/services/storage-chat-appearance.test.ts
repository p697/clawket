import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';

jest.mock('../theme', () => ({
  defaultAccentId: 'iceBlue',
  isBuiltInAccentId: jest.fn(() => false),
}));

import { StorageService } from './storage';

const mockGetItemAsync = SecureStore.getItemAsync as jest.Mock;
const mockSetItemAsync = SecureStore.setItemAsync as jest.Mock;
const mockGetInfoAsync = FileSystem.getInfoAsync as jest.Mock;

describe('StorageService chat appearance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetInfoAsync.mockResolvedValue({ exists: true });
  });

  it('returns the default chat appearance when nothing has been saved', async () => {
    mockGetItemAsync.mockResolvedValueOnce(null);

    await expect(StorageService.getChatAppearance()).resolves.toEqual({
      version: 1,
      background: {
        enabled: false,
        imagePath: undefined,
        blur: 8,
        dim: 0,
        fillMode: 'cover',
      },
      bubbles: {
        style: 'solid',
        opacity: 1,
      },
    });
  });

  it('normalizes invalid saved chat appearance values', async () => {
    mockGetItemAsync.mockResolvedValueOnce(JSON.stringify({
      version: 1,
      background: {
        enabled: true,
        imagePath: '',
        blur: 999,
        dim: -2,
        fillMode: 'weird',
      },
      bubbles: {
        style: 'neon',
        opacity: 0.1,
      },
    }));

    await expect(StorageService.getChatAppearance()).resolves.toEqual({
      version: 1,
      background: {
        enabled: false,
        imagePath: undefined,
        blur: 24,
        dim: 0,
        fillMode: 'cover',
      },
      bubbles: {
        style: 'solid',
        opacity: 0.78,
      },
    });
  });

  it('saves normalized chat appearance settings', async () => {
    await StorageService.setChatAppearance({
      version: 1,
      background: {
        enabled: true,
        imagePath: 'file:///wallpaper.jpg',
        blur: 30,
        dim: 0.8,
        fillMode: 'cover',
      },
      bubbles: {
        style: 'glass',
        opacity: 0.7,
      },
    });

    expect(mockSetItemAsync).toHaveBeenCalledWith(
      'clawket.chatAppearance.v1',
      JSON.stringify({
        version: 1,
        background: {
          enabled: true,
          imagePath: 'wallpaper.jpg',
          blur: 24,
          dim: 0.6,
          fillMode: 'cover',
        },
        bubbles: {
          style: 'glass',
          opacity: 0.78,
        },
      }),
      expect.any(Object),
    );
  });

  it('migrates legacy contain mode to cover', async () => {
    mockGetItemAsync.mockResolvedValueOnce(JSON.stringify({
      version: 1,
      background: {
        enabled: true,
        imagePath: 'file:///documents/chat-appearance/wallpaper.jpg',
        blur: 8,
        dim: 0.28,
        fillMode: 'contain',
      },
      bubbles: {
        style: 'soft',
        opacity: 0.9,
      },
    }));

    await expect(StorageService.getChatAppearance()).resolves.toEqual({
      version: 1,
      background: {
        enabled: true,
        imagePath: 'file:///documents/chat-appearance/wallpaper.jpg',
        blur: 8,
        dim: 0.28,
        fillMode: 'cover',
      },
      bubbles: {
        style: 'soft',
        opacity: 0.9,
      },
    });

    expect(mockSetItemAsync).toHaveBeenCalledWith(
      'clawket.chatAppearance.v1',
      JSON.stringify({
        version: 1,
        background: {
          enabled: true,
          imagePath: 'wallpaper.jpg',
          blur: 8,
          dim: 0.28,
          fillMode: 'cover',
        },
        bubbles: {
          style: 'soft',
          opacity: 0.9,
        },
      }),
      expect.any(Object),
    );
  });

  it('disables the wallpaper when the persisted file is missing', async () => {
    mockGetInfoAsync.mockResolvedValueOnce({ exists: false });
    mockGetItemAsync.mockResolvedValueOnce(JSON.stringify({
      version: 1,
      background: {
        enabled: true,
        imagePath: 'wallpaper.jpg',
        blur: 8,
        dim: 0,
        fillMode: 'cover',
      },
      bubbles: {
        style: 'soft',
        opacity: 0.9,
      },
    }));

    await expect(StorageService.getChatAppearance()).resolves.toEqual({
      version: 1,
      background: {
        enabled: false,
        imagePath: undefined,
        blur: 8,
        dim: 0,
        fillMode: 'cover',
      },
      bubbles: {
        style: 'soft',
        opacity: 0.9,
      },
    });

    expect(mockSetItemAsync).toHaveBeenCalledWith(
      'clawket.chatAppearance.v1',
      JSON.stringify({
        version: 1,
        background: {
          enabled: false,
          imagePath: undefined,
          blur: 8,
          dim: 0,
          fillMode: 'cover',
        },
        bubbles: {
          style: 'soft',
          opacity: 0.9,
        },
      }),
      expect.any(Object),
    );
  });
});
