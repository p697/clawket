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

describe('StorageService composer draft', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('generates correct storage key from agentId and sessionKey', () => {
    const key = StorageService._draftKey('agent-123', 'agent:abc:main');
    expect(key).toBe('clawket.draft.agent-123-agent:abc:main');
  });

  it('saves draft text via AsyncStorage', async () => {
    await StorageService.setComposerDraft('a1', 's1', 'hello world');
    expect(mockSetItem).toHaveBeenCalledWith('clawket.draft.a1-s1', 'hello world');
  });

  it('removes draft when text is empty', async () => {
    await StorageService.setComposerDraft('a1', 's1', '');
    expect(mockRemoveItem).toHaveBeenCalledWith('clawket.draft.a1-s1');
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it('loads saved draft text', async () => {
    mockGetItem.mockResolvedValueOnce('saved draft');
    const result = await StorageService.getComposerDraft('a1', 's1');
    expect(result).toBe('saved draft');
    expect(mockGetItem).toHaveBeenCalledWith('clawket.draft.a1-s1');
  });

  it('returns null when no draft exists', async () => {
    mockGetItem.mockResolvedValueOnce(null);
    const result = await StorageService.getComposerDraft('a1', 's1');
    expect(result).toBeNull();
  });

  it('uses different keys for different sessions of the same agent', () => {
    const key1 = StorageService._draftKey('agent-1', 'session-a');
    const key2 = StorageService._draftKey('agent-1', 'session-b');
    expect(key1).not.toBe(key2);
  });

  it('uses different keys for different agents on the same session', () => {
    const key1 = StorageService._draftKey('agent-1', 'session-a');
    const key2 = StorageService._draftKey('agent-2', 'session-a');
    expect(key1).not.toBe(key2);
  });
});
