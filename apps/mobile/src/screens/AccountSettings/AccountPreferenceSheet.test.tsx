import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import {
  AccountPreferenceSheet,
  isAccountPreferenceAction,
} from './AccountPreferenceSheet';
import {
  getCurrentAppIconAsync,
  isAppIconChangeSupportedAsync,
  setCurrentAppIconAsync,
} from '../../services/app-icon';

const mockSetLanguage = jest.fn();
jest.mock('../../i18n/AppLanguageProvider', () => ({
  useAppLanguage: () => ({ language: 'system', setLanguage: mockSetLanguage }),
}));

const mockSetMode = jest.fn();
const mockSetAccentId = jest.fn();
const mockSetSpeechLanguage = jest.fn();

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
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
    Pressable: host('Pressable'),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => style,
      hairlineWidth: 1,
    },
    Image: host('Image'),
    Text: host('Text'),
    View: host('View'),
  };
});

jest.mock('lucide-react-native', () => {
  const ReactRuntime = require('react');
  return { Check: (props: Record<string, unknown>) => ReactRuntime.createElement('Check', props) };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../components/ui/Sheet', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    Sheet: ({ children, testID }: { children: React.ReactNode; testID?: string }) => (
      ReactRuntime.createElement(View, { testID }, children)
    ),
  };
});

jest.mock('../../components/ui/Banner', () => {
  const ReactRuntime = require('react');
  const { Text, View } = require('react-native');
  return {
    Banner: ({ testID, message }: { testID?: string; message: string }) => ReactRuntime.createElement(
      View,
      { testID },
      ReactRuntime.createElement(Text, null, message),
    ),
  };
});

jest.mock('../../theme', () => ({
  builtInAccents: {
    iceBlue: { light: { accent500: '#1F5EFF' }, dark: { accent500: '#6B95FF' } },
    jadeGreen: { light: { accent500: '#147A5B' }, dark: { accent500: '#52C49A' } },
    oceanTeal: { light: { accent500: '#0F7180' }, dark: { accent500: '#55C2D0' } },
    sunsetOrange: { light: { accent500: '#A85312' }, dark: { accent500: '#F1A45B' } },
    rosePink: { light: { accent500: '#B12D62' }, dark: { accent500: '#F0709F' } },
    royalPurple: { light: { accent500: '#6C43C2' }, dark: { accent500: '#A98BFF' } },
  },
  useAppTheme: () => ({
    theme: {
      scheme: 'light',
      colors: {
        accent: '#1F5EFF',
        bad: '#D64545',
        ink: '#111113',
        inkSecondary: '#6B6B72',
        inkTertiary: '#A3A3AB',
        line: '#E6E6EA',
        surface: '#F2F2F4',
        surfaceFloating: '#FFFFFF',
      },
    },
    mode: 'system',
    accentId: 'iceBlue',
    setMode: mockSetMode,
    setAccentId: mockSetAccentId,
  }),
}));

jest.mock('../../contexts/AppContext', () => ({
  useAppContext: () => ({
    speechRecognitionLanguage: 'system',
    onSpeechRecognitionLanguageChange: mockSetSpeechLanguage,
  }),
}));

jest.mock('../../services/app-icon', () => ({
  getCurrentAppIconAsync: jest.fn(),
  isAppIconChangeSupportedAsync: jest.fn(),
  setCurrentAppIconAsync: jest.fn(),
}));

describe('AccountPreferenceSheet', () => {
  const mockedGetIcon = getCurrentAppIconAsync as jest.MockedFunction<typeof getCurrentAppIconAsync>;
  const mockedIconSupported = isAppIconChangeSupportedAsync as jest.MockedFunction<
    typeof isAppIconChangeSupportedAsync
  >;
  const mockedSetIcon = setCurrentAppIconAsync as jest.MockedFunction<typeof setCurrentAppIconAsync>;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
    mockedIconSupported.mockResolvedValue(true);
    mockedGetIcon.mockResolvedValue('default');
    mockedSetIcon.mockResolvedValue();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('recognizes only the local preference actions', () => {
    expect([
      'app-language',
      'theme',
      'accent',
      'speech-language',
      'app-icon',
    ].every(isAccountPreferenceAction)).toBe(true);
    expect(isAccountPreferenceAction('chat-appearance')).toBe(false);
  });

  it('persists theme, accent, and speech choices before closing', async () => {
    const onClose = jest.fn();
    const onChanged = jest.fn();
    const view = render(
      <AccountPreferenceSheet preference="theme" onClose={onClose} onChanged={onChanged} />,
    );
    fireEvent.press(view.getByTestId('account-preference-dark'));
    expect(mockSetMode).toHaveBeenCalledWith('dark');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    view.rerender(
      <AccountPreferenceSheet preference="accent" onClose={onClose} onChanged={onChanged} />,
    );
    fireEvent.press(view.getByTestId('account-preference-jadeGreen'));
    expect(mockSetAccentId).toHaveBeenCalledWith('jadeGreen');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));

    view.rerender(
      <AccountPreferenceSheet preference="speech-language" onClose={onClose} onChanged={onChanged} />,
    );
    fireEvent.press(view.getByTestId('account-preference-ja'));
    expect(mockSetSpeechLanguage).toHaveBeenCalledWith('ja');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(3));
    expect(onChanged).toHaveBeenNthCalledWith(1, 'theme', 'dark');
    expect(onChanged).toHaveBeenNthCalledWith(2, 'accent', 'jadeGreen');
    expect(onChanged).toHaveBeenNthCalledWith(3, 'speech-language', 'ja');
  });

  it('changes app language independently of voice and exposes save failures', async () => {
    const onClose = jest.fn();
    mockSetLanguage.mockResolvedValueOnce(undefined);
    const view = render(<AccountPreferenceSheet preference="app-language" onClose={onClose} />);
    expect(view.getByText('日本語')).toBeTruthy();
    fireEvent.press(view.getByTestId('account-preference-ja'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockSetLanguage).toHaveBeenCalledWith('ja');
    expect(mockSetSpeechLanguage).not.toHaveBeenCalled();
    mockSetLanguage.mockRejectedValueOnce(new Error('storage unavailable'));
    fireEvent.press(view.getByTestId('account-preference-system'));
    await waitFor(() => expect(view.getByText('Unable to change app language')).toBeTruthy());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('loads native icon support and applies a Pro icon selection', async () => {
    const onClose = jest.fn();
    const view = render(<AccountPreferenceSheet preference="app-icon" onClose={onClose} />);

    await waitFor(() => {
      expect(view.getByTestId('account-preference-black').props.accessibilityState).toEqual({
        disabled: false,
      });
    });
    fireEvent.press(view.getByTestId('account-preference-black'));

    await waitFor(() => {
      expect(mockedSetIcon).toHaveBeenCalledWith('black');
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps app-icon failures inside the app-owned preference sheet', async () => {
    mockedSetIcon.mockRejectedValueOnce(new Error('native failure'));
    const onClose = jest.fn();
    const view = render(<AccountPreferenceSheet preference="app-icon" onClose={onClose} />);

    await waitFor(() => {
      expect(view.getByTestId('account-preference-black').props.accessibilityState).toEqual({
        disabled: false,
      });
    });
    fireEvent.press(view.getByTestId('account-preference-black'));

    await waitFor(() => expect(view.getByTestId('account-preference-error')).toBeTruthy());
    expect(view.getByText('Unable to change app icon')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
