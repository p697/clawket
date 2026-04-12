import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../theme', () => ({
  defaultAccentId: 'iceBlue',
  isAccentScale: jest.fn(() => false),
}));

import { StorageService } from './storage';

describe('StorageService skill list sort mode', () => {
  const mockGetItem = AsyncStorage.getItem as jest.Mock;
  const mockSetItem = AsyncStorage.setItem as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('defaults Hermes to creation-time descending when nothing is stored', async () => {
    mockGetItem.mockResolvedValueOnce(null);

    await expect(StorageService.getSkillListSortMode('hermes')).resolves.toBe('createdDesc');
  });

  it('keeps OpenClaw default sorting by name when nothing is stored', async () => {
    mockGetItem.mockResolvedValueOnce(null);

    await expect(StorageService.getSkillListSortMode('openclaw')).resolves.toBe('name');
  });

  it('reads a stored backend-specific sort mode', async () => {
    mockGetItem.mockResolvedValueOnce('updatedDesc');

    await expect(StorageService.getSkillListSortMode('hermes')).resolves.toBe('updatedDesc');
    expect(mockGetItem).toHaveBeenCalledWith('clawket.skillListSortMode.v1.hermes');
  });

  it('persists a backend-specific sort mode', async () => {
    await StorageService.setSkillListSortMode('hermes', 'createdDesc');

    expect(mockSetItem).toHaveBeenCalledWith('clawket.skillListSortMode.v1.hermes', 'createdDesc');
  });

  it('maps legacy stored sort modes to the new time-based variants', async () => {
    mockGetItem.mockResolvedValueOnce('created');
    await expect(StorageService.getSkillListSortMode('hermes')).resolves.toBe('createdAsc');

    mockGetItem.mockResolvedValueOnce('updated');
    await expect(StorageService.getSkillListSortMode('hermes')).resolves.toBe('updatedDesc');
  });
});
