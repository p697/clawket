import { renderHook, waitFor } from '@testing-library/react-native';
import type { ConnectionDescriptor } from '@clawket/agent-protocol';

const mockStorage = {
  getDebugMode: jest.fn(async () => false),
  getShowAgentAvatar: jest.fn(async () => true),
  getThemeMode: jest.fn(async () => 'system' as const),
  getAccentColor: jest.fn(async () => 'iceBlue' as const),
  getShowModelUsage: jest.fn(async () => true),
  getExecApprovalEnabled: jest.fn(async () => false),
  getChatFontSize: jest.fn(async () => 16),
  getChatAppearance: jest.fn(async () => ({
    background: { fillMode: 'solid' as const, color: null, imageUri: null },
    bubbles: { style: 'solid' as const },
  })),
  getNodeEnabled: jest.fn(async () => false),
  getNodeCapabilityToggles: jest.fn(async () => ({ camera: true })),
  getCurrentAgentId: jest.fn(async () => 'agent-7'),
  getLastOpenedSessionSnapshot: jest.fn<Promise<any>, any[]>(async () => null),
  getCachedAgentIdentity: jest.fn<Promise<any>, any[]>(async () => null),
};

jest.mock('../services/storage', () => ({
  StorageService: mockStorage,
}));

import { useAppBootstrap } from './useAppBootstrap';

function connection(
  id: string,
  backendKind: ConnectionDescriptor['backendKind'],
): ConnectionDescriptor {
  return {
    id,
    backendKind,
    transportKind: 'relay',
    label: id,
    createdAt: 1,
    isFreeSlot: true,
  };
}

describe('useAppBootstrap', () => {
  const nodeClient = { disconnect: jest.fn() } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.getCurrentAgentId.mockResolvedValue('agent-7');
    mockStorage.getLastOpenedSessionSnapshot.mockResolvedValue(null);
    mockStorage.getCachedAgentIdentity.mockResolvedValue(null);
  });

  it('waits for the registry and restores OpenClaw cache by connection id', async () => {
    mockStorage.getLastOpenedSessionSnapshot.mockResolvedValue({
      sessionKey: 'agent:agent-7:main',
      updatedAt: 42,
      agentId: 'agent-7',
    });
    mockStorage.getCachedAgentIdentity.mockResolvedValue({
      agentId: 'agent-7',
      updatedAt: 43,
      agentName: 'Seven',
    });

    const waiting = renderHook(() => useAppBootstrap({
      nodeClient,
      connection: null,
      connectionsInitialized: false,
    }));

    await waitFor(() => expect(mockStorage.getCurrentAgentId).toHaveBeenCalledTimes(1));
    expect(waiting.result.current.loading).toBe(true);
    waiting.unmount();

    const view = renderHook(() => useAppBootstrap({
      nodeClient,
      connection: connection('connection-1', 'openclaw'),
      connectionsInitialized: true,
    }));
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    expect(mockStorage.getLastOpenedSessionSnapshot).toHaveBeenCalledWith(
      'connection-1',
      'agent-7',
    );
    expect(view.result.current.initialAgentId).toBe('agent-7');
    expect(view.result.current.initialChatPreview).toMatchObject({
      sessionKey: 'agent:agent-7:main',
      agentName: 'Seven',
    });
  });

  it('uses the backend-scoped Hermes main session instead of a stale agent id', async () => {
    const view = renderHook(() => useAppBootstrap({
      nodeClient,
      connection: connection('hermes-1', 'hermes'),
      connectionsInitialized: true,
    }));

    await waitFor(() => expect(view.result.current.loading).toBe(false));

    expect(mockStorage.getLastOpenedSessionSnapshot).toHaveBeenCalledWith('hermes-1', 'main');
    expect(view.result.current.initialAgentId).toBe('main');
    expect(view.result.current.initialChatPreview).toMatchObject({
      agentId: 'main',
      sessionKey: 'main',
    });
  });
});
