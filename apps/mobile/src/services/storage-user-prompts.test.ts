import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../theme', () => ({
  defaultAccentId: 'iceBlue',
  isBuiltInAccentId: jest.fn(() => false),
}));

import { StorageService, type SavedPrompt } from './storage';

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;

const USER_PROMPTS_KEY = 'clawket.userPrompts.v1';

describe('StorageService user prompts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns normalized prompts and preserves pinned state', async () => {
    mockGetItem.mockResolvedValueOnce(JSON.stringify([
      {
        id: 'prompt-1',
        text: 'Pinned prompt',
        createdAt: 1,
        updatedAt: 3,
        pinnedAt: 2,
      },
      {
        id: 'prompt-2',
        text: 'Legacy prompt',
        createdAt: 4,
      },
    ]));

    await expect(StorageService.getUserPrompts()).resolves.toEqual([
      {
        id: 'prompt-1',
        text: 'Pinned prompt',
        createdAt: 1,
        updatedAt: 3,
        pinnedAt: 2,
      },
      {
        id: 'prompt-2',
        text: 'Legacy prompt',
        createdAt: 4,
        updatedAt: 4,
      },
    ]);
  });

  it('filters invalid prompt entries', async () => {
    mockGetItem.mockResolvedValueOnce(JSON.stringify([
      null,
      { id: 'prompt-1', text: 'Valid prompt', createdAt: 1 },
      { id: '', text: 'Missing id', createdAt: 2 },
      { id: 'prompt-2', createdAt: 3 },
      { id: 'prompt-3', text: 'Bad pin', createdAt: 4, pinnedAt: 'top' },
    ]));

    await expect(StorageService.getUserPrompts()).resolves.toEqual([
      {
        id: 'prompt-1',
        text: 'Valid prompt',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'prompt-3',
        text: 'Bad pin',
        createdAt: 4,
        updatedAt: 4,
      },
    ]);
  });

  it('writes prompts back to AsyncStorage', async () => {
    const prompts: SavedPrompt[] = [{
      id: 'prompt-1',
      text: 'Pinned prompt',
      createdAt: 1,
      updatedAt: 2,
      pinnedAt: 3,
    }];

    await StorageService.setUserPrompts(prompts);

    expect(mockSetItem).toHaveBeenCalledWith(USER_PROMPTS_KEY, JSON.stringify(prompts));
  });
});
