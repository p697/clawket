import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type {
  YouMindEmailAuthClient,
  YouMindOnboardingAuthSession,
} from '../../connection';
import { FontSize, FontWeight } from '../../theme/tokens';
import {
  YouMindOnboardingScreen,
  type YouMindOnboardingScreenProps,
} from './YouMindOnboardingScreen';

let panelProps: Record<string, unknown> | null = null;
let consoleErrorSpy: jest.SpyInstance;

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => ({ children, ...props }: { children?: React.ReactNode }) => (
    ReactRuntime.createElement(name, props, children)
  );
  return {
    Platform: { OS: 'ios' },
    ScrollView: host('ScrollView'),
    Pressable: host('Pressable'),
    Text: host('Text'),
    View: host('View'),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => Object.assign({}, ...(Array.isArray(style) ? style : [style])),
    },
  };
});

jest.mock('react-native-keyboard-controller', () => ({ KeyboardAvoidingView: require('react-native').View }));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('lucide-react-native', () => ({ ArrowLeft: () => null }));

jest.mock('../../theme', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        canvas: '#ffffff',
        ink: '#111111',
      },
    },
  }),
}));

jest.mock('../../components/ui/FloatingButton', () => {
  const ReactRuntime = require('react');
  const { Pressable } = require('react-native');
  return {
    FloatingButton: ({ testID, onPress }: { testID?: string; onPress: () => void }) => (
      ReactRuntime.createElement(Pressable, { testID, onPress })
    ),
  };
});

jest.mock('../../components/youmind/YouMindSignInPanel', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    YouMindSignInPanel: (props: Record<string, unknown>) => {
      panelProps = props;
      return ReactRuntime.createElement(View, { testID: 'youmind-sign-in-panel' });
    },
  };
});

function props(overrides: Partial<YouMindOnboardingScreenProps> = {}): YouMindOnboardingScreenProps {
  return {
    client: {
      sendOtp: jest.fn(),
      verifyOtp: jest.fn(),
    } as YouMindEmailAuthClient,
    onBack: jest.fn(),
    onSignedIn: jest.fn(),
    ...overrides,
  };
}

describe('YouMindOnboardingScreen', () => {
  beforeAll(() => {
    const originalConsoleError = console.error;
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown, ...rest: unknown[]) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
      originalConsoleError(message, ...rest);
    });
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders the email-only sign-in flow and preserves the canonical header tokens', () => {
    const input = props();
    const view = render(<YouMindOnboardingScreen {...input} />);

    expect(view.getByTestId('youmind-sign-in-panel')).toBeTruthy();
    expect(panelProps).toMatchObject({
      client: input.client,
      source: 'onboarding',
      onSignedIn: input.onSignedIn,
      centered: true,
    });
    expect(view.getByTestId('youmind-onboarding-screen').props.style).toEqual(expect.arrayContaining([
      expect.objectContaining({ backgroundColor: '#ffffff', flex: 1 }),
      { paddingTop: 24, paddingBottom: 16 },
    ]));
    expect(view.getByTestId('youmind-onboarding-title').props.style).toMatchObject({
      fontSize: FontSize.body,
      fontWeight: FontWeight.semibold,
    });
  });

  it('returns to the backend chooser without clearing a completed connection itself', () => {
    const onBack = jest.fn();
    const onSignedIn = jest.fn((_session: YouMindOnboardingAuthSession) => undefined);
    const view = render(<YouMindOnboardingScreen {...props({ onBack, onSignedIn })} />);

    fireEvent.press(view.getByTestId('youmind-onboarding-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
