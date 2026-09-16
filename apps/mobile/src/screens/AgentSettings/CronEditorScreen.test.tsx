import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { CAPABILITY_MATRIX, type AgentAdapter, type AgentDescriptor, type CronJob } from '@clawket/agent-protocol';
import { CronEditorScreen } from './CronEditorScreen';
import { CronSection } from './CronSection';

const mockPreventRemove = jest.fn();
jest.mock('@react-navigation/native', () => ({ usePreventRemove: (...args: unknown[]) => mockPreventRemove(...args) }));
jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => ReactRuntime.forwardRef(({ children, style, ...props }: Record<string, unknown>, ref: unknown) =>
    ReactRuntime.createElement(name, { ...props, ref, style: typeof style === 'function' ? style({ pressed: false }) : style }, children));
  return {
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
    Pressable: host('Pressable'), View: host('View'), Text: host('Text'), TextInput: host('TextInput'), ScrollView: host('ScrollView'), ActivityIndicator: host('ActivityIndicator'),
    Modal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) => visible ? children : null,
    StyleSheet: { create: <T,>(styles: T) => styles, flatten: (style: unknown) => style, hairlineWidth: 1 },
  };
});
jest.mock('lucide-react-native', () => new Proxy({}, {
  get: (_target, key) => key === '__esModule' ? true : (props: unknown) => require('react').createElement('Icon', props),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, values?: Record<string, unknown>) => key.replace(/{{(.*?)}}/g, (_, name) => String(values?.[name] ?? name)),
  i18n: { resolvedLanguage: 'en' },
}) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }) }));
jest.mock('../../theme', () => ({ useAppTheme: () => ({ theme: require('../../theme/theme').buildInterfaceTheme('light', 'light', require('../../theme/accents').builtInAccents.iceBlue) }) }));
jest.mock('../../services/analytics/events', () => ({ analyticsEvents: { cronSaveSucceeded: jest.fn() } }));
jest.mock('@react-native-community/datetimepicker', () => ({ __esModule: true, default: (props: unknown) => require('react').createElement('DateTimePicker', props) }));
jest.mock('@react-native-menu/menu', () => ({ MenuView: ({ children, ...props }: Record<string, unknown>) => require('react').createElement('MenuView', props, children) }));
jest.mock('../../components/ui/ScreenHeader', () => ({ ScreenHeader: ({ title, onBack, rightContent }: Record<string, unknown>) => {
  const R = require('react');
  return R.createElement('View', null, R.createElement('Text', null, title), R.createElement('Pressable', { testID: 'editor-back', onPress: onBack }), rightContent);
} }));
jest.mock('../../components/ui/FormTextInput', () => ({ FormTextInput: (props: unknown) => require('react').createElement('TextInput', props) }));
jest.mock('../../components/ui/ThemedSwitch', () => ({ ThemedSwitch: (props: unknown) => require('react').createElement('Switch', props) }));
jest.mock('../../components/ui/FloatingButton', () => ({ FloatingButton: (props: unknown) => require('react').createElement('Pressable', props) }));
jest.mock('../../components/ui/Skeleton', () => ({ Skeleton: (props: unknown) => require('react').createElement('View', props) }));
jest.mock('../../components/ui/Sheet', () => ({ Sheet: ({ visible, children, ...props }: Record<string, unknown>) => visible ? require('react').createElement('View', props, children) : null }));

const agent: AgentDescriptor = { connectionId: 'studio', agentId: 'main', name: 'Main', isMain: true, mainSessionKey: 'agent:main:main' };
const existing: CronJob = {
  id: 'daily', name: 'Brief', enabled: true, createdAtMs: 1, updatedAtMs: 1,
  schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'Asia/Tokyo', staggerMs: 5000 },
  sessionTarget: 'main', wakeMode: 'now', payload: { kind: 'systemEvent', text: 'Summarize today' }, state: {},
};
function setup(backend: 'openclaw' | 'hermes' = 'openclaw', initialJobs: CronJob[] = [existing]) {
  let jobs = initialJobs;
  const list = jest.fn(async () => ({ jobs, total: jobs.length, offset: 0, limit: 100, hasMore: false, nextOffset: null }));
  const add = jest.fn(async (input) => { const job = { ...existing, ...input, id: 'created' }; jobs = [...jobs, job]; return job; });
  const update = jest.fn(async (id, patch) => { const job = { ...jobs.find(value => value.id === id)!, ...patch }; jobs = jobs.map(value => value.id === id ? job : value); return job; });
  const remove = jest.fn(async (id) => { jobs = jobs.filter(job => job.id !== id); return { ok: true }; });
  const run = jest.fn(async () => undefined);
  const runs = jest.fn(async () => ({ entries: [], total: 0, offset: 0, limit: 10, hasMore: false, nextOffset: null }));
  const adapter = { capabilities: CAPABILITY_MATRIX[backend], management: { cron: { list, add, update, remove, run, runs } } } as unknown as AgentAdapter;
  const navigation = { goBack: jest.fn(), dispatch: jest.fn() } as unknown as React.ComponentProps<typeof CronEditorScreen>['navigation'];
  return { adapter, navigation, list, add, update, remove, run, runs };
}

