import AsyncStorage from '@react-native-async-storage/async-storage';

// Mock theme module to avoid TSX parsing issues
jest.mock('../theme', () => ({
  defaultAccentId: 'iceBlue',
  isBuiltInAccentId: jest.fn(() => false),
}));

import { StorageService, type NodeInvokeAuditEntry } from './storage';

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;

const ENTRY_BASE: NodeInvokeAuditEntry = {
  id: 'inv-1',
  nodeId: 'node-1',
  command: 'device.status',
  source: 'gateway',
  timestampMs: 1000,
  result: 'success',
};

describe('StorageService node invoke audit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('appends entry to empty audit list', async () => {
    mockGetItem.mockResolvedValueOnce(null);
    await StorageService.appendNodeInvokeAudit(ENTRY_BASE);
    expect(mockSetItem).toHaveBeenCalledWith(
      'clawket.nodeInvokeAudit.v1',
      JSON.stringify([ENTRY_BASE]),
    );
  });

  it('prepends newest entry before existing ones', async () => {
    const oldEntry = { ...ENTRY_BASE, id: 'old', timestampMs: 500 };
    const newEntry = { ...ENTRY_BASE, id: 'new', timestampMs: 1500 };
    mockGetItem.mockResolvedValueOnce(JSON.stringify([oldEntry]));
    await StorageService.appendNodeInvokeAudit(newEntry);
    expect(mockSetItem).toHaveBeenCalledWith(
      'clawket.nodeInvokeAudit.v1',
      JSON.stringify([newEntry, oldEntry]),
    );
  });

  it('returns sorted audit entries and filters invalid records', async () => {
    const a = { ...ENTRY_BASE, id: 'a', timestampMs: 100 };
    const b = { ...ENTRY_BASE, id: 'b', timestampMs: 300 };
    const invalid = { foo: 'bar' };
    mockGetItem.mockResolvedValueOnce(JSON.stringify([a, invalid, b]));
    const entries = await StorageService.getNodeInvokeAuditEntries();
    expect(entries.map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('returns empty list for corrupted storage value', async () => {
    mockGetItem.mockResolvedValueOnce('not-json');
    const entries = await StorageService.getNodeInvokeAuditEntries();
    expect(entries).toEqual([]);
  });

  it('does not throw on append failure', async () => {
    mockGetItem.mockRejectedValueOnce(new Error('storage error'));
    await expect(StorageService.appendNodeInvokeAudit(ENTRY_BASE)).resolves.toBeUndefined();
  });
});
