import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { OpenClawDirectScreen } from './OpenClawDirectScreen';
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


const props = () => ({ busy: false, onBack: jest.fn(), onSubmit: jest.fn(), onCopyCommand: jest.fn() });
describe('direct connection form', () => {
  it('submits masked credentials with a Tailnet address and the selected transport', () => {
    const p = props(); const view = render(<OpenClawDirectScreen {...p} />);
    fireEvent.press(view.getByText('Tailscale'));
    fireEvent.changeText(view.getByTestId('direct-url'), 'ws://100.64.0.1:18789');
    fireEvent.changeText(view.getByTestId('direct-credential'), 'token');
    expect(view.getByTestId('direct-credential').props.secureTextEntry).toBe(true);
    fireEvent.press(view.getByTestId('direct-connect'));
    expect(p.onSubmit).toHaveBeenCalledWith({ mode: 'tailscale', url: 'ws://100.64.0.1:18789', authMethod: 'token', credential: 'token' });
  });
  it('clears an obsolete token when switching to password and preserves fields on failure', () => {
    const p = props(); const view = render(<OpenClawDirectScreen {...p} />);
    fireEvent.changeText(view.getByTestId('direct-credential'), 'token');
    fireEvent.press(view.getByText('Password'));
    expect(view.getByTestId('direct-credential').props.value).toBe('');
    fireEvent.changeText(view.getByTestId('direct-credential'), 'password');
    view.rerender(<OpenClawDirectScreen {...p} error="unauthorized" />);
    expect(view.getByTestId('direct-credential').props.value).toBe('password');
    expect(view.getByTestId('direct-error')).toBeTruthy();
  });
  it('locks the form during a request, allows back, and expands copyable help', () => {
    const p = props(); const view = render(<OpenClawDirectScreen {...p} busy />);
    expect(view.getByTestId('direct-url').props.editable).toBe(false);
    expect(view.getByTestId('direct-connect').props.disabled).toBe(true);
    fireEvent.press(view.getByTestId('direct-back'));
    expect(p.onBack).toHaveBeenCalled();
    fireEvent.press(view.getByTestId('direct-help'));
    fireEvent.press(view.getByTestId('onboarding-copy-command'));
    expect(p.onCopyCommand).toHaveBeenCalledWith('openclaw config get gateway.auth.token');
  });
});
