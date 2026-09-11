import { BridgeCapabilityStore } from './bridge-capability-store';

describe('BridgeCapabilityStore', () => {
  it('persists and reloads a negotiated capability mode per connection', async () => {
    const values = new Map<string, any>();
    const storage = {
      getDashboardCache: jest.fn(async (key: string) => values.get(key) ?? null),
      setDashboardCache: jest.fn(async (key: string, value: any) => {
        values.set(key, value);
      }),
    };
    const first = new BridgeCapabilityStore(storage, () => 123);
    await first.set('openclaw-preview', 'legacy');

    const restarted = new BridgeCapabilityStore(storage, () => 456);
    await expect(restarted.get('openclaw-preview')).resolves.toBe('legacy');
    await expect(restarted.get('another')).resolves.toBeNull();
    expect(storage.setDashboardCache).toHaveBeenCalledWith(
      'connection-registry:bridge-capability:v1:openclaw-preview',
      expect.objectContaining({
        savedAt: 123,
        data: { version: 1, connectionId: 'openclaw-preview', mode: 'legacy' },
      }),
    );
  });

  it('rejects corrupt or cross-connection cache data', async () => {
    const storage = {
      getDashboardCache: jest.fn(async () => ({
        version: 2 as const,
        cacheKey: 'corrupt',
        savedAt: 1,
        source: 'network' as const,
        connectionStateAtSave: 'ready',
        data: { version: 1, connectionId: 'wrong', mode: 'v2' },
      })),
      setDashboardCache: jest.fn(async () => undefined),
    };
    await expect(new BridgeCapabilityStore(storage as any).get('expected')).resolves.toBeNull();
  });
});
