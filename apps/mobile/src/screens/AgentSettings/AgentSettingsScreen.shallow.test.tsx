import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  CAPABILITY_MATRIX,
  createMockAdapter,
  type AgentDescriptor,
  type ConnectionDescriptor,
} from '@clawket/agent-protocol';
import {
  AgentSettingsScreen,
  AgentSettingsView,
  type AgentSettingsViewProps,
} from './AgentSettingsScreen';

const mockLoadSummary = jest.fn();

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
      flatten: (style: unknown) => Array.isArray(style)
        ? Object.assign({}, ...style.filter(Boolean))
        : style,
      hairlineWidth: 1,
    },
    Text: host('Text'),
    View: host('View'),
  };
});

jest.mock('lucide-react-native', () => ({ ChevronLeft: () => null }));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../theme', () => ({
  useAppTheme: () => ({
    theme: {
      scheme: 'light',
      colors: {
        canvasGrouped: 'canvas-grouped',
        ink: 'ink',
        inkSecondary: 'ink-secondary',
      },
    },
  }),
}));

jest.mock('../../components/ui/AgentAvatar', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return { AgentAvatar: (props: Record<string, unknown>) => ReactRuntime.createElement(View, props) };
});

jest.mock('../../components/ui/Banner', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    Banner: ({ testID, message, actionLabel, onAction }: {
      testID: string;
      message: string;
      actionLabel: string;
      onAction: () => void;
    }) => ReactRuntime.createElement(
      View,
      { testID },
      ReactRuntime.createElement(Text, null, message),
      ReactRuntime.createElement(
        Pressable,
        { testID: `${testID}-action`, onPress: onAction },
        ReactRuntime.createElement(Text, null, actionLabel),
      ),
    ),
  };
});

jest.mock('../../components/ui/FloatingButton', () => {
  const ReactRuntime = require('react');
  const { Pressable } = require('react-native');
  return {
    FloatingButton: (props: Record<string, unknown>) => ReactRuntime.createElement(Pressable, props),
  };
});

jest.mock('../../components/ui/SettingsGroup', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    SettingsGroup: ({ children, ...props }: Record<string, unknown>) => ReactRuntime.createElement(
      View,
      props,
      children,
    ),
    SettingsDivider: (props: Record<string, unknown>) => ReactRuntime.createElement(View, props),
    SettingsRow: ({ title, subtitle, value, leading, onPress, children, ...props }: Record<string, unknown>) => ReactRuntime.createElement(
      Pressable,
      { ...props, onPress },
      leading,
      title ? ReactRuntime.createElement(Text, null, title) : null,
      subtitle ? ReactRuntime.createElement(Text, null, subtitle) : null,
      value ? ReactRuntime.createElement(Text, null, value) : null,
      children,
    ),
  };
});

jest.mock('../../components/ui/Skeleton', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return { Skeleton: (props: Record<string, unknown>) => ReactRuntime.createElement(View, props) };
});

jest.mock('./load-summary', () => ({
  loadAgentSettingsSummary: (...args: unknown[]) => mockLoadSummary(...args),
}));

const connection: ConnectionDescriptor = {
  id: 'connection-one',
  backendKind: 'openclaw',
  transportKind: 'relay',
  label: 'Studio',
  createdAt: 1,
  isFreeSlot: true,
};

const agent: AgentDescriptor = {
  connectionId: connection.id,
  agentId: 'main',
  name: 'Lucy',
  isMain: true,
  mainSessionKey: 'agent:main:main',
};

function viewProps(patch: Partial<AgentSettingsViewProps> = {}): AgentSettingsViewProps {
  return {
    connection,
    agent,
    capabilities: { ...CAPABILITY_MATRIX.openclaw },
    connectionState: 'ready',
    state: 'ready',
    isPro: true,
    onBack: jest.fn(),
    onNavigate: jest.fn(),
    onOpenPro: jest.fn(),
    onRetry: jest.fn(),
    ...patch,
  };
}

describe('AgentSettingsView shallow states', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockLoadSummary.mockReset();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it.each([
    ['loading', 'agent-settings-loading'],
    ['empty', 'agent-settings-empty'],
    ['error', 'agent-settings-error'],
    ['offline', 'agent-settings-offline'],
    ['permission', 'agent-settings-permission'],
  ] as const)('renders the %s state through a dedicated primitive', (state, testID) => {
    const view = render(
      <AgentSettingsView
        {...viewProps({
          state,
          agent: state === 'empty' ? null : agent,
          connectionState: state === 'error'
            ? 'error'
            : state === 'offline'
              ? 'offline'
              : 'ready',
        })}
      />,
    );
    expect(view.getByTestId(testID)).toBeTruthy();
  });

  it('keeps content under the offline primitive and dispatches its action', () => {
    const onRetry = jest.fn();
    const view = render(
      <AgentSettingsView
        {...viewProps({ state: 'offline', connectionState: 'offline', onRetry })}
      />,
    );
    expect(view.getByTestId('agent-settings-row-connection')).toBeTruthy();
    fireEvent.press(view.getByTestId('agent-settings-offline-action'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('loads AgentAdapter management summary in the connected wrapper', async () => {
    mockLoadSummary.mockResolvedValue({ currentModel: 'loaded-model' });
    const adapter = createMockAdapter({
      connection,
      agents: [agent],
      initialState: 'ready',
    });
    const view = render(
      <AgentSettingsScreen
        {...viewProps()}
        adapter={adapter}
      />,
    );

    expect(view.getByTestId('agent-settings-loading')).toBeTruthy();
    await waitFor(() => expect(view.getByText('loaded-model')).toBeTruthy());
    expect(mockLoadSummary).toHaveBeenCalledWith(adapter, agent);
  });
});
