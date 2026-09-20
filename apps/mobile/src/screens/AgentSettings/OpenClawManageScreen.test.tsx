import React from 'react';
import {
  act,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react-native';
import {
  AdapterError,
  CAPABILITY_MATRIX,
  type AgentAdapter,
  type ApprovalRequest,
  type ConnectionState,
  type DoctorResult,
  type PermissionsReport,
  type SessionUpdate,
} from '@clawket/agent-protocol';

import { OpenClawManageScreen } from './OpenClawManageScreen';

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
  good: '#178A6A',
  goodSoft: '#E4F3EE',
  warn: '#D9791C',
  warnSoft: '#FAEDE1',
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
    BackHandler: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
    Platform: {
      OS: 'ios',
      select: (options: Record<string, unknown>) => options.ios ?? options.default,
    },
    Pressable: host('Pressable'),
    ScrollView: host('ScrollView'),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => flattenStyle(style),
      hairlineWidth: 1,
    },
    Text: host('Text'),
    TextInput: host('TextInput'),
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
    t: (key: string) => key.includes(':') ? key.split(':').at(-1) : key,
    i18n: { language: 'en' },
  }),
}));

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
    Button: ({ testID, label, onPress, disabled, loading }: {
      testID?: string;
      label: string;
      onPress?: () => void;
      disabled?: boolean;
      loading?: boolean;
    }) => ReactRuntime.createElement(
      Pressable,
      { testID, onPress: disabled || loading ? undefined : onPress, disabled },
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
    FormTextInput: (props: Record<string, unknown>) => ReactRuntime.createElement(TextInput, props),
  };
});

jest.mock('../../components/ui/SearchInput', () => {
  const ReactRuntime = require('react');
  const { TextInput } = require('react-native');
  return {
    SearchInput: ({ testID, value, onChangeText, placeholder }: {
      testID?: string;
      value: string;
      onChangeText: (value: string) => void;
      placeholder?: string;
    }) => ReactRuntime.createElement(TextInput, {
      testID: `${testID}-input`,
      value,
      onChangeText,
      placeholder,
    }),
  };
});

