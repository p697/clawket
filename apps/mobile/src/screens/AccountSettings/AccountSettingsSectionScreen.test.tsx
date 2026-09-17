import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import { FontSize } from '../../theme/tokens';
import {
  AccountSettingsSectionScreen,
  type AccountSettingsSectionScreenProps,
} from './AccountSettingsSectionScreen';
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
    Switch: host('Switch'),
    Image: host('Image'),
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

jest.mock('../../contexts/AppContext', () => ({
  useAppContext: () => ({
    speechRecognitionLanguage: 'system',
    onSpeechRecognitionLanguageChange: jest.fn(),
  }),
}));

jest.mock('../../services/app-icon', () => ({
  getCurrentAppIconAsync: jest.fn(async () => 'default'),
  isAppIconChangeSupportedAsync: jest.fn(async () => true),
  setCurrentAppIconAsync: jest.fn(async () => undefined),
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

jest.mock('../../components/ui/Button', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    Button: ({ testID, label, onPress }: {
      testID?: string;
      label: string;
      onPress: () => void;
    }) => ReactRuntime.createElement(
      Pressable,
      { testID, onPress },
      ReactRuntime.createElement(Text, null, label),
    ),
  };
});

jest.mock('../../components/ui/ConfirmationModal', () => {
  const ReactRuntime = require('react');
  return {
    ConfirmationModal: ({
      visible,
      testID,
      title,
      message,
      onClose,
      onConfirm,
    }: {
      visible: boolean;
      testID: string;
      title: string;
      message: string;
      onClose: () => void;
      onConfirm: () => void;
    }) => visible
      ? ReactRuntime.createElement(
        'ConfirmationModal',
        { testID },
        ReactRuntime.createElement('ConfirmationTitle', null, title),
        ReactRuntime.createElement('ConfirmationMessage', null, message),
        ReactRuntime.createElement('ConfirmationCancel', {
          testID: `${testID}-cancel`,
          onPress: onClose,
        }),
        ReactRuntime.createElement('ConfirmationConfirm', {
          testID: `${testID}-confirm`,
          onPress: onConfirm,
        }),
      )
      : null,
  };
});

jest.mock('../../components/ui/Sheet', () => {
  const ReactRuntime = require('react');
  const { Text, View } = require('react-native');
  return {
    Sheet: ({ visible, testID, title, children }: {
      visible: boolean;
      testID?: string;
      title?: string;
      children: React.ReactNode;
    }) => visible
      ? ReactRuntime.createElement(
        View,
        { testID },
        title ? ReactRuntime.createElement(Text, null, title) : null,
        children,
      )
      : null,
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

function createProps(
  patch: Partial<AccountSettingsSectionScreenProps> = {},
): AccountSettingsSectionScreenProps {
  return {
    section: 'about',
    data: {
      canAddConnection: true,
      labels: {
        theme: 'Dark',
        accent: 'Blue',
        chatAppearance: 'Compact',
        appIcon: 'Light',
        speechLanguage: 'Japanese',
        appVersion: '3.0.0',
        previewEnvironment: 'Preview',
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

  it('renders the section title and version row and routes navigation actions', () => {
    const onBack = jest.fn();
    const onAction = jest.fn();
    const view = render(
      <AccountSettingsSectionScreen {...createProps({ onBack, onAction })} />,
    );

    expect(view.getByText('About')).toBeTruthy();
    expect(view.getByText('3.0.0')).toBeTruthy();
    expect(view.queryByText('Connections')).toBeNull();

    fireEvent.press(view.getByTestId('account-settings-section-back'));
    fireEvent.press(view.getByTestId('account-settings-section-row-repository'));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ action: 'repository' });
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

  it('dispatches the production Help to Release Notes navigation action', () => {
    const onAction = jest.fn();
    const view = render(
      <AccountSettingsSectionScreen
        {...createProps({ section: 'help', onAction })}
      />,
    );

    fireEvent.press(view.getByTestId('account-settings-section-row-release-notes'));
    expect(onAction).toHaveBeenCalledWith({ action: 'release-notes' });
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
    expect(view.getByText('Open Source Repository')).toBeTruthy();

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

  it('keeps local section rows available without reporting an unrelated Agent outage', () => {
    const status = resolveAccountSettingsRuntimeStatus({
      connectionInitialized: true,
      connectionSwitching: false,
      connectionCount: 1,
      activeConnectionId: 'studio',
      activeState: 'offline',
      permissionsLoading: false,
    });
    const view = render(<AccountSettingsSectionScreen {...createProps()} status={status} />);

    expect(view.queryByTestId('account-settings-section-offline')).toBeNull();
    expect(view.getByText('Open Source Repository')).toBeTruthy();
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
    expect(onOpenPaywall).toHaveBeenCalledWith('appIcons', expect.any(Function));
    act(() => onOpenPaywall.mock.calls[0]?.[1]?.());
    expect(view.getByTestId('account-preference-sheet')).toBeTruthy();
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

  it('requires app-owned confirmation before clearing cache or resetting the device', () => {
    const onAction = jest.fn();
    const view = render(
      <AccountSettingsSectionScreen
        {...createProps({
          section: 'developer',
          data: { debugMode: true },
          onAction,
        })}
      />,
    );

    fireEvent.press(view.getByTestId('account-settings-section-row-clear-cache'));
    expect(onAction).not.toHaveBeenCalled();
    expect(view.getByTestId('account-settings-clear-cache-confirmation')).toBeTruthy();
    fireEvent.press(view.getByTestId('account-settings-clear-cache-confirmation-cancel'));
    expect(view.queryByTestId('account-settings-clear-cache-confirmation')).toBeNull();

    fireEvent.press(view.getByTestId('account-settings-section-row-clear-cache'));
    fireEvent.press(view.getByTestId('account-settings-clear-cache-confirmation-confirm'));
    expect(onAction).toHaveBeenLastCalledWith({ action: 'clear-cache' });
    expect(view.queryByTestId('account-settings-clear-cache-confirmation')).toBeNull();

    fireEvent.press(view.getByTestId('account-settings-section-row-reset-device'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('account-settings-reset-device-confirmation')).toBeTruthy();
    fireEvent.press(view.getByTestId('account-settings-reset-device-confirmation-confirm'));
    expect(onAction).toHaveBeenLastCalledWith({ action: 'reset-device' });
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
