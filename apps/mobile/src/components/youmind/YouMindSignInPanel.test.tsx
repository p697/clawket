import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { YouMindSignInPanel } from './YouMindSignInPanel';

let cardProps: Record<string, unknown> | null = null;
const signInTapped = jest.fn();
const signInResolved = jest.fn();
let consoleErrorSpy: jest.SpyInstance;

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => ({ children, ...props }: { children?: React.ReactNode }) => (
    ReactRuntime.createElement(name, props, children)
  );
  return {
    Pressable: host('Pressable'),
    Text: host('Text'),
    View: host('View'),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => style,
    },
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../theme', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        ink: '#111111',
        inkSecondary: '#666666',
        accent: '#3366ff',
      },
    },
  }),
}));

jest.mock('../ui/Banner', () => {
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

jest.mock('../../services/analytics/events', () => ({
  analyticsEvents: {
    youMindSignInTapped: (...args: unknown[]) => signInTapped(...args),
    youMindSignInResolved: (...args: unknown[]) => signInResolved(...args),
  },
}));

jest.mock('../../utils/openExternalUrl', () => ({
  openExternalUrl: jest.fn(async () => true),
}));

jest.mock('./YouMindSignInCard', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    YouMindSignInCard: (props: Record<string, unknown>) => {
      cardProps = props;
      return ReactRuntime.createElement(View, { testID: 'youmind-sign-in-card' });
    },
  };
});

describe('YouMindSignInPanel', () => {
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

  beforeEach(() => {
    cardProps = null;
    signInTapped.mockReset();
    signInResolved.mockReset();
  });

  it('supports only email OTP and forwards the verified session', async () => {
    const session = {
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresIn: 3600,
      createdAtMs: 1,
      user: { id: 'user-1', email: 'lucy@example.com' },
    };
    const client = {
      sendOtp: jest.fn(async () => undefined),
      verifyOtp: jest.fn(async () => session),
    };
    const onSignedIn = jest.fn(async () => undefined);
    render(
      <YouMindSignInPanel
        client={client}
        source="onboarding"
        onSignedIn={onSignedIn}
      />,
    );

    expect(cardProps).not.toHaveProperty('onAppleSignIn');
    expect(cardProps).not.toHaveProperty('onGoogleSignIn');
    act(() => (cardProps?.onChangeEmail as (value: string) => void)('lucy@example.com'));
    await act(async () => {
      (cardProps?.onSendCode as () => void)();
      await Promise.resolve();
    });
    await waitFor(() => expect(client.sendOtp).toHaveBeenCalledWith('lucy@example.com'));
    expect(cardProps).toMatchObject({ step: 'email', otpSent: true });

    act(() => (cardProps?.onChangeCode as (value: string) => void)('123456'));
    await act(async () => {
      await (cardProps?.onVerify as () => Promise<boolean>)();
    });
    expect(client.verifyOtp).toHaveBeenCalledWith('lucy@example.com', '123456');
    expect(onSignedIn).toHaveBeenCalledWith(session);
    expect(signInResolved).toHaveBeenCalledWith({
      method: 'email',
      result: 'success',
      source: 'otp',
    });
  });

  it('keeps validation and request failures in the onboarding surface', async () => {
    const client = {
      sendOtp: jest.fn(async () => { throw new Error('No network'); }),
      verifyOtp: jest.fn(),
    };
    const view = render(<YouMindSignInPanel client={client} source="onboarding" />);

    await act(async () => {
      (cardProps?.onSendCode as () => void)();
      await Promise.resolve();
    });
    expect(view.getByText('Please enter your YouMind email first.')).toBeTruthy();

    act(() => (cardProps?.onChangeEmail as (value: string) => void)('lucy@example.com'));
    await act(async () => {
      (cardProps?.onSendCode as () => void)();
      await Promise.resolve();
    });
    await waitFor(() => expect(view.getByTestId('youmind-sign-in-error')).toBeTruthy());
    expect(view.getByText('No network')).toBeTruthy();
    expect(client.verifyOtp).not.toHaveBeenCalled();
  });
  it('verifies the completed value immediately and suppresses concurrent submissions', async () => {
    let rejectRequest!: (error: Error) => void;
    const client = { sendOtp: jest.fn(async () => undefined), verifyOtp: jest.fn(() => new Promise<never>((_resolve, reject) => { rejectRequest = reject; })) };
    render(<YouMindSignInPanel client={client} source="onboarding" />);
    act(() => (cardProps!.onChangeEmail as Function)(' lucy@example.com '));
    await act(async () => { (cardProps!.onSendCode as Function)(); });
    expect(client.sendOtp).toHaveBeenCalledWith('lucy@example.com');
    expect(cardProps!.resendCountdown).toBe(60);
    await act(async () => { (cardProps!.onSendCode as Function)(); });
    expect(client.sendOtp).toHaveBeenCalledTimes(1);
    let pending!: Promise<boolean>;
    act(() => {
      (cardProps!.onChangeCode as Function)('123456');
      pending = (cardProps!.onVerify as Function)('123456');
      void (cardProps!.onVerify as Function)('123456');
    });
    expect(client.verifyOtp).toHaveBeenCalledTimes(1);
    expect(client.verifyOtp).toHaveBeenCalledWith('lucy@example.com', '123456');
    await act(async () => { rejectRequest(new Error('Incorrect code')); await pending; });
    expect(cardProps!.busy).toBe(false);
    expect(cardProps!.invalid).toBe(true);
    act(() => (cardProps!.onEditEmail as Function)());
    expect(cardProps).toMatchObject({ otpSent: false, code: '', email: 'lucy@example.com' });
  });

});
