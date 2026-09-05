import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { ConnectionDescriptor } from '@clawket/agent-protocol';

import { FontSize } from '../../theme/tokens';
import {
  AccountSettingsScreen,
  type AccountSettingsScreenProps,
} from './AccountSettingsScreen';
import { resolveAccountSettingsRuntimeStatus } from './model';

const lightColors = {
  canvas: '#FFFFFF',
  canvasGrouped: '#F5F5F7',
  surface: '#F2F2F4',
  surfaceFloating: '#FFFFFF',
  ink: '#111113',
  inkSecondary: '#6B6B72',
  inkTertiary: '#A3A3AB',
  line: '#E6E6EA',
  accent: '#1F5EFF',
  accentSoft: '#E8EEFF',
  good: '#178A6A',
  goodSoft: '#E4F3EE',
  warn: '#D9791C',
  warnSoft: '#FAEDE1',
  bad: '#D64545',
  badSoft: '#F9E7E7',
};

const darkColors = {
  ...lightColors,
  canvas: '#0C0C0D',
  canvasGrouped: '#0C0C0D',
  surface: '#1A1A1D',
  surfaceFloating: '#222225',
  ink: '#F3F3F5',
  inkSecondary: '#9A9AA3',
  inkTertiary: '#6A6A73',
  line: '#2A2A2F',
  accent: '#6B95FF',
  accentSoft: '#1B2947',
  good: '#2FA07C',
  goodSoft: '#17352C',
  warn: '#D07F30',
  warnSoft: '#3A2B1E',
  bad: '#E06060',
  badSoft: '#3B2224',
};

let mockTheme = { scheme: 'light' as 'light' | 'dark', colors: lightColors };

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
    Platform: {
      OS: 'android',
      select: (options: Record<string, unknown>) => options.android ?? options.default,
    },
    Pressable: host('Pressable'),
    ScrollView: host('ScrollView'),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => flattenStyle(style),
      hairlineWidth: 1,
    },
    Text: host('Text'),
    View: host('View'),
  };
});

jest.mock('lucide-react-native', () => {
  const ReactRuntime = require('react');
  const icon = (props: Record<string, unknown>) => ReactRuntime.createElement('Icon', props);
  return new Proxy({}, { get: () => icon });
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => key.replace(
      /\{\{(\w+)\}\}/g,
      (_match, name: string) => String(options?.[name] ?? ''),
    ),
  }),
}));

jest.mock('../../theme', () => ({
  useAppTheme: () => ({ theme: mockTheme }),
}));

jest.mock('../../components/ui/Banner', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    Banner: ({ testID, message, actionLabel, onAction }: {
      testID?: string;
      message: string;
      actionLabel?: string;
      onAction?: () => void;
    }) => ReactRuntime.createElement(
      View,
      { testID },
      ReactRuntime.createElement(Text, null, message),
      actionLabel
        ? ReactRuntime.createElement(
          Pressable,
          { testID: `${testID}-action`, onPress: onAction },
          ReactRuntime.createElement(Text, null, actionLabel),
        )
        : null,
    ),
  };
});

jest.mock('../../components/ui/FloatingButton', () => {
  const ReactRuntime = require('react');
  const { Pressable } = require('react-native');
  return {
    FloatingButton: ({ testID, onPress, accessibilityLabel }: {
      testID?: string;
      onPress: () => void;
      accessibilityLabel: string;
    }) => ReactRuntime.createElement(Pressable, { testID, onPress, accessibilityLabel }),
  };
});

jest.mock('../../components/ui/Skeleton', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    Skeleton: (props: Record<string, unknown>) => ReactRuntime.createElement(View, props),
  };
});

jest.mock('../../components/ui/ThemedSwitch', () => {
  const ReactRuntime = require('react');
  return {
    ThemedSwitch: (props: Record<string, unknown>) => ReactRuntime.createElement('Switch', props),
  };
});

function flattenStyle(style: unknown): Record<string, unknown> {
  if (!style) return {};
  if (!Array.isArray(style)) return style as Record<string, unknown>;
  return Object.assign({}, ...style.map(flattenStyle));
}

function connection(
  id: string,
  patch: Partial<ConnectionDescriptor & { locked: boolean }> = {},
): ConnectionDescriptor & { locked?: boolean } {
  return {
    id,
    backendKind: 'openclaw',
    transportKind: 'relay',
    label: id === 'home' ? 'Home' : 'Work',
    environment: id === 'home' ? 'production' : 'preview',
    createdAt: 1,
    isFreeSlot: id === 'home',
    ...patch,
  };
}

