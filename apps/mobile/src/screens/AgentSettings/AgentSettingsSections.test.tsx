import React from 'react';
import {
  act,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react-native';
import {
  CAPABILITY_MATRIX,
  type AgentAdapter,
  type AgentDescriptor,
  type CostSummary,
  type CronJob,
  type DiscoverSkillItem,
  type ModelSelectionState,
  type SkillStatusEntry,
  type SkillStatusReport,
  type UsageResult,
  type UsageTotals,
} from '@clawket/agent-protocol';
import { CronSection } from './CronSection';
import { FilesSection } from './FilesSection';
import { ModelsSection } from './ModelsSection';
import { SkillsSection } from './SkillsSection';
import { UsageSection } from './UsageSection';
import { IdentitySection } from './IdentitySection';

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

jest.mock('../../components/ui/FormTextInput', () => {
  const ReactRuntime = require('react');
  const { TextInput } = require('react-native');
  return {
    FormTextInput: (props: Record<string, unknown>) => ReactRuntime.createElement(TextInput, props),
  };
});

jest.mock('../../components/ui/ThemedSwitch', () => {
  const ReactRuntime = require('react');
  return {
    ThemedSwitch: (props: Record<string, unknown>) => ReactRuntime.createElement('Switch', props),
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
    SettingsRow: ({ testID, title, value, disabled, onPress, trailing }: {
      testID?: string;
      title?: string;
      value?: string;
      disabled?: boolean;
      onPress?: () => void;
      trailing?: React.ReactNode;
    }) => ReactRuntime.createElement(
      onPress ? Pressable : View,
      { testID, disabled, onPress },
      ReactRuntime.createElement(Text, null, title),
      value ? ReactRuntime.createElement(Text, null, value) : null,
      trailing,
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

jest.mock('./UsagePosterSheet', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    UsagePosterSheet: ({ visible }: { visible: boolean }) => visible
      ? ReactRuntime.createElement(View, { testID: 'mock-usage-poster' })
      : null,
  };
});

const agent: AgentDescriptor = {
  connectionId: 'studio',
  agentId: 'main',
  name: 'Main',
  isMain: true,
  mainSessionKey: 'agent:main:main',
};

const selection: ModelSelectionState = {
  currentModel: 'openai/gpt-5',
  currentProvider: 'openai',
  currentBaseUrl: '',
  models: [
    { id: 'gpt-5', name: 'GPT-5', provider: 'openai' },
    {
      id: 'mini',
      name: 'Mini',
      provider: 'openai',
      cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0 },
    },
  ],
};

function skill(patch: Partial<SkillStatusEntry> = {}): SkillStatusEntry {
  return {
    name: 'Builder',
    description: 'Builds things',
    source: 'managed',
    bundled: false,
    filePath: '/skills/builder/SKILL.md',
    baseDir: '/skills/builder',
    skillKey: 'builder',
    always: false,
    disabled: false,
    blockedByAllowlist: false,
    eligible: true,
    deletable: true,
    requirements: {},
    missing: {},
    configChecks: [],
    install: [],
    ...patch,
  };
}

const report: SkillStatusReport = {
  workspaceDir: '/workspace',
  managedSkillsDir: '/skills',
  skills: [skill()],
};

const discovered: DiscoverSkillItem = {
  id: 'clawhub:planner',
  source: 'clawhub',
  slug: 'planner',
  title: 'Planner',
  summary: 'Plans work',
  author: 'ClawHub',
  detailUrl: 'https://example.com/planner',
  installCommand: 'Install planner',
};

const cronJob: CronJob = {
  id: 'daily',
  name: 'Daily brief',
  enabled: true,
  createdAtMs: 1,
  updatedAtMs: 1,
  schedule: { kind: 'every', everyMs: 3_600_000 },
  sessionTarget: 'main',
  wakeMode: 'now',
  payload: { kind: 'systemEvent', text: 'Summarize today' },
  state: { nextRunAtMs: 2_000, lastRunAtMs: 1_000, lastRunStatus: 'ok' },
};

const usageTotals: UsageTotals = {
  input: 800,
  output: 200,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 1_000,
  totalCost: 1.25,
  inputCost: 0.5,
  outputCost: 0.75,
  cacheReadCost: 0,
  cacheWriteCost: 0,
  missingCostEntries: 0,
};

const usageResult: UsageResult = {
  totals: usageTotals,
  sessions: [{ key: 'main', usage: { totalTokens: 1_000, totalCost: 1.25 } }],
  aggregates: {
    messages: { total: 4, user: 2, assistant: 2, toolCalls: 3, toolResults: 3, errors: 0 },
    tools: { totalCalls: 3, uniqueTools: 2, tools: [] },
    byModel: [{ provider: 'openai', model: 'gpt-5', count: 4, totals: usageTotals }],
    byProvider: [],
    byAgent: [],
    byChannel: [],
    daily: [{ date: '2026-09-05', tokens: 1_000, cost: 1.25, messages: 4, toolCalls: 3, errors: 0 }],
  },
};

const costSummary: CostSummary = {
  totals: usageTotals,
  daily: [{ date: '2026-09-05', ...usageTotals }],
};

function adapterWith(patch: Partial<AgentAdapter>): AgentAdapter {
  return {
    capabilities: { ...CAPABILITY_MATRIX.openclaw },
    ...patch,
  } as AgentAdapter;
}

describe('AgentSettings functional sections', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('loads and switches models with capability-derived session scope', async () => {
    const setSelection = jest.fn(async () => ({
      ...selection,
      currentModel: 'mini',
      ok: true,
      scope: 'global' as const,
    }));
    const adapter = adapterWith({
      management: {
        models: {
          getSelection: jest.fn(async () => selection),
          setSelection,
          listThinkingLevels: () => ['low', 'high'],
        },
      },
    });
    const view = render(<ModelsSection adapter={adapter} agent={agent} online />);

    await waitFor(() => expect(view.getByTestId('agent-model-row-openai:mini')).toBeTruthy());
    fireEvent.press(view.getByTestId('agent-model-row-openai:mini'));
    await waitFor(() => expect(setSelection).toHaveBeenCalledWith({
      model: 'mini',
      provider: 'openai',
      scope: 'session',
      sessionKey: agent.mainSessionKey,
    }));

    fireEvent.press(view.getByTestId('agent-models-tabs-providers'));
    expect(view.getByText('$0.01 / $0.02')).toBeTruthy();
  });

  it('loads identity fields and saves profile changes through agent management', async () => {
    const update = jest.fn(async () => ({ ok: true, agentId: agent.agentId }));
    const set = jest.fn(async () => ({ ok: true }));
    const onChanged = jest.fn();
    const adapter = identityAdapter({ update, set });
    const view = render(
      <IdentitySection
        adapter={adapter}
        agent={agent}
        online
        isPro
        onOpenPaywall={jest.fn()}
        onChanged={onChanged}
      />,
    );

    expect(view.getByTestId('agent-identity-loading')).toBeTruthy();
    await waitFor(() => expect(view.getByTestId('agent-identity-profile')).toBeTruthy());
    expect(view.getByText('🦉 Main')).toBeTruthy();
    fireEvent.press(view.getByTestId('agent-identity-profile'));
    fireEvent.changeText(view.getByTestId('agent-identity-profile-name'), 'Writer');
    fireEvent.changeText(view.getByTestId('agent-identity-profile-emoji'), '✍️');
    fireEvent.press(view.getByTestId('agent-identity-profile-save'));

    await waitFor(() => expect(update).toHaveBeenCalledWith(agent.agentId, { name: 'Writer' }));
    expect(set).toHaveBeenCalledWith(
      'IDENTITY.md',
      expect.stringContaining('- **Emoji:** ✍️'),
      agent.agentId,
    );
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('keeps core identity files editable and gates the save through Pro', async () => {
    const set = jest.fn(async () => ({ ok: true }));
    const onOpenPaywall = jest.fn();
    const adapter = identityAdapter({ set });
    const view = render(
      <IdentitySection
        adapter={adapter}
        agent={agent}
        online
        isPro={false}
        onOpenPaywall={onOpenPaywall}
      />,
    );
    await waitFor(() => expect(view.getByTestId('agent-identity-user')).toBeTruthy());
    fireEvent.press(view.getByTestId('agent-identity-user'));
    expect(view.getByTestId('agent-identity-user-name').props.value).toBe('Lucy');
    fireEvent.press(view.getByTestId('agent-identity-file-edit'));
    expect(view.getByTestId('agent-identity-user-name').props.editable).toBe(true);
    expect(onOpenPaywall).not.toHaveBeenCalled();
    fireEvent.changeText(view.getByTestId('agent-identity-user-name'), 'Lucy Chen');
    fireEvent.press(view.getByTestId('agent-identity-file-save'));
    expect(onOpenPaywall).toHaveBeenCalledWith('coreFileEditing', expect.any(Function));
    expect(set).not.toHaveBeenCalled();
    const continueSaving = onOpenPaywall.mock.calls[0]?.[1] as (() => void) | undefined;
    act(() => continueSaving?.());
    await waitFor(() => expect(set).toHaveBeenCalledWith(
      'USER.md',
      expect.stringContaining('- **Name:** Lucy Chen'),
      agent.agentId,
    ));
  });

  it('keeps the agent-create entry visible and creates through capability operations after Pro unlock', async () => {
    const create = jest.fn(async () => ({
      ok: true,
      agentId: 'researcher',
      name: 'Researcher',
      workspace: '/workspace-researcher',
    }));
    const onOpenPaywall = jest.fn();
    const onChanged = jest.fn();
    const adapter = identityAdapter({ create });
    const view = render(
      <IdentitySection
        adapter={adapter}
        agent={agent}
        online
        isPro={false}
        onOpenPaywall={onOpenPaywall}
        onChanged={onChanged}
      />,
    );
    await waitFor(() => expect(view.getByTestId('agent-identity-create')).toBeTruthy());
    fireEvent.press(view.getByTestId('agent-identity-create'));
    expect(onOpenPaywall).toHaveBeenCalledWith('agents', expect.any(Function));
    expect(view.queryByTestId('agent-identity-create-sheet')).toBeNull();
    const continueCreating = onOpenPaywall.mock.calls[0]?.[1] as (() => void) | undefined;
    act(() => continueCreating?.());
    expect(view.getByTestId('agent-identity-create-sheet')).toBeTruthy();

    view.rerender(
      <IdentitySection
        adapter={adapter}
        agent={agent}
        online
        isPro
        onOpenPaywall={onOpenPaywall}
        onChanged={onChanged}
      />,
    );
    fireEvent.changeText(view.getByTestId('agent-identity-create-name'), 'Researcher');
    fireEvent.changeText(view.getByTestId('agent-identity-create-emoji'), '🔬');
    fireEvent.press(view.getByTestId('agent-identity-create-action'));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ name: 'Researcher', emoji: '🔬' }));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('opens the real create sheet from a route action and reports the created Agent', async () => {
    const create = jest.fn(async () => ({
      ok: true,
      agentId: 'route-created',
      name: 'Route Created',
      workspace: '/workspace-route-created',
    }));
    const onCreated = jest.fn();
    const view = render(
      <IdentitySection
        adapter={identityAdapter({ create })}
        agent={agent}
        online
        isPro
        openCreateOnMount
        onOpenPaywall={jest.fn()}
        onCreated={onCreated}
      />,
    );

    await waitFor(() => expect(view.getByTestId('agent-identity-create-sheet')).toBeTruthy());
    fireEvent.changeText(view.getByTestId('agent-identity-create-name'), 'Route Created');
    fireEvent.press(view.getByTestId('agent-identity-create-action'));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('route-created'));
  });

  it('shows identity load errors, disables offline edits, and confirms agent removal', async () => {
    const failed = identityAdapter({
      get: jest.fn(async () => { throw new Error('Identity unavailable'); }),
      list: undefined,
    });
    const errorView = render(
      <IdentitySection
        adapter={failed}
        agent={agent}
        online
        isPro
        onOpenPaywall={jest.fn()}
      />,
    );
    await waitFor(() => expect(errorView.getByTestId('agent-identity-error')).toBeTruthy());
    errorView.unmount();

    const remove = jest.fn(async () => ({ ok: true, agentId: 'writer' }));
    const onRemoved = jest.fn();
    const editable = identityAdapter({ remove });
    const writer = { ...agent, agentId: 'writer', name: 'Writer', isMain: false };
    const view = render(
      <IdentitySection
        adapter={editable}
        agent={writer}
        online={false}
        isPro
        onOpenPaywall={jest.fn()}
        onRemoved={onRemoved}
      />,
    );
    await waitFor(() => expect(view.getByTestId('agent-identity-profile')).toBeTruthy());
    fireEvent.press(view.getByTestId('agent-identity-user'));
    expect(view.getByTestId('agent-identity-file-edit').props.disabled).toBe(true);
    expect(view.getByTestId('agent-identity-delete').props.disabled).toBe(true);

    view.rerender(
      <IdentitySection
        adapter={editable}
        agent={writer}
        online
        isPro
        onOpenPaywall={jest.fn()}
        onRemoved={onRemoved}
      />,
    );
    fireEvent.press(view.getByTestId('agent-identity-delete'));
    fireEvent.press(view.getByTestId('agent-identity-delete-action'));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('writer', true));
    expect(onRemoved).toHaveBeenCalledTimes(1);
  });

  it('manages installed skills and installs discovered skills through adapter operations', async () => {
    const update = jest.fn(async () => ({ ok: true, skillKey: 'builder', config: {} }));
    const remove = jest.fn(async () => ({ ok: true, skillKey: 'builder' }));
    const prompt = jest.fn(async () => ({ runId: 'install-run' }));
    const adapter = adapterWith({
      prompt,
      management: {
        skills: {
          status: jest.fn(async () => report),
          update,
          remove,
          discover: jest.fn(async () => ({ items: [discovered], nextCursor: null, hasMore: false })),
        },
      },
    });
    const view = render(<SkillsSection adapter={adapter} agent={agent} online />);

    await waitFor(() => expect(view.getByTestId('agent-skill-installed-builder')).toBeTruthy());
    fireEvent.press(view.getByTestId('agent-skill-installed-builder'));
    fireEvent.press(view.getByTestId('agent-skill-toggle'));
    await waitFor(() => expect(update).toHaveBeenCalledWith('builder', { enabled: false }));

    await waitFor(() => expect(view.getByTestId('agent-skill-installed-builder')).toBeTruthy());
    fireEvent.press(view.getByTestId('agent-skill-installed-builder'));
    fireEvent.press(view.getByTestId('agent-skill-remove'));
    fireEvent.press(view.getByTestId('agent-skill-remove-confirm-action'));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('builder', agent.agentId));

    fireEvent.press(view.getByTestId('agent-skills-tabs-discover'));
    await waitFor(() => expect(view.getByTestId('agent-skill-discover-clawhub:planner')).toBeTruthy());
    fireEvent.press(view.getByTestId('agent-skill-discover-clawhub:planner'));
    fireEvent.press(view.getByTestId('agent-skill-install'));
    await waitFor(() => expect(prompt).toHaveBeenCalledWith(
      agent.mainSessionKey,
      expect.objectContaining({ text: 'Install planner' }),
    ));
  });

  it('hides discovery and mutation controls when capabilities are absent', async () => {
    const adapter = adapterWith({
      capabilities: {
        ...CAPABILITY_MATRIX.openclaw,
        skillDiscover: false,
        skillInstall: false,
      },
      management: {
        skills: {
          status: jest.fn(async () => report),
          discover: jest.fn(),
          remove: jest.fn(),
        },
      },
    });
    const view = render(<SkillsSection adapter={adapter} agent={agent} online />);

    await waitFor(() => expect(view.getByTestId('agent-skill-installed-builder')).toBeTruthy());
    expect(view.queryByTestId('agent-skills-tabs-discover')).toBeNull();
    fireEvent.press(view.getByTestId('agent-skill-installed-builder'));
    expect(view.queryByTestId('agent-skill-toggle')).toBeNull();
    expect(view.queryByTestId('agent-skill-remove')).toBeNull();
  });

  it('renders Cron heartbeat, jobs, and run records from management operations', async () => {
    const adapter = cronAdapter();
    const view = render(<CronSection adapter={adapter} agent={agent} online />);

    expect(view.getByTestId('agent-cron-loading')).toBeTruthy();
    await waitFor(() => expect(view.getByTestId('agent-cron-job-daily')).toBeTruthy());
    expect(view.getByTestId('agent-cron-heartbeat')).toBeTruthy();

    fireEvent.press(view.getByTestId('agent-cron-tabs-runs'));
    expect(view.getByTestId('agent-cron-run-daily-2000')).toBeTruthy();
    fireEvent.press(view.getByTestId('agent-cron-run-daily-2000'));
    expect(view.getByTestId('agent-cron-run-detail')).toBeTruthy();
  });

  it('creates, edits, runs, deletes, and saves heartbeat settings through Cron management', async () => {
    const adapter = cronAdapter();
    const operations = adapter.management!.cron!;
    const view = render(<CronSection adapter={adapter} agent={agent} online />);
    await waitFor(() => expect(view.getByTestId('agent-cron-job-daily')).toBeTruthy());

    fireEvent.press(view.getByTestId('agent-cron-job-daily'));
    fireEvent.press(view.getByTestId('agent-cron-run'));
    await waitFor(() => expect(operations.run).toHaveBeenCalledWith('daily', 'force'));

    fireEvent.press(view.getByTestId('agent-cron-edit'));
    fireEvent.changeText(view.getByTestId('agent-cron-prompt'), 'Updated summary');
    fireEvent.press(view.getByTestId('agent-cron-save'));
    await waitFor(() => expect(operations.update).toHaveBeenCalledWith(
      'daily',
      expect.objectContaining({ payload: { kind: 'systemEvent', text: 'Updated summary' } }),
    ));

    fireEvent.press(view.getByTestId('agent-cron-create'));
    fireEvent.changeText(view.getByTestId('agent-cron-name'), 'Morning plan');
    fireEvent.changeText(view.getByTestId('agent-cron-schedule'), '30m');
    fireEvent.changeText(view.getByTestId('agent-cron-prompt'), 'Plan today');
    fireEvent.press(view.getByTestId('agent-cron-save'));
    await waitFor(() => expect(operations.add).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Morning plan', schedule: { kind: 'every', everyMs: 1_800_000 } }),
    ));

    fireEvent.press(view.getByTestId('agent-cron-job-daily'));
    fireEvent.press(view.getByTestId('agent-cron-delete'));
    fireEvent.press(view.getByTestId('agent-cron-delete-confirm-action'));
    await waitFor(() => expect(operations.remove).toHaveBeenCalledWith('daily'));

    fireEvent.press(view.getByTestId('agent-cron-heartbeat'));
    fireEvent.changeText(view.getByTestId('agent-heartbeat-every'), '1h');
    fireEvent.press(view.getByTestId('agent-heartbeat-save'));
    await waitFor(() => expect(operations.heartbeat?.set).toHaveBeenCalledWith(
      expect.objectContaining({ every: '1h' }),
    ));
  });

  it('opens the create editor once on mount with the Thread draft as the prompt', async () => {
    const adapter = cronAdapter();
    const operations = adapter.management!.cron!;
    const view = render(
      <CronSection adapter={adapter} agent={agent} online openCreateOnMount initialPrompt="Summarize my inbox" />,
    );
    await waitFor(() => expect(view.getByTestId('agent-cron-editor')).toBeTruthy());
    expect(view.getByTestId('agent-cron-prompt').props.value).toBe('Summarize my inbox');

    fireEvent.changeText(view.getByTestId('agent-cron-name'), 'Inbox digest');
    fireEvent.changeText(view.getByTestId('agent-cron-schedule'), '1h');
    fireEvent.press(view.getByTestId('agent-cron-save'));
    await waitFor(() => expect(operations.add).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Inbox digest', payload: { kind: 'systemEvent', text: 'Summarize my inbox' } }),
    ));
    await waitFor(() => expect(view.queryByTestId('agent-cron-editor')).toBeNull());

    // A later manual "New cron job" starts blank instead of re-seeding the Thread draft.
    fireEvent.press(view.getByTestId('agent-cron-create'));
    await waitFor(() => expect(view.getByTestId('agent-cron-editor')).toBeTruthy());
    expect(view.getByTestId('agent-cron-prompt').props.value).toBe('');

    const readOnly = render(
      <CronSection adapter={{ ...adapter, capabilities: { ...adapter.capabilities, cronCreate: false } }} agent={agent} online openCreateOnMount />,
    );
    await waitFor(() => expect(readOnly.queryByTestId('agent-cron-create')).toBeNull());
    expect(readOnly.queryByTestId('agent-cron-editor')).toBeNull();
  });

  it('reads and edits files, then routes the save gate to the Pro paywall', async () => {
    const list = jest.fn(async () => [{
      name: 'SOUL.md',
      path: '/SOUL.md',
      missing: false,
      size: 12,
    }]);
    const get = jest.fn(async () => ({
      name: 'SOUL.md',
      path: '/SOUL.md',
      missing: false,
      content: 'Original',
    }));
    const set = jest.fn(async () => ({ ok: true }));
    const adapter = adapterWith({ management: { agents: { files: { list, get, set } } } });
    const onOpenPaywall = jest.fn();
    const view = render(
      <FilesSection
        adapter={adapter}
        agent={agent}
        online
        isPro={false}
        onOpenPaywall={onOpenPaywall}
      />,
    );

    expect(view.getByTestId('agent-files-loading')).toBeTruthy();
    await waitFor(() => expect(view.getByTestId('agent-file-SOUL.md')).toBeTruthy());
    fireEvent.press(view.getByTestId('agent-file-SOUL.md'));
    await waitFor(() => expect(view.getByText('Original')).toBeTruthy());
    fireEvent.press(view.getByTestId('agent-file-edit'));
    expect(view.getByTestId('agent-file-editor-input')).toBeTruthy();
    expect(onOpenPaywall).not.toHaveBeenCalled();
    fireEvent.changeText(view.getByTestId('agent-file-editor-input'), 'Updated');
    fireEvent.press(view.getByTestId('agent-file-save'));
    expect(onOpenPaywall).toHaveBeenCalledWith('coreFileEditing', expect.any(Function));
    expect(set).not.toHaveBeenCalled();
    const continueSaving = onOpenPaywall.mock.calls[0]?.[1] as (() => void) | undefined;
    act(() => continueSaving?.());
    await waitFor(() => expect(set).toHaveBeenCalledWith('SOUL.md', 'Updated', agent.agentId));
  });

  it('loads usage and cost summaries and opens the retained stats poster', async () => {
    const sessions = jest.fn(async () => usageResult);
    const cost = jest.fn(async () => costSummary);
    const adapter = adapterWith({ management: { usage: { sessions, cost } } });
    const view = render(<UsageSection adapter={adapter} agent={agent} online />);

    expect(view.getByTestId('agent-usage-loading')).toBeTruthy();
    await waitFor(() => expect(view.getByTestId('agent-usage-summary')).toBeTruthy());
    expect(view.getByText('$1.25')).toBeTruthy();
    expect(view.getByTestId('agent-usage-cost-breakdown')).toBeTruthy();
    fireEvent.press(view.getByTestId('agent-usage-open-poster'));
    expect(view.getByTestId('mock-usage-poster')).toBeTruthy();

    fireEvent.press(view.getByTestId('agent-usage-range-7d'));
    await waitFor(() => expect(sessions).toHaveBeenCalledTimes(2));
    expect(cost).toHaveBeenCalledTimes(2);
  });

  it('renders empty and error states and disables mutations offline', async () => {
    const emptyCron = cronAdapter({ jobs: [] });
    const cron = render(<CronSection adapter={emptyCron} agent={agent} online={false} />);
    await waitFor(() => expect(cron.getByTestId('agent-cron-empty')).toBeTruthy());
    expect(cron.getByTestId('agent-cron-create').props.disabled).toBe(true);
    cron.unmount();

    const fileError = adapterWith({
      management: { agents: { files: { list: jest.fn(async () => { throw new Error('No files'); }) } } },
    });
    const files = render(
      <FilesSection
        adapter={fileError}
        agent={agent}
        online
        isPro
        onOpenPaywall={jest.fn()}
      />,
    );
    await waitFor(() => expect(files.getByTestId('agent-files-error')).toBeTruthy());
    expect(files.getByTestId('agent-files-empty')).toBeTruthy();
    files.unmount();

    const emptyUsage = adapterWith({
      management: { usage: { sessions: jest.fn(async () => ({})) } },
    });
    const usage = render(<UsageSection adapter={emptyUsage} agent={agent} online />);
    await waitFor(() => expect(usage.getByTestId('agent-usage-empty')).toBeTruthy());
    usage.unmount();

    const usageError = adapterWith({
      management: { usage: { sessions: jest.fn(async () => { throw new Error('No usage'); }) } },
    });
    const failedUsage = render(<UsageSection adapter={usageError} agent={agent} online />);
    await waitFor(() => expect(failedUsage.getByTestId('agent-usage-error')).toBeTruthy());
  });
});

