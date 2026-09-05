import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { FontSize, Radius } from '../../theme/tokens';
import { OnboardingScreen, type OnboardingScreenProps } from './OnboardingScreen';

const mockLightColors = {
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

const mockDarkColors = {
  ...mockLightColors,
  canvas: '#0C0C0D',
  surface: '#1A1A1D',
  surfaceFloating: '#222225',
  ink: '#F3F3F5',
  inkSecondary: '#9A9AA3',
  inkTertiary: '#6A6A73',
  line: '#2A2A2F',
};

let mockTheme = { scheme: 'light' as 'light' | 'dark', colors: mockLightColors };

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
    Pressable: host('Pressable'),
    ScrollView: host('ScrollView'),
    Text: host('Text'),
    TextInput: host('TextInput'),
    View: host('View'),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => flattenStyle(style),
      hairlineWidth: 1,
    },
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('lucide-react-native', () => {
  const ReactRuntime = require('react');
  const icon = ({ children, ...props }: Record<string, unknown>) => ReactRuntime.createElement('Icon', props, children);
  return new Proxy({}, { get: () => icon });
});

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

jest.mock('../../components/ui/Button', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    Button: ({ testID, label, onPress, disabled, loading }: {
      testID?: string;
      label: string;
      onPress: () => void;
      disabled?: boolean;
      loading?: boolean;
    }) => ReactRuntime.createElement(
      Pressable,
      { testID, onPress, disabled, accessibilityState: { disabled, busy: loading } },
      ReactRuntime.createElement(Text, null, label),
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

jest.mock('../../components/ui/FormTextInput', () => {
  const ReactRuntime = require('react');
  const { TextInput } = require('react-native');
  return {
    FormTextInput: (props: Record<string, unknown>) => ReactRuntime.createElement(TextInput, props),
  };
});

jest.mock('../../components/ui/Skeleton', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    Skeleton: (props: Record<string, unknown>) => ReactRuntime.createElement(View, props),
  };
});

function flattenStyle(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (!Array.isArray(value)) return value as Record<string, unknown>;
  return Object.assign({}, ...value.map(flattenStyle));
}

function createProps(overrides: Partial<OnboardingScreenProps> = {}): OnboardingScreenProps {
  return {
    onSubmitPairing: jest.fn(),
    onScanQr: jest.fn(),
    onOpenYouMind: jest.fn(),
    onOpenDocs: jest.fn(),
    ...overrides,
  };
}

