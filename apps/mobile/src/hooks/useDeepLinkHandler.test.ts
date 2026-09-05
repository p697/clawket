import { Alert } from 'react-native';
import * as Linking from 'expo-linking';

// Capture the useEffect callback and useRef value
let effectCallback: (() => void | (() => void)) | null = null;
const refObject = { current: null as string | null };
const connectPairingLinkMock = jest.fn();
const mockPrompt = jest.fn();
const mockGetAdapter = jest.fn();
const mockGetSnapshot = jest.fn();
const mockUpsertConnection = jest.fn();
const mockActivate = jest.fn();
const mockRequestConfirmation = jest.fn();
const mockActiveAdapter = {
  connection: { id: 'connection-1' },
  prompt: mockPrompt,
};
const mockRuntime = {
  getAdapter: mockGetAdapter,
  getSnapshot: mockGetSnapshot,
  upsertConnection: mockUpsertConnection,
  activate: mockActivate,
};

jest.mock('react', () => ({
  useEffect: jest.fn((cb: () => void | (() => void)) => {
    effectCallback = cb;
  }),
  useRef: jest.fn(() => refObject),
}));

jest.mock('../connection', () => ({
  getConnectionRuntime: () => mockRuntime,
}));

jest.mock('../contexts/GatewayScannerContext', () => ({
  useGatewayScanner: () => ({ connectPairingLink: connectPairingLinkMock }),
}));

// Import after mocks are set up
import {
  createDeepLinkPromptIdempotencyKey,
  useDeepLinkHandler,
  type DeepLinkDeps,
} from './useDeepLinkHandler';