function cronAdapter(input: Readonly<{ jobs?: CronJob[] }> = {}): AgentAdapter {
  const jobs = input.jobs ?? [cronJob];
  const list = jest.fn(async () => ({
    jobs,
    total: jobs.length,
    offset: 0,
    limit: 100,
    hasMore: false,
    nextOffset: null,
  }));
  return adapterWith({
    management: {
      cron: {
        list,
        runs: jest.fn(async () => ({
          entries: [{
            ts: 2_000,
            jobId: 'daily',
            jobName: 'Daily brief',
            action: 'finished' as const,
            status: 'ok' as const,
          }],
          total: 1,
          offset: 0,
          limit: 100,
          hasMore: false,
          nextOffset: null,
        })),
        add: jest.fn(async (create) => ({ ...cronJob, ...create, id: 'created' })),
        update: jest.fn(async (_id, patch) => ({ ...cronJob, ...patch } as CronJob)),
        remove: jest.fn(async () => ({ ok: true })),
        run: jest.fn(async () => undefined),
        heartbeat: {
          get: jest.fn(async () => ({
            every: '30m',
            activeStart: '09:00',
            activeEnd: '17:00',
            activeTimezone: 'UTC',
            session: 'main',
            model: '',
          })),
          set: jest.fn(async () => undefined),
        },
      },
    },
  });
}

