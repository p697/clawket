import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { ConnectionDescriptor } from '@clawket/agent-protocol';

import { FontSize } from '../../theme/tokens';
import {
  AccountSettingsSectionScreen,
  type AccountSettingsSectionScreenProps,
} from './AccountSettingsSectionScreen';

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
    Switch: host('Switch'),
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

function flattenStyle(style: unknown): Record<string, unknown> {
  if (!style) return {};
  if (!Array.isArray(style)) return style as Record<string, unknown>;
  return Object.assign({}, ...style.map(flattenStyle));
}

function connection(
  patch: Partial<ConnectionDescriptor> = {},
): ConnectionDescriptor {
  return {
    id: 'studio',
    backendKind: 'hermes',
    transportKind: 'relay',
    label: 'Studio',
    environment: 'preview',
    createdAt: 1,
    isFreeSlot: true,
    ...patch,
  };
}

function createProps(
  patch: Partial<AccountSettingsSectionScreenProps> = {},
): AccountSettingsSectionScreenProps {
  return {
    section: 'connections',
    data: {
      connections: [{
        ...connection(),
        state: 'ready',
        supportsRelayStats: true,
        relayStats: {
          state: 'ready',
          uptimeMs: 3_720_000,
          serverVersion: '2026.9.5',
        },
      }],
      canAddConnection: true,
      labels: {
        theme: 'Dark',
        accent: 'Blue',
        chatAppearance: 'Compact',
        appIcon: 'Light',
        appLanguage: 'English',
        speechLanguage: 'Japanese',
        appVersion: '3.0.0',
        previewEnvironment: 'Preview',
        deviceIdentity: 'Configured',
      },
    },
    onBack: jest.fn(),
    onAction: jest.fn(),
    onOpenPaywall: jest.fn(),
    ...patch,
  };
}

type RenderNode = Readonly<{ props: Readonly<Record<string, unknown>> }>;

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

function renderedBorderWidths(view: ReturnType<typeof render>): ReadonlyArray<unknown> {
  return view.UNSAFE_root
    .findAll((node: RenderNode) => Boolean(node.props.style))
    .map((node: RenderNode) => flattenStyle(node.props.style).borderWidth)
    .filter((value: unknown) => value !== undefined);
}

