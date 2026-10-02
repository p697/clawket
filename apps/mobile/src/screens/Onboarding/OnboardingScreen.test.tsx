import React from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { ControlSize, FontSize, Motion, Radius, Space } from '../../theme/tokens';
import { ChoiceRow } from '../../components/ui/SetupPrimitives';
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

let mockIPad = false;
jest.mock('../../utils/platform', () => ({ get isIPad() { return mockIPad; } }));

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
    Platform: { OS: 'ios' },
    Keyboard: { dismiss: jest.fn() },
    useWindowDimensions: () => ({ width: 402, height: 874, scale: 3, fontScale: 1 }),
    Pressable: host('Pressable'),
    ScrollView: host('ScrollView'),
    Text: host('Text'),
    TextInput: host('TextInput'),
    Image: host('Image'),
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

jest.mock('react-native-keyboard-controller', () => ({
  KeyboardAvoidingView: require('react-native').View,
  useKeyboardHandler: jest.fn(),
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

jest.mock('../../components/ui/Sheet', () => ({
  Sheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) => visible ? <>{children}</> : null,
}));

jest.mock('@gorhom/bottom-sheet', () => ({
  BottomSheetScrollView: require('react-native').ScrollView,
}));

jest.mock('../../components/ui/LoadingState', () => {
  const ReactRuntime = require('react');
  const { Pressable, View, Text } = require('react-native');
  return {
    LoadingState: ({ testID, phase, message, headline, action }: {
      testID: string;
      phase: string;
      message: string;
      headline?: boolean;
      action?: { label: string; onPress: () => void };
    }) => ReactRuntime.createElement(
      View,
      { testID, phase, headline },
      phase === 'wait' ? ReactRuntime.createElement(Text, null, message) : null,
      action
        ? ReactRuntime.createElement(Pressable, { testID: `${testID}-action`, onPress: action.onPress }, ReactRuntime.createElement(Text, null, action.label))
        : null,
    ),
  };
});

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
    Button: ({ testID, label, onPress, disabled, loading, accessibilityLabel }: {
      testID?: string;
      label: string;
      accessibilityLabel?: string;
      onPress: () => void;
      disabled?: boolean;
      loading?: boolean;
    }) => ReactRuntime.createElement(
      Pressable,
      { testID, onPress, disabled, accessibilityLabel, accessibilityState: { disabled, busy: loading } },
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
    FormTextInput: ({ trailing, ...props }: Record<string, unknown>) => ReactRuntime.createElement(ReactRuntime.Fragment, null, ReactRuntime.createElement(TextInput, props), trailing),
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
    initialBackend: 'openclaw',
    onSubmitPairing: jest.fn(),
    onScanQr: jest.fn(),
    onOpenWebsite: jest.fn(),
    onCopyAgentPrompt: jest.fn(),
    ...overrides,
  };
}

describe('OnboardingScreen', () => {
  it.each([
    ['backend_mismatch', 'This QR code belongs to another backend. Scan the QR code for this backend.'],
    ['invalid_backend', 'This QR code does not contain valid connection info.'],
    ['preview_requires_debug_mode', 'Enable Debug Mode before pairing with the Preview environment.'],
    ['official_environment_mismatch', 'Pairing environment does not match. Use the command shown on this page.'],
    ['saved_connection_mismatch', 'Could not save this connection. Try again.'],
  ] as const)('shows actionable feedback for %s without a capability error', (pairingReason, message) => {
    const view = render(<OnboardingScreen {...createProps({ status: { kind: 'error', code: 'unsupported', pairingReason } })} />);
    expect(view.getByText(message)).toBeTruthy();
    expect(view.queryByText('Not supported by this backend')).toBeNull();
  });
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockIPad = false;
    mockTheme = { scheme: 'light', colors: mockLightColors };
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it.each(['openclaw', 'hermes', 'codex', 'claude-code', 'pi'] as const)('does not claim a completed transport before %s is ready', (initialBackend) => {
    const props = createProps({ initialBackend });
    const view = render(<OnboardingScreen {...props} status={{ kind: 'connecting', phase: 'relay_connected' }} />);
    for (const phase of ['relay_connected', 'waiting_bridge'] as const) {
      view.rerender(<OnboardingScreen {...props} status={{ kind: 'connecting', phase }} />);
      expect(view.getByText('common:Connecting')).toBeTruthy();
      expect(view.getByTestId('onboarding-connecting-cat').props.phase).toBe('wait');
      expect(view.queryByText('Relay connected')).toBeNull();
      expect(view.queryByText('Ready')).toBeNull();
    }
    // Success is the cat's exit while the app moves on; the stage adds no label of its own.
    view.rerender(<OnboardingScreen {...props} status={{ kind: 'connecting', phase: 'ready' }} />);
    expect(view.getByTestId('onboarding-connecting-cat').props.phase).toBe('ready');
    expect(view.queryByText('common:Connecting')).toBeNull();
    expect(view.queryByText('Ready')).toBeNull();
  });

  it('covers the spent form with the connecting stage until the pairing ends', () => {
    jest.useFakeTimers();
    try {
      const onClose = jest.fn();
      const onRetry = jest.fn();
      const props = createProps({ initialBackend: 'codex', onClose, onRetry });
      const view = render(<OnboardingScreen {...props} />);
      const hidden = { includeHiddenElements: true };
      const form = () => view.getByTestId('onboarding-keyboard-avoiding', hidden);
      expect(view.queryByTestId('onboarding-progress')).toBeNull();
      expect(form().props.accessibilityElementsHidden).toBe(false);
      fireEvent.press(view.getByTestId('onboarding-show-code'));
      fireEvent.changeText(view.getByTestId('onboarding-pairing-code'), '123456');

      view.rerender(<OnboardingScreen {...props} status={{ kind: 'connecting', phase: 'relay_connected' }} />);
      expect(view.getByTestId('onboarding-progress').props.pointerEvents).toBe('auto');
      expect(view.getByTestId('onboarding-connecting-cat').props.headline).toBe(true);
      expect(view.getByText('common:Connecting')).toBeTruthy();
      // The form stays mounted underneath for a failure to return to, hidden from assistive technology.
      expect(view.queryByTestId('onboarding-pairing-code')).toBeNull();
      expect(view.getByTestId('onboarding-pairing-code', hidden)).toBeTruthy();
      expect(form().props.accessibilityElementsHidden).toBe(true);
      expect(form().props.importantForAccessibility).toBe('no-hide-descendants');
      // Back leaves the flow; it never returns to the chooser underneath the stage.
      fireEvent.press(view.getByTestId('onboarding-close'));
      expect(onClose).toHaveBeenCalledTimes(1);

      // Automatic retries keep the offline label and its manual reconnect until the pairing ends.
      view.rerender(<OnboardingScreen {...props} status={{ kind: 'offline' }} />);
      expect(view.getByText('Offline · reconnecting')).toBeTruthy();
      view.rerender(<OnboardingScreen {...props} status={{ kind: 'connecting', phase: 'waiting_bridge' }} />);
      expect(view.getByText('Offline · reconnecting')).toBeTruthy();
      expect(view.queryByText('common:Connecting')).toBeNull();
      fireEvent.press(view.getByTestId('onboarding-connecting-cat-action'));
      expect(onRetry).toHaveBeenCalledTimes(1);

      // A failure hands the page back at once and fades the stage out over the form and its error.
      view.rerender(<OnboardingScreen {...props} status={{ kind: 'error', code: 'timeout' }} />);
      expect(view.getByTestId('onboarding-progress').props.pointerEvents).toBe('none');
      expect(view.getByText('Offline · reconnecting')).toBeTruthy();
      expect(view.getByText('Connection timed out')).toBeTruthy();
      expect(form().props.accessibilityElementsHidden).toBe(false);
      expect(view.getByTestId('onboarding-pairing-code').props.editable).toBe(true);
      act(() => { jest.advanceTimersByTime(Motion.duration.normal); });
      expect(view.queryByTestId('onboarding-progress')).toBeNull();

      // The next attempt starts over with the connecting label.
      view.rerender(<OnboardingScreen {...props} status={{ kind: 'connecting', phase: 'relay_connected' }} />);
      expect(view.getByText('common:Connecting')).toBeTruthy();
      expect(view.queryByTestId('onboarding-connecting-cat-action')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('separates backend selection from pairing and returns without retaining a stale code', () => {
    const view = render(<OnboardingScreen {...createProps({ initialBackend: undefined })} />);
    expect(view.getByText('Connect your agent')).toBeTruthy();
    expect(view.queryByTestId('onboarding-pairing-code')).toBeNull();
    fireEvent.press(view.getByTestId('onboarding-backend-openclaw'));
    expect(view.getByTestId('onboarding-agent-prompt')).toBeTruthy();
    fireEvent.changeText(view.getByTestId('onboarding-pairing-code'), '123456');
    fireEvent.press(view.getByTestId('onboarding-close'));
    fireEvent.press(view.getByTestId('onboarding-backend-hermes'));
    expect(view.getByTestId('onboarding-pairing-code').props.value).toBe('');
  });

  it('submits normalized manual codes with separate Hermes and Relay identities', () => {
    const onSubmitPairing = jest.fn();
    const view = render(<OnboardingScreen {...createProps({ onSubmitPairing, initialBackend: undefined })} />);

    fireEvent.press(view.getByTestId('onboarding-backend-hermes'));
    fireEvent.changeText(view.getByTestId('onboarding-pairing-code'), 'abc-234');
    expect(view.getByTestId('onboarding-pairing-code').props.value).toBe('ABC 234');
    fireEvent.press(view.getByTestId('onboarding-connect'));

    expect(onSubmitPairing).toHaveBeenCalledWith({
      backendKind: 'hermes',
      transportKind: 'relay',
      code: 'ABC234',
    });
  });

  it('offers local models in every environment and submits all six digits including zero and one', () => {
    const onSubmitPairing = jest.fn();
    const onOpenWebsite = jest.fn();
    // Production, no Debug Mode: the local model row is a first-class backend (owner decision 2026-09-19).
    const view = render(<OnboardingScreen {...createProps({ initialBackend: undefined, onSubmitPairing, onOpenWebsite })} />);
    // Chooser order (owner decision 2026-09-26): products first, the user's own model server last.
    expect(view.getByTestId('onboarding-backends').props.children.map((cell: { props: { children: { props: { testID: string } } } }) => cell.props.children.props.testID))
      .toEqual(['onboarding-backend-openclaw', 'onboarding-backend-hermes', 'onboarding-backend-codex', 'onboarding-backend-claude-code', 'onboarding-backend-pi', 'onboarding-backend-local-model']);
    // A local model is a server the user already runs; "No agent yet?" only lists products to install.
    fireEvent.press(view.getByTestId('onboarding-docs-toggle'));
    expect(view.getByTestId('onboarding-doc-options').props.children.map((link: { props: { testID: string } }) => link.props.testID))
      .toEqual(['onboarding-doc-openclaw', 'onboarding-doc-hermes', 'onboarding-doc-codex', 'onboarding-doc-claude-code', 'onboarding-doc-pi']);
    expect(view.queryByTestId('onboarding-doc-local-model')).toBeNull();
    fireEvent.press(view.getByTestId('onboarding-backend-local-model'));
    expect(view.queryByTestId('onboarding-agent-prompt')).toBeNull();
    expect(view.queryByTestId('onboarding-pairing-method-terminal')).toBeNull();
    expect(view.getByText('npx @p697/clawket@latest pair --backend local-model')).toBeTruthy();
    fireEvent.press(view.getByTestId('onboarding-show-code'));
    fireEvent.changeText(view.getByTestId('onboarding-pairing-code'), '001234');
    fireEvent.press(view.getByTestId('onboarding-connect'));
    expect(onSubmitPairing).toHaveBeenCalledWith({ backendKind: 'local-model', transportKind: 'relay', code: '001234' });
  });

  it('lists the supported local model servers and adapts the command and hint to the chosen one', () => {
    const onCopyCommand = jest.fn();
    const view = render(<OnboardingScreen {...createProps({ initialBackend: 'local-model', onCopyCommand })} />);
    const engineTabs = view.getByTestId('onboarding-local-model-engine');
    expect(engineTabs).toBeTruthy();
    expect(view.getByTestId('onboarding-local-model-engine-llamacpp').props.accessibilityState).toEqual({ selected: true });
    expect(view.getByTestId('onboarding-command-hint').props.children).toBe('Start llama-server first (default port 8080), then run this in Terminal.');
    expect(view.getByText('npx @p697/clawket@latest pair --backend local-model')).toBeTruthy();

    fireEvent.press(view.getByTestId('onboarding-local-model-engine-ollama'));
    expect(view.getByTestId('onboarding-command-hint').props.children).toBe('Make sure Ollama is running, then run this in Terminal.');
    const ollamaCommand = 'npx @p697/clawket@latest pair --backend local-model --engine ollama --base-url http://127.0.0.1:11434';
    expect(view.getByText(ollamaCommand)).toBeTruthy();
    fireEvent.press(view.getByTestId('onboarding-copy-command'));
    expect(onCopyCommand).toHaveBeenCalledWith(ollamaCommand);

    fireEvent.press(view.getByTestId('onboarding-local-model-engine-openai-compatible'));
    expect(view.getByTestId('onboarding-command-hint').props.children).toContain('OpenAI-compatible server');
    expect(view.getByText('npx @p697/clawket@latest pair --backend local-model --engine openai-compatible --base-url http://127.0.0.1:1234')).toBeTruthy();

    // OpenClaw keeps its generic terminal hint and never shows the engine switch.
    view.rerender(<OnboardingScreen {...createProps({ initialBackend: 'openclaw', onCopyCommand, onCopyAgentPrompt: undefined })} />);
    expect(view.queryByTestId('onboarding-local-model-engine')).toBeNull();
    expect(view.getByTestId('onboarding-command-hint').props.children).toBe('Open Terminal and run this command.');
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
    // The connecting stage covers the form; underneath it the controls are locked as well.
    const hidden = { includeHiddenElements: true };
    expect(view.getByTestId('onboarding-pairing-code', hidden).props.editable).toBe(false);
    fireEvent(view.getByTestId('onboarding-pairing-code', hidden), 'submitEditing');
    fireEvent.press(view.getByTestId('onboarding-connect', hidden));
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

  it('anchors the pairing code and Connect action for keyboard reveal without the number-pad accessory bar', () => {
    const { useKeyboardHandler } = require('react-native-keyboard-controller') as { useKeyboardHandler: jest.Mock };
    useKeyboardHandler.mockClear();
    const view = render(<OnboardingScreen {...createProps()} />);
    const scroll = view.getByTestId('onboarding-scroll');
    expect(scroll.props.automaticallyAdjustKeyboardInsets).toBe(false);
    expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
    const anchor = view.getByTestId('onboarding-keyboard-anchor');
    expect(anchor.findByProps({ testID: 'onboarding-pairing-code' })).toBeTruthy();
    expect(anchor.findByProps({ testID: 'onboarding-connect' })).toBeTruthy();
    // OpenClaw's number pad relies on the visible Connect button; Hermes keeps the native Go key.
    expect(view.getByTestId('onboarding-pairing-code').props.returnKeyType).toBeUndefined();
    expect(useKeyboardHandler).toHaveBeenCalledTimes(1);
    const handler = useKeyboardHandler.mock.calls[0][0];
    expect(typeof handler.onStart).toBe('function');
    expect(typeof handler.onMove).toBe('function');
    expect(typeof handler.onEnd).toBe('function');

    const hermes = render(<OnboardingScreen {...createProps({ initialBackend: 'hermes' })} />);
    expect(hermes.getByTestId('onboarding-pairing-code').props.returnKeyType).toBe('go');
  });

  it('lifts the pairing code and Connect action above the Android keyboard too', () => {
    // KeyboardProvider draws edge to edge, so Android's adjustResize no longer resizes the window
    // and the number pad covered Connect (Samsung A56, Android 16).
    const platform = (require('react-native') as { Platform: { OS: string } }).Platform;
    platform.OS = 'android';
    try {
      const view = render(<OnboardingScreen {...createProps()} />);
      const avoiding = view.getByTestId('onboarding-keyboard-avoiding');
      expect(avoiding.props.enabled).toBe(true);
      expect(avoiding.props.behavior).toBe('padding');
      expect(view.getByTestId('onboarding-scroll').props.automaticallyAdjustKeyboardInsets).toBe(false);
      // Hermes codes are Latin letters and digits: a plain Latin keyboard, not the system IME.
      const hermes = render(<OnboardingScreen {...createProps({ initialBackend: 'hermes' })} />);
      expect(hermes.getByTestId('onboarding-pairing-code').props.keyboardType).toBe('visible-password');
      expect(hermes.getByTestId('onboarding-pairing-code').props.returnKeyType).toBe('go');
      expect(view.getByTestId('onboarding-pairing-code').props.keyboardType).toBe('number-pad');
    } finally {
      platform.OS = 'ios';
    }
  });

  it('tells Pi users to run the command from the project folder it pairs', () => {
    const pi = render(<OnboardingScreen {...createProps({ initialBackend: 'pi', onCopyAgentPrompt: undefined })} />);
    expect(pi.getByTestId('onboarding-command-hint').props.children).toBe('Open Terminal in your project folder and run this command.');
    const codex = render(<OnboardingScreen {...createProps({ initialBackend: 'codex', onCopyAgentPrompt: undefined })} />);
    expect(codex.getByTestId('onboarding-command-hint').props.children).toBe('Open Terminal and run this command.');
  });

  it.each(['openclaw', 'hermes'] as const)('uses one native keyboard-avoidance owner on iPad for %s pairing', (backend) => {
    mockIPad = true;
    const onSubmitPairing = jest.fn();
    const view = render(<OnboardingScreen {...createProps({ initialBackend: backend, onSubmitPairing })} />);
    const scroll = view.getByTestId('onboarding-scroll');
    expect(scroll.props.automaticallyAdjustKeyboardInsets).toBe(true);
    expect(scroll.props.keyboardDismissMode).toBe('on-drag');
    expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
    expect(view.getByTestId('onboarding-keyboard-avoiding').props.enabled).toBe(false);
    expect(view.getByTestId('onboarding-pairing-code').props.keyboardType).toBe('ascii-capable');
    expect(view.getByTestId('onboarding-pairing-code').props.returnKeyType).toBe('go');
    fireEvent(view.getByTestId('onboarding-pairing-code'), 'focus');
    const code = backend === 'hermes' ? 'ABC234' : '123456';
    fireEvent.changeText(view.getByTestId('onboarding-pairing-code'), code);
    expect(view.getByTestId('onboarding-connect').props.disabled).toBe(false);
    fireEvent.press(view.getByTestId('onboarding-connect'));
    expect(onSubmitPairing).toHaveBeenCalledWith(expect.objectContaining({ code }));
  });

  it('renders and copies an environment-specific pairing command, confirming briefly', async () => {
    jest.useFakeTimers();
    try {
      const onCopyCommand = jest.fn().mockResolvedValue(undefined);
      const view = render(
        <OnboardingScreen
          {...createProps({
            environment: 'preview',
            pairingCommand: 'npx @p697/clawket pair --preview',
            onCopyCommand,
            onCopyAgentPrompt: undefined,
          })}
        />,
      );

      // Without an agent handler the step offers only the terminal path, with no method switch.
      expect(view.queryByTestId('onboarding-pairing-method-terminal')).toBeNull();
      expect(view.queryByTestId('onboarding-pairing-method-agent')).toBeNull();
      expect(view.getByText('npx @p697/clawket pair --preview --backend openclaw')).toBeTruthy();
      fireEvent.press(view.getByTestId('onboarding-copy-command'));
      expect(onCopyCommand).toHaveBeenCalledWith('npx @p697/clawket pair --preview --backend openclaw');
      await act(async () => { await Promise.resolve(); });
      expect(view.getByTestId('onboarding-copy-command').props.accessibilityLabel).toBe('Copied');
      act(() => { jest.advanceTimersByTime(1500); });
      expect(view.getByTestId('onboarding-copy-command').props.accessibilityLabel).toBe('Copy command');
    } finally {
      jest.useRealTimers();
    }
  });

  it('leads with the agent message, copies it with a transient confirmation, and keeps the terminal path one switch away', async () => {
    jest.useFakeTimers();
    try {
      const onCopyAgentPrompt = jest.fn().mockResolvedValue(undefined);
      const onCopyCommand = jest.fn().mockResolvedValue(undefined);
      const view = render(
        <OnboardingScreen
          {...createProps({
            initialBackend: 'hermes',
            pairingCommand: 'npx @p697/clawket pair --preview',
            onCopyAgentPrompt,
            onCopyCommand,
          })}
        />,
      );

      // The agent path leads step 01; its terminal alternative stays beside the step title.
      expect(view.getByText('Send this message to your agent')).toBeTruthy();
      expect(view.getByText('Enter the code it replies with')).toBeTruthy();
      expect(view.queryByTestId('onboarding-pairing-method-agent')).toBeNull();
      expect(view.queryByTestId('onboarding-command')).toBeNull();
      expect(view.queryByTestId('onboarding-agent-prompt-sent')).toBeNull();
      // The message is folded to its first lines until the user asks to read it.
      const preview = view.getByTestId('onboarding-agent-prompt');
      expect(preview.props.accessibilityState).toEqual({ expanded: false });
      const promptText = () => view.getByTestId('onboarding-agent-prompt-text');
      expect(promptText().props.numberOfLines).toBe(2);
      fireEvent.press(preview);
      expect(view.getByTestId('onboarding-agent-prompt').props.accessibilityState).toEqual({ expanded: true });
      expect(promptText().props.numberOfLines).toBeUndefined();
      // The test translator returns raw keys; interpolation is covered in model.test.ts.
      const prompt = promptText().props.children as string;
      expect(prompt).toContain('{{pairCommand}}');

      fireEvent.press(view.getByTestId('onboarding-copy-agent-prompt'));
      expect(onCopyAgentPrompt).toHaveBeenCalledWith(prompt, 'hermes');
      await act(async () => { await Promise.resolve(); });
      expect(view.getByText('Copied')).toBeTruthy();
      act(() => { jest.advanceTimersByTime(1500); });
      expect(view.queryByText('Copied')).toBeNull();
      expect(view.getByText('Copy this message')).toBeTruthy();
      // Clipboard success is not proof that the agent ran the command.
      expect(view.queryByTestId('onboarding-agent-prompt-sent')).toBeNull();

      fireEvent.press(view.getByTestId('onboarding-pairing-method-terminal'));
      expect(view.queryByTestId('onboarding-agent-prompt')).toBeNull();
      expect(view.getByText('Run in your computer terminal')).toBeTruthy();
      expect(view.getByText('Scan the QR code in your terminal')).toBeTruthy();
      expect(view.getByText('npx @p697/clawket pair --preview --backend hermes')).toBeTruthy();
      fireEvent.press(view.getByTestId('onboarding-copy-command'));
      expect(onCopyCommand).toHaveBeenCalledWith('npx @p697/clawket pair --preview --backend hermes');
      fireEvent.press(view.getByTestId('onboarding-pairing-method-agent'));
      expect(view.getByTestId('onboarding-agent-prompt')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('offers a prominent generic scan on the chooser only', () => {
    const onScanAnyQr = jest.fn();
    const view = render(<OnboardingScreen {...createProps({ onScanAnyQr, initialBackend: undefined })} />);

    fireEvent.press(view.getByTestId('onboarding-scan-any-qr'));
    expect(onScanAnyQr).toHaveBeenCalledTimes(1);

    // A backend's own step keeps its footer scan; the header scan leaves with the chooser.
    fireEvent.press(view.getByTestId('onboarding-backend-hermes'));
    expect(view.queryByTestId('onboarding-scan-any-qr')).toBeNull();
    expect(view.getByTestId('onboarding-scan-qr')).toBeTruthy();
  });

  it.each(['codex', 'claude-code', 'pi', 'local-model'] as const)('leads %s with a terminal command and scanner, revealing codes on request', (backend) => {
    const onScanQr = jest.fn();
    const onSubmitPairing = jest.fn();
    const view = render(<OnboardingScreen {...createProps({ initialBackend: backend, onScanQr, onSubmitPairing })} />);
    expect(view.queryByTestId('onboarding-agent-prompt')).toBeNull();
    expect(view.getByText(`npx @p697/clawket@latest pair --backend ${backend}`)).toBeTruthy();
    expect(view.queryByTestId('onboarding-pairing-code')).toBeNull();
    expect(view.getByTestId('onboarding-scan-qr')).toBeTruthy();
    fireEvent.press(view.getByTestId('onboarding-scan-qr'));
    expect(onScanQr).toHaveBeenCalledWith(backend);
    fireEvent.press(view.getByTestId('onboarding-show-code'));
    fireEvent.changeText(view.getByTestId('onboarding-pairing-code'), '001234');
    fireEvent.press(view.getByTestId('onboarding-connect'));
    expect(onSubmitPairing).toHaveBeenCalledWith({ backendKind: backend, transportKind: 'relay', code: '001234' });
  });

  it('restores each backend default after switching platforms and preserves a draft across pairing methods', () => {
    const view = render(<OnboardingScreen {...createProps({ initialBackend: undefined })} />);
    fireEvent.press(view.getByTestId('onboarding-backend-codex'));
    fireEvent.press(view.getByTestId('onboarding-show-code'));
    fireEvent.changeText(view.getByTestId('onboarding-pairing-code'), '123');
    fireEvent.press(view.getByTestId('onboarding-pairing-method-agent'));
    expect(view.getByTestId('onboarding-pairing-code').props.value).toBe('123');
    fireEvent.press(view.getByTestId('onboarding-pairing-method-terminal'));
    expect(view.getByTestId('onboarding-pairing-code').props.value).toBe('123');
    fireEvent.press(view.getByTestId('onboarding-change-platform'));
    fireEvent.press(view.getByTestId('onboarding-backend-hermes'));
    expect(view.getByTestId('onboarding-agent-prompt')).toBeTruthy();
    expect(view.getByTestId('onboarding-pairing-code').props.value).toBe('');
    fireEvent.press(view.getByTestId('onboarding-close'));
    fireEvent.press(view.getByTestId('onboarding-backend-codex'));
    expect(view.queryByTestId('onboarding-agent-prompt')).toBeNull();
    expect(view.queryByTestId('onboarding-pairing-code')).toBeNull();
  });

  it('exposes interactive discovery to a person and requires an explicit backend for its code fallback', async () => {
    const onCopyCommand = jest.fn().mockResolvedValue(undefined);
    const onScanAnyQr = jest.fn();
    const onImportAnyQr = jest.fn();
    const onSubmitPairing = jest.fn();
    const view = render(<OnboardingScreen {...createProps({ initialBackend: undefined, onCopyCommand, onScanAnyQr, onImportAnyQr, onSubmitPairing })} />);
    expect(view.getByText('npx @p697/clawket@latest pair choose')).toBeTruthy();
    expect(view.queryByTestId('onboarding-pairing-method-agent')).toBeNull();
    fireEvent.press(view.getByTestId('onboarding-copy-command'));
    expect(onCopyCommand).toHaveBeenCalledWith('npx @p697/clawket@latest pair choose');
    await act(async () => { await Promise.resolve(); });
    fireEvent.press(view.getByTestId('onboarding-scan-any-qr'));
    expect(onScanAnyQr).toHaveBeenCalledTimes(1);
    fireEvent.press(view.getByTestId('onboarding-import-qr'));
    expect(onImportAnyQr).toHaveBeenCalledTimes(1);
    fireEvent.press(view.getByTestId('onboarding-show-code'));
    expect(view.queryByTestId('onboarding-pairing-code')).toBeNull();
    expect(view.queryByTestId('onboarding-code-backend-local-model')).toBeNull();
    fireEvent.press(view.getByTestId('onboarding-change-code-backend'));
    fireEvent.press(view.getByTestId('onboarding-code-backend-hermes'));
    fireEvent.changeText(view.getByTestId('onboarding-pairing-code'), 'ABC234');
    fireEvent.press(view.getByTestId('onboarding-connect'));
    expect(onSubmitPairing).toHaveBeenCalledWith({ backendKind: 'hermes', transportKind: 'relay', code: 'ABC234' });
    fireEvent.press(view.getByTestId('onboarding-change-code-backend'));
    fireEvent.press(view.getByTestId('onboarding-code-backend-codex'));
    expect(view.getByTestId('onboarding-pairing-code').props.value).toBe('');
    expect(view.getByTestId('onboarding-connect').props.disabled).toBe(true);
  });

  it('keeps a discovery code form intact when route progress echoes its selected backend', () => {
    const props = createProps({ initialBackend: undefined, onScanAnyQr: jest.fn() });
    const view = render(<OnboardingScreen {...props} />);
    fireEvent.press(view.getByTestId('onboarding-show-code'));
    fireEvent.press(view.getByTestId('onboarding-change-code-backend'));
    fireEvent.press(view.getByTestId('onboarding-code-backend-hermes'));
    fireEvent.changeText(view.getByTestId('onboarding-pairing-code'), 'ABC234');
    view.rerender(<OnboardingScreen {...props} initialBackend="hermes" status={{ kind: 'connecting', phase: 'relay_connected' }} />);
    view.rerender(<OnboardingScreen {...props} initialBackend="hermes" status={{ kind: 'error', code: 'timeout' }} />);
    expect(view.getByText('npx @p697/clawket@latest pair choose')).toBeTruthy();
    expect(view.getByTestId('onboarding-pairing-code').props.value).toBe('ABC 234');
    expect(view.queryByTestId('onboarding-agent-prompt')).toBeNull();
  });

  it('keeps discovery out of Preview while preserving generic scanning', () => {
    const view = render(<OnboardingScreen {...createProps({ initialBackend: undefined, environment: 'preview', onScanAnyQr: jest.fn() })} />);
    expect(view.queryByTestId('onboarding-auto-detect')).toBeNull();
    expect(view.getByTestId('onboarding-scan-any-qr')).toBeTruthy();
    const props = createProps({ initialBackend: undefined, onScanAnyQr: jest.fn() });
    view.rerender(<OnboardingScreen {...props} />);
    view.rerender(<OnboardingScreen {...props} environment="preview" />);
    expect(view.getByTestId('onboarding-chooser')).toBeTruthy();
    expect(view.queryByText('npx @p697/clawket@latest pair choose')).toBeNull();
  });

  it.each(['openclaw', 'hermes', 'codex', 'claude-code', 'pi'] as const)('pairs %s from the home code form without entering a platform guide', (kind) => {
    const onSubmitPairing = jest.fn();
    const view = render(<OnboardingScreen {...createProps({ initialBackend: undefined, onSubmitPairing })} />);
    expect(view.getByTestId('onboarding-auto-detect')).toBeTruthy();
    expect(view.queryByTestId('onboarding-computer-choose')).toBeNull();
    fireEvent.press(view.getByTestId('onboarding-show-code'));
    expect(view.queryByTestId('onboarding-connect')).toBeNull();
    fireEvent.press(view.getByTestId('onboarding-change-code-backend'));
    fireEvent.press(view.getByTestId(`onboarding-code-backend-${kind}`));
    expect(view.getByTestId('onboarding-connect').props.disabled).toBe(true);
    const code = kind === 'hermes' ? 'ABC234' : '123456';
    fireEvent.changeText(view.getByTestId('onboarding-pairing-code'), code);
    fireEvent.press(view.getByTestId('onboarding-connect'));
    expect(onSubmitPairing).toHaveBeenCalledWith({ backendKind: kind, transportKind: 'relay', code });
    expect(view.getByTestId('onboarding-chooser')).toBeTruthy();
  });

  it('retains the home code draft across disclosure and clears it when entering a platform guide', () => {
    const view = render(<OnboardingScreen {...createProps({ initialBackend: undefined })} />);
    fireEvent.press(view.getByTestId('onboarding-show-code'));
    fireEvent.press(view.getByTestId('onboarding-change-code-backend'));
    fireEvent.press(view.getByTestId('onboarding-code-backend-hermes'));
    fireEvent.changeText(view.getByTestId('onboarding-pairing-code'), 'ABC234');
    fireEvent.press(view.getByTestId('onboarding-hide-code'));
    expect(view.getByTestId('onboarding-scan-any-qr')).toBeTruthy();
    fireEvent.press(view.getByTestId('onboarding-show-code'));
    expect(view.getByTestId('onboarding-pairing-code').props.value).toBe('ABC 234');
    fireEvent.press(view.getByTestId('onboarding-backend-openclaw'));
    expect(view.getByTestId('onboarding-pairing-code').props.value).toBe('');
    expect(view.getByTestId('onboarding-agent-prompt')).toBeTruthy();
  });

  it('keeps failed generic QR pairing on the home with its scan and image actions', () => {
    const props = createProps({ initialBackend: undefined, onScanAnyQr: jest.fn(), onImportAnyQr: jest.fn() });
    const view = render(<OnboardingScreen {...props} />);
    view.rerender(<OnboardingScreen {...props} initialBackend="hermes" status={{ kind: 'connecting', phase: 'relay_connected' }} />);
    view.rerender(<OnboardingScreen {...props} initialBackend="hermes" status={{ kind: 'error', code: 'timeout' }} />);
    expect(view.getByTestId('onboarding-chooser')).toBeTruthy();
    expect(view.getByTestId('onboarding-scan-any-qr')).toBeTruthy();
    expect(view.getByTestId('onboarding-import-qr')).toBeTruthy();
    expect(view.queryByTestId('onboarding-agent-prompt')).toBeNull();
  });

  it('ignores a late paste after the home platform changes', async () => {
    let completePaste!: (value: string) => void;
    const onPastePairingCode = jest.fn(() => new Promise<string>((resolve) => { completePaste = resolve; }));
    const view = render(<OnboardingScreen {...createProps({ initialBackend: undefined, onPastePairingCode })} />);
    fireEvent.press(view.getByTestId('onboarding-show-code'));
    fireEvent.press(view.getByTestId('onboarding-change-code-backend'));
    fireEvent.press(view.getByTestId('onboarding-code-backend-hermes'));
    fireEvent.press(view.getByTestId('onboarding-paste-code'));
    expect(onPastePairingCode).toHaveBeenCalledWith('hermes', expect.any(Function));
    fireEvent.press(view.getByTestId('onboarding-change-code-backend'));
    fireEvent.press(view.getByTestId('onboarding-code-backend-codex'));
    await act(async () => { completePaste('ABC234'); });
    expect(view.getByTestId('onboarding-pairing-code').props.value).toBe('');
    expect(view.getByTestId('onboarding-connect').props.disabled).toBe(true);
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
    // A paired connection that dropped mid-pairing is still this pairing's wait: the stage says so.
    const hidden = { includeHiddenElements: true };
    expect(offline.getByTestId('onboarding-progress')).toBeTruthy();
    expect(offline.getByText('Offline · reconnecting')).toBeTruthy();
    expect(offline.queryByText('No network')).toBeNull();
    expect(offline.queryByTestId('onboarding-pairing-code')).toBeNull();
    expect(offline.getByTestId('onboarding-pairing-code', hidden)).toBeTruthy();
    fireEvent.press(offline.getByTestId('onboarding-connecting-cat-action'));
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
    // The failure keeps its place under the stage while the next attempt connects, and cannot start another one.
    error.rerender(<OnboardingScreen {...createProps({ initialBackend: 'hermes', status: { kind: 'connecting', phase: 'waiting_bridge' }, onErrorAction })} />);
    expect(error.getByText('Hermes is not responding', hidden)).toBeTruthy();
    fireEvent.press(error.getByTestId('onboarding-error-action', hidden));
    expect(onErrorAction).toHaveBeenCalledTimes(1);
    error.rerender(<OnboardingScreen {...createProps({ initialBackend: 'hermes', status: { kind: 'idle' }, onErrorAction })} />);
    expect(error.queryByTestId('onboarding-error')).toBeNull();
    error.unmount();

    const connecting = render(
      <OnboardingScreen
        {...createProps({ status: { kind: 'connecting', phase: 'waiting_bridge' } })}
      />,
    );
    expect(connecting.getByText('Connect {{backend}}', hidden)).toBeTruthy();
    expect(connecting.getByTestId('onboarding-progress')).toBeTruthy();
    expect(connecting.getByTestId('onboarding-connect', hidden).props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });
  });

  it('uses the shared intro and borderless choices in both color schemes', () => {
    for (const scheme of ['light', 'dark'] as const) {
      mockTheme = { scheme, colors: scheme === 'light' ? mockLightColors : mockDarkColors };
      const view = render(<OnboardingScreen {...createProps({ initialBackend: undefined })} />);
      expect(flattenStyle(view.getByTestId('onboarding-screen').props.style).backgroundColor).toBe(mockTheme.colors.canvas);
      expect(flattenStyle(view.getByText('Connect your agent').props.style)).toMatchObject({ fontSize: FontSize.display, color: mockTheme.colors.ink });
      const choiceStyle = flattenStyle(view.getByTestId('onboarding-backend-openclaw').props.style);
      expect(choiceStyle.borderRadius).toBe(Radius.card);
      expect(choiceStyle).not.toHaveProperty('borderWidth');
      expect(flattenStyle(view.getByText('Automatically detect agents on your computer').props.style)).toMatchObject({
        color: mockTheme.colors.ink, fontSize: FontSize.body,
      });
      view.unmount();
    }
  });

  it('keeps title-only choices compact, the help under them and the open-source note after it', () => {
    const view = render(<OnboardingScreen {...createProps({ initialBackend: undefined })} />);
    // Two columns of 52-point rows keep the official platforms above the home pairing actions.
    expect(flattenStyle(view.getByTestId('onboarding-backends').props.style)).not.toHaveProperty('gap');
    for (const kind of ['openclaw', 'hermes', 'codex', 'claude-code', 'pi', 'local-model']) {
      const row = view.getByTestId(`onboarding-backend-${kind}`);
      const choiceStyle = flattenStyle(row.props.style);
      expect(choiceStyle.paddingVertical).toBe(Space.sm);
      expect(choiceStyle.minHeight).toBe(ControlSize.settingsRow);
      expect(flattenStyle(row.props.children[0].props.style).width).toBe(Space.xxl);
    }
    // "No agent yet?" belongs to the choices; the open-source note follows it instead of anchoring to the bottom.
    const chooser = view.getByTestId('onboarding-chooser');
    expect(flattenStyle(chooser.props.style).gap).toBe(Space.sm);
    expect(within(chooser).getByTestId('onboarding-docs-toggle')).toBeTruthy();
    const openSource = flattenStyle(view.getByTestId('onboarding-open-source').props.style);
    expect(openSource.paddingTop).toBe(Space.lg);
    expect(openSource).not.toHaveProperty('marginTop');
    // Five or more website links outgrow one line; they wrap instead of running off both edges.
    fireEvent.press(view.getByTestId('onboarding-docs-toggle'));
    expect(flattenStyle(view.getByTestId('onboarding-doc-options').props.style)).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' });
    view.unmount();
    // Described choices (Roster add sheet, Cron templates) keep the 52-point tile and two-line roster height.
    const described = render(<ChoiceRow testID="described-choice" title="Add Connection" description="Connect OpenClaw, Hermes and more" onPress={jest.fn()} />);
    const describedRow = described.getByTestId('described-choice');
    expect(flattenStyle(describedRow.props.style)).toMatchObject({ minHeight: ControlSize.rosterRow, paddingVertical: Space.lg });
    expect(flattenStyle(describedRow.props.children[0].props.style).width).toBe(ControlSize.settingsRow);
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