function identityAdapter(input: Readonly<{
  list?: jest.Mock;
  get?: jest.Mock;
  set?: jest.Mock;
  update?: jest.Mock;
  remove?: jest.Mock;
  create?: jest.Mock;
}> = {}): AgentAdapter {
  const hasListOverride = Object.prototype.hasOwnProperty.call(input, 'list');
  const list = hasListOverride ? input.list : jest.fn(async () => ({
    defaultId: 'main',
    mainKey: 'main',
    agents: [{ id: 'main', name: 'Main', identity: { emoji: '🦉' } }],
  }));
  const get = input.get ?? jest.fn(async (name: string) => ({
    name,
    path: `/${name}`,
    missing: false,
    content: name === 'IDENTITY.md'
      ? '- **Name:** Main\n- **Emoji:** 🦉\n- **Vibe:** Calm'
      : name === 'USER.md'
        ? '- **Name:** Lucy\n- **What to call them:** Lucy\n\n## Context\n\nBuilding\n\n---'
        : name === 'SOUL.md'
          ? 'Be useful.'
          : 'Remember preferences.',
  }));
  return adapterWith({
    management: {
      agents: {
        ...(list ? { list } : {}),
        update: input.update ?? jest.fn(async (_id, _patch) => ({ ok: true, agentId: agent.agentId })),
        remove: input.remove ?? jest.fn(async (id) => ({ ok: true, agentId: id })),
        create: input.create ?? jest.fn(async ({ name }) => ({
          ok: true,
          agentId: name.toLowerCase(),
          name,
          workspace: `/workspace-${name.toLowerCase()}`,
        })),
        files: {
          get,
          set: input.set ?? jest.fn(async () => ({ ok: true })),
        },
      },
    },
  });
}
