import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  MessageDetailScreen,
  type MessageDetailScreenProps,
} from './MessageDetailScreen';

let mockIsPro = true;
let mockRuntime = {
  activeConnectionId: 'connection',
  activeState: 'ready',
};

const mockListSessions = jest.fn(async () => [{
  storageKey: 'storage',
  gatewayConfigId: 'connection',
  agentId: 'agent',
  agentName: 'Agent',
  sessionKey: 'session',
  sessionLabel: 'Session',
  messageCount: 1,
  updatedAt: 100,
}]);
const mockGetMessages = jest.fn(async (_key: string) => [{
  id: 'message',
  role: 'assistant' as const,
  text: 'Cached message',
  timestampMs: 100,
}]);
const mockListFavorites = jest.fn(async () => []);

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => ReactRuntime.forwardRef(
    ({ children, style, ...props }: Record<string, unknown>, ref: unknown) => ReactRuntime.createElement(
      name,
      {
        ...props,
        ref,
        style: typeof style === 'function' ? style({ pressed: false }) : style,
      },
      children,
    ),
  );
  return {
    ScrollView: host('ScrollView'),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => style,
      hairlineWidth: 1,
    },
    Text: host('Text'),
    View: host('View'),
  };
});

jest.mock('lucide-react-native', () => ({ ChevronLeft: () => null }));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 16, left: 0 }),
}));

jest.mock('../../theme', () => ({
  useAppTheme: () => ({
    theme: {
      scheme: 'light',
      colors: {
        canvas: '#FFFFFF',
        surface: '#F2F2F4',
        ink: '#111113',
        inkSecondary: '#6B6B72',
      },
    },
  }),
}));

jest.mock('../../connection', () => ({
  useConnections: () => mockRuntime,
}));

jest.mock('../../contexts/ProPaywallContext', () => ({
  useProPaywall: () => ({ isPro: mockIsPro }),
}));

jest.mock('../../services/chat-cache', () => ({
  ChatCacheService: {
    listSessions: () => mockListSessions(),
    getMessagesByStorageKey: (key: string) => mockGetMessages(key),
  },
}));

jest.mock('../../services/message-favorites', () => ({
  MessageFavoritesService: {
    listFavorites: () => mockListFavorites(),
  },
}));

jest.mock('../../components/ui/Banner', () => ({
  Banner: ({ actionLabel, onAction, ...props }: Record<string, unknown>) => React.createElement(
    'Banner',
    props,
    actionLabel ? React.createElement(
      'Pressable',
      { testID: `${String(props.testID)}-action`, onPress: onAction },
      String(actionLabel),
    ) : null,
  ),
}));

jest.mock('../../components/ui/Button', () => ({
  Button: ({ label, onPress, ...props }: Record<string, unknown>) => React.createElement(
    'Pressable',
    { ...props, onPress },
    String(label),
  ),
}));

jest.mock('../../components/ui/FloatingButton', () => ({
  FloatingButton: ({ onPress, ...props }: Record<string, unknown>) => React.createElement(
    'Pressable',
    { ...props, onPress },
  ),
}));

jest.mock('../../components/ui/Skeleton', () => ({
  Skeleton: (props: Record<string, unknown>) => React.createElement('Skeleton', props),
}));

function props(): MessageDetailScreenProps {
  return {
    navigation: {
      goBack: jest.fn(),
      navigate: jest.fn(),
    },
    route: {
      key: 'MessageDetail-key',
      name: 'MessageDetail',
      params: {
        connectionId: 'connection',
        sessionKey: 'session',
        messageId: 'message',
      },
    },
  } as unknown as MessageDetailScreenProps;
}

describe('Search MessageDetailScreen', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockIsPro = true;
    mockRuntime = { activeConnectionId: 'connection', activeState: 'ready' };
    mockListSessions.mockClear();
    mockGetMessages.mockClear();
    mockListFavorites.mockClear();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
  });

  afterEach(() => consoleErrorSpy.mockRestore());

  it('loads local detail and navigates back into its thread', async () => {
    const screenProps = props();
    const view = render(<MessageDetailScreen {...screenProps} />);
    await waitFor(() => expect(view.getByTestId('message-detail-content')).toBeTruthy());

    fireEvent.press(view.getByTestId('message-detail-view-thread'));
    expect(screenProps.navigation.navigate).toHaveBeenCalledWith('Thread', {
      connectionId: 'connection',
      agentId: 'agent',
      sessionKey: 'session',
      from: 'search',
    });
    fireEvent.press(view.getByTestId('message-detail-back'));
    expect(screenProps.navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('uses the explicit view-in-thread callback when supplied', async () => {
    const onViewInThread = jest.fn();
    const view = render(<MessageDetailScreen {...props()} onViewInThread={onViewInThread} />);
    await waitFor(() => expect(view.getByTestId('message-detail-content')).toBeTruthy());

    fireEvent.press(view.getByTestId('message-detail-view-thread'));
    expect(onViewInThread).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 'connection',
      agentId: 'agent',
      messageId: 'message',
    }));
  });

  it('blocks free users at the messageHistory Pro gate before reading cache', () => {
    mockIsPro = false;
    const screenProps = props();
    const view = render(<MessageDetailScreen {...screenProps} />);

    expect(view.getByTestId('message-detail-permission')).toBeTruthy();
    expect(mockListSessions).not.toHaveBeenCalled();
    fireEvent.press(view.getByTestId('message-detail-permission-action'));
    expect(screenProps.navigation.navigate).toHaveBeenCalledWith('Paywall', {
      reason: 'messageHistory',
    });
  });

  it('keeps cached content visible while the active connection is offline', async () => {
    mockRuntime = { activeConnectionId: 'connection', activeState: 'offline' };
    const view = render(<MessageDetailScreen {...props()} />);

    await waitFor(() => expect(view.getByTestId('message-detail-offline')).toBeTruthy());
    expect(view.getByTestId('message-detail-content')).toBeTruthy();
  });
});
