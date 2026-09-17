import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { ConnectionDescriptor } from '@clawket/agent-protocol';
import { ConnectionsScreen } from './ConnectionsScreen';

let mockRuntime: Record<string, unknown> = {};

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
  useConnections: () => mockRuntime,
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
      ReactRuntime.createElement(Pressable, { testID: testID ?? 'connections-add', onPress, accessibilityLabel })
    ),
  };
});
jest.mock('../../components/ui/Button', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    Button: ({ testID, label, onPress }: { testID?: string; label: string; onPress: () => void }) => (
      ReactRuntime.createElement(Pressable, { testID, onPress }, ReactRuntime.createElement(Text, null, label))
    ),
  };
});
jest.mock('../../components/ui/ConfirmationModal', () => {
  const ReactRuntime = require('react');
  const { Text } = require('react-native');
  return {
    ConfirmationModal: ({ visible, testID, title, message, onClose, onConfirm }: Record<string, unknown>) => visible
      ? ReactRuntime.createElement(
        'ConfirmationModal',
        { testID },
        ReactRuntime.createElement(Text, null, title as string),
        ReactRuntime.createElement(Text, null, message as string),
        ReactRuntime.createElement('ConfirmationCancel', { testID: `${testID}-cancel`, onPress: onClose }),
        ReactRuntime.createElement('ConfirmationConfirm', { testID: `${testID}-confirm`, onPress: onConfirm }),
      )
      : null,
  };
});

function connection(patch: Partial<ConnectionDescriptor> = {}): ConnectionDescriptor {
  return {
    id: 'studio',
    backendKind: 'openclaw',
    transportKind: 'relay',
    label: 'Studio',
    createdAt: 1,
    isFreeSlot: true,
    ...patch,
  };
}

function runtime(patch: Record<string, unknown> = {}): Record<string, unknown> {
  const studio = connection();
  const lab = connection({ id: 'lab', backendKind: 'hermes', label: 'Lab', isFreeSlot: false });
  return {
    connections: [studio, lab],
    activeConnectionId: 'studio',
    activeState: 'ready',
    pausedConnectionIds: ['lab'],
    roster: [
      { connection: studio, agents: [{ agent: { name: 'Lucy' } }, { agent: { name: 'Codex' } }] },
      { connection: lab, agents: [{ agent: { name: 'Hermes' } }] },
    ],
    ...patch,
  };
}

function props(patch: Partial<React.ComponentProps<typeof ConnectionsScreen>> = {}): React.ComponentProps<typeof ConnectionsScreen> {
  return {
    onBack: jest.fn(),
    onAdd: jest.fn(),
    onOpen: jest.fn(),
    onPause: jest.fn(async () => undefined),
    onResume: jest.fn(async () => undefined),
    onRemove: jest.fn(async () => undefined),
    ...patch,
  };
}

describe('ConnectionsScreen', () => {
  beforeEach(() => {
    mockRuntime = runtime();
  });

  it('lists every connection with its status and opens the connection page on tap', () => {
    const onOpen = jest.fn();
    const view = render(<ConnectionsScreen {...props({ onOpen })} />);

    expect(view.getByText('Studio')).toBeTruthy();
    expect(view.getByText('Lucy · Codex')).toBeTruthy();
    expect(view.getByText('Online')).toBeTruthy();
    expect(view.getByText('Lab')).toBeTruthy();
    expect(view.getByText('Connection paused')).toBeTruthy();
    fireEvent.press(view.getByTestId('connection-list-lab'));
    expect(onOpen).toHaveBeenCalledWith('lab');
  });

  it('swipes to pause or resume and to remove, confirming what the connection page confirms', async () => {
    const onPause = jest.fn(async () => undefined);
    const onResume = jest.fn(async () => undefined);
    const onRemove = jest.fn(async () => undefined);
    const view = render(<ConnectionsScreen {...props({ onPause, onResume, onRemove })} />);

    expect(view.getByTestId('connection-swipe-studio-action-pause')).toBeTruthy();
    expect(view.queryByTestId('connection-swipe-studio-action-resume')).toBeNull();
    expect(view.getByTestId('connection-swipe-lab-action-resume')).toBeTruthy();
    expect(view.queryByTestId('connection-swipe-lab-action-pause')).toBeNull();

    fireEvent.press(view.getByTestId('connection-swipe-studio-action-pause'));
    expect(onPause).not.toHaveBeenCalled();
    expect(view.getByText('Pause this connection?')).toBeTruthy();
    fireEvent.press(view.getByTestId('connections-confirmation-cancel'));
    expect(view.queryByTestId('connections-confirmation')).toBeNull();
    fireEvent.press(view.getByTestId('connection-swipe-studio-action-pause'));
    await act(async () => { fireEvent.press(view.getByTestId('connections-confirmation-confirm')); });
    expect(onPause).toHaveBeenCalledWith('studio');

    await act(async () => { fireEvent.press(view.getByTestId('connection-swipe-lab-action-resume')); });
    expect(onResume).toHaveBeenCalledWith('lab');
    expect(view.queryByTestId('connections-confirmation')).toBeNull();

    fireEvent.press(view.getByTestId('connection-swipe-lab-action-remove'));
    expect(view.getByText('Are you sure you want to delete "Lab"?')).toBeTruthy();
    await act(async () => { fireEvent.press(view.getByTestId('connections-confirmation-confirm')); });
    expect(onRemove).toHaveBeenCalledWith('lab');
  });

  it('renders no swipe tray without lifecycle handlers and an empty state without connections', () => {
    const view = render(<ConnectionsScreen {...props({ onPause: undefined, onResume: undefined, onRemove: undefined })} />);
    expect(view.queryByTestId('connection-swipe-studio-actions')).toBeNull();

    mockRuntime = runtime({ connections: [], roster: [], activeConnectionId: null });
    const onAdd = jest.fn();
    const empty = render(<ConnectionsScreen {...props({ onAdd })} />);
    expect(empty.getByText('No connections yet')).toBeTruthy();
    fireEvent.press(empty.getByText('Add Connection'));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
