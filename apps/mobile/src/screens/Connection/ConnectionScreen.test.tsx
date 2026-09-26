import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { ConnectionDescriptor } from '@clawket/agent-protocol';
import { ConnectionScreen } from './ConnectionScreen';
import { formatConnectionLastReady } from './connection-details';

const mockGetRuntimeConnectionRecord = jest.fn(async (_id: string) => ({ url: 'wss://relay.example:8443/ws?token=secret' }));

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => ReactRuntime.forwardRef(
    ({ children, style, ...props }: Record<string, unknown>, ref: unknown) => ReactRuntime.createElement(
      name,
      { ...props, ref, style: typeof style === 'function' ? style({ pressed: false }) : style },
      children,
    ),
  );
  return {
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
    Pressable: host('Pressable'),
    ScrollView: host('ScrollView'),
    StyleSheet: { create: <T,>(styles: T) => styles, flatten: (style: unknown) => style, hairlineWidth: 1 },
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
    i18n: { resolvedLanguage: 'en-US' },
  }),
}));
jest.mock('../../theme', () => ({
  useAppTheme: () => ({
    theme: {
      scheme: 'light',
      colors: {
        canvas: '#FFFFFF', canvasGrouped: '#F5F5F7', surface: '#F2F2F4', surfaceFloating: '#FFFFFF',
        ink: '#111113', inkSecondary: '#6B6B72', inkTertiary: '#A3A3AB', line: '#E6E6EA',
        accent: '#1F5EFF', accentSoft: '#E8EEFF', onAccent: '#FFFFFF', bad: '#D64545', badSoft: '#F9E7E7',
      },
    },
  }),
}));
jest.mock('../../connection', () => ({
  getConnectionRuntime: () => ({ getRuntimeConnectionRecord: mockGetRuntimeConnectionRecord }),
}));
jest.mock('../../components/ui/PlatformMark', () => {
  const ReactRuntime = require('react');
  return { PlatformMark: (props: Record<string, unknown>) => ReactRuntime.createElement('PlatformMark', props) };
});
jest.mock('../../components/ui/FloatingButton', () => {
  const ReactRuntime = require('react');
  const { Pressable } = require('react-native');
  return {
    FloatingButton: ({ testID, onPress, accessibilityLabel }: { testID?: string; onPress: () => void; accessibilityLabel: string }) => (
      ReactRuntime.createElement(Pressable, { testID, onPress, accessibilityLabel })
    ),
  };
});
jest.mock('../../components/ui/Button', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    Button: ({ testID, label, onPress, disabled }: { testID?: string; label: string; onPress: () => void; disabled?: boolean }) => (
      ReactRuntime.createElement(Pressable, { testID, onPress, disabled }, ReactRuntime.createElement(Text, null, label))
    ),
  };
});
jest.mock('../../components/ui/Banner', () => {
  const ReactRuntime = require('react');
  const { Text } = require('react-native');
  return { Banner: ({ message }: { message: string }) => ReactRuntime.createElement(Text, null, message) };
});
jest.mock('../../components/ui/ConfirmationModal', () => {
  const ReactRuntime = require('react');
  return {
    ConfirmationModal: ({ visible, testID, title, onClose, onConfirm }: Record<string, unknown>) => visible
      ? ReactRuntime.createElement(
        'ConfirmationModal',
        { testID },
        ReactRuntime.createElement('ConfirmationTitle', null, title as string),
        ReactRuntime.createElement('ConfirmationCancel', { testID: `${testID}-cancel`, onPress: onClose }),
        ReactRuntime.createElement('ConfirmationConfirm', { testID: `${testID}-confirm`, onPress: onConfirm }),
      )
      : null,
  };
});
jest.mock('../../components/ui/Sheet', () => {
  const ReactRuntime = require('react');
  const { Text, View } = require('react-native');
  return {
    Sheet: ({ visible, testID, title, children }: Record<string, unknown>) => visible
      ? ReactRuntime.createElement(View, { testID }, title ? ReactRuntime.createElement(Text, null, title as string) : null, children)
      : null,
  };
});
jest.mock('../../components/ui/CompositionSafeBottomSheetTextInput', () => {
  const ReactRuntime = require('react');
  return { CompositionSafeBottomSheetTextInput: (props: Record<string, unknown>) => ReactRuntime.createElement('TextInput', props) };
});

function connection(patch: Partial<ConnectionDescriptor> = {}): ConnectionDescriptor {
  return {
    id: 'studio',
    backendKind: 'openclaw',
    transportKind: 'relay',
    label: 'Studio',
    environment: 'preview',
    createdAt: 1,
    isFreeSlot: true,
    ...patch,
  };
}

function props(patch: Partial<React.ComponentProps<typeof ConnectionScreen>> = {}): React.ComponentProps<typeof ConnectionScreen> {
  return {
    connection: connection(),
    active: true,
    state: 'ready',
    paused: false,
    agentNames: ['Lucy', 'Codex'],
    details: {
      lastReadyAt: Date.UTC(2026, 8, 5, 7, 30),
      bridgeVersion: '2026.9.5',
      bridgeCapabilities: ['bridge.capabilities.v2'],
    },
    onBack: jest.fn(),
    onReconnect: jest.fn(async () => undefined),
    onResume: jest.fn(async () => undefined),
    onPause: jest.fn(async () => undefined),
    onRemove: jest.fn(async () => undefined),
    onRename: jest.fn(async () => undefined),
    ...patch,
  };
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); });
}

