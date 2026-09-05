import React from 'react';
import {
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react-native';
import {
  CAPABILITY_MATRIX,
  type AgentAdapter,
  type AgentDescriptor,
  type ChannelsStatusResult,
  type ToolCatalog,
} from '@clawket/agent-protocol';
import { ChannelsDevicesSection } from './ChannelsDevicesSection';
import { ToolsSection } from './ToolsSection';

const colors = {
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
  onAccent: '#FFFFFF',
  scrim: 'rgba(0,0,0,0.4)',
  bad: '#D64545',
  badSoft: '#F9E7E7',
};

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
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => style,
      hairlineWidth: 1,
    },
    Text: host('Text'),
    TextInput: host('TextInput'),
    View: host('View'),
  };
});

jest.mock('lucide-react-native', () => {
  const ReactRuntime = require('react');
  return {
    Check: (props: Record<string, unknown>) => ReactRuntime.createElement('Icon', props),
  };
});

jest.mock('react-i18next', () => {
  const translate = (key: string) => key;
  return { useTranslation: () => ({ t: translate }) };
});

jest.mock('../../theme', () => ({
  useAppTheme: () => ({ theme: { scheme: 'light', colors } }),
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

jest.mock('../../components/ui/FormTextInput', () => {
  const ReactRuntime = require('react');
  const { TextInput } = require('react-native');
  return {
    FormTextInput: (props: Record<string, unknown>) => ReactRuntime.createElement(TextInput, props),
  };
});

jest.mock('../../components/ui/SearchInput', () => {
  const ReactRuntime = require('react');
  const { TextInput } = require('react-native');
  return {
    SearchInput: ({ testID, ...props }: { testID?: string }) => ReactRuntime.createElement(
      TextInput,
      { ...props, testID: `${testID}-input` },
    ),
  };
});

jest.mock('../../components/ui/SegmentedTabs', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    SegmentedTabs: ({ testID, tabs, onSwitch }: {
      testID?: string;
      tabs: Array<{ key: string; label: string }>;
      onSwitch: (key: string) => void;
    }) => ReactRuntime.createElement(
      View,
      { testID },
      tabs.map((tab) => ReactRuntime.createElement(
        Pressable,
        { key: tab.key, testID: `${testID}-${tab.key}`, onPress: () => onSwitch(tab.key) },
        ReactRuntime.createElement(Text, null, tab.label),
      )),
    ),
  };
});

jest.mock('../../components/ui/SettingsGroup', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    SettingsDivider: (props: Record<string, unknown>) => ReactRuntime.createElement(View, props),
    SettingsGroup: ({ children, testID }: { children: React.ReactNode; testID?: string }) => (
      ReactRuntime.createElement(View, { testID }, children)
    ),
    SettingsRow: ({ children, testID, title, value, disabled, onPress, trailing }: {
      children?: React.ReactNode;
      testID?: string;
      title?: string;
      value?: string;
      disabled?: boolean;
      onPress?: () => void;
      trailing?: React.ReactNode;
    }) => ReactRuntime.createElement(
      onPress ? Pressable : View,
      { testID, disabled, onPress },
      children ?? ReactRuntime.createElement(
        ReactRuntime.Fragment,
        null,
        ReactRuntime.createElement(Text, null, title),
        value ? ReactRuntime.createElement(Text, null, value) : null,
        trailing,
      ),
    ),
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

jest.mock('../../components/ui/ThemedSwitch', () => {
  const ReactRuntime = require('react');
  return {
    ThemedSwitch: (props: Record<string, unknown>) => ReactRuntime.createElement('Switch', props),
  };
});

jest.mock('../../services/analytics/events', () => ({
  analyticsEvents: { toolsSaveTapped: jest.fn() },
}));

const agent: AgentDescriptor = {
  connectionId: 'studio',
  agentId: 'main',
  name: 'Main',
  isMain: true,
  mainSessionKey: 'agent:main:main',
};

const catalog: ToolCatalog = {
  agentId: 'main',
  profiles: [
    { id: 'full', label: 'Full' },
    { id: 'coding', label: 'Coding' },
  ],
  groups: [{
    id: 'core',
    label: 'Core',
    source: 'core',
    tools: [
      {
        id: 'read',
        label: 'Read',
        description: 'Read files',
        source: 'core',
        defaultProfiles: ['coding'],
      },
      {
        id: 'weather',
        label: 'Weather',
        description: 'Read weather',
        source: 'core',
        defaultProfiles: [],
      },
    ],
  }],
};

const channels: ChannelsStatusResult = {
  ts: 1,
  channelOrder: ['telegram'],
  channelLabels: { telegram: 'Telegram' },
  channelDetailLabels: {},
  channelSystemImages: {},
  channelMeta: [],
  channels: { telegram: { configured: true } },
  channelAccounts: { telegram: [{ accountId: 'main', connected: true }] },
  channelDefaultAccountId: { telegram: 'main' },
};

describe('ToolsSection', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders loading then empty tool states', async () => {
    const pending = deferred<ToolCatalog>();
    const adapter = adapterWith({
      management: {
        tools: { catalog: jest.fn(() => pending.promise), save: jest.fn() },
        config: { view: jest.fn(async () => ({ config: null, hash: null })) },
      },
    });
    const view = render(<ToolsSection adapter={adapter} agent={agent} online />);
    expect(view.getByTestId('agent-tools-loading')).toBeTruthy();
    pending.resolve({ ...catalog, groups: [] });
    await waitFor(() => expect(view.getByTestId('agent-tools-empty')).toBeTruthy());
  });

  it('handles unsupported, offline, error, and retry states', async () => {
    const catalogRequest = jest.fn()
      .mockRejectedValueOnce(new Error('Tools denied'))
      .mockResolvedValue({ ...catalog, groups: [] });
    const unavailable = render(
      <ToolsSection
        adapter={adapterWith({
          capabilities: { ...CAPABILITY_MATRIX.openclaw, tools: false },
          management: { tools: { catalog: catalogRequest, save: jest.fn() } },
        })}
        agent={agent}
        online
      />,
    );
    expect(unavailable.getByTestId('agent-tools-unavailable')).toBeTruthy();
    unavailable.unmount();

    const offline = render(
      <ToolsSection
        adapter={adapterWith({
          management: { tools: { catalog: catalogRequest, save: jest.fn() } },
        })}
        agent={agent}
        online={false}
      />,
    );
    expect(offline.getByTestId('agent-tools-offline')).toBeTruthy();
    expect(catalogRequest).not.toHaveBeenCalled();
    offline.unmount();

    const failed = render(
      <ToolsSection
        adapter={adapterWith({
          management: {
            tools: { catalog: catalogRequest, save: jest.fn() },
            config: { view: jest.fn(async () => ({ config: null, hash: null })) },
          },
        })}
        agent={agent}
        online
      />,
    );
    await waitFor(() => expect(failed.getByText('Tools denied')).toBeTruthy());
    fireEvent.press(failed.getByTestId('agent-tools-error-action'));
    await waitFor(() => expect(catalogRequest).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(failed.getByTestId('agent-tools-empty')).toBeTruthy());
  });

  it('edits and confirms agent tool policy through adapter management', async () => {
    const save = jest.fn(async () => undefined);
    const adapter = adapterWith({
      management: {
        tools: { catalog: jest.fn(async () => catalog), save },
        config: {
          view: jest.fn(async () => ({
            config: { agents: { list: [{ id: 'main', tools: { profile: 'coding' } }] } },
            hash: 'hash',
          })),
        },
      },
    });
    const view = render(<ToolsSection adapter={adapter} agent={agent} online />);
    await waitFor(() => expect(view.getByTestId('agent-tools-toggle-weather')).toBeTruthy());
    fireEvent(view.getByTestId('agent-tools-toggle-weather'), 'valueChange', true);
    expect(view.getByTestId('agent-tools-actions')).toBeTruthy();
    fireEvent.press(view.getByTestId('agent-tools-save'));
    expect(view.getByTestId('agent-tools-confirm')).toBeTruthy();
    fireEvent.press(view.getByTestId('agent-tools-confirm-save'));
    await waitFor(() => expect(save).toHaveBeenCalledWith({
      agentId: 'main',
      profile: 'coding',
      alsoAllow: ['weather'],
      deny: [],
    }));
    await waitFor(() => expect(view.queryByTestId('agent-tools-actions')).toBeNull());
  });

  it('keeps explicit allow policies read only', async () => {
    const adapter = adapterWith({
      management: {
        tools: { catalog: jest.fn(async () => catalog), save: jest.fn() },
        config: {
          view: jest.fn(async () => ({
            config: { agents: { list: [{ id: 'main', tools: { allow: ['read'] } }] } },
            hash: 'hash',
          })),
        },
      },
    });
    const view = render(<ToolsSection adapter={adapter} agent={agent} online />);
    await waitFor(() => expect(view.getByTestId('agent-tools-read-only')).toBeTruthy());
    expect(view.getByTestId('agent-tools-toggle-read').props.disabled).toBe(true);
  });
});