describe('OnboardingScreen', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockTheme = { scheme: 'light', colors: mockLightColors };
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders the first-launch premise and keeps the command under the selected backend', () => {
    const view = render(<OnboardingScreen {...createProps()} />);

    expect(view.getByText('Connect Clawket to your agent')).toBeTruthy();
    expect(view.getByText('You need a computer running OpenClaw or Hermes')).toBeTruthy();
    expect(view.getByText('npx @p697/clawket pair')).toBeTruthy();
    expect(view.getByTestId('onboarding-backend-openclaw').props.accessibilityState).toEqual({ selected: true });
    expect(view.getByTestId('onboarding-backend-hermes').props.accessibilityState).toEqual({ selected: false });
    expect(view.queryByTestId('onboarding-doc-options')).toBeNull();
  });

  it('submits normalized manual codes with separate Hermes and Relay identities', () => {
    const onSubmitPairing = jest.fn();
    const view = render(<OnboardingScreen {...createProps({ onSubmitPairing })} />);

    fireEvent.press(view.getByTestId('onboarding-backend-hermes'));
    fireEvent.changeText(view.getByTestId('onboarding-pairing-code'), 'ab1c-2o34');
    expect(view.getByTestId('onboarding-pairing-code').props.value).toBe('ABC 234');
    fireEvent.press(view.getByTestId('onboarding-connect'));

    expect(onSubmitPairing).toHaveBeenCalledWith({
      backendKind: 'hermes',
      transportKind: 'relay',
      code: 'ABC234',
    });
  });

  it('shares one synchronous readiness guard across Enter, button, and input state', () => {
    const onSubmitPairing = jest.fn(() => new Promise<void>(() => undefined));
    const props = createProps({ onSubmitPairing });
    const view = render(<OnboardingScreen {...props} />);
    const input = view.getByTestId('onboarding-pairing-code');

    fireEvent(input, 'submitEditing');
    expect(onSubmitPairing).not.toHaveBeenCalled();

    fireEvent.changeText(input, '123456');
    fireEvent(input, 'submitEditing');
    fireEvent.press(view.getByTestId('onboarding-connect'));
    expect(onSubmitPairing).toHaveBeenCalledTimes(1);

    view.rerender(
      <OnboardingScreen
        {...props}
        status={{ kind: 'connecting', phase: 'relay_connected' }}
      />,
    );
    expect(view.getByTestId('onboarding-pairing-code').props.editable).toBe(false);
    fireEvent(view.getByTestId('onboarding-pairing-code'), 'submitEditing');
    fireEvent.press(view.getByTestId('onboarding-connect'));
    expect(onSubmitPairing).toHaveBeenCalledTimes(1);
  });

  it('accepts a pairing code through the injected clipboard callback', async () => {
    const onSubmitPairing = jest.fn();
    const view = render(
      <OnboardingScreen
        {...createProps({
          onSubmitPairing,
          onPastePairingCode: jest.fn(async () => '98-7654'),
        })}
      />,
    );

    fireEvent.press(view.getByTestId('onboarding-paste-code'));
    await waitFor(() => {
      expect(view.getByTestId('onboarding-pairing-code').props.value).toBe('987 654');
    });
    fireEvent.press(view.getByTestId('onboarding-connect'));
    expect(onSubmitPairing).toHaveBeenCalledWith(expect.objectContaining({ code: '987654' }));
  });

  it('renders and copies an environment-specific pairing command', () => {
    const onCopyCommand = jest.fn();
    const view = render(
      <OnboardingScreen
        {...createProps({
          environment: 'preview',
          pairingCommand: 'npx @p697/clawket pair --preview',
          onCopyCommand,
        })}
      />,
    );

    expect(view.getByText('npx @p697/clawket pair --preview')).toBeTruthy();
    fireEvent.press(view.getByTestId('onboarding-copy-command'));
    expect(onCopyCommand).toHaveBeenCalledWith('npx @p697/clawket pair --preview');
  });

  it('routes QR, YouMind, and official documentation actions through callbacks', () => {
    const onScanQr = jest.fn();
    const onOpenYouMind = jest.fn();
    const onOpenDocs = jest.fn();
    const view = render(
      <OnboardingScreen {...createProps({ onScanQr, onOpenYouMind, onOpenDocs })} />,
    );

    fireEvent.press(view.getByTestId('onboarding-backend-hermes'));
    fireEvent.press(view.getByTestId('onboarding-scan-qr'));
    fireEvent.press(view.getByTestId('onboarding-youmind'));
    fireEvent.press(view.getByTestId('onboarding-docs-toggle'));
    fireEvent.press(view.getByTestId('onboarding-doc-openclaw'));
    fireEvent.press(view.getByTestId('onboarding-doc-hermes'));

    expect(onScanQr).toHaveBeenCalledWith('hermes');
    expect(onOpenYouMind).toHaveBeenCalledTimes(1);
    expect(onOpenDocs.mock.calls).toEqual([['openclaw'], ['hermes']]);
  });

  it('renders loading, offline, error, and connecting states without replacing cached form content', () => {
    const loading = render(
      <OnboardingScreen {...createProps({ status: { kind: 'loading' } })} />,
    );
    expect(loading.getByTestId('onboarding-loading')).toBeTruthy();
    expect(loading.getByTestId('onboarding-skeleton-title')).toBeTruthy();
    loading.unmount();

    const onRetry = jest.fn();
    const offline = render(
      <OnboardingScreen {...createProps({ status: { kind: 'offline' }, onRetry })} />,
    );
    expect(offline.getByTestId('onboarding-offline')).toBeTruthy();
    expect(offline.getByTestId('onboarding-backends')).toBeTruthy();
    fireEvent.press(offline.getByTestId('onboarding-offline-action'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    offline.unmount();

    const onErrorAction = jest.fn();
    const error = render(
      <OnboardingScreen
        {...createProps({
          initialBackend: 'hermes',
          status: { kind: 'error', code: 'gateway_offline' },
          onErrorAction,
        })}
      />,
    );
    expect(error.getByText('Hermes is not responding')).toBeTruthy();
    fireEvent.press(error.getByTestId('onboarding-error-action'));
    expect(onErrorAction).toHaveBeenCalledWith('gateway_offline');
    error.unmount();

    const connecting = render(
      <OnboardingScreen
        {...createProps({ status: { kind: 'connecting', phase: 'waiting_bridge' } })}
      />,
    );
    expect(connecting.getByText('Connecting through Relay…')).toBeTruthy();
    expect(connecting.getByTestId('onboarding-progress')).toBeTruthy();
    expect(connecting.getByTestId('onboarding-connect').props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });
  });

  it('uses the same canonical token hierarchy in light and dark schemes', () => {
    const light = render(<OnboardingScreen {...createProps({ environment: 'preview' })} />);
    expect(flattenStyle(light.getByTestId('onboarding-screen').props.style).backgroundColor).toBe(mockLightColors.canvas);
    expect(flattenStyle(light.getByTestId('onboarding-title').props.style).fontSize).toBe(FontSize.display);
    expect(flattenStyle(light.getByTestId('onboarding-subtitle').props.style).fontSize).toBe(FontSize.secondary);
    const choiceStyle = flattenStyle(light.getByTestId('onboarding-backend-openclaw').props.style);
    expect(choiceStyle.borderRadius).toBe(Radius.card);
    expect(choiceStyle).not.toHaveProperty('borderWidth');
    expect(light.getByTestId('onboarding-preview')).toBeTruthy();
    light.unmount();

    mockTheme = { scheme: 'dark', colors: mockDarkColors };
    const dark = render(<OnboardingScreen {...createProps()} />);
    expect(flattenStyle(dark.getByTestId('onboarding-screen').props.style).backgroundColor).toBe(mockDarkColors.canvas);
    expect(flattenStyle(dark.getByTestId('onboarding-title').props.style).color).toBe(mockDarkColors.ink);
  });

  it('reports a page view once per mount', () => {
    const first = jest.fn();
    const second = jest.fn();
    const view = render(<OnboardingScreen {...createProps({ onViewed: first })} />);
    view.rerender(<OnboardingScreen {...createProps({ onViewed: second })} />);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });
});