describe('useDeepLinkHandler', () => {
  const mockNavigate = jest.fn();
  const mockIsReady = jest.fn(() => true);

  const deps: DeepLinkDeps = {
    rootNavigationRef: {
      isReady: mockIsReady,
      navigate: mockNavigate,
      current: null,
    } as any,
    activeAdapter: mockActiveAdapter as any,
    activeConnectionId: 'connection-1',
    currentAgentId: 'main',
    mainSessionKey: 'main-session',
    requestConfirmation: mockRequestConfirmation,
  };

  // Helper to simulate a deep link URL event
  function simulateUrl(url: string) {
    const addEventListener = Linking.addEventListener as jest.Mock;
    const urlCallback = addEventListener.mock.calls[0]?.[1];
    if (urlCallback) {
      urlCallback({ url });
    }
  }

  function confirmRequest() {
    const lastCall = mockRequestConfirmation.mock.calls.at(-1)?.[0];
    lastCall?.onConfirm();
  }

  beforeEach(() => {
    jest.clearAllMocks();
    refObject.current = null;
    effectCallback = null;
    deps.activeConnectionId = 'connection-1';
    deps.activeAdapter = mockActiveAdapter as any;
    mockIsReady.mockReturnValue(true);
    mockPrompt.mockResolvedValue({ runId: 'deep-link-run' });
    mockGetAdapter.mockReturnValue(mockActiveAdapter);
    mockGetSnapshot.mockReturnValue({ connections: [{ id: 'existing' }] });
    mockUpsertConnection.mockResolvedValue({
      connection: { id: 'connection-from-link' },
      created: true,
    });
    mockActivate.mockResolvedValue(undefined);

    // Reset Linking mocks
    (Linking.getInitialURL as jest.Mock).mockResolvedValue(null);
    (Linking.addEventListener as jest.Mock).mockReturnValue({ remove: jest.fn() });
  });

  function setupHook() {
    useDeepLinkHandler(deps);
    // Run the captured useEffect callback
    if (effectCallback) effectCallback();
  }

  describe('URL filtering', () => {
    it('should ignore non-clawket URLs', async () => {
      (Linking.getInitialURL as jest.Mock).mockResolvedValue('https://example.com');
      setupHook();
      await flushPromises();
      expect(mockRequestConfirmation).not.toHaveBeenCalled();
    });

    it('should process clawket:// URLs from initial URL', async () => {
      (Linking.getInitialURL as jest.Mock).mockResolvedValue(
        'clawket://config'
      );
      setupHook();
      await flushPromises();
      expect(mockRequestConfirmation).toHaveBeenCalledWith({
        action: { type: 'config' },
        onConfirm: expect.any(Function),
      });
    });

    it('should process clawket:// URLs from events', async () => {
      setupHook();
      await flushPromises();
      simulateUrl('clawket://config');
      expect(mockRequestConfirmation).toHaveBeenCalledWith({
        action: { type: 'config' },
        onConfirm: expect.any(Function),
      });
    });

    it('should send an official pairing Universal Link directly to the secure pairing flow', async () => {
      const url = 'https://registry.clawket.ai/pair/ps_abc123#k=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      setupHook();
      await flushPromises();
      simulateUrl(url);
      expect(connectPairingLinkMock).toHaveBeenCalledWith(url);
      expect(mockRequestConfirmation).not.toHaveBeenCalled();
    });
  });

  describe('deduplication', () => {
    it('should not process the same URL twice', async () => {
      setupHook();
      await flushPromises();
      simulateUrl('clawket://config');
      simulateUrl('clawket://config');
      expect(mockRequestConfirmation).toHaveBeenCalledTimes(1);
    });

    it('should process different URLs', async () => {
      setupHook();
      await flushPromises();
      simulateUrl('clawket://config');
      simulateUrl('clawket://session?key=abc');
      expect(mockRequestConfirmation).toHaveBeenCalledTimes(2);
    });
  });

  describe('confirmation requests', () => {
    beforeEach(async () => {
      setupHook();
      await flushPromises();
    });

    it('should show agent action description', () => {
      simulateUrl('clawket://agent?message=hello');
      expect(mockRequestConfirmation).toHaveBeenCalledWith({
        action: { type: 'agent', message: 'hello', sessionKey: undefined },
        onConfirm: expect.any(Function),
      });
    });

    it('should show session action description', () => {
      simulateUrl('clawket://session?key=test-session');
      expect(mockRequestConfirmation).toHaveBeenCalledWith({
        action: { type: 'session', key: 'test-session' },
        onConfirm: expect.any(Function),
      });
    });

    it('should show config action description', () => {
      simulateUrl('clawket://config');
      expect(mockRequestConfirmation).toHaveBeenCalledWith({
        action: { type: 'config' },
        onConfirm: expect.any(Function),
      });
    });

    it('should show connect action description', () => {
      simulateUrl('clawket://connect?url=https://example.com&token=abc');
      expect(mockRequestConfirmation).toHaveBeenCalledWith({
        action: {
          type: 'connect',
          url: 'https://example.com',
          token: 'abc',
          password: undefined,
        },
        onConfirm: expect.any(Function),
      });
    });
  });

  describe('executeAction (after confirmation)', () => {
    beforeEach(async () => {
      setupHook();
      await flushPromises();
    });

    it('should navigate to the active Agent thread and prompt through the adapter', async () => {
      simulateUrl('clawket://agent?message=hello');
      confirmRequest();
      await flushPromises();
      expect(mockNavigate).toHaveBeenCalledWith('Thread', {
        connectionId: 'connection-1',
        agentId: 'main',
        sessionKey: 'main-session',
        from: 'notification',
      });
      expect(mockPrompt).toHaveBeenCalledWith('main-session', {
        text: 'hello',
        idempotencyKey: expect.stringMatching(/^deeplink_[a-z0-9]+_[a-f0-9]{8}$/),
      });
    });

    it('should navigate and prompt a custom sessionKey for an agent action', async () => {
      simulateUrl('clawket://agent?message=hello&sessionKey=custom');
      confirmRequest();
      await flushPromises();
      expect(mockNavigate).toHaveBeenCalledWith('Thread', {
        connectionId: 'connection-1',
        agentId: 'main',
        sessionKey: 'custom',
        from: 'notification',
      });
      expect(mockPrompt).toHaveBeenCalledWith('custom', {
        text: 'hello',
        idempotencyKey: expect.stringMatching(/^deeplink_[a-z0-9]+_[a-f0-9]{8}$/),
      });
    });

    it('uses the runtime adapter when the active adapter prop has not caught up yet', async () => {
      deps.activeAdapter = null;
      simulateUrl('clawket://agent?message=hello');
      confirmRequest();
      await flushPromises();
      expect(mockGetAdapter).toHaveBeenCalledWith('connection-1');
      expect(mockPrompt).toHaveBeenCalledWith('main-session', expect.objectContaining({ text: 'hello' }));
    });

    it('should navigate directly to the linked session', () => {
      simulateUrl('clawket://session?key=test');
      confirmRequest();
      expect(mockNavigate).toHaveBeenCalledWith('Thread', {
        connectionId: 'connection-1',
        agentId: 'main',
        sessionKey: 'test',
        from: 'notification',
      });
    });

    it('should navigate to Account Settings for a config action', () => {
      simulateUrl('clawket://config');
      confirmRequest();
      expect(mockNavigate).toHaveBeenCalledWith('AccountSettings');
    });

    it('should upsert and activate an OpenClaw custom connection with token credentials', async () => {
      simulateUrl('clawket://connect?url=https://example.com&token=secret');
      confirmRequest();
      await flushPromises();
      expect(mockUpsertConnection).toHaveBeenCalledWith({
        backendKind: 'openclaw',
        transportKind: 'custom',
        label: 'Custom (example.com)',
        url: 'https://example.com',
        auth: { token: 'secret' },
      });
      expect(mockActivate).toHaveBeenCalledWith('connection-from-link');
      expect(mockUpsertConnection.mock.invocationCallOrder[0]).toBeLessThan(
        mockActivate.mock.invocationCallOrder[0],
      );
    });

    it('should store password-only credentials in the connection registry', async () => {
      simulateUrl('clawket://connect?url=https://example.com&password=secret');
      confirmRequest();
      await flushPromises();
      expect(mockUpsertConnection).toHaveBeenCalledWith({
        backendKind: 'openclaw',
        transportKind: 'custom',
        label: 'Custom (example.com)',
        url: 'https://example.com',
        auth: { password: 'secret' },
      });
      expect(mockActivate).toHaveBeenCalledWith('connection-from-link');
    });

    it('should report a registry failure without activating a partial connection', async () => {
      mockUpsertConnection.mockRejectedValueOnce(new Error('secure write failed'));
      simulateUrl('clawket://connect?url=https://example.com&token=secret');
      confirmRequest();
      await flushPromises();
      expect(mockActivate).not.toHaveBeenCalled();
      expect(Alert.alert).toHaveBeenLastCalledWith(
        'Connection Failed',
        'Could not save this connection. Try again.',
      );
    });

    it('should report an activation failure after the connection is saved', async () => {
      mockActivate.mockRejectedValueOnce(new Error('switch failed'));
      simulateUrl('clawket://connect?url=https://example.com');
      confirmRequest();
      await flushPromises();
      expect(mockUpsertConnection).toHaveBeenCalledTimes(1);
      expect(mockActivate).toHaveBeenCalledWith('connection-from-link');
      expect(Alert.alert).toHaveBeenLastCalledWith(
        'Connection Failed',
        'Could not save this connection. Try again.',
      );
    });

    it('should not navigate when rootNavigationRef is not ready', () => {
      mockIsReady.mockReturnValue(false);
      simulateUrl('clawket://agent?message=hello');
      confirmRequest();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(mockPrompt).toHaveBeenCalledWith(
        'main-session',
        expect.objectContaining({ text: 'hello' }),
      );
    });

    it('should preserve the send failure prompt after opening the thread', async () => {
      mockPrompt.mockRejectedValueOnce(new Error('offline'));
      simulateUrl('clawket://agent?message=hello');
      confirmRequest();
      await flushPromises();
      expect(mockNavigate).toHaveBeenCalledWith('Thread', {
        connectionId: 'connection-1',
        agentId: 'main',
        sessionKey: 'main-session',
        from: 'notification',
      });
      expect(Alert.alert).toHaveBeenLastCalledWith(
        'Send Failed',
        'Connection is not ready. Please try again in the thread.',
      );
    });

    it('should not navigate or send an agent action without an active connection', () => {
      deps.activeConnectionId = null;
      simulateUrl('clawket://agent?message=hello');
      confirmRequest();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(mockPrompt).not.toHaveBeenCalled();
      expect(Alert.alert).toHaveBeenLastCalledWith(
        'Connection Required',
        'Connect to an Agent before sending this message.',
      );
    });

    it('should not navigate a session action without an active connection', () => {
      deps.activeConnectionId = null;
      simulateUrl('clawket://session?key=test');
      confirmRequest();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(mockPrompt).not.toHaveBeenCalled();
      expect(Alert.alert).toHaveBeenLastCalledWith(
        'Connection Required',
        'Connect to an Agent before opening this session.',
      );
    });
  });

  describe('prompt idempotency', () => {
    it('derives the same opaque key from the same delivery identity', () => {
      const input = {
        connectionId: 'connection-1',
        agentId: 'main',
        sessionKey: 'agent:main:main',
        message: 'do not expose this text',
        receivedAtMs: 1_725_000_000_123,
      };
      const first = createDeepLinkPromptIdempotencyKey(input);
      expect(createDeepLinkPromptIdempotencyKey(input)).toBe(first);
      expect(first).toMatch(/^deeplink_[a-z0-9]+_[a-f0-9]{8}$/);
      expect(first).not.toContain(input.message);
    });
  });

  describe('invalid URLs', () => {
    it('should not show alert for unknown routes', async () => {
      setupHook();
      await flushPromises();
      simulateUrl('clawket://unknown');
      expect(mockRequestConfirmation).not.toHaveBeenCalled();
    });

    it('should not show alert for agent without message', async () => {
      setupHook();
      await flushPromises();
      simulateUrl('clawket://agent');
      expect(mockRequestConfirmation).not.toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('should return cleanup function that removes listener', () => {
      const mockRemove = jest.fn();
      (Linking.addEventListener as jest.Mock).mockReturnValue({ remove: mockRemove });
      useDeepLinkHandler(deps);
      const cleanup = effectCallback?.() as (() => void) | undefined;
      if (typeof cleanup === 'function') {
        cleanup();
        expect(mockRemove).toHaveBeenCalled();
      }
    });
  });
});

function flushPromises() {
  return new Promise((resolve) => process.nextTick(resolve));
}
