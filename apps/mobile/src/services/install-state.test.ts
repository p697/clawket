import {
  INSTALL_MARKER_STORAGE_KEY,
  classifyInstallState,
  ensureInstallState,
  markInstalled,
  resolveInstallState,
  type InstallMarkerStorage,
} from './install-state';

class MemoryMarkerStorage implements InstallMarkerStorage {
  readonly values = new Map<string, string>();
  failReads = false;
  failWrites = false;

  constructor(entries: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(entries)) this.values.set(key, value);
  }

  async getItem(key: string): Promise<string | null> {
    if (this.failReads) throw new Error('storage unavailable');
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    if (this.failWrites) throw new Error('storage unavailable');
    this.values.set(key, value);
  }

  async getAllKeys(): Promise<ReadonlyArray<string>> {
    if (this.failReads) throw new Error('storage unavailable');
    return [...this.values.keys()];
  }
}

describe('install state', () => {
  it('classifies a bundle that never ran as fresh even with third-party keys around', () => {
    expect(classifyInstallState(null, [])).toBe('fresh');
    expect(classifyInstallState(null, ['posthog-rn-anon-id', 'RCPurchases'])).toBe('fresh');
    expect(classifyInstallState('', ['posthog-rn-anon-id'])).toBe('fresh');
  });

  it('classifies pre-marker sandbox data as an upgrade, never a fresh install', () => {
    expect(classifyInstallState(null, ['clawket.dashboard.cache.v2:roster'])).toBe('upgraded');
    expect(classifyInstallState(null, ['clawket.appUpdateAnnouncementSeen.v1:2.1.2'])).toBe('upgraded');
    expect(classifyInstallState(null, ['agent_avatars'])).toBe('upgraded');
    expect(classifyInstallState(null, ['clawket.chatCache.index.v2', 'posthog-rn-anon-id'])).toBe('upgraded');
  });

  it('treats a present marker as an existing install regardless of other keys', () => {
    expect(classifyInstallState('1758000000000', [])).toBe('existing');
    expect(classifyInstallState('1758000000000', ['clawket.chatCache.index.v2'])).toBe('existing');
    expect(classifyInstallState(null, [INSTALL_MARKER_STORAGE_KEY])).toBe('fresh');
  });

  it('fails closed to existing when the sandbox cannot be read', async () => {
    const storage = new MemoryMarkerStorage();
    storage.failReads = true;
    await expect(resolveInstallState(storage)).resolves.toBe('existing');

    const malformed: InstallMarkerStorage = {
      getItem: async () => null,
      setItem: async () => undefined,
      getAllKeys: async () => (null as unknown as ReadonlyArray<string>),
    };
    await expect(resolveInstallState(malformed)).resolves.toBe('existing');
  });

  it('runs the reset exactly once for a fresh install and then records the marker', async () => {
    const storage = new MemoryMarkerStorage({ 'posthog-rn-anon-id': 'anon' });
    const resetForFreshInstall = jest.fn(async () => undefined);

    await expect(ensureInstallState({
      resetForFreshInstall,
      storage,
      now: () => 1_758_000_000_000,
    })).resolves.toBe('fresh');
    expect(resetForFreshInstall).toHaveBeenCalledTimes(1);
    expect(storage.values.get(INSTALL_MARKER_STORAGE_KEY)).toBe('1758000000000');

    await expect(ensureInstallState({ resetForFreshInstall, storage })).resolves.toBe('existing');
    expect(resetForFreshInstall).toHaveBeenCalledTimes(1);
  });

  it('marks an upgraded device without touching its surviving state', async () => {
    const storage = new MemoryMarkerStorage({ 'clawket.chatCache.index.v2': '{}' });
    const resetForFreshInstall = jest.fn(async () => undefined);

    await expect(ensureInstallState({ resetForFreshInstall, storage })).resolves.toBe('upgraded');

    expect(resetForFreshInstall).not.toHaveBeenCalled();
    expect(storage.values.has(INSTALL_MARKER_STORAGE_KEY)).toBe(true);
  });

  it('never blocks launch on a failed reset or a failed marker write', async () => {
    const storage = new MemoryMarkerStorage();
    await expect(ensureInstallState({
      resetForFreshInstall: async () => { throw new Error('keychain unavailable'); },
      storage,
    })).resolves.toBe('fresh');
    expect(storage.values.has(INSTALL_MARKER_STORAGE_KEY)).toBe(true);

    const readOnly = new MemoryMarkerStorage();
    readOnly.failWrites = true;
    await expect(markInstalled(readOnly)).resolves.toBeUndefined();
    await expect(ensureInstallState({
      resetForFreshInstall: async () => undefined,
      storage: readOnly,
    })).resolves.toBe('fresh');
  });
});
