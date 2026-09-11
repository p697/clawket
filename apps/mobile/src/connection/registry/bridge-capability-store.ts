import { StorageService } from '../../services/storage';

export type BridgeCapabilityMode = 'v2' | 'legacy';

type PersistedBridgeCapability = {
  version: 1;
  connectionId: string;
  mode: BridgeCapabilityMode;
};

type BridgeCapabilityStorage = Pick<
  typeof StorageService,
  'getDashboardCache' | 'setDashboardCache'
>;

export class BridgeCapabilityStore {
  public constructor(
    private readonly storage: BridgeCapabilityStorage = StorageService,
    private readonly now: () => number = Date.now,
  ) {}

  public async get(connectionId: string): Promise<BridgeCapabilityMode | null> {
    const normalizedId = connectionId.trim();
    if (!normalizedId) return null;
    const entry = await this.storage.getDashboardCache<PersistedBridgeCapability>(
      scope(normalizedId),
    );
    const value = entry?.data;
    if (
      value?.version !== 1
      || value.connectionId !== normalizedId
      || (value.mode !== 'v2' && value.mode !== 'legacy')
    ) {
      return null;
    }
    return value.mode;
  }

  public async set(connectionId: string, mode: BridgeCapabilityMode): Promise<void> {
    const normalizedId = connectionId.trim();
    if (!normalizedId) throw new Error('Connection id is required.');
    const cacheKey = scope(normalizedId);
    await this.storage.setDashboardCache(cacheKey, {
      version: 2,
      cacheKey,
      savedAt: this.now(),
      source: 'network',
      connectionStateAtSave: 'capability-negotiated',
      data: {
        version: 1,
        connectionId: normalizedId,
        mode,
      },
    });
  }
}

function scope(connectionId: string): string {
  return `connection-registry:bridge-capability:v1:${encodeURIComponent(connectionId)}`;
}

export const bridgeCapabilityStore = new BridgeCapabilityStore();