describe('AccountSettingsSectionScreen', () => {
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

  it('renders connection and Relay runtime descriptors and routes actions', () => {
    const onBack = jest.fn();
    const onAction = jest.fn();
    const view = render(
      <AccountSettingsSectionScreen {...createProps({ onBack, onAction })} />,
    );

    expect(view.getByText('Connections')).toBeTruthy();
    expect(view.getByText('Studio')).toBeTruthy();
    expect(view.getByText('Hermes')).toBeTruthy();
    expect(view.getByText('1h 2m')).toBeTruthy();
    expect(view.getByText('2026.9.5')).toBeTruthy();

    fireEvent.press(view.getByTestId('account-settings-section-back'));
    fireEvent.press(view.getByTestId('account-settings-section-row-studio-open'));
    fireEvent.press(view.getByTestId('account-settings-section-row-studio-reconnect'));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenNthCalledWith(1, {
      action: 'open-connection',
      connectionId: 'studio',
    });
    expect(onAction).toHaveBeenNthCalledWith(2, {
      action: 'reconnect-connection',
      connectionId: 'studio',
    });
  });

  it('uses the existing reply-notification state and callback', () => {
    const onAction = jest.fn();
    const view = render(
      <AccountSettingsSectionScreen
        {...createProps({
          section: 'notifications',
          data: {
            replyNotificationsEnabled: true,
          },
          onAction,
        })}
      />,
    );

    expect(view.getByTestId('account-settings-section-toggle-replyNotifications').props.value).toBe(true);
    fireEvent(
      view.getByTestId('account-settings-section-toggle-replyNotifications'),
      'valueChange',
      false,
    );
    expect(onAction).toHaveBeenCalledWith({
      action: 'set-reply-notifications',
      enabled: false,
    });
  });

  it('renders a dark unsupported capability gate without backend inspection', () => {
    mockTheme = { scheme: 'dark', colors: darkColors };
    const view = render(
      <AccountSettingsSectionScreen
        {...createProps({
          section: 'about',
          capabilities: { about: false },
        })}
      />,
    );

    expect(flattenStyle(view.getByTestId('account-settings-section-screen').props.style)).toEqual(
      expect.objectContaining({ backgroundColor: darkColors.canvasGrouped }),
    );
    expect(view.getByText('About')).toBeTruthy();
    expect(view.getByText('Not supported by this backend')).toBeTruthy();
    expect(view.queryByTestId('account-settings-section-group-about')).toBeNull();
  });

  it('covers loading, empty, error, offline cached, and permission states', () => {
    const onRetry = jest.fn();
    const onOpenPaywall = jest.fn();
    const props = createProps({ onRetry, onOpenPaywall });
    const view = render(
      <AccountSettingsSectionScreen {...props} status={{ kind: 'loading' }} />,
    );

    expect(view.getByTestId('account-settings-section-loading')).toBeTruthy();
    expect(view.getAllByLabelText('Loading settings')).toHaveLength(3);
    expect(view.queryByTestId('account-settings-section-scroll')).toBeNull();

    view.rerender(<AccountSettingsSectionScreen {...props} status={{ kind: 'empty' }} />);
    expect(view.getByText('No settings available')).toBeTruthy();
    fireEvent.press(view.getByTestId('account-settings-section-empty-action'));

    view.rerender(
      <AccountSettingsSectionScreen
        {...props}
        status={{ kind: 'error', code: 'timeout' }}
      />,
    );
    expect(view.getByText('Settings unavailable · timeout')).toBeTruthy();
    fireEvent.press(view.getByTestId('account-settings-section-error-action'));

    view.rerender(<AccountSettingsSectionScreen {...props} status={{ kind: 'offline' }} />);
    expect(view.getByText('Offline · showing cached settings')).toBeTruthy();
    expect(view.getByText('Studio')).toBeTruthy();

    view.rerender(
      <AccountSettingsSectionScreen
        {...props}
        status={{ kind: 'permission', reason: 'gatewayConnections' }}
      />,
    );
    fireEvent.press(view.getByTestId('account-settings-section-permission-action'));
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onOpenPaywall).toHaveBeenCalledWith('gatewayConnections');
  });

  it('keeps Pro locks distinct from disabled capability rows', () => {
    const onOpenPaywall = jest.fn();
    const onAction = jest.fn();
    const view = render(
      <AccountSettingsSectionScreen
        {...createProps({
          section: 'appearance',
          data: { isPro: false },
          onAction,
          onOpenPaywall,
        })}
      />,
    );
    fireEvent.press(view.getByTestId('account-settings-section-row-app-icon'));
    expect(onOpenPaywall).toHaveBeenCalledWith('appIcons');
    expect(onAction).not.toHaveBeenCalled();

    view.rerender(
      <AccountSettingsSectionScreen
        {...createProps({
          section: 'appearance',
          data: { isPro: false },
          capabilities: { appIcons: false },
          onAction,
          onOpenPaywall,
        })}
      />,
    );
    expect(view.getByTestId('account-settings-section-row-app-icon').props.accessibilityState).toEqual({
      disabled: true,
    });
    expect(view.getByText('Unavailable')).toBeTruthy();
  });

  it('keeps the existing voice, about, and developer section scope', () => {
    const onAction = jest.fn();
    const props = createProps({ onAction });
    const view = render(
      <AccountSettingsSectionScreen
        {...props}
        section="voice"
        data={{
          labels: { speechLanguage: 'Japanese' },
        }}
      />,
    );
    expect(view.getByText('Recognition Language')).toBeTruthy();
    expect(view.getByText('Japanese')).toBeTruthy();

    view.rerender(
      <AccountSettingsSectionScreen
        {...props}
        section="about"
      />,
    );
    expect(view.getByText('Open Source Repository')).toBeTruthy();
    expect(view.getByText('Privacy Policy')).toBeTruthy();

    view.rerender(
      <AccountSettingsSectionScreen
        {...props}
        section="developer"
        data={{ debugMode: true }}
      />,
    );
    expect(view.getByText('Design System')).toBeTruthy();
    expect(view.getByText('Clear Cache')).toBeTruthy();
    expect(view.getByText('Reset Device')).toBeTruthy();
  });

  it('stays within the settings typography budget and adds no row borders', () => {
    const view = render(<AccountSettingsSectionScreen {...createProps()} />);
    expect(renderedFontSizes(view)).toEqual([
      FontSize.secondary,
      FontSize.body,
      FontSize.title,
    ]);
    expect(renderedBorderWidths(view)).toEqual([]);
  });
});