describe('ConnectionScreen', () => {
  beforeEach(() => {
    mockGetRuntimeConnectionRecord.mockClear();
  });

  it('shows the identity, the read-only details and the Bridge facts on one page', async () => {
    const view = render(<ConnectionScreen {...props()} />);
    await flush();

    expect(view.getByTestId('connection-label').props.children).toBe('Studio');
    expect(view.getByText('Online')).toBeTruthy();
    expect(view.getByText('Lucy · Codex')).toBeTruthy();
    expect(view.getByText('OpenClaw')).toBeTruthy();
    expect(view.getByText('Relay')).toBeTruthy();
    expect(view.getByText('Preview')).toBeTruthy();
    // The host comes from the credential record but the token never reaches the page.
    expect(view.getByText('relay.example:8443')).toBeTruthy();
    expect(view.queryByText(/secret/)).toBeNull();
    expect(view.getByText('2026.9.5')).toBeTruthy();
    expect(view.getByText('bridge.capabilities.v2')).toBeTruthy();
    expect(view.getByText(formatConnectionLastReady(Date.UTC(2026, 8, 5, 7, 30), 'en-US'))).toBeTruthy();
    expect(view.queryByText('Advanced settings')).toBeNull();
    expect(view.queryByTestId('connection-free-slot')).toBeNull();
    expect(mockGetRuntimeConnectionRecord).toHaveBeenCalledWith('studio');
  });

  it('reads an inactive connection as not connected and keeps offline for the active one', async () => {
    const view = render(<ConnectionScreen {...props({ active: false, state: 'idle' })} />);
    await flush();
    expect(view.getByText('Not connected')).toBeTruthy();
    expect(view.queryByText('Offline')).toBeNull();

    view.rerender(<ConnectionScreen {...props({ state: 'handshaking' })} />);
    expect(view.getByText('Connecting')).toBeTruthy();
    view.rerender(<ConnectionScreen {...props({ state: 'offline' })} />);
    expect(view.getByText('Offline')).toBeTruthy();
    view.rerender(<ConnectionScreen {...props({ active: false, paused: true, state: 'idle' })} />);
    expect(view.getByText('Connection paused')).toBeTruthy();
  });

  it('renames through the shared sheet and keeps an unchanged or empty name unsaveable', async () => {
    const onRename = jest.fn(async () => undefined);
    const view = render(<ConnectionScreen {...props({ onRename })} />);
    await flush();

    fireEvent.press(view.getByTestId('connection-name'));
    expect(view.getByTestId('connection-rename-sheet')).toBeTruthy();
    expect(view.getByTestId('connection-rename-save').props.disabled).toBe(true);
    fireEvent.changeText(view.getByTestId('connection-rename-input'), '   ');
    expect(view.getByTestId('connection-rename-save').props.disabled).toBe(true);
    fireEvent.changeText(view.getByTestId('connection-rename-input'), '  Home desk ');
    expect(view.getByTestId('connection-rename-save').props.disabled).toBe(false);
    await act(async () => { fireEvent.press(view.getByTestId('connection-rename-save')); });

    expect(onRename).toHaveBeenCalledWith('Home desk');
    expect(view.queryByTestId('connection-rename-sheet')).toBeNull();
  });

  it('confirms pause and removal, and swaps reconnect for resume while paused', async () => {
    const onPause = jest.fn(async () => undefined);
    const onRemove = jest.fn(async () => undefined);
    const onReconnect = jest.fn(async () => undefined);
    const onResume = jest.fn(async () => undefined);
    const view = render(<ConnectionScreen {...props({ onPause, onRemove, onReconnect, onResume })} />);
    await flush();

    await act(async () => { fireEvent.press(view.getByTestId('connection-reconnect')); });
    expect(onReconnect).toHaveBeenCalledTimes(1);

    fireEvent.press(view.getByTestId('connection-pause'));
    expect(onPause).not.toHaveBeenCalled();
    fireEvent.press(view.getByTestId('connection-confirmation-cancel'));
    fireEvent.press(view.getByTestId('connection-pause'));
    await act(async () => { fireEvent.press(view.getByTestId('connection-confirmation-confirm')); });
    expect(onPause).toHaveBeenCalledTimes(1);

    fireEvent.press(view.getByTestId('connection-remove'));
    await act(async () => { fireEvent.press(view.getByTestId('connection-confirmation-confirm')); });
    expect(onRemove).toHaveBeenCalledTimes(1);

    view.rerender(<ConnectionScreen {...props({ paused: true, onResume, state: 'offline' })} />);
    expect(view.getByText('Connection paused')).toBeTruthy();
    expect(view.queryByTestId('connection-pause')).toBeNull();
    await act(async () => { fireEvent.press(view.getByTestId('connection-reconnect')); });
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('shows the free slot only to free users and routes the switch', async () => {
    const onUseAsFreeConnection = jest.fn();
    const view = render(<ConnectionScreen {...props({
      freeSlot: { current: false, switchAvailable: true, switching: false },
      onUseAsFreeConnection,
    })} />);
    await flush();

    fireEvent.press(view.getByTestId('connection-set-free'));
    expect(onUseAsFreeConnection).toHaveBeenCalledTimes(1);

    view.rerender(<ConnectionScreen {...props({
      freeSlot: { current: false, switchAvailable: false, switchStatus: 'Available tomorrow', switching: false },
      onUseAsFreeConnection,
    })} />);
    expect(view.getByText('Available tomorrow')).toBeTruthy();
    expect(view.getByTestId('connection-set-free').props.accessibilityState).toEqual({ disabled: true });

    view.rerender(<ConnectionScreen {...props({ freeSlot: { current: true, switchAvailable: true, switching: false } })} />);
    expect(view.getByTestId('connection-free-current')).toBeTruthy();
    expect(view.getByText('Current')).toBeTruthy();
  });
});
