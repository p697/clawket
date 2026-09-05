import { act, renderHook, waitFor } from '@testing-library/react-native';

import { getConnectionRuntime } from '../connection';
import { ChatCacheService } from '../services/chat-cache';
import { ensureIdentity } from '../services/gateway-auth';
import { ProEntitlementStorageService } from '../services/pro-entitlement-storage';
import { useProEntitlement } from './useProEntitlement';

jest.mock('../connection', () => ({
  getConnectionRuntime: jest.fn(),
}));
jest.mock('../services/chat-cache', () => ({
  ChatCacheService: { listSessions: jest.fn() },
}));
jest.mock('../services/gateway-auth', () => ({
  ensureIdentity: jest.fn(),
}));
jest.mock('../services/pro-entitlement-storage', () => ({
  ProEntitlementStorageService: {
    resolve: jest.fn(),
    switchFreeConnection: jest.fn(),
  },
}));

const connection = {
  id: 'home',
  backendKind: 'openclaw' as const,
  transportKind: 'relay' as const,
  label: 'Home',
  createdAt: 1,
  isFreeSlot: false,
};
const persisted = {
  version: 1 as const,
  freeConnectionId: 'home',
  lastFreeConnectionSwitchAt: null,
  graceEvaluatedAt: 1_000,
  graceUntil: 2_000,
};

describe('useProEntitlement', () => {
  const setFreeConnection = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(1_000);
    (getConnectionRuntime as jest.Mock).mockReturnValue({ setFreeConnection });
    setFreeConnection.mockResolvedValue(undefined);
    (ensureIdentity as jest.Mock).mockResolvedValue({ deviceId: 'device' });
    (ChatCacheService.listSessions as jest.Mock).mockResolvedValue([{
      storageKey: 'writer',
      gatewayConfigId: 'home',
      agentId: 'writer',
      sessionKey: 'agent:writer:main',
      messageCount: 1,
      updatedAt: 1,
    }]);
    (ProEntitlementStorageService.resolve as jest.Mock).mockResolvedValue({
      state: persisted,
      entitlement: {
        isPro: false,
        graceUntil: 2_000,
        now: 1_000,
        freeConnectionId: 'home',
      },
      graceGranted: true,
      recoveredCorruptState: false,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves device-scoped legacy use and synchronizes the authoritative free connection', async () => {
    const { result } = renderHook(() => useProEntitlement({
      isPro: false,
      subscriptionLoading: false,
      connections: [connection],
      activeConnectionId: 'home',
      registryFreeConnectionId: null,
      roster: [],
      foregroundEpoch: 0,
    }));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(ProEntitlementStorageService.resolve).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: 'device',
      connectionIds: ['home'],
      activeConnectionId: 'home',
      hasNonMainAgentSession: true,
      now: 1_000,
    }));
    expect(setFreeConnection).toHaveBeenCalledWith('home');
    expect(result.current.entitlement).toEqual({
      isPro: false,
      graceUntil: 2_000,
      now: 1_000,
      freeConnectionId: 'home',
    });
  });

  it('persists a free switch, updates access immediately, and exposes its cooldown', async () => {
    const work = { ...connection, id: 'work', label: 'Work' };
    const switched = {
      ...persisted,
      freeConnectionId: 'work',
      lastFreeConnectionSwitchAt: 1_000,
    };
    (ProEntitlementStorageService.switchFreeConnection as jest.Mock).mockResolvedValue({
      ok: true,
      changed: true,
      state: switched,
      nextSwitchAt: 86_401_000,
    });
    const { result } = renderHook(() => useProEntitlement({
      isPro: false,
      subscriptionLoading: false,
      connections: [connection, work],
      activeConnectionId: 'home',
      registryFreeConnectionId: 'home',
      roster: [],
      foregroundEpoch: 0,
    }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    setFreeConnection.mockClear();

    await act(async () => {
      await result.current.switchFreeConnection('work');
    });

    expect(ProEntitlementStorageService.switchFreeConnection).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: 'device',
      targetConnectionId: 'work',
      connectionIds: ['home', 'work'],
      now: 1_000,
    }));
    expect(setFreeConnection).toHaveBeenCalledWith('work');
    expect(result.current.entitlement.freeConnectionId).toBe('work');
    expect(result.current.nextFreeConnectionSwitchAt).toBe(86_401_000);
    expect(result.current.switching).toBe(false);
  });

  it('keeps a persisted free switch authoritative when the registry mirror fails', async () => {
    const work = { ...connection, id: 'work', label: 'Work' };
    const switched = {
      ...persisted,
      freeConnectionId: 'work',
      lastFreeConnectionSwitchAt: 1_000,
    };
    (ProEntitlementStorageService.switchFreeConnection as jest.Mock).mockResolvedValue({
      ok: true,
      changed: true,
      state: switched,
      nextSwitchAt: 86_401_000,
    });
    const { result } = renderHook(() => useProEntitlement({
      isPro: false,
      subscriptionLoading: false,
      connections: [connection, work],
      activeConnectionId: 'home',
      registryFreeConnectionId: 'home',
      roster: [],
      foregroundEpoch: 0,
    }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    setFreeConnection.mockRejectedValueOnce(new Error('registry write failed'));

    let switchResult: unknown;
    await act(async () => {
      switchResult = await result.current.switchFreeConnection('work');
    });

    expect(switchResult).toMatchObject({ ok: true, changed: true });
    expect(result.current.entitlement.freeConnectionId).toBe('work');
    expect(result.current.nextFreeConnectionSwitchAt).toBe(86_401_000);
    expect(result.current.switching).toBe(false);
  });
});