jest.mock('../../components/ui/SegmentedTabs', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    SegmentedTabs: ({ tabs, onSwitch, testID }: {
      tabs: Array<{ key: string; label: string }>;
      onSwitch: (key: string) => void;
      testID: string;
    }) => ReactRuntime.createElement(
      View,
      { testID },
      ...tabs.map((tab) => ReactRuntime.createElement(
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
    SettingsDivider: () => ReactRuntime.createElement(View),
    SettingsGroup: ({ children, testID }: { children: React.ReactNode; testID?: string }) => (
      ReactRuntime.createElement(View, { testID }, children)
    ),
    SettingsRow: ({ testID, title, subtitle, value, attention, children, onPress, disabled, expanded }: {
      testID?: string;
      title?: string;
      subtitle?: string;
      value?: string;
      attention?: boolean;
      children?: React.ReactNode;
      onPress?: () => void;
      disabled?: boolean;
      expanded?: boolean;
    }) => ReactRuntime.createElement(
      onPress ? Pressable : View,
      { testID, onPress: disabled ? undefined : onPress, disabled, accessibilityState: { disabled, expanded } },
      children,
      title ? ReactRuntime.createElement(Text, null, title) : null,
      subtitle ? ReactRuntime.createElement(Text, null, subtitle) : null,
      attention ? ReactRuntime.createElement(View, { testID: testID ? `${testID}-attention` : undefined }) : null,
      value ? ReactRuntime.createElement(Text, null, value) : null,
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

jest.mock('../../components/pro/ProGate', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    ProGate: ({ testID, title, actionLabel, onUnlock, children }: {
      testID?: string;
      title: string;
      actionLabel: string;
      onUnlock: () => void;
      children?: React.ReactNode;
    }) => ReactRuntime.createElement(
      View,
      { testID },
      ReactRuntime.createElement(Text, null, title),
      children ? ReactRuntime.createElement(View, { testID: `${testID}-teaser` }, children) : null,
      ReactRuntime.createElement(
        Pressable,
        { testID: `${testID}-action`, onPress: onUnlock },
        ReactRuntime.createElement(Text, null, actionLabel),
      ),
    ),
  };
});

jest.mock('../../components/ui/Skeleton', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    Skeleton: (props: Record<string, unknown>) => ReactRuntime.createElement(View, props),
  };
});

jest.mock('../../services/analytics/events', () => ({
  analyticsEvents: {
    gatewayConfigViewOpened: jest.fn(),
    gatewayConfigBackupCreated: jest.fn(),
    gatewayConfigRestoreTapped: jest.fn(),
    approvalResolved: jest.fn(),
  },
}));

function flattenStyle(style: unknown): Record<string, unknown> {
  if (!style) return {};
  if (!Array.isArray(style)) return style as Record<string, unknown>;
  return Object.assign({}, ...style.map(flattenStyle));
}

const permissionsReport: PermissionsReport = {
  configPath: '/tmp/openclaw.json',
  approvalsPath: '/tmp/approvals.json',
  web: {
    status: 'available',
    summary: 'Web tools are ready.',
    reasons: [],
    searchEnabled: true,
    searchProvider: 'brave',
    searchConfigured: true,
    fetchEnabled: true,
    firecrawlConfigured: false,
  },
  exec: {
    status: 'needs_approval',
    summary: 'Commands ask on miss.',
    reasons: [],
    currentAgentId: 'main',
    currentAgentName: 'Main',
    toolProfile: 'coding',
    execToolAvailable: true,
    hostApprovalsApply: true,
    implicitSandboxFallback: false,
    configuredHost: 'gateway',
    effectiveHost: 'gateway',
    sandboxMode: 'off',
    configSecurity: 'allowlist',
    configAsk: 'on-miss',
    approvalsExists: true,
    approvalsSecurity: 'allowlist',
    approvalsAsk: 'on-miss',
    effectiveSecurity: 'allowlist',
    effectiveAsk: 'on-miss',
    allowlistCount: 2,
    toolPolicyDenied: false,
    safeBins: [],
    safeBinTrustedDirs: [],
    trustedDirWarnings: [],
  },
  codeExecution: {
    status: 'needs_approval',
    summary: 'Code follows command approvals.',
    reasons: [],
    inheritsFromExec: true,
  },
};

const doctorResult: DoctorResult = {
  ok: true,
  summary: 'Everything is healthy.',
  checks: [{ name: 'Gateway', status: 'pass', message: 'Ready' }],
  raw: 'doctor: ok',
};

type AdapterHarness = Readonly<{
  adapter: AgentAdapter;
  view: jest.Mock;
  set: jest.Mock;
  permissions: jest.Mock;
  doctor: jest.Mock;
  repair: jest.Mock;
  listBackups: jest.Mock;
  createBackup: jest.Mock;
  restoreBackup: jest.Mock;
  removeBackup: jest.Mock;
  resolveExec: jest.Mock;
  connect: jest.Mock;
  emitState: (state: ConnectionState) => void;
  emitUpdate: (update: SessionUpdate) => void;
}>;

function createAdapterHarness(options: Readonly<{
  state?: ConnectionState;
  configView?: { config: Record<string, unknown> | null; hash: string | null };
  capabilities?: Partial<typeof CAPABILITY_MATRIX.openclaw>;
  backendKind?: 'openclaw' | 'hermes';
}> = {}): AdapterHarness {
  let state = options.state ?? 'ready';
  const stateListeners = new Set<(next: ConnectionState) => void>();
  const updateListeners = new Set<(update: SessionUpdate) => void>();
  const view = jest.fn(async () => options.configView ?? ({ config: { theme: { mode: 'dark' } }, hash: 'hash-1' }));
  const set = jest.fn(async () => ({ ok: true, config: { theme: 'light' } }));
  const permissions = jest.fn(async () => permissionsReport);
  const doctor = jest.fn(async () => doctorResult);
  const repair = jest.fn(async () => ({ ok: true, summary: 'Permissions repaired.' }));
  const listBackups = jest.fn(async () => []);
  const createBackup = jest.fn(async () => ({ id: 'backup-1', createdAt: 1_700_000_000_000 }));
  const restoreBackup = jest.fn(async () => undefined);
  const removeBackup = jest.fn(async () => undefined);
  const resolveExec = jest.fn(async () => undefined);
  const connect = jest.fn(async () => undefined);
  const adapter = {
    connection: {
      id: 'studio',
      backendKind: options.backendKind ?? 'openclaw',
      transportKind: 'relay',
      label: 'Studio',
      createdAt: 1,
      isFreeSlot: true,
    },
    capabilities: { ...CAPABILITY_MATRIX.openclaw, ...options.capabilities },
    get state() {
      return state;
    },
    connect,
    disconnect: jest.fn(),
    probe: jest.fn(async () => true),
    listAgents: jest.fn(async () => []),
    listSessions: jest.fn(async () => []),
    loadSession: jest.fn(),
    prompt: jest.fn(),
    cancel: jest.fn(),
    management: {
      config: {
        view,
        set,
        permissions,
        repair,
        doctor,
        backups: { list: listBackups, create: createBackup, restore: restoreBackup, remove: removeBackup },
      },
      approvals: { resolveExec },
    },
    on: (event: string, listener: ((value: ConnectionState) => void) | ((value: SessionUpdate) => void)) => {
      if (event === 'state') {
        stateListeners.add(listener as (value: ConnectionState) => void);
        return () => stateListeners.delete(listener as (value: ConnectionState) => void);
      }
      if (event === 'update') {
        updateListeners.add(listener as (value: SessionUpdate) => void);
        return () => updateListeners.delete(listener as (value: SessionUpdate) => void);
      }
      return () => undefined;
    },
  } as unknown as AgentAdapter;
  return {
    adapter,
    view,
    set,
    permissions,
    doctor,
    repair,
    listBackups,
    createBackup,
    restoreBackup,
    removeBackup,
    resolveExec,
    connect,
    emitState: (next) => {
      state = next;
      stateListeners.forEach((listener) => listener(next));
    },
    emitUpdate: (update) => updateListeners.forEach((listener) => listener(update)),
  };
}

function renderScreen(
  harness: AdapterHarness,
  overrides: Partial<React.ComponentProps<typeof OpenClawManageScreen>> = {},
) {
  const onBack = jest.fn();
  const onOpenPaywall = jest.fn();
  const result = render(
    <OpenClawManageScreen
      adapter={harness.adapter}
      isPro
      initialTab="configuration"
      onBack={onBack}
      onOpenPaywall={onOpenPaywall}
      {...overrides}
    />,
  );
  return { ...result, onBack, onOpenPaywall };
}

describe('OpenClawManageScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('opens a readable management menu without fetching configuration and preserves loaded sections on return', async () => {
    const harness = createAdapterHarness();
    const screen = renderScreen(harness, { initialTab: undefined });
    expect(harness.view).not.toHaveBeenCalled();
    expect(harness.permissions).not.toHaveBeenCalled();
    expect(harness.doctor).not.toHaveBeenCalled();
    for (const section of ['configuration', 'permissions', 'diagnostics', 'backups']) {
      expect(screen.getByTestId(`openclaw-manage-tabs-${section}`)).toBeTruthy();
      // Four feature cards, one per Pro section (owner-approved 2026-09-19).
      expect(screen.getByTestId(`openclaw-manage-card-${section}`)).toBeTruthy();
    }
    // Each card says what its section does.
    expect(screen.getByTestId('openclaw-manage-menu')).toBeTruthy();
    expect(screen.getByText('OpenClaw config')).toBeTruthy();
    expect(screen.getByText('See and change every OpenClaw setting.')).toBeTruthy();
    expect(screen.getByText('Check web and command access; fix it in one tap.')).toBeTruthy();
    expect(screen.getByText('Give OpenClaw a check-up and auto-fix issues.')).toBeTruthy();
    expect(screen.getByText('Keeps a copy on your phone so a bad change can be undone.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('openclaw-manage-tabs-configuration'));
    await waitFor(() => expect(harness.view).toHaveBeenCalledTimes(1));
    fireEvent.press(screen.getByTestId('openclaw-manage-back'));
    expect(screen.onBack).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('openclaw-manage-tabs-configuration'));
    expect(harness.view).toHaveBeenCalledTimes(1);
  });

  it('shows the newest restore point age and pending approvals on the menu from local data only', async () => {
    const harness = createAdapterHarness();
    const now = Date.now();
    harness.listBackups.mockResolvedValue([
      { id: 'old', createdAt: now - 5 * 24 * 60 * 60_000 },
      { id: 'new', createdAt: now - 3 * 24 * 60 * 60_000 },
    ]);
    const screen = renderScreen(harness, { initialTab: undefined });
    // The local backup list is the only read the menu performs; Gateway sections stay untouched.
    await waitFor(() => expect(harness.listBackups).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('{{count}}d ago')).toBeTruthy());
    expect(harness.view).not.toHaveBeenCalled();
    expect(harness.permissions).not.toHaveBeenCalled();
    expect(harness.doctor).not.toHaveBeenCalled();
    expect(screen.queryByTestId('openclaw-manage-tabs-permissions-attention')).toBeNull();

    act(() => harness.emitUpdate({
      type: 'approval_requested',
      approval: { kind: 'exec', id: 'approval-1', command: 'ls', expiresAtMs: now + 60_000 },
    }));
    expect(screen.getByTestId('openclaw-manage-tabs-permissions-attention')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();

    // Entering Backups reuses the list the menu already loaded.
    fireEvent.press(screen.getByTestId('openclaw-manage-tabs-backups'));
    await waitFor(() => expect(screen.getByTestId('openclaw-backup-new')).toBeTruthy());
    expect(harness.listBackups).toHaveBeenCalledTimes(1);
  });

  it('shows explicit diagnostic progress and renders a delayed result', async () => {
    const harness = createAdapterHarness();
    let finish: ((value: DoctorResult) => void) | undefined;
    harness.doctor.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const screen = renderScreen(harness, { initialTab: 'diagnostics' });
    expect(screen.getByText('Running diagnostics…')).toBeTruthy();
    expect(harness.doctor).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId('openclaw-manage-back'));
    fireEvent.press(screen.getByTestId('openclaw-manage-tabs-diagnostics'));
    expect(harness.doctor).toHaveBeenCalledTimes(1);
    await act(async () => finish?.({ ok: true, checks: [], summary: 'Done' }));
    expect(screen.queryByTestId('openclaw-manage-loading')).toBeNull();
    expect(screen.getByText('Done')).toBeTruthy();
  });

  it('does not present an empty approval inbox as missing settings', async () => {
    const screen = renderScreen(createAdapterHarness(), { initialTab: 'permissions' });
    await waitFor(() => expect(screen.getByTestId('openclaw-permissions-content')).toBeTruthy());
    expect(screen.queryByText('Pending Requests')).toBeNull();
    expect(screen.queryByTestId('openclaw-approvals-empty')).toBeNull();
  });

  it('lists config keys as a captioned table of contents with several keys open at once', async () => {
    const harness = createAdapterHarness({
      configView: {
        config: {
          meta: { lastTouchedVersion: '2026.9.1', migrations: { modelPolicyAllowlist: true } },
          channels: { telegram: { enabled: true }, discord: { enabled: false } },
          bindings: [{ agentId: 'main' }, { agentId: 'ops' }],
          acp: {},
          talk: 'quiet',
        },
        hash: 'hash-1',
      },
    });
    const screen = renderScreen(harness);
    await waitFor(() => expect(screen.getByTestId('openclaw-configuration-keys')).toBeTruthy());

    // Captions describe the shape without opening anything.
    expect(screen.getByText('lastTouchedVersion, migrations')).toBeTruthy();
    expect(screen.getByText('telegram, discord')).toBeTruthy();
    expect(screen.getByText('{{count}} items')).toBeTruthy();
    expect(screen.getByText('{}')).toBeTruthy();
    expect(screen.getByText('"quiet"')).toBeTruthy();
    // Empty containers and primitives have nothing further to show.
    expect(screen.getByTestId('openclaw-config-key-acp').props.onPress).toBeUndefined();
    expect(screen.getByTestId('openclaw-config-key-talk').props.onPress).toBeUndefined();
    expect(screen.queryByTestId('openclaw-config-body-meta')).toBeNull();
    expect(screen.queryByTestId('openclaw-configuration-collapse-all')).toBeNull();

    // Two keys open together; the header offers Collapse all from the second one.
    fireEvent.press(screen.getByTestId('openclaw-config-key-meta'));
    expect(screen.getByTestId('openclaw-config-body-meta')).toBeTruthy();
    expect(screen.getByTestId('openclaw-config-key-meta').props.accessibilityState.expanded).toBe(true);
    expect(screen.queryByTestId('openclaw-configuration-collapse-all')).toBeNull();
    fireEvent.press(screen.getByTestId('openclaw-config-key-channels'));
    expect(screen.getByTestId('openclaw-config-body-meta')).toBeTruthy();
    expect(screen.getByTestId('openclaw-config-body-channels')).toBeTruthy();
    expect(screen.getByText(/2026\.9\.1/)).toBeTruthy();
    expect(screen.getByTestId('openclaw-configuration-collapse-all')).toBeTruthy();

    // Open keys survive a trip to the menu and back.
    fireEvent.press(screen.getByTestId('openclaw-manage-back'));
    fireEvent.press(screen.getByTestId('openclaw-manage-tabs-configuration'));
    expect(harness.view).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('openclaw-config-body-meta')).toBeTruthy();
    expect(screen.getByTestId('openclaw-config-body-channels')).toBeTruthy();

    // Tapping an open key closes only that key; Collapse all closes the rest.
    fireEvent.press(screen.getByTestId('openclaw-config-key-meta'));
    expect(screen.queryByTestId('openclaw-config-body-meta')).toBeNull();
    expect(screen.getByTestId('openclaw-config-body-channels')).toBeTruthy();
    fireEvent.press(screen.getByTestId('openclaw-config-key-bindings'));
    fireEvent.press(screen.getByTestId('openclaw-configuration-collapse-all'));
    expect(screen.queryByTestId('openclaw-config-body-channels')).toBeNull();
    expect(screen.queryByTestId('openclaw-config-body-bindings')).toBeNull();
    expect(screen.queryByTestId('openclaw-configuration-collapse-all')).toBeNull();
  });

  it('filters config keys by name or serialized value and keeps open keys through a search', async () => {
    const harness = createAdapterHarness({
      configView: {
        config: {
          meta: { lastTouchedVersion: '2026.9.1' },
          channels: { telegram: { enabled: true } },
          plugins: { entries: { telegramBridge: {} } },
          acp: { enabled: false },
        },
        hash: 'hash-1',
      },
    });
    const screen = renderScreen(harness);
    await waitFor(() => expect(screen.getByTestId('openclaw-configuration-keys')).toBeTruthy());
    fireEvent.press(screen.getByTestId('openclaw-config-key-channels'));

    fireEvent.changeText(screen.getByTestId('openclaw-configuration-search-input'), 'Telegram');
    expect(screen.getByTestId('openclaw-config-key-channels')).toBeTruthy();
    expect(screen.getByTestId('openclaw-config-key-plugins')).toBeTruthy();
    expect(screen.queryByTestId('openclaw-config-key-meta')).toBeNull();
    expect(screen.queryByTestId('openclaw-config-key-acp')).toBeNull();
    expect(screen.getByTestId('openclaw-config-body-channels')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('openclaw-configuration-search-input'), 'nothing-here');
    expect(screen.getByTestId('openclaw-configuration-no-results')).toBeTruthy();
    expect(screen.queryByTestId('openclaw-configuration-keys')).toBeNull();
    // Edit stays reachable while a search is active.
    expect(screen.getByTestId('openclaw-configuration-edit')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('openclaw-configuration-search-input'), '');
    expect(screen.getByTestId('openclaw-config-key-meta')).toBeTruthy();
    expect(screen.getByTestId('openclaw-config-body-channels')).toBeTruthy();
  });

  it('loads configuration and requires a second confirmation before saving', async () => {
    const harness = createAdapterHarness();
    const screen = renderScreen(harness);

    await waitFor(() => expect(
      screen.getByTestId('openclaw-configuration-content'),
    ).toBeTruthy());
    expect(harness.view).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('openclaw-configuration-edit'));
    fireEvent.changeText(
      screen.getByTestId('openclaw-configuration-input'),
      '{"theme":"light"}',
    );
    fireEvent.press(screen.getByTestId('openclaw-configuration-review'));

    expect(screen.getByTestId('openclaw-configuration-confirm')).toBeTruthy();
    expect(harness.set).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('openclaw-configuration-confirm-action'));

    await waitFor(() => expect(harness.set).toHaveBeenCalledWith(
      '{\n  "theme": "light"\n}',
      'hash-1',
    ));
  });

  it('loads all four segments and resolves only live exec approvals through management', async () => {
    const harness = createAdapterHarness();
    const screen = renderScreen(harness);
    await waitFor(() => expect(
      screen.getByTestId('openclaw-configuration-content'),
    ).toBeTruthy());

    fireEvent.press(screen.getByTestId('openclaw-manage-back'));
    fireEvent.press(screen.getByTestId('openclaw-manage-tabs-permissions'));
    await waitFor(() => expect(
      screen.getByTestId('openclaw-permission-report'),
    ).toBeTruthy());
    expect(harness.permissions).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId('openclaw-permissions-repair'));
    expect(screen.getByTestId('openclaw-repair-confirm')).toBeTruthy();
    expect(harness.repair).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('openclaw-repair-confirm-action'));
    await waitFor(() => expect(harness.repair).toHaveBeenCalledTimes(1));

    const approval: Extract<ApprovalRequest, { kind: 'exec' }> = {
      kind: 'exec',
      id: 'approval-1',
      command: 'npm test',
      expiresAtMs: Date.now() + 60_000,
    };
    act(() => harness.emitUpdate({ type: 'approval_requested', approval }));
    fireEvent.press(screen.getByTestId('openclaw-approval-approval-1'));
    fireEvent.press(screen.getByTestId('openclaw-approval-allow-once'));
    await waitFor(() => expect(harness.resolveExec).toHaveBeenCalledWith(
      'approval-1',
      'allow-once',
    ));

    fireEvent.press(screen.getByTestId('openclaw-manage-back'));
    fireEvent.press(screen.getByTestId('openclaw-manage-tabs-diagnostics'));
    await waitFor(() => expect(
      screen.getByTestId('openclaw-diagnostics-content'),
    ).toBeTruthy());
    expect(harness.doctor).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('openclaw-manage-back'));
    fireEvent.press(screen.getByTestId('openclaw-manage-tabs-backups'));
    await waitFor(() => expect(screen.getByTestId('openclaw-backups-empty')).toBeTruthy());
    expect(harness.listBackups).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId('openclaw-backup-create'));
    await waitFor(() => expect(screen.getByTestId('openclaw-backup-backup-1')).toBeTruthy());
    expect(harness.createBackup).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId('openclaw-backup-backup-1'));
    expect(screen.getByTestId('openclaw-restore-confirm')).toBeTruthy();
    expect(harness.restoreBackup).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('openclaw-restore-confirm-action'));
    await waitFor(() => expect(harness.restoreBackup).toHaveBeenCalledWith('backup-1'));
  });

  it('deletes a local backup only after confirmation, retries failures, and works offline', async () => {
    const harness = createAdapterHarness({ state: 'offline' });
    harness.listBackups.mockResolvedValue([{ id: 'backup-1', createdAt: 1_700_000_000_000 }]);
    harness.removeBackup.mockRejectedValueOnce(new Error('storage unavailable'));
    const screen = renderScreen(harness, { isPro: false, initialTab: 'backups' });
    await waitFor(() => expect(screen.getByTestId('openclaw-backup-delete-backup-1')).toBeTruthy());
    fireEvent.press(screen.getByTestId('openclaw-backup-delete-backup-1'));
    expect(harness.removeBackup).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('openclaw-backup-delete-confirm-action'));
    await waitFor(() => expect(screen.getByText('storage unavailable')).toBeTruthy());
    expect(screen.getByTestId('openclaw-backup-backup-1')).toBeTruthy();
    fireEvent.press(screen.getByTestId('openclaw-backup-delete-confirm-action'));
    await waitFor(() => expect(screen.getByTestId('openclaw-backups-empty')).toBeTruthy());
    expect(harness.removeBackup).toHaveBeenCalledTimes(2);
    expect(harness.restoreBackup).not.toHaveBeenCalled();
  });

  it('ignores a stale tab load after the adapter changes', async () => {
    let resolveFirst: ((value: { config: Record<string, unknown>; hash: string }) => void) | undefined;
    let resolveSecond: ((value: { config: Record<string, unknown>; hash: string }) => void) | undefined;
    const first = createAdapterHarness();
    const second = createAdapterHarness();
    first.view.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFirst = resolve;
    }));
    second.view.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSecond = resolve;
    }));
    const screen = renderScreen(first);

    await waitFor(() => expect(first.view).toHaveBeenCalledTimes(1));
    screen.rerender(
      <OpenClawManageScreen
        adapter={second.adapter}
        isPro
        initialTab="configuration"
        onBack={screen.onBack}
        onOpenPaywall={screen.onOpenPaywall}
      />,
    );
    await waitFor(() => expect(second.view).toHaveBeenCalledTimes(1));

    await act(async () => {
      resolveFirst?.({ config: { source: 'stale' }, hash: 'hash-stale' });
    });
    expect(screen.getByTestId('openclaw-manage-loading')).toBeTruthy();
    expect(screen.queryByText(/stale/)).toBeNull();

    await act(async () => {
      resolveSecond?.({ config: { source: 'current' }, hash: 'hash-current' });
    });
    await waitFor(() => expect(
      screen.getByTestId('openclaw-configuration-content'),
    ).toBeTruthy());
    // A primitive section shows its literal in the row caption; there is nothing to expand.
    expect(screen.getByText('"current"')).toBeTruthy();
    expect(screen.getByTestId('openclaw-config-key-source').props.onPress).toBeUndefined();
    expect(screen.queryByText(/stale/)).toBeNull();
  });

  it('renders a skeleton while loading and the explicit empty configuration state', async () => {
    let resolveView: ((value: { config: null; hash: null }) => void) | undefined;
    const harness = createAdapterHarness();
    harness.view.mockImplementationOnce(() => new Promise((resolve) => {
      resolveView = resolve;
    }));
    const screen = renderScreen(harness);

    await waitFor(() => expect(screen.getByTestId('openclaw-manage-loading')).toBeTruthy());
    await act(async () => resolveView?.({ config: null, hash: null }));
    await waitFor(() => expect(screen.getByTestId('openclaw-configuration-empty')).toBeTruthy());
  });

  it('keeps a failed request stable until Retry is pressed', async () => {
    const harness = createAdapterHarness();
    harness.view
      .mockRejectedValueOnce(new AdapterError('server', 'private server detail'))
      .mockResolvedValueOnce({ config: { ok: true }, hash: 'hash-2' });
    const screen = renderScreen(harness);

    await waitFor(() => expect(screen.getByTestId('openclaw-manage-error')).toBeTruthy());
    expect(harness.view).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Server error')).toBeTruthy();
    fireEvent.press(screen.getByTestId('openclaw-manage-error-action'));
    await waitFor(() => expect(harness.view).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('openclaw-manage-error')).toBeNull());
  });

  it('retains cached content behind the offline banner', async () => {
    const harness = createAdapterHarness();
    const screen = renderScreen(harness);
    await waitFor(() => expect(screen.getByTestId('openclaw-configuration-content')).toBeTruthy());

    act(() => harness.emitState('offline'));
    expect(screen.getByTestId('openclaw-manage-offline')).toBeTruthy();
    expect(screen.getByTestId('openclaw-configuration-content')).toBeTruthy();
    expect(harness.view).toHaveBeenCalledTimes(1);
  });

  it('blocks management calls and preserves each contextual paywall trigger without Pro access', () => {
    const harness = createAdapterHarness();
    const screen = renderScreen(harness, { isPro: false, permissionDenied: true });

    expect(screen.getByTestId('openclaw-manage-locked')).toBeTruthy();
    expect(harness.view).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('openclaw-manage-locked-action'));
    expect(screen.onOpenPaywall).toHaveBeenLastCalledWith('configManage');

    fireEvent.press(screen.getByTestId('openclaw-manage-back'));
    fireEvent.press(screen.getByTestId('openclaw-manage-tabs-permissions'));
    fireEvent.press(screen.getByTestId('openclaw-manage-locked-action'));
    expect(screen.onOpenPaywall).toHaveBeenLastCalledWith('openclawPermissions');

    fireEvent.press(screen.getByTestId('openclaw-manage-back'));
    fireEvent.press(screen.getByTestId('openclaw-manage-tabs-diagnostics'));
    fireEvent.press(screen.getByTestId('openclaw-manage-locked-action'));
    expect(screen.onOpenPaywall).toHaveBeenLastCalledWith('openclawDiagnostics');

    fireEvent.press(screen.getByTestId('openclaw-manage-back'));
    fireEvent.press(screen.getByTestId('openclaw-manage-tabs-backups'));
    fireEvent.press(screen.getByTestId('openclaw-manage-locked-action'));
    expect(screen.onOpenPaywall).toHaveBeenLastCalledWith('configBackups');
    expect(harness.permissions).not.toHaveBeenCalled();
    expect(harness.doctor).not.toHaveBeenCalled();
    expect(harness.listBackups).not.toHaveBeenCalled();
  });

  it('previews real management data for free users and gates only the last step', async () => {
    const harness = createAdapterHarness();
    harness.doctor.mockResolvedValue({
      ok: false,
      summary: 'Two issues found.',
      checks: [
        { name: 'Gateway', status: 'pass', message: 'Ready' },
        { name: 'Config', status: 'pass', message: 'Readable' },
        { name: 'Sandbox', status: 'warn', message: 'Sandbox is off' },
        { name: 'Allowlist', status: 'fail', message: 'Allowlist is empty' },
      ],
      raw: 'doctor: issues',
    });
    harness.listBackups.mockResolvedValue([{ id: 'backup-1', createdAt: 1_700_000_000_000 }]);
    const screen = renderScreen(harness, { isPro: false });
    const lastContinuation = () => screen.onOpenPaywall.mock.calls.at(-1)?.[1] as (() => void) | undefined;

    // Configuration: keys load for free; an expanded key is veiled and Edit is gated.
    await waitFor(() => expect(screen.getByTestId('openclaw-configuration-content')).toBeTruthy());
    expect(screen.queryByTestId('openclaw-manage-locked')).toBeNull();
    fireEvent.press(screen.getByTestId('openclaw-config-key-theme'));
    expect(screen.getByTestId('openclaw-config-gate-theme-teaser')).toBeTruthy();
    fireEvent.press(screen.getByTestId('openclaw-config-gate-theme-action'));
    expect(screen.onOpenPaywall).toHaveBeenLastCalledWith('configManage', undefined);
    fireEvent.press(screen.getByTestId('openclaw-configuration-edit'));
    expect(screen.onOpenPaywall).toHaveBeenLastCalledWith('configManage', expect.any(Function));
    expect(screen.queryByTestId('openclaw-configuration-editor')).toBeNull();
    act(() => lastContinuation()?.());
    expect(screen.getByTestId('openclaw-configuration-editor')).toBeTruthy();

    // Permissions: statuses load for free; details, rules and repair are gated.
    fireEvent.press(screen.getByTestId('openclaw-manage-back'));
    fireEvent.press(screen.getByTestId('openclaw-manage-tabs-permissions'));
    await waitFor(() => expect(screen.getByTestId('openclaw-permissions-content')).toBeTruthy());
    expect(harness.permissions).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('openclaw-permission-web')).toBeTruthy();
    expect(screen.getByTestId('openclaw-permissions-gate-teaser')).toBeTruthy();
    fireEvent.press(screen.getByTestId('openclaw-permission-web'));
    expect(screen.onOpenPaywall).toHaveBeenLastCalledWith('openclawPermissions', expect.any(Function));
    expect(screen.queryByTestId('openclaw-detail-sheet')).toBeNull();
    fireEvent.press(screen.getByTestId('openclaw-permissions-repair'));
    expect(screen.onOpenPaywall).toHaveBeenLastCalledWith('openclawPermissions', expect.any(Function));
    expect(screen.queryByTestId('openclaw-repair-confirm')).toBeNull();
    expect(harness.repair).not.toHaveBeenCalled();

    // Diagnostics: doctor runs for free; two checks are readable, the rest veiled.
    fireEvent.press(screen.getByTestId('openclaw-manage-back'));
    fireEvent.press(screen.getByTestId('openclaw-manage-tabs-diagnostics'));
    await waitFor(() => expect(screen.getByTestId('openclaw-diagnostics-content')).toBeTruthy());
    expect(harness.doctor).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('openclaw-diagnostic-check-0')).toBeTruthy();
    expect(screen.getByTestId('openclaw-diagnostic-check-1')).toBeTruthy();
    expect(screen.getByTestId('openclaw-diagnostics-gate-teaser')).toBeTruthy();
    expect(screen.getByTestId('openclaw-diagnostics-hidden-checks')).toBeTruthy();
    expect(screen.getByTestId('openclaw-diagnostic-check-3')).toBeTruthy();
    fireEvent.press(screen.getByTestId('openclaw-diagnostics-details'));
    expect(screen.onOpenPaywall).toHaveBeenLastCalledWith('openclawDiagnostics', expect.any(Function));
    expect(screen.queryByTestId('openclaw-detail-sheet')).toBeNull();
    fireEvent.press(screen.getByTestId('openclaw-diagnostics-repair'));
    expect(screen.onOpenPaywall).toHaveBeenLastCalledWith('openclawDiagnostics', expect.any(Function));
    expect(harness.repair).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('openclaw-diagnostics-gate-action'));
    expect(screen.onOpenPaywall).toHaveBeenLastCalledWith('openclawDiagnostics', undefined);

    // Backups: the list is free; create and the restore confirmation are gated with continuations.
    fireEvent.press(screen.getByTestId('openclaw-manage-back'));
    fireEvent.press(screen.getByTestId('openclaw-manage-tabs-backups'));
    await waitFor(() => expect(screen.getByTestId('openclaw-backups-list')).toBeTruthy());
    fireEvent.press(screen.getByTestId('openclaw-backup-create'));
    expect(screen.onOpenPaywall).toHaveBeenLastCalledWith('configBackups', expect.any(Function));
    expect(harness.createBackup).not.toHaveBeenCalled();
    await act(async () => { await lastContinuation()?.(); });
    expect(harness.createBackup).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('openclaw-backup-backup-1'));
    expect(screen.getByTestId('openclaw-restore-confirm')).toBeTruthy();
    fireEvent.press(screen.getByTestId('openclaw-restore-confirm-action'));
    expect(screen.onOpenPaywall).toHaveBeenLastCalledWith('configBackups', expect.any(Function));
    expect(harness.restoreBackup).not.toHaveBeenCalled();
    await act(async () => { await lastContinuation()?.(); });
    expect(harness.restoreBackup).toHaveBeenCalledWith('backup-1');
  });

  it('does not call operations that runtime capabilities downgrade', () => {
    const harness = createAdapterHarness({ capabilities: { configManage: false } });
    const screen = renderScreen(harness);

    expect(screen.getByTestId('openclaw-manage-unsupported')).toBeTruthy();
    expect(harness.view).not.toHaveBeenCalled();
  });
});