describe('guided Cron management', () => {
  beforeEach(() => jest.clearAllMocks());
  it.each(['openclaw', 'hermes'] as const)('creates a task from a template with weekly multi-select on %s', async backend => {
    const setupData = setup(backend);
    const view = render(<CronEditorScreen {...setupData} agent={agent} online />);
    expect(view.queryByTestId('agent-cron-schedule')).toBeNull();
    fireEvent.press(view.getByTestId('cron-templates-more'));
    expect(view.getByTestId('cron-template-weekly-cleanup')).toBeTruthy();
    fireEvent.press(view.getByTestId('cron-template-weekly-report'));
    expect(view.getByTestId('agent-cron-prompt').props.value).toContain('Review this week');
    fireEvent.press(view.getByTestId('cron-workdays'));
    fireEvent.press(view.getByTestId('cron-time-open'));
    const at = new Date(); at.setHours(16, 30, 0, 0);
    fireEvent(view.getByTestId('cron-date-time-picker'), 'change', { type: 'set' }, at);
    fireEvent.press(view.getByTestId('agent-cron-save'));
    await waitFor(() => expect(setupData.add).toHaveBeenCalledTimes(1));
    const schedule = setupData.add.mock.calls[0][0].schedule;
    expect(schedule.expr).toBe('30 16 * * 1,2,3,4,5');
    if (backend === 'hermes') expect(schedule.tz).toBeUndefined();
    else expect(schedule.tz).toBeTruthy();
    await waitFor(() => expect(setupData.navigation.goBack).toHaveBeenCalledTimes(1));
  });

  it('carries a Thread prompt directly into the form and leaves future new tasks blank', async () => {
    const data = setup();
    const view = render(<CronEditorScreen {...data} agent={agent} online initialPrompt="Summarize my inbox" />);
    expect(view.queryByTestId('cron-template-custom')).toBeNull();
    expect(view.getByTestId('agent-cron-prompt').props.value).toBe('Summarize my inbox');
    fireEvent.changeText(view.getByTestId('agent-cron-name'), 'Inbox');
    fireEvent.press(view.getByTestId('cron-frequency-interval'));
    fireEvent.changeText(view.getByTestId('cron-interval-amount'), '1');
    fireEvent.press(view.getByTestId('agent-cron-save'));
    await waitFor(() => expect(data.add).toHaveBeenCalledWith(expect.objectContaining({ schedule: { kind: 'every', everyMs: 3_600_000 }, payload: { kind: 'systemEvent', text: 'Summarize my inbox' } })));
    view.unmount();
    const fresh = render(<CronEditorScreen {...data} agent={agent} online />);
    fireEvent.press(fresh.getByTestId('cron-template-custom'));
    expect(fresh.getByTestId('agent-cron-prompt').props.value).toBe('');
  });

  it('retains timezone, stagger and delivery when editing only the content', async () => {
    const original: CronJob = { ...existing, schedule: { kind: 'cron', expr: '0 9 28-31 * *', tz: 'Asia/Tokyo', staggerMs: 8000 }, delivery: { mode: 'webhook', to: 'https://example.com/hook', bestEffort: true } };
    const data = setup('openclaw', [original]);
    const view = render(<CronEditorScreen {...data} agent={agent} online jobId="daily" />);
    await waitFor(() => expect(view.getByTestId('agent-cron-prompt')).toBeTruthy());
    fireEvent.changeText(view.getByTestId('agent-cron-prompt'), 'Updated');
    fireEvent.press(view.getByTestId('agent-cron-save'));
    await waitFor(() => expect(data.update).toHaveBeenCalledTimes(1));
    expect(data.update.mock.calls[0][1]).toMatchObject({ payload: { kind: 'systemEvent', text: 'Updated' } });
    expect(data.update.mock.calls[0][1]).not.toHaveProperty('schedule');
    expect(data.update.mock.calls[0][1]).not.toHaveProperty('delivery');
  });

  it('retains the draft on failed save and blocks same-turn duplicate submissions', async () => {
    const data = setup();
    let reject!: (error: Error) => void;
    data.add.mockImplementationOnce(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    const view = render(<CronEditorScreen {...data} agent={agent} online />);
    fireEvent.press(view.getByTestId('cron-template-daily-briefing'));
    const save = view.getByTestId('agent-cron-save').props.onPress;
    act(() => { save(); save(); });
    expect(data.add).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error('Save unavailable')));
    expect(view.getByText('Save unavailable')).toBeTruthy();
    expect(view.getByTestId('agent-cron-name').props.value).toBe('Daily briefing');
    expect(data.navigation.goBack).not.toHaveBeenCalled();
  });

  it('validates empty content, empty weekdays and zero intervals before writing', () => {
    const data = setup();
    const view = render(<CronEditorScreen {...data} agent={agent} online />);
    fireEvent.press(view.getByTestId('cron-template-custom'));
    fireEvent.press(view.getByTestId('agent-cron-save'));
    expect(view.getByText('Task name is required.')).toBeTruthy();
    fireEvent.changeText(view.getByTestId('agent-cron-name'), 'Task');
    fireEvent.press(view.getByTestId('agent-cron-save'));
    expect(view.getByText('Prompt is required.')).toBeTruthy();
    fireEvent.changeText(view.getByTestId('agent-cron-prompt'), 'Do something');
    fireEvent.press(view.getByTestId('cron-frequency-weekly'));
    fireEvent.press(view.getByTestId('cron-weekday-1'));
    fireEvent.press(view.getByTestId('agent-cron-save'));
    expect(view.getByText('Invalid schedule.')).toBeTruthy();
    fireEvent.press(view.getByTestId('cron-frequency-interval'));
    fireEvent.changeText(view.getByTestId('cron-interval-amount'), '0');
    fireEvent.press(view.getByTestId('agent-cron-save'));
    expect(data.add).not.toHaveBeenCalled();
  });

  it('runs the saved job, confirms deletion, and preserves the editor on history errors', async () => {
    const data = setup();
    data.runs.mockRejectedValue(new Error('History unavailable'));
    const view = render(<CronEditorScreen {...data} agent={agent} online jobId="daily" />);
    await waitFor(() => expect(view.getByTestId('agent-cron-name')).toBeTruthy());
    expect(view.getByText('History unavailable')).toBeTruthy();
    fireEvent.press(view.getByTestId('agent-cron-run'));
    await waitFor(() => expect(data.run).toHaveBeenCalledWith('daily', 'force'));
    await waitFor(() => expect(view.getByTestId('agent-cron-delete').props.disabled).toBe(false));
    fireEvent.press(view.getByTestId('agent-cron-delete'));
    expect(data.remove).not.toHaveBeenCalled();
    fireEvent.press(view.getByTestId('agent-cron-delete-confirm-confirm'));
    await waitFor(() => expect(data.remove).toHaveBeenCalledWith('daily'));
  });

  it('confirms dirty back navigation and keeps the draft when canceled', async () => {
    const data = setup();
    const view = render(<CronEditorScreen {...data} agent={agent} online jobId="daily" />);
    await waitFor(() => expect(view.getByTestId('agent-cron-name')).toBeTruthy());
    fireEvent.changeText(view.getByTestId('agent-cron-name'), 'Changed');
    fireEvent.press(view.getByTestId('editor-back'));
    expect(view.getByTestId('cron-discard')).toBeTruthy();
    fireEvent.press(view.getByTestId('cron-discard-cancel'));
    expect(view.getByTestId('agent-cron-name').props.value).toBe('Changed');
    const [blocked, callback] = mockPreventRemove.mock.calls.at(-1)!;
    expect(blocked).toBe(true);
    act(() => callback({ data: { action: { type: 'POP' } } }));
    fireEvent.press(view.getByTestId('cron-discard-confirm'));
    await waitFor(() => expect(data.navigation.dispatch).toHaveBeenCalledWith({ type: 'POP' }));
  });

  it('keeps acknowledged list toggles if refresh fails and prevents duplicate writes', async () => {
    const data = setup();
    const view = render(<CronSection adapter={data.adapter} agent={agent} online onCreate={jest.fn()} onEdit={jest.fn()} />);
    await waitFor(() => expect(view.getByTestId('agent-cron-switch-daily')).toBeTruthy());
    data.list.mockRejectedValueOnce(new Error('Refresh unavailable'));
    const toggle = view.getByTestId('agent-cron-switch-daily').props.onValueChange;
    act(() => { toggle(false); toggle(false); });
    await waitFor(() => expect(view.getByText('Refresh unavailable')).toBeTruthy());
    expect(data.update).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('agent-cron-switch-daily').props.value).toBe(false);
  });

  it('ignores a save completion after switching Agent', async () => {
    const data = setup();
    let finish!: (job: CronJob) => void;
    data.add.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<CronEditorScreen {...data} agent={agent} online />);
    fireEvent.press(view.getByTestId('cron-template-daily-briefing'));
    fireEvent.press(view.getByTestId('agent-cron-save'));
    view.rerender(<CronEditorScreen {...data} agent={{ ...agent, agentId: 'writer', isMain: false }} online />);
    await act(async () => finish(existing));
    expect(data.navigation.goBack).not.toHaveBeenCalled();
    expect(view.getByTestId('cron-template-custom')).toBeTruthy();
  });

  it('preserves cached content and drafts offline and gates unsupported creation', async () => {
    const data = setup();
    const view = render(<CronEditorScreen {...data} agent={agent} online jobId="daily" />);
    await waitFor(() => expect(view.getByTestId('agent-cron-name')).toBeTruthy());
    fireEvent.changeText(view.getByTestId('agent-cron-name'), 'Offline draft');
    view.rerender(<CronEditorScreen {...data} agent={agent} online={false} jobId="daily" />);
    expect(view.getByTestId('agent-cron-name').props.value).toBe('Offline draft');
    expect(view.getByTestId('agent-cron-save').props.disabled).toBe(true);
    expect(data.update).not.toHaveBeenCalled();
    view.unmount();
    const unavailable = { ...data.adapter, capabilities: { ...data.adapter.capabilities, cronCreate: false } };
    const blocked = render(<CronEditorScreen adapter={unavailable} navigation={data.navigation} agent={agent} online />);
    expect(blocked.queryByTestId('cron-template-custom')).toBeNull();
    expect(data.add).not.toHaveBeenCalled();
  });

  it('shows a paused task and its previous failure independently', async () => {
    const data = setup('hermes', [{ ...existing, enabled: false, state: { lastRunStatus: 'error', lastError: 'Credentials expired' } }]);
    const view = render(<CronSection adapter={data.adapter} agent={agent} online onCreate={jest.fn()} onEdit={jest.fn()} />);
    await waitFor(() => expect(view.getByTestId('agent-cron-switch-daily')).toBeTruthy());
    expect(view.getByTestId('agent-cron-switch-daily').props.value).toBe(false);
    expect(view.getByText('Paused')).toBeTruthy();
    expect(view.getByText('Failed · Credentials expired')).toBeTruthy();
    expect(view.queryByTestId('agent-cron-heartbeat')).toBeNull();
  });

  it('uses acknowledged edits on returning to a list even when refresh fails', async () => {
    const data = setup();
    const list = render(<CronSection adapter={data.adapter} agent={agent} online refreshKey={0} onCreate={jest.fn()} onEdit={jest.fn()} />);
    await waitFor(() => expect(list.getByTestId('agent-cron-job-daily')).toBeTruthy());
    const editor = render(<CronEditorScreen {...data} agent={agent} online jobId="daily" />);
    await waitFor(() => expect(editor.getByTestId('agent-cron-name')).toBeTruthy());
    fireEvent.changeText(editor.getByTestId('agent-cron-name'), 'Acknowledged name');
    fireEvent.press(editor.getByTestId('agent-cron-save'));
    await waitFor(() => expect(data.navigation.goBack).toHaveBeenCalledTimes(1));
    editor.unmount();
    data.list.mockRejectedValueOnce(new Error('Refresh failed'));
    list.rerender(<CronSection adapter={data.adapter} agent={agent} online refreshKey={1} onCreate={jest.fn()} onEdit={jest.fn()} />);
    await waitFor(() => expect(list.getByText('Refresh failed')).toBeTruthy());
    expect(list.getByText('Acknowledged name')).toBeTruthy();
  });
});
