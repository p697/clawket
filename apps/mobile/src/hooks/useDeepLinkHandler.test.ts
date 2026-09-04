import { Alert } from 'react-native';
import * as Linking from 'expo-linking';
import { StorageService } from '../services/storage';

// Capture the useEffect callback and useRef value
let effectCallback: (() => void | (() => void)) | null = null;
const refObject = { current: null as string | null };
const connectPairingLinkMock = jest.fn();

jest.mock('react', () => ({
  useEffect: jest.fn((cb: () => void | (() => void)) => {
    effectCallback = cb;
  }),
  useRef: jest.fn(() => refObject),
}));

jest.mock('../services/storage', () => ({
  StorageService: {
    setGatewayConfig: jest.fn(),
  },
}));

jest.mock('../contexts/GatewayScannerContext', () => ({
  useGatewayScanner: () => ({ connectPairingLink: connectPairingLinkMock }),
}));

// Import after mocks are set up
import { useDeepLinkHandler } from './useDeepLinkHandler';

describe('useDeepLinkHandler', () => {
  const mockNavigate = jest.fn();
  const mockIsReady = jest.fn(() => true);
  const mockSendChat = jest.fn();
  const mockOnSaved = jest.fn();
  const mockRequestChatSidebar = jest.fn();

  const deps = {
    rootNavigationRef: {
      isReady: mockIsReady,
      navigate: mockNavigate,
      current: null,
    } as any,
    gateway: {
      sendChat: mockSendChat,
    } as any,
    mainSessionKey: 'main-session',
    onSaved: mockOnSaved,
    requestChatSidebar: mockRequestChatSidebar,
  };

  // Helper to simulate a deep link URL event
  function simulateUrl(url: string) {
    const addEventListener = Linking.addEventListener as jest.Mock;
    const urlCallback = addEventListener.mock.calls[0]?.[1];
    if (urlCallback) {
      urlCallback({ url });
    }
  }

  // Helper to press Confirm on the Alert
  function pressAlertConfirm() {
    const alertMock = Alert.alert as jest.Mock;
    const lastCall = alertMock.mock.calls[alertMock.mock.calls.length - 1];
    const buttons = lastCall[2] as { text: string; onPress?: () => void }[];
    const confirm = buttons.find((b) => b.text === 'Confirm');
    confirm?.onPress?.();
  }

  beforeEach(() => {
    jest.clearAllMocks();
    refObject.current = null;
    effectCallback = null;

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
      expect(Alert.alert).not.toHaveBeenCalled();
    });

    it('should process clawket:// URLs from initial URL', async () => {
      (Linking.getInitialURL as jest.Mock).mockResolvedValue(
        'clawket://config'
      );
      setupHook();
      await flushPromises();
      expect(Alert.alert).toHaveBeenCalledWith(
        'Open Settings',
        'Open the settings screen?',
        expect.any(Array)
      );
    });

    it('should process clawket:// URLs from events', async () => {
      setupHook();
      await flushPromises();
      simulateUrl('clawket://config');
      expect(Alert.alert).toHaveBeenCalledWith(
        'Open Settings',
        'Open the settings screen?',
        expect.any(Array)
      );
    });

    it('should send an official pairing Universal Link directly to the secure pairing flow', async () => {
      const url = 'https://registry.clawket.ai/pair/ps_abc123#k=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      setupHook();
      await flushPromises();
      simulateUrl(url);
      expect(connectPairingLinkMock).toHaveBeenCalledWith(url);
      expect(Alert.alert).not.toHaveBeenCalled();
    });
  });

  describe('deduplication', () => {
    it('should not process the same URL twice', async () => {
      setupHook();
      await flushPromises();
      simulateUrl('clawket://config');
      simulateUrl('clawket://config');
      expect(Alert.alert).toHaveBeenCalledTimes(1);
    });

    it('should process different URLs', async () => {
      setupHook();
      await flushPromises();
      simulateUrl('clawket://config');
      simulateUrl('clawket://session?key=abc');
      expect(Alert.alert).toHaveBeenCalledTimes(2);
    });
  });

  describe('describeAction (via Alert)', () => {
    beforeEach(async () => {
      setupHook();
      await flushPromises();
    });

    it('should show agent action description', () => {
      simulateUrl('clawket://agent?message=hello');
      expect(Alert.alert).toHaveBeenCalledWith(
        'Send Message',
        'Send "hello" to agent?',
        expect.any(Array)
      );
    });

    it('should show session action description', () => {
      simulateUrl('clawket://session?key=test-session');
      expect(Alert.alert).toHaveBeenCalledWith(
        'Open Session',
        'Navigate to session "test-session"?',
        expect.any(Array)
      );
    });

    it('should show config action description', () => {
      simulateUrl('clawket://config');
      expect(Alert.alert).toHaveBeenCalledWith(
        'Open Settings',
        'Open the settings screen?',
        expect.any(Array)
      );
    });

    it('should show connect action description', () => {
      simulateUrl('clawket://connect?url=https://example.com&token=abc');
      expect(Alert.alert).toHaveBeenCalledWith(
        'Connect to Server',
        'Connect to https://example.com? This will change your active gateway connection.',
        expect.any(Array)
      );
    });
  });

  describe('executeAction (via Confirm)', () => {
    beforeEach(async () => {
      setupHook();
      await flushPromises();
    });

    it('should navigate to Chat and send message for agent action', () => {
      simulateUrl('clawket://agent?message=hello');
      pressAlertConfirm();
      expect(mockNavigate).toHaveBeenCalledWith('MainTabs', { screen: 'Chat' });
      expect(mockSendChat).toHaveBeenCalledWith('main-session', 'hello');
    });

    it('should use custom sessionKey for agent action if provided', () => {
      simulateUrl('clawket://agent?message=hello&sessionKey=custom');
      pressAlertConfirm();
      expect(mockSendChat).toHaveBeenCalledWith('custom', 'hello');
    });

    it('should request chat sidebar for session action', () => {
      simulateUrl('clawket://session?key=test');
      pressAlertConfirm();
      expect(mockRequestChatSidebar).toHaveBeenCalledWith({
        tab: 'sessions',
        openDrawer: false,
      });
    });

    it('should navigate to My tab for config action', () => {
      simulateUrl('clawket://config');
      pressAlertConfirm();
      expect(mockNavigate).toHaveBeenCalledWith('MainTabs', { screen: 'My' });
    });

    it('should save config and call onSaved for connect action', () => {
      simulateUrl('clawket://connect?url=https://example.com&token=secret');
      pressAlertConfirm();
      expect(StorageService.setGatewayConfig).toHaveBeenCalledWith({
        url: 'https://example.com',
        token: 'secret',
      });
      expect(mockOnSaved).toHaveBeenCalledWith(
        {
          url: 'https://example.com',
          token: 'secret',
        },
        expect.stringMatching(/^runtime:/),
      );
    });

    it('should save password-only config for connect action', () => {
      simulateUrl('clawket://connect?url=https://example.com&password=secret');
      pressAlertConfirm();
      expect(StorageService.setGatewayConfig).toHaveBeenCalledWith({
        url: 'https://example.com',
        token: undefined,
        password: 'secret',
      });
      expect(mockOnSaved).toHaveBeenCalledWith(
        {
          url: 'https://example.com',
          token: undefined,
          password: 'secret',
        },
        expect.stringMatching(/^runtime:/),
      );
    });

    it('should not navigate when rootNavigationRef is not ready', () => {
      mockIsReady.mockReturnValue(false);
      simulateUrl('clawket://agent?message=hello');
      pressAlertConfirm();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(mockSendChat).toHaveBeenCalledWith('main-session', 'hello');
    });
  });

  describe('invalid URLs', () => {
    it('should not show alert for unknown routes', async () => {
      setupHook();
      await flushPromises();
      simulateUrl('clawket://unknown');
      expect(Alert.alert).not.toHaveBeenCalled();
    });

    it('should not show alert for agent without message', async () => {
      setupHook();
      await flushPromises();
      simulateUrl('clawket://agent');
      expect(Alert.alert).not.toHaveBeenCalled();
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