describe('ChannelsDevicesSection', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders unavailable, offline, loading, empty, error, and retry states', async () => {
    const status = jest.fn();
    const unavailable = render(
      <ChannelsDevicesSection
        adapter={adapterWith({
          capabilities: {
            ...CAPABILITY_MATRIX.openclaw,
            channels: false,
            devices: false,
            nodes: false,
          },
          management: {},
        })}
        online
      />,
    );
    expect(unavailable.getByTestId('agent-channels-devices-unavailable')).toBeTruthy();
    unavailable.unmount();

    const offline = render(
      <ChannelsDevicesSection
        adapter={adapterWith({ management: { channels: { status } } })}
        online={false}
      />,
    );
    expect(offline.getByTestId('agent-channels-devices-offline')).toBeTruthy();
    expect(status).not.toHaveBeenCalled();
    offline.unmount();

    const pending = deferred<ChannelsStatusResult>();
    const loading = render(
      <ChannelsDevicesSection
        adapter={adapterWith({ management: { channels: { status: () => pending.promise } } })}
        online
      />,
    );
    await waitFor(() => expect(loading.getByTestId('agent-channels-devices-loading')).toBeTruthy());
    pending.resolve({ ...channels, channelOrder: [], channelLabels: {}, channels: {}, channelAccounts: {} });
    await waitFor(() => expect(loading.getByTestId('agent-channels-empty')).toBeTruthy());
    loading.unmount();

    const retryStatus = jest.fn()
      .mockRejectedValueOnce(new Error('Channels denied'))
      .mockResolvedValue({ ...channels, channelOrder: [], channelLabels: {}, channels: {}, channelAccounts: {} });
    const failed = render(
      <ChannelsDevicesSection
        adapter={adapterWith({ management: { channels: { status: retryStatus } } })}
        online
      />,
    );
    await waitFor(() => expect(failed.getByText('Channels denied')).toBeTruthy());
    fireEvent.press(failed.getByTestId('agent-channels-devices-channels-error-action'));
    await waitFor(() => expect(retryStatus).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(failed.getByTestId('agent-channels-empty')).toBeTruthy());
  });

  it('renders channels and handles device pairing and removal', async () => {
    const approve = jest.fn(async () => undefined);
    const remove = jest.fn(async () => undefined);
    const listDevices = jest.fn()
      .mockResolvedValueOnce({
        pending: [{ requestId: 'pair-1', deviceId: 'phone', displayName: 'Phone', platform: 'ios' }],
        paired: [{ deviceId: 'laptop', displayName: 'Laptop', platform: 'darwin' }],
      })
      .mockResolvedValue({
        pending: [],
        paired: [{ deviceId: 'laptop', displayName: 'Laptop', platform: 'darwin' }],
      });
    const adapter = adapterWith({
      management: {
        channels: { status: jest.fn(async () => channels) },
        devices: { list: listDevices, approve, reject: jest.fn(), remove },
        nodes: { list: jest.fn(async () => EMPTY_NODES) },
      },
    });
    const view = render(<ChannelsDevicesSection adapter={adapter} online />);
    await waitFor(() => expect(view.getByTestId('agent-channel-row-telegram')).toBeTruthy());
    expect(view.getByText('Connected')).toBeTruthy();

    fireEvent.press(view.getByTestId('agent-channels-devices-tabs-devices'));
    await waitFor(() => expect(view.getByTestId('agent-device-request-pair-1')).toBeTruthy());
    fireEvent.press(view.getByTestId('agent-device-request-pair-1-approve'));
    await waitFor(() => expect(approve).toHaveBeenCalledWith('pair-1'));

    await waitFor(() => expect(view.getByTestId('agent-device-row-laptop')).toBeTruthy());
    fireEvent.press(view.getByTestId('agent-device-row-laptop'));
    fireEvent.press(view.getByTestId('agent-device-remove'));
    expect(view.getByTestId('agent-device-remove-confirm')).toBeTruthy();
    fireEvent.press(view.getByTestId('agent-device-remove-confirm-action'));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('laptop'));
    await waitFor(() => expect(view.queryByTestId('agent-device-row-laptop')).toBeNull());
  });

  it('hides pair decisions without permission and surfaces device load errors', async () => {
    const list = jest.fn()
      .mockRejectedValueOnce(new Error('Device list denied'))
      .mockResolvedValue({
        pending: [{ requestId: 'pair-1', deviceId: 'phone' }],
        paired: [],
      });
    const adapter = adapterWith({
      capabilities: { ...CAPABILITY_MATRIX.openclaw, pairRequests: false },
      management: {
        channels: { status: jest.fn(async () => channels) },
        devices: { list, approve: jest.fn(), reject: jest.fn() },
      },
    });
    const view = render(<ChannelsDevicesSection adapter={adapter} online />);
    fireEvent.press(view.getByTestId('agent-channels-devices-tabs-devices'));
    await waitFor(() => expect(view.getByText('Device list denied')).toBeTruthy());
    fireEvent.press(view.getByTestId('agent-channels-devices-devices-error-action'));
    await waitFor(() => expect(view.getByTestId('agent-device-request-pair-1')).toBeTruthy());
    expect(view.queryByTestId('agent-device-request-pair-1-approve')).toBeNull();
    expect(view.queryByTestId('agent-device-request-pair-1-reject')).toBeNull();
  });

  it('handles node pair decisions and edits node details', async () => {
    const approve = jest.fn(async () => undefined);
    const rename = jest.fn(async (nodeId: string, displayName: string) => ({ nodeId, displayName }));
    const pairRequests = jest.fn()
      .mockResolvedValueOnce({
        pending: [{ requestId: 'node-pair', nodeId: 'new-node', displayName: 'New Node' }],
        nodes: [],
      })
      .mockResolvedValue({ pending: [], nodes: [] });
    const adapter = adapterWith({
      capabilities: { ...CAPABILITY_MATRIX.openclaw, channels: false, devices: false },
      management: {
        nodes: {
          list: jest.fn(async () => ({
            ts: 1,
            nodes: [{
              nodeId: 'node-1',
              displayName: 'Desk',
              platform: 'darwin',
              version: '3.0',
              caps: [],
              commands: ['device.info'],
              paired: true,
              connected: true,
            }],
          })),
          pairRequests,
          approve,
          reject: jest.fn(),
          rename,
        },
      },
    });
    const view = render(<ChannelsDevicesSection adapter={adapter} online />);
    await waitFor(() => expect(view.getByTestId('agent-node-request-node-pair')).toBeTruthy());
    fireEvent.press(view.getByTestId('agent-node-request-node-pair-approve'));
    await waitFor(() => expect(approve).toHaveBeenCalledWith('node-pair'));

    fireEvent.press(view.getByTestId('agent-node-row-node-1'));
    expect(view.getByTestId('agent-node-detail')).toBeTruthy();
    fireEvent.changeText(view.getByTestId('agent-node-rename-input'), 'Studio Mac');
    fireEvent.press(view.getByTestId('agent-node-rename'));
    await waitFor(() => expect(rename).toHaveBeenCalledWith('node-1', 'Studio Mac'));
    await waitFor(() => expect(view.getByTestId('agent-node-rename-input').props.value).toBe('Studio Mac'));
  });
});

const EMPTY_NODES = { ts: 0, nodes: [] };

function adapterWith(patch: Partial<AgentAdapter>): AgentAdapter {
  return {
    capabilities: { ...CAPABILITY_MATRIX.openclaw },
    ...patch,
  } as AgentAdapter;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
