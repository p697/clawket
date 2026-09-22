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

test('connection-scoped drafts cannot collide with another connection or legacy keys', async () => {
  const first = StorageService._draftKey('a-b', 'c', 'one');
  expect(first).not.toBe(StorageService._draftKey('a', 'b-c', 'one'));
  expect(first).not.toBe(StorageService._draftKey('a-b', 'c', 'two'));
  expect(first).not.toBe(StorageService._draftKey('a-b', 'c'));
  await StorageService.setComposerDraft('a-b', 'c', 'private', 'one');
  expect(mockSetItem).toHaveBeenCalledWith(first, 'private');
});

test('connection removal deletes only its scoped drafts and preserves unowned legacy data', async () => {
  const own = StorageService._draftKey('main', 'main', 'one');
  const other = StorageService._draftKey('main', 'main', 'one.extra');
  const legacy = StorageService._draftKey('main', 'main');
  jest.mocked(AsyncStorage.getAllKeys).mockResolvedValueOnce([own, other, legacy, 'unrelated']);
  await StorageService.clearConnectionComposerDrafts('one');
  expect(AsyncStorage.multiRemove).toHaveBeenCalledWith([own]);
});

test('a submitted draft cannot reappear when an older write completes late', async () => {
  let finishWrite!: () => void;
  let stored: string | null = null;
  mockSetItem.mockImplementationOnce(() => new Promise<void>(resolve => {
    finishWrite = () => { stored = 'old text'; resolve(); };
  }));
  mockRemoveItem.mockImplementationOnce(async () => { stored = null; });
  const writing = StorageService.setComposerDraft('main', 'main', 'old text', 'one');
  await Promise.resolve();
  const clearing = StorageService.setComposerDraft('main', 'main', '', 'one');
  await Promise.resolve();
  finishWrite();
  await Promise.all([writing, clearing]);
  expect(stored).toBeNull();
});

test('legacy consumption cannot delete a newer edit while its comparison is pending', async () => {
  let finishRead!: () => void;
  let stored: string | null = 'legacy';
  mockGetItem.mockImplementationOnce(() => new Promise<string>(resolve => {
    finishRead = () => resolve('legacy');
  }));
  mockRemoveItem.mockImplementationOnce(async () => { stored = null; });
  mockSetItem.mockImplementationOnce(async (_key, text) => { stored = text; });
  const consuming = StorageService.clearComposerDraftIfMatches('main', 'main', 'legacy');
  await Promise.resolve();
  const editing = StorageService.setComposerDraft('main', 'main', 'newer text');
  await Promise.resolve();
  finishRead();
  await Promise.all([consuming, editing]);
  expect(stored).toBe('newer text');
});

test('legacy consumption preserves a different draft and storage failures do not poison later operations', async () => {
  mockGetItem.mockResolvedValueOnce('new text');
  mockRemoveItem.mockClear();
  await expect(StorageService.clearComposerDraftIfMatches('main', 'main', 'old text')).resolves.toBe(false);
  expect(mockRemoveItem).not.toHaveBeenCalled();
  mockSetItem.mockRejectedValueOnce(new Error('storage full'));
  await expect(StorageService.setComposerDraft('main', 'main', 'draft', 'one')).rejects.toThrow('storage full');
  await expect(StorageService.setComposerDraft('main', 'main', '', 'one')).resolves.toBeUndefined();
});
