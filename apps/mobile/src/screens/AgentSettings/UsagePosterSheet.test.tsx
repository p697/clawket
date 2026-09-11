import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { AgentDescriptor } from '@clawket/agent-protocol';
import { UsagePosterSheet } from './UsagePosterSheet';

const mockRequestPermissions = jest.fn();
const mockSaveToLibrary = jest.fn();
const mockShare = jest.fn();
const mockCapture = jest.fn();

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => ReactRuntime.forwardRef(
    ({ children, style, ...props }: Record<string, unknown>, ref: unknown) => {
      ReactRuntime.useImperativeHandle(ref, () => ({ name }));
      return ReactRuntime.createElement(name, {
        ...props,
        style: typeof style === 'function' ? style({ pressed: false }) : style,
      }, children);
    },
  );
  return {
    Pressable: host('Pressable'),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => style,
    },
    Text: host('Text'),
    View: host('View'),
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));

jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: () => mockRequestPermissions(),
  saveToLibraryAsync: (uri: string) => mockSaveToLibrary(uri),
}));

jest.mock('expo-sharing', () => ({
  shareAsync: (uri: string, options: unknown) => mockShare(uri, options),
}));

jest.mock('react-native-view-shot', () => ({
  captureRef: (target: unknown, options: unknown) => mockCapture(target, options),
}));

jest.mock('../../theme', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        accent: '#1F5EFF',
        canvas: '#FFFFFF',
        ink: '#111113',
        inkSecondary: '#6B6B72',
        surface: '#F2F2F4',
      },
    },
  }),
}));

jest.mock('../../components/ui/AgentAvatar', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return { AgentAvatar: () => ReactRuntime.createElement(View, { testID: 'poster-avatar' }) };
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

jest.mock('../../components/ui/Button', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    Button: ({ testID, label, disabled, loading, onPress }: {
      testID?: string;
      label: string;
      disabled?: boolean;
      loading?: boolean;
      onPress?: () => void;
    }) => ReactRuntime.createElement(
      Pressable,
      { testID, disabled: disabled || loading, onPress },
      ReactRuntime.createElement(Text, null, label),
    ),
  };
});

jest.mock('../../components/ui/Sheet', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    Sheet: ({ visible, testID, children }: {
      visible: boolean;
      testID?: string;
      children: React.ReactNode;
    }) => visible ? ReactRuntime.createElement(View, { testID }, children) : null,
  };
});

const agent: AgentDescriptor = {
  connectionId: 'studio',
  agentId: 'main',
  name: 'Main',
  emoji: '🐾',
  isMain: true,
  mainSessionKey: 'agent:main:main',
};

describe('UsagePosterSheet', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
    jest.clearAllMocks();
    mockCapture.mockResolvedValue('/tmp/poster.png');
    mockSaveToLibrary.mockResolvedValue(undefined);
    mockShare.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('shows the media permission state without trying to capture', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'denied' });
    const view = render(
      <UsagePosterSheet
        visible
        agent={agent}
        data={{ cost: '$1.25', tokens: '1K', messages: '4', toolCalls: '3' }}
        onClose={jest.fn()}
      />,
    );

    fireEvent.press(view.getByTestId('agent-usage-poster-save'));

    await waitFor(() => expect(view.getByText('Permission denied')).toBeTruthy());
    expect(mockCapture).not.toHaveBeenCalled();
    expect(mockSaveToLibrary).not.toHaveBeenCalled();
  });

  it('captures for save and share after permission is granted', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });
    const view = render(
      <UsagePosterSheet
        visible
        agent={agent}
        data={{ cost: '$1.25', tokens: '1K', messages: '4', toolCalls: '3' }}
        onClose={jest.fn()}
      />,
    );

    fireEvent.press(view.getByTestId('agent-usage-poster-save'));
    await waitFor(() => expect(mockSaveToLibrary).toHaveBeenCalledWith('file:///tmp/poster.png'));

    fireEvent.press(view.getByTestId('agent-usage-poster-share'));
    await waitFor(() => expect(mockShare).toHaveBeenCalledWith(
      '/tmp/poster.png',
      { mimeType: 'image/png' },
    ));
  });
});
