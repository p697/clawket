import React from 'react';
import { Keyboard } from 'react-native';
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
  type SkillStatusEntry,
  type SkillStatusReport,
  type UsageResult,
  type UsageTotals,
} from '@clawket/agent-protocol';
import { CronSection } from './CronSection';
import { FilesSection } from './FilesSection';
import { SkillsSection } from './SkillsSection';
import { UsageSection } from './UsageSection';

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
    AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
    Keyboard: { dismiss: jest.fn() },
    Platform: { OS: 'ios', select: (values: Record<string, unknown>) => values.ios ?? values.default },
    ActivityIndicator: host('ActivityIndicator'),
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
    CircleAlert: (props: Record<string, unknown>) => ReactRuntime.createElement('Icon', props),
    ChevronRight: (props: Record<string, unknown>) => ReactRuntime.createElement('Icon', props),
    Check: (props: Record<string, unknown>) => ReactRuntime.createElement('Icon', props),
    LockKeyhole: (props: Record<string, unknown>) => ReactRuntime.createElement('Icon', props),
  };
});

jest.mock('react-i18next', () => {
  const translate = (key: string, options?: Record<string, unknown>) => key.replace(/{{(.*?)}}/g, (_, name) => String(options?.[name] ?? `{{${name}}}`));
  return { useTranslation: () => ({ t: translate }) };
});

jest.mock('../../theme', () => ({
  useAppTheme: () => ({ theme: { scheme: 'light', colors } }),
}));

const mockAcknowledgeCronFailures = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock('../../services/cron-failure-acks', () => ({
  CronFailureAckService: {
    acknowledge: (...args: unknown[]) => mockAcknowledgeCronFailures(...args),
  },
}));

jest.mock('../../services/analytics/events', () => ({
  ...jest.requireActual('../../services/analytics/events'),
  analyticsEvents: { usageRangeChanged: jest.fn() },
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

jest.mock('../../components/ui/FloatingButton', () => ({
  FloatingButton: (props: Record<string, unknown>) => require('react').createElement('Pressable', props),
}));

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

jest.mock('react-native-enriched-markdown', () => ({
  EnrichedMarkdownText: (props: Record<string, unknown>) => require('react').createElement('Markdown', props),
}));
jest.mock('../../components/ui/CompositionSafeBottomSheetTextInput', () => ({
  CompositionSafeBottomSheetTextInput: (props: Record<string, unknown>) => require('react').createElement('TextInput', props),
}));

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
    SettingsRow: ({ testID, title, value, disabled, onPress, trailing, children }: {
      testID?: string;
      title?: string;
      value?: string;
      disabled?: boolean;
      onPress?: () => void;
      trailing?: React.ReactNode;
      children?: React.ReactNode;
    }) => ReactRuntime.createElement(
      onPress ? Pressable : View,
      { testID, disabled, onPress },
      children ?? ReactRuntime.createElement(Text, null, title),
      !children && value ? ReactRuntime.createElement(Text, null, value) : null,
      trailing,
    ),
  };
});

jest.mock('../../components/ui/Sheet', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    Sheet: ({ visible, testID, title, children, footer, headerRight, onClose, onAfterClose }: {
      visible: boolean;
      testID?: string;
      title?: string;
      children: React.ReactNode;
      footer?: React.ReactNode;
      headerRight?: React.ReactNode;
      onClose: () => void;
      onAfterClose?: () => void;
    }) => {
      const wasVisible = ReactRuntime.useRef(false);
      ReactRuntime.useEffect(() => {
        if (wasVisible.current && !visible) onAfterClose?.();
        wasVisible.current = visible;
      }, [visible, onAfterClose]);
      return visible ? ReactRuntime.createElement(View, { testID },
        title ? ReactRuntime.createElement(Text, null, title) : null,
        ReactRuntime.createElement(Pressable, { testID: `${testID}-close`, onPress: onClose }),
        headerRight, children, footer,
      ) : null;
    },
  };
});

jest.mock('../../components/ui/ConfirmationModal', () => {
  const ReactRuntime = require('react');
  const { Pressable, View } = require('react-native');
  return {
    ConfirmationModal: ({ visible, testID, onClose, onConfirm }: {
      visible: boolean; testID: string; onClose: () => void; onConfirm: () => void;
    }) => visible ? ReactRuntime.createElement(View, { testID },
      ReactRuntime.createElement(Pressable, { testID: `${testID}-cancel`, onPress: onClose }),
      ReactRuntime.createElement(Pressable, { testID: `${testID}-confirm`, onPress: onConfirm }),
    ) : null,
  };
});

jest.mock('../../components/ui/Skeleton', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    Skeleton: (props: Record<string, unknown>) => ReactRuntime.createElement(View, props),
  };
});