function createProps(
  patch: Partial<AccountSettingsScreenProps> = {},
): AccountSettingsScreenProps {
  return {
    connections: [connection('home'), connection('work', { locked: true })],
    labels: {
      theme: 'Dark',
      accent: 'Blue',
      chatAppearance: 'Comfortable',
      appIcon: 'Light',
      speechLanguage: 'English',
      appVersion: '3.0.0 (300)',
      previewEnvironment: 'Preview',
    },
    onBack: jest.fn(),
    onOpenAction: jest.fn(),
    onOpenConnection: jest.fn(),
    onOpenPaywall: jest.fn(),
    onReplyNotificationsChange: jest.fn(),
    onDebugModeChange: jest.fn(),
    ...patch,
  };
}

type RenderNode = Readonly<{
  props: Readonly<Record<string, unknown>>;
}>;

function renderedFontSizes(view: ReturnType<typeof render>): ReadonlyArray<number> {
  const sizes = new Set<number>();
  view.UNSAFE_root
    .findAll((node: RenderNode) => Boolean(node.props.style))
    .forEach((node: RenderNode) => {
      const value = flattenStyle(node.props.style).fontSize;
      if (typeof value === 'number') sizes.add(value);
    });
  return [...sizes].sort((a, b) => a - b);
}

describe('AccountSettingsScreen', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockTheme = { scheme: 'light', colors: lightColors };
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders all descriptor groups and routes navigation, locks, and toggles through callbacks', () => {
    const onBack = jest.fn();
    const onOpenAction = jest.fn();
    const onOpenConnection = jest.fn();
    const onOpenPaywall = jest.fn();
    const onReplyNotificationsChange = jest.fn();
    const onDebugModeChange = jest.fn();
    const view = render(
      <AccountSettingsScreen
        {...createProps({
          debugMode: true,
          onBack,
          onOpenAction,
          onOpenConnection,
          onOpenPaywall,
          onReplyNotificationsChange,
          onDebugModeChange,
        })}
      />,
    );

    expect(view.getByText('Settings')).toBeTruthy();
    expect(view.getByText('OpenClaw · Relay · Production')).toBeTruthy();
    expect(view.getByText('Preview')).toBeTruthy();
    expect(view.getByTestId('account-settings-row-preview-environment')).toBeTruthy();
    expect(view.getByTestId('account-settings-row-app-icon')).toBeTruthy();
    expect(view.getByTestId('account-settings-row-pro-status-lock-icon')).toBeTruthy();

    fireEvent.press(view.getByTestId('account-settings-back'));
    fireEvent.press(view.getByTestId('account-settings-row-pro-status'));
    expect(onOpenPaywall).toHaveBeenLastCalledWith('generic');
    fireEvent.press(view.getByTestId('account-settings-row-restore-purchases'));
    fireEvent.press(view.getByTestId('account-settings-row-connection-home'));
    fireEvent.press(view.getByTestId('account-settings-row-connection-work'));
    fireEvent.press(view.getByTestId('account-settings-row-add-connection'));
    fireEvent.press(view.getByTestId('account-settings-row-app-icon'));
    fireEvent(view.getByTestId('account-settings-toggle-replyNotifications'), 'valueChange', true);
    fireEvent(view.getByTestId('account-settings-toggle-debugMode'), 'valueChange', false);

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onOpenAction).toHaveBeenCalledWith('restore-purchases');
    expect(onOpenConnection).toHaveBeenCalledWith('home');
    expect(onOpenPaywall).toHaveBeenCalledWith('gatewayConnections', expect.any(Function));
    expect(onOpenPaywall).toHaveBeenCalledWith('appIcons', expect.any(Function));
    const connectionContinuation = onOpenPaywall.mock.calls.find(
      ([reason]) => reason === 'gatewayConnections',
    )?.[1];
    const appIconContinuation = onOpenPaywall.mock.calls.find(
      ([reason]) => reason === 'appIcons',
    )?.[1];
    connectionContinuation?.();
    appIconContinuation?.();
    expect(onOpenConnection).toHaveBeenCalledWith('work');
    expect(onOpenAction).toHaveBeenCalledWith('app-icon');
    expect(onReplyNotificationsChange).toHaveBeenCalledWith(true);
    expect(onDebugModeChange).toHaveBeenCalledWith(false);
  });

  it('renders the dark grouped canvas and capability degradation without backend branches', () => {
    mockTheme = { scheme: 'dark', colors: darkColors };
    const view = render(
      <AccountSettingsScreen
        {...createProps({
          isPro: true,
          capabilities: {
            subscription: false,
            appIcons: false,
            voice: false,
            notifications: false,
            help: false,
            community: false,
            developer: false,
          },
        })}
      />,
    );

    expect(flattenStyle(view.getByTestId('account-settings-screen').props.style)).toEqual(
      expect.objectContaining({ backgroundColor: darkColors.canvasGrouped }),
    );
    expect(view.queryByTestId('account-settings-group-pro')).toBeNull();
    expect(view.queryByTestId('account-settings-row-app-icon')).toBeNull();
    expect(view.queryByTestId('account-settings-group-voice')).toBeNull();
    expect(view.queryByTestId('account-settings-group-notifications')).toBeNull();
    expect(view.queryByTestId('account-settings-group-help')).toBeNull();
    expect(view.queryByTestId('account-settings-group-community')).toBeNull();
    expect(view.queryByTestId('account-settings-group-developer')).toBeNull();
    expect(view.getByTestId('account-settings-group-connections')).toBeTruthy();
    expect(view.getByTestId('account-settings-group-about')).toBeTruthy();
  });

  it('covers loading, empty, error, offline cached, and permission-paywall states', () => {
    const onRetry = jest.fn();
    const onOpenAction = jest.fn();
    const onOpenPaywall = jest.fn();
    const props = createProps({ onRetry, onOpenAction, onOpenPaywall });
    const view = render(<AccountSettingsScreen {...props} status={{ kind: 'loading' }} />);

    expect(view.getByTestId('account-settings-loading')).toBeTruthy();
    expect(view.getAllByLabelText('Loading settings')).toHaveLength(4);
    expect(view.queryByTestId('account-settings-group-connections')).toBeNull();

    view.rerender(<AccountSettingsScreen {...props} status={{ kind: 'empty' }} />);
    expect(view.getByTestId('account-settings-empty')).toBeTruthy();
    fireEvent.press(view.getByTestId('account-settings-empty-action'));
    expect(onOpenAction).toHaveBeenCalledWith('add-connection');

    view.rerender(
      <AccountSettingsScreen {...props} status={{ kind: 'error', code: 'timeout' }} />,
    );
    expect(view.getByText('Settings unavailable · timeout')).toBeTruthy();
    expect(view.getByTestId('account-settings-group-connections')).toBeTruthy();
    fireEvent.press(view.getByTestId('account-settings-error-action'));
    expect(onRetry).toHaveBeenCalledTimes(1);

    view.rerender(<AccountSettingsScreen {...props} status={{ kind: 'offline' }} />);
    expect(view.getByText('Offline · showing cached settings')).toBeTruthy();
    expect(view.getByText('Home')).toBeTruthy();

    view.rerender(
      <AccountSettingsScreen
        {...props}
        status={{ kind: 'permission', reason: 'gatewayConnections' }}
      />,
    );
    fireEvent.press(view.getByTestId('account-settings-permission-action'));
    expect(onOpenPaywall).toHaveBeenCalledWith('gatewayConnections');
  });

  it('renders the state assembled from live connection and permission inputs', () => {
    const status = resolveAccountSettingsRuntimeStatus({
      connectionInitialized: true,
      connectionSwitching: false,
      connectionCount: 2,
      activeConnectionId: 'home',
      activeState: 'ready',
      permissionsLoading: false,
      permissionReason: 'gatewayConnections',
    });
    const view = render(<AccountSettingsScreen {...createProps()} status={status} />);

    expect(view.getByTestId('account-settings-permission')).toBeTruthy();
    expect(view.queryByTestId('account-settings-pro-banner')).toBeNull();
    expect(view.getByTestId('account-settings-group-connections')).toBeTruthy();
  });

  it('uses only the settings title, row, and tail typography tiers on the light surface', () => {
    const view = render(<AccountSettingsScreen {...createProps({ isPro: true })} />);
    expect(flattenStyle(view.getByTestId('account-settings-screen').props.style)).toEqual(
      expect.objectContaining({ backgroundColor: lightColors.canvasGrouped }),
    );
    expect(renderedFontSizes(view)).toEqual([
      FontSize.secondary,
      FontSize.body,
      FontSize.title,
    ]);
  });
});