jest.mock('react-native-svg', () => {
  const host = (name: string) => ({ children, ...props }: Record<string, unknown>) => require('react').createElement(name, props, children);
  return Object.assign(
    { __esModule: true },
    Object.fromEntries(['Svg', 'Path', 'Defs', 'LinearGradient', 'Rect', 'Stop']
      .map((name) => [name === 'Svg' ? 'default' : name, host(name)])),
  );
});

jest.mock('./UsagePosterSheet', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    UsagePosterSheet: ({ visible, data }: { visible: boolean; data: { costCaption?: string } }) => visible
      ? ReactRuntime.createElement(View, { testID: 'mock-usage-poster', costCaption: data.costCaption })
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
    connection: { backendKind: 'openclaw' },
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

  it('manages installed skills through adapter operations', async () => {
    const update = jest.fn(async () => ({ ok: true, skillKey: 'builder', config: {} }));
    const remove = jest.fn(async () => ({ ok: true, skillKey: 'builder' }));
    const adapter = adapterWith({
      management: {
        skills: {
          status: jest.fn(async () => report),
          update,
          remove,
        },
      },
    });
    const view = render(<SkillsSection adapter={adapter} agent={agent} online />);

    await waitFor(() => expect(view.getByTestId('agent-skill-installed-builder')).toBeTruthy());
    fireEvent.press(view.getByTestId('agent-skill-installed-builder'));
    fireEvent(view.getByTestId('agent-skill-toggle'), 'valueChange', false);
    await waitFor(() => expect(update).toHaveBeenCalledWith('builder', { enabled: false }));

    await waitFor(() => expect(view.getByTestId('agent-skill-installed-builder')).toBeTruthy());
    fireEvent.press(view.getByTestId('agent-skill-installed-builder'));
    fireEvent.press(view.getByTestId('agent-skill-remove'));
    await waitFor(() => expect(view.getByTestId('agent-skill-remove-confirm-confirm')).toBeTruthy());
    fireEvent.press(view.getByTestId('agent-skill-remove-confirm-confirm'));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('builder', agent.agentId));
  });

  it.each(['openclaw', 'hermes'] as const)('hands %s SKILL.md to the document page only after the detail sheet has closed', async (backend) => {
    const get = jest.fn(async () => ({ skillKey: 'builder', name: 'Builder', path: '/SKILL.md', content: '# Original', editable: true, linkedFiles: {} }));
    const adapter = adapterWith({ connection: { backendKind: backend } as AgentAdapter['connection'],
      capabilities: { ...CAPABILITY_MATRIX[backend] }, management: { skills: { status: jest.fn(async () => report), get } } });
    const onOpenSource = jest.fn();
    jest.mocked(Keyboard.dismiss).mockClear();
    const view = render(<SkillsSection adapter={adapter} agent={agent} online onOpenSource={onOpenSource} />);
    await waitFor(() => expect(view.getByTestId('agent-skill-installed-builder')).toBeTruthy());
    fireEvent.press(view.getByTestId('agent-skill-installed-builder'));
    expect(Keyboard.dismiss).toHaveBeenCalledTimes(1);
    fireEvent.press(view.getByTestId('agent-skill-source'));
    // The page is pushed from the sheet's close callback (the mocked sheet closes at once), never over the sheet.
    await waitFor(() => expect(onOpenSource).toHaveBeenCalledWith(expect.objectContaining({ skillKey: 'builder', name: 'Builder' })));
    expect(onOpenSource).toHaveBeenCalledTimes(1);
    expect(view.queryByTestId('agent-skill-detail')).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it('omits the source entry when the adapter does not expose document reading or no page can host it', async () => {
    const adapter = adapterWith({ management: { skills: { status: jest.fn(async () => report) } } });
    const view = render(<SkillsSection adapter={adapter} agent={agent} online onOpenSource={jest.fn()} />);
    await waitFor(() => expect(view.getByTestId('agent-skill-installed-builder')).toBeTruthy());
    fireEvent.press(view.getByTestId('agent-skill-installed-builder'));
    expect(view.queryByTestId('agent-skill-source')).toBeNull();
    view.unmount();

    const readable = adapterWith({ management: { skills: { status: jest.fn(async () => report), get: jest.fn() } } });
    const hostless = render(<SkillsSection adapter={readable} agent={agent} online />);
    await waitFor(() => expect(hostless.getByTestId('agent-skill-installed-builder')).toBeTruthy());
    fireEvent.press(hostless.getByTestId('agent-skill-installed-builder'));
    expect(hostless.queryByTestId('agent-skill-source')).toBeNull();
  });

  it('hides mutation controls when capabilities are absent', async () => {
    const adapter = adapterWith({
      capabilities: {
        ...CAPABILITY_MATRIX.openclaw,
        skillDiscover: false,
        skillInstall: false,
      },
      management: {
        skills: {
          status: jest.fn(async () => report),
          remove: jest.fn(),
        },
      },
    });
    const view = render(<SkillsSection adapter={adapter} agent={agent} online />);

    await waitFor(() => expect(view.getByTestId('agent-skill-installed-builder')).toBeTruthy());
    fireEvent.press(view.getByTestId('agent-skill-installed-builder'));
    expect(view.queryByTestId('agent-skill-toggle')).toBeNull();
    expect(view.queryByTestId('agent-skill-remove')).toBeNull();
  });

  it.each(['openclaw', 'hermes'] as const)('toggles %s in place without hiding or reordering the list', async (backend) => {
    let finishUpdate!: (result: { ok: boolean; skillKey: string; config: null }) => void;
    const items = [skill({ name: 'Zed', skillKey: 'zed' }), skill({ name: 'Alpha', skillKey: 'alpha' })];
    const status = jest.fn(async () => ({ ...report, skills: items.map((item) => ({ ...item })) }));
    const update = jest.fn(() => new Promise<{ ok: boolean; skillKey: string; config: null }>((resolve) => { finishUpdate = resolve; }));
    const adapter = adapterWith({ capabilities: CAPABILITY_MATRIX[backend], management: { skills: { status, update } } });
    const view = render(<SkillsSection adapter={adapter} agent={agent} online />);
    await waitFor(() => expect(view.getByTestId('agent-skill-switch-alpha')).toBeTruthy());
    const control = view.getByTestId('agent-skill-switch-alpha');
    expect(view.getAllByText('Builds things')).toHaveLength(2);
    expect(view.queryByTestId('agent-skills-tabs')).toBeNull();
    fireEvent(control, 'valueChange', false);
    fireEvent(control, 'valueChange', false);
    expect(update).toHaveBeenCalledTimes(1);
    expect(view.queryByTestId('agent-skills-loading')).toBeNull();
    expect(view.queryByTestId('agent-skill-detail')).toBeNull();
    expect(control.props.value).toBe(true);
    expect(control.props.disabled).toBe(true);
    items[1] = { ...items[1]!, disabled: true };
    await act(async () => finishUpdate({ ok: true, skillKey: 'alpha', config: null }));
    await waitFor(() => expect(control.props.disabled).toBe(false));
    expect(view.getByTestId('agent-skill-switch-alpha')).toBe(control);
    expect(control.props.value).toBe(false);
    expect(view.getByText('2 skills · 1 enabled')).toBeTruthy();
    expect(view.getAllByTestId(/^agent-skill-installed-/).map((row) => row.props.testID))
      .toEqual(['agent-skill-installed-alpha', 'agent-skill-installed-zed']);
  });

  it('keeps the switch on for missing requirements and never offers an always-on toggle', async () => {
    const adapter = adapterWith({ management: { skills: {
      status: jest.fn(async () => ({ ...report, skills: [
        skill({ eligible: false, missing: { env: ['IMAGE_KEY'] } }),
        skill({ name: 'Core', skillKey: 'core', always: true }),
      ] })),
      update: jest.fn(),
    } } });
    const view = render(<SkillsSection adapter={adapter} agent={agent} online />);
    await waitFor(() => expect(view.getByText('Missing: IMAGE_KEY')).toBeTruthy());
    expect(view.getByTestId('agent-skill-switch-builder').props.value).toBe(true);
    expect(view.queryByTestId('agent-skill-switch-core')).toBeNull();
    expect(view.getByText('Always on')).toBeTruthy();
    fireEvent.press(view.getByTestId('agent-skill-installed-builder'));
    expect(view.getByTestId('agent-skill-toggle').props.value).toBe(true);
    expect(view.getByText('Unavailable')).toBeTruthy();
  });

  it('preserves the prior value on a rejected update and shows the error inside details', async () => {
    const update = jest.fn(async () => { throw new Error('Permission denied'); });
    const adapter = adapterWith({ management: { skills: { status: jest.fn(async () => report), update } } });
    const view = render(<SkillsSection adapter={adapter} agent={agent} online />);
    await waitFor(() => expect(view.getByTestId('agent-skill-switch-builder')).toBeTruthy());
    fireEvent.press(view.getByTestId('agent-skill-installed-builder'));
    fireEvent(view.getByTestId('agent-skill-toggle'), 'valueChange', false);
    await waitFor(() => expect(view.getByTestId('agent-skill-detail-error')).toBeTruthy());
    expect(view.getByTestId('agent-skill-toggle').props.value).toBe(true);
    expect(view.getByTestId('agent-skill-switch-builder').props.value).toBe(true);
  });

  it('keeps an acknowledged update when the quiet status refresh fails', async () => {
    const status = jest.fn().mockResolvedValueOnce(report).mockRejectedValue(new Error('Read timed out'));
    const update = jest.fn(async () => ({ ok: true, skillKey: 'builder', config: null }));
    const adapter = adapterWith({ management: { skills: { status, update } } });
    const view = render(<SkillsSection adapter={adapter} agent={agent} online />);
    await waitFor(() => expect(view.getByTestId('agent-skill-switch-builder')).toBeTruthy());
    fireEvent(view.getByTestId('agent-skill-switch-builder'), 'valueChange', false);
    await waitFor(() => expect(view.getByText('Read timed out')).toBeTruthy());
    expect(view.getByTestId('agent-skill-switch-builder').props.value).toBe(false);
    expect(view.queryByTestId('agent-skills-loading')).toBeNull();
  });

  it('keeps cached search results offline and blocks writes', async () => {
    const update = jest.fn();
    const status = jest.fn(async () => report);
    const adapter = adapterWith({ management: { skills: { status, update } } });
    const view = render(<SkillsSection adapter={adapter} agent={agent} online />);
    await waitFor(() => expect(view.getByTestId('agent-skill-switch-builder')).toBeTruthy());
    fireEvent.changeText(view.getByTestId('agent-skills-search-input'), 'builds');
    view.rerender(<SkillsSection adapter={adapter} agent={agent} online={false} />);
    expect(view.getByTestId('agent-skill-switch-builder').props.disabled).toBe(true);
    fireEvent(view.getByTestId('agent-skill-switch-builder'), 'valueChange', false);
    expect(update).not.toHaveBeenCalled();
    expect(view.getByTestId('agent-skills-search-input').props.value).toBe('builds');
    expect(status).toHaveBeenCalledTimes(1);
  });

  it('ignores a previous Agent mutation completion after changing scope', async () => {
    let finishUpdate!: (result: { ok: boolean; skillKey: string; config: null }) => void;
    const update = jest.fn(() => new Promise<{ ok: boolean; skillKey: string; config: null }>((resolve) => { finishUpdate = resolve; }));
    const status = jest.fn(async () => report);
    const adapter = adapterWith({ management: { skills: { status, update } } });
    const view = render(<SkillsSection adapter={adapter} agent={agent} online />);
    await waitFor(() => expect(view.getByTestId('agent-skill-switch-builder')).toBeTruthy());
    fireEvent(view.getByTestId('agent-skill-switch-builder'), 'valueChange', false);
    view.rerender(<SkillsSection adapter={adapter} agent={{ ...agent, agentId: 'other' }} online />);
    await waitFor(() => expect(view.getByTestId('agent-skill-switch-builder')).toBeTruthy());
    await act(async () => finishUpdate({ ok: true, skillKey: 'builder', config: null }));
    expect(status).toHaveBeenCalledTimes(2);
    expect(view.getByTestId('agent-skill-switch-builder').props.value).toBe(true);
    expect(view.getByTestId('agent-skill-switch-builder').props.disabled).toBe(false);
  });

  it('renders loading, load failure, retry and a genuine empty result distinctly', async () => {
    const status = jest.fn().mockRejectedValueOnce(new Error('Skills unavailable')).mockResolvedValue({ ...report, skills: [] });
    const adapter = adapterWith({ management: { skills: { status } } });
    const view = render(<SkillsSection adapter={adapter} agent={agent} online />);
    expect(view.getByTestId('agent-skills-loading')).toBeTruthy();
    await waitFor(() => expect(view.getByText('Skills unavailable')).toBeTruthy());
    expect(view.queryByTestId('agent-skills-empty')).toBeNull();
    fireEvent.press(view.getByTestId('agent-skills-error-action'));
    await waitFor(() => expect(view.getByText('0 skills · 0 enabled')).toBeTruthy());
    expect(view.getByTestId('agent-skills-empty')).toBeTruthy();
    expect(view.queryByTestId('agent-skills-error')).toBeNull();
  });

  it('treats an explicit unsuccessful update response as failure', async () => {
    const status = jest.fn(async () => report);
    const adapter = adapterWith({ management: { skills: {
      status, update: jest.fn(async () => ({ ok: false, skillKey: 'builder', config: null })),
    } } });
    const view = render(<SkillsSection adapter={adapter} agent={agent} online />);
    await waitFor(() => expect(view.getByTestId('agent-skill-switch-builder')).toBeTruthy());
    fireEvent(view.getByTestId('agent-skill-switch-builder'), 'valueChange', false);
    await waitFor(() => expect(view.getByText('Failed to update skill')).toBeTruthy());
    expect(view.getByTestId('agent-skill-switch-builder').props.value).toBe(true);
    expect(status).toHaveBeenCalledTimes(1);
  });

  it('refreshes on return while preserving the installed search', async () => {
    const status = jest.fn(async () => report);
    const adapter = adapterWith({ management: { skills: { status } } });
    const view = render(<SkillsSection adapter={adapter} agent={agent} online refreshKey={0} />);
    await waitFor(() => expect(view.getByTestId('agent-skill-installed-builder')).toBeTruthy());
    fireEvent.changeText(view.getByTestId('agent-skills-search-input'), 'build');
    view.rerender(<SkillsSection adapter={adapter} agent={agent} online refreshKey={1} />);
    await waitFor(() => expect(status).toHaveBeenCalledTimes(2));
    expect(view.getByTestId('agent-skills-search-input').props.value).toBe('build');
    expect(view.queryByTestId('agent-skills-loading')).toBeNull();
  });

  it('renders Cron heartbeat, jobs, and run records from management operations', async () => {
    const adapter = cronAdapter();
    const view = render(<CronSection adapter={adapter} agent={agent} online onCreate={jest.fn()} onEdit={jest.fn()} />);

    expect(view.getByTestId('agent-cron-loading')).toBeTruthy();
    // An Agent with jobs lands on the run records.
    await waitFor(() => expect(view.getByTestId('agent-cron-run-daily-2000')).toBeTruthy());
    expect(view.queryByTestId('agent-cron-job-list')).toBeNull();
    fireEvent.press(view.getByTestId('agent-cron-run-daily-2000'));
    expect(view.getByTestId('agent-cron-run-detail')).toBeTruthy();

    fireEvent.press(view.getByTestId('agent-cron-tabs-jobs'));
    expect(view.getByTestId('agent-cron-job-daily')).toBeTruthy();
    expect(view.getByTestId('agent-cron-heartbeat')).toBeTruthy();
  });

  it('opens on the run records with the failures first and marks them as seen', async () => {
    const failed: CronJob = {
      ...cronJob,
      id: 'digest',
      name: 'Digest',
      state: { nextRunAtMs: 9_000, lastRunAtMs: 3_000, lastRunStatus: 'error', lastError: 'model quota' },
    };
    const adapter = cronAdapter({ jobs: [cronJob, failed] });
    const runs = adapter.management?.cron?.runs as jest.Mock;
    runs.mockResolvedValue({
      entries: [
        // The history twin of the failed run: shown once, in the failed block.
        { ts: 3_000, runAtMs: 3_000, jobId: 'digest', jobName: 'Digest', action: 'finished', status: 'error', error: 'model quota' },
        { ts: 2_000, jobId: 'daily', jobName: 'Daily brief', action: 'finished', status: 'ok' },
      ],
      total: 2,
      offset: 0,
      limit: 100,
      hasMore: false,
      nextOffset: null,
    });
    mockAcknowledgeCronFailures.mockClear();
    const view = render(<CronSection adapter={adapter} agent={agent} online onCreate={jest.fn()} onEdit={jest.fn()} />);

    await waitFor(() => expect(view.getByTestId('agent-cron-failed-digest')).toBeTruthy());
    expect(view.queryByTestId('agent-cron-job-list')).toBeNull();
    expect(view.getByTestId('agent-cron-failed-count').props.children).toBe('1 failed');
    await waitFor(() => expect(view.getByTestId('agent-cron-run-daily-2000')).toBeTruthy());
    expect(view.queryByTestId('agent-cron-run-digest-3000')).toBeNull();
    expect(view.queryByTestId('agent-cron-runs-empty')).toBeNull();
    await waitFor(() => expect(mockAcknowledgeCronFailures).toHaveBeenCalledWith('studio', 'main', [cronJob, failed]));

    fireEvent.press(view.getByTestId('agent-cron-failed-digest'));
    expect(view.getByTestId('agent-cron-run-detail')).toBeTruthy();
    expect(view.getByText('model quota')).toBeTruthy();
  });

  it('lands an Agent without jobs on the job list and keeps it there after the first job is created', async () => {
    mockAcknowledgeCronFailures.mockClear();
    const adapter = cronAdapter({ jobs: [] });
    const list = adapter.management?.cron?.list as jest.Mock;
    const view = render(<CronSection adapter={adapter} agent={agent} online refreshKey={0} onCreate={jest.fn()} onEdit={jest.fn()} />);
    await waitFor(() => expect(view.getByTestId('agent-cron-empty')).toBeTruthy());
    expect(view.getByTestId('agent-cron-create')).toBeTruthy();
    expect(adapter.management?.cron?.runs).not.toHaveBeenCalled();
    expect(mockAcknowledgeCronFailures).not.toHaveBeenCalled();

    list.mockResolvedValue({ jobs: [cronJob], total: 1, offset: 0, limit: 100, hasMore: false, nextOffset: null });
    view.rerender(<CronSection adapter={adapter} agent={agent} online refreshKey={1} onCreate={jest.fn()} onEdit={jest.fn()} />);
    await waitFor(() => expect(view.getByTestId('agent-cron-job-daily')).toBeTruthy());
    expect(view.queryByTestId('agent-cron-runs-empty')).toBeNull();

    fireEvent.press(view.getByTestId('agent-cron-tabs-runs'));
    await waitFor(() => expect(mockAcknowledgeCronFailures).toHaveBeenCalledWith('studio', 'main', [cronJob]));
    expect(view.queryByTestId('agent-cron-failed')).toBeNull();
  });

  it('opens a full task editor, toggles inline, and retains heartbeat editing', async () => {
    const adapter = cronAdapter();
    const onEdit = jest.fn();
    const view = render(<CronSection adapter={adapter} agent={agent} online onCreate={jest.fn()} onEdit={onEdit} />);
    await waitFor(() => expect(view.getByTestId('agent-cron-tabs-jobs')).toBeTruthy());
    fireEvent.press(view.getByTestId('agent-cron-tabs-jobs'));
    fireEvent.press(view.getByTestId('agent-cron-job-daily'));
    expect(onEdit).toHaveBeenCalledWith('daily');
    fireEvent(view.getByTestId('agent-cron-switch-daily'), 'valueChange', false);
    await waitFor(() => expect(adapter.management?.cron?.update).toHaveBeenCalledWith('daily', { enabled: false }));
    fireEvent.press(view.getByTestId('agent-cron-heartbeat'));
    fireEvent.changeText(view.getByTestId('agent-heartbeat-every'), '1h');
    fireEvent.press(view.getByTestId('agent-heartbeat-save'));
    await waitFor(() => expect(adapter.management?.cron?.heartbeat?.set).toHaveBeenCalledWith(expect.objectContaining({ every: '1h' })));
  });

  it('lists workspace files and opens each row on the document page', async () => {
    const files = [
      { name: 'MEMORY.md', path: '/MEMORY.md', missing: true },
      { name: 'SOUL.md', path: '/SOUL.md', missing: false, size: 12 },
    ];
    const list = jest.fn(async () => files);
    const get = jest.fn();
    const set = jest.fn();
    const onOpenFile = jest.fn();
    const view = render(
      <FilesSection adapter={adapterWith({ management: { agents: { files: { list, get, set } } } })} agent={agent} online onOpenFile={onOpenFile} />,
    );
    expect(view.getByTestId('agent-files-loading')).toBeTruthy();
    await waitFor(() => expect(view.getByTestId('agent-file-SOUL.md')).toBeTruthy());
    expect(view.getByText('12 B')).toBeTruthy();
    // A listed-but-absent file is creatable: the page opens its empty editor.
    expect(view.getByText('Create')).toBeTruthy();
    fireEvent.press(view.getByTestId('agent-file-MEMORY.md'));
    fireEvent.press(view.getByTestId('agent-file-SOUL.md'));
    expect(onOpenFile.mock.calls.map(([file]) => file.name)).toEqual(['MEMORY.md', 'SOUL.md']);
    // The list never reads a document itself.
    expect(get).not.toHaveBeenCalled();

    fireEvent.changeText(view.getByTestId('agent-files-search-input'), 'soul');
    expect(view.queryByTestId('agent-file-MEMORY.md')).toBeNull();
    expect(view.getByTestId('agent-file-SOUL.md')).toBeTruthy();
    fireEvent.changeText(view.getByTestId('agent-files-search-input'), 'nothing');
    expect(view.getByTestId('agent-files-empty')).toBeTruthy();
    view.unmount();

    const readOnly = render(
      <FilesSection
        adapter={adapterWith({ capabilities: { ...CAPABILITY_MATRIX.openclaw, fileEdit: false }, management: { agents: { files: { list, get } } } })}
        agent={agent}
        online
        onOpenFile={onOpenFile}
      />,
    );
    await waitFor(() => expect(readOnly.getByText('Missing')).toBeTruthy());
    expect(readOnly.getByTestId('agent-file-MEMORY.md').props.disabled).toBe(true);
  });

  it('refreshes the file list quietly on return and keeps loaded rows offline', async () => {
    const files = [{ name: 'SOUL.md', path: '/SOUL.md', missing: false, size: 12 }];
    const list = jest.fn(async () => [...files]);
    const adapter = adapterWith({ management: { agents: { files: { list, get: jest.fn(), set: jest.fn() } } } });
    const view = render(<FilesSection adapter={adapter} agent={agent} online onOpenFile={jest.fn()} />);
    await waitFor(() => expect(view.getByText('12 B')).toBeTruthy());
    files[0] = { name: 'SOUL.md', path: '/SOUL.md', missing: false, size: 20 };
    view.rerender(<FilesSection adapter={adapter} agent={agent} online refreshKey={1} onOpenFile={jest.fn()} />);
    // No skeleton: the rows stay while the size updates underneath.
    expect(view.queryByTestId('agent-files-loading')).toBeNull();
    await waitFor(() => expect(view.getByText('20 B')).toBeTruthy());
    expect(list).toHaveBeenCalledTimes(2);

    view.rerender(<FilesSection adapter={adapter} agent={agent} online={false} refreshKey={2} onOpenFile={jest.fn()} />);
    expect(view.getByText('20 B')).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('shows the file list error with retry and a genuine empty result distinctly', async () => {
    const list = jest.fn().mockRejectedValueOnce(new Error('List failed')).mockResolvedValue([{ name: 'SOUL.md', path: '/SOUL.md', missing: false, size: 12 }]);
    const adapter = adapterWith({ management: { agents: { files: { list, get: jest.fn() } } } });
    const view = render(<FilesSection adapter={adapter} agent={agent} online onOpenFile={jest.fn()} />);
    await waitFor(() => expect(view.getByTestId('agent-files-error')).toBeTruthy());
    expect(view.getByText('List failed')).toBeTruthy();
    // A failed first load is not an empty workspace.
    expect(view.getByTestId('agent-files-empty')).toBeTruthy();
    fireEvent.press(view.getByTestId('agent-files-error-action'));
    await waitFor(() => expect(view.getByTestId('agent-file-SOUL.md')).toBeTruthy());
    expect(view.queryByTestId('agent-files-error')).toBeNull();
    expect(view.queryByTestId('agent-files-empty')).toBeNull();
    view.unmount();

    const empty = render(<FilesSection adapter={adapterWith({ management: { agents: { files: { list: jest.fn(async () => []), get: jest.fn() } } } })} agent={agent} online onOpenFile={jest.fn()} />);
    await waitFor(() => expect(empty.getByTestId('agent-files-empty')).toBeTruthy());
    expect(empty.queryByTestId('agent-files-error')).toBeNull();
  });

  it('loads usage and cost summaries and opens the retained stats poster', async () => {
    const sessions = jest.fn(async () => usageResult);
    const cost = jest.fn(async () => costSummary);
    const adapter = adapterWith({ management: { usage: { sessions, cost } } });
    const view = render(<UsageSection adapter={adapter} agent={agent} online isPro />);

    expect(view.getByTestId('agent-usage-loading')).toBeTruthy();
    await waitFor(() => expect(view.getByTestId('agent-usage-summary')).toBeTruthy());
    expect(view.getByTestId('agent-usage-primary').props.children).toBe('$1.25');
    expect(view.getByTestId('agent-usage-secondary').props.children).toBe('1K');
    expect(view.getByTestId('agent-usage-cost-breakdown')).toBeTruthy();
    expect(view.getByTestId('agent-usage-cost-breakdown-value-output').props.children).toBe('$0.7500');
    expect(view.getByTestId('agent-usage-messages-value').props.children).toBe('4');
    expect(view.getByTestId('agent-usage-tool-calls-value').props.children).toBe('3');
    expect(view.getByTestId('agent-usage-sessions-value').props.children).toBe('1');
    expect(view.getByTestId('agent-usage-cache-hit-value').props.children).toBe('0%');
    expect(view.getByTestId('agent-usage-model-0')).toBeTruthy();
    expect(view.queryByTestId('agent-usage-tools')).toBeNull();
    expect(view.queryByTestId('mock-usage-poster')).toBeNull();
    view.rerender(<UsageSection adapter={adapter} agent={agent} online isPro posterRequest={1} />);
    expect(view.getByTestId('mock-usage-poster')).toBeTruthy();

    // The single-day view carries the week as context, then the other ranges prefetch once.
    await waitFor(() => expect(sessions).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(view.getByTestId('agent-usage-chart')).toBeTruthy());
    expect(cost).toHaveBeenCalledTimes(3);
    fireEvent.press(view.getByTestId('agent-usage-range-7d'));
    expect(view.getByTestId('agent-usage-summary')).toBeTruthy();
    expect(view.queryByTestId('agent-usage-loading')).toBeNull();
    expect(sessions).toHaveBeenCalledTimes(3);
  });

  it('labels an OpenClaw subtotal as partial and carries that status into sharing', async () => {
    const sessions = jest.fn(async () => usageResult);
    const cost = jest.fn(async () => ({ ...costSummary, totals: { ...usageTotals, missingCostEntries: 19 } }));
    const adapter = adapterWith({ management: { usage: { sessions, cost } } });
    const view = render(<UsageSection adapter={adapter} agent={agent} online isPro />);
    await waitFor(() => expect(view.getByTestId('agent-usage-partial')).toBeTruthy());
    expect(view.getByTestId('agent-usage-primary').props.children).toBe('$1.25');
    expect(view.getAllByText('Partial').length).toBeGreaterThan(0);
    view.rerender(<UsageSection adapter={adapter} agent={agent} online isPro posterRequest={1} />);
    expect(view.getByTestId('mock-usage-poster').props.costCaption).toBe('Partial');
  });

  it('leads with tokens and hides the poster cost when the backend cannot price usage', async () => {
    const sessions = jest.fn(async () => ({
      ...usageResult,
      aggregates: {
        ...usageResult.aggregates!,
        tools: { totalCalls: 3, uniqueTools: 2, tools: [{ name: 'read', count: 2 }, { name: 'exec', count: 1 }] },
      },
    }));
    const cost = jest.fn(async () => ({ totals: usageTotals, costPresentation: { mode: 'unknown' as const } }));
    const adapter = adapterWith({ management: { usage: { sessions, cost } } });
    const view = render(<UsageSection adapter={adapter} agent={agent} online isPro />);
    await waitFor(() => expect(view.getByTestId('agent-usage-summary')).toBeTruthy());
    expect(view.getByTestId('agent-usage-primary').props.children).toBe('1K');
    expect(view.getByTestId('agent-usage-secondary').props.children).toBe('—');
    expect(view.getByTestId('agent-usage-token-composition')).toBeTruthy();
    expect(view.getByTestId('agent-usage-tools')).toBeTruthy();
    expect(view.getByTestId('agent-usage-tool-0')).toBeTruthy();
  });

  it('veils the week and month for free users and opens the usage paywall from the veil and past days', async () => {
    const sessions = jest.fn(async () => usageResult);
    const cost = jest.fn(async () => costSummary);
    const onOpenPaywall = jest.fn();
    const adapter = adapterWith({ management: { usage: { sessions, cost } } });
    const view = render(
      <UsageSection adapter={adapter} agent={agent} online isPro={false} onOpenPaywall={onOpenPaywall} />,
    );
    await waitFor(() => expect(view.getByTestId('agent-usage-summary')).toBeTruthy());
    expect(view.queryByTestId('agent-usage-gate')).toBeNull();
    await waitFor(() => expect(view.getByTestId('agent-usage-chart')).toBeTruthy());

    // Today is free, but reaching for a past day in the week context meets the paywall.
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const iso = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    fireEvent.press(view.getByTestId(`agent-usage-chart-slot-${iso}`));
    expect(onOpenPaywall).toHaveBeenCalledWith('usage');

    fireEvent.press(view.getByTestId('agent-usage-range-7d'));
    await waitFor(() => expect(view.getByTestId('agent-usage-gate')).toBeTruthy());
    expect(view.queryByTestId('agent-usage-summary')).toBeNull();
    expect(view.getByTestId('agent-usage-summary', { includeHiddenElements: true })).toBeTruthy();
    expect(view.getByTestId('agent-usage-primary', { includeHiddenElements: true }).props.children).toBe('$1.25');
    fireEvent.press(view.getByTestId('agent-usage-gate-action'));
    expect(onOpenPaywall).toHaveBeenCalledTimes(2);

    view.rerender(<UsageSection adapter={adapter} agent={agent} online isPro onOpenPaywall={onOpenPaywall} />);
    expect(view.queryByTestId('agent-usage-gate')).toBeNull();
    expect(view.getByTestId('agent-usage-summary')).toBeTruthy();
  });

  it('renders empty and error states and disables mutations offline', async () => {
    const emptyCron = cronAdapter({ jobs: [] });
    const cron = render(<CronSection adapter={emptyCron} agent={agent} online onCreate={jest.fn()} onEdit={jest.fn()} />);
    await waitFor(() => expect(cron.getByTestId('agent-cron-empty')).toBeTruthy());
    cron.rerender(<CronSection adapter={emptyCron} agent={agent} online={false} onCreate={jest.fn()} onEdit={jest.fn()} />);
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
        onOpenFile={jest.fn()}
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
