import React from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
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
jest.mock('../../components/ui/CompositionSafeBottomSheetTextInput', () => ({ CompositionSafeBottomSheetTextInput: (props: unknown) => require('react').createElement('TextInput', props) }));
jest.mock('@gorhom/bottom-sheet', () => ({ BottomSheetScrollView: ({ children, ...props }: Record<string, unknown>) => require('react').createElement('BottomSheetScrollView', props, children) }));
jest.mock('../../components/chat/ModelPickerModal', () => ({ ModelPickerModal: ({ visible, models, showDefault, selectedModelId, onSelectModel, onClose }: Record<string, any>) => {
  const R = require('react');
  if (!visible) return null;
  const rows = models.map((model: { id: string; provider: string }) => R.createElement('Pressable', {
    key: `${model.provider}:${model.id}`, testID: `cron-model-pick-${model.provider}:${model.id}`, onPress: () => { onSelectModel(model); onClose(); },
  }));
  return R.createElement('View', { testID: 'cron-model-picker', selectedModelId },
    showDefault ? R.createElement('Pressable', { testID: 'cron-model-pick-default', onPress: () => { onSelectModel({ id: '', name: 'Default', provider: '' }); onClose(); } }) : null, rows);
} }));

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
  const models = [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', provider: 'anthropic' }, { id: 'gpt-5-mini', name: 'GPT-5 mini', provider: 'openai' }];
  const getSelection = jest.fn(async () => ({ currentModel: 'claude-sonnet-4-5', currentProvider: 'anthropic', currentBaseUrl: '', models }));
  const listModels = jest.fn(async () => models);
  const adapter = { capabilities: CAPABILITY_MATRIX[backend], management: { cron: { list, add, update, remove, run, runs }, models: { getSelection, list: listModels } } } as unknown as AgentAdapter;
  const navigation = { goBack: jest.fn(), dispatch: jest.fn() } as unknown as React.ComponentProps<typeof CronEditorScreen>['navigation'];
  return { adapter, navigation, list, add, update, remove, run, runs, getSelection, listModels };
}

// The edit page renames through the shared RenameSheet row instead of an inline input.
// The RenameSheet close alone takes ~1.7 s in Jest; CI runners under load stretch it past Jest's 5 s default.
const RENAME_TEST_TIMEOUT = 15_000;
async function rename(view: ReturnType<typeof render>, name: string) {
  fireEvent.press(view.getByTestId('agent-cron-name'));
  fireEvent.changeText(view.getByTestId('cron-rename-input'), name);
  fireEvent.press(view.getByTestId('cron-rename-save'));
  // RenameSheet closes after its awaited submit; under a loaded worker that can exceed waitFor's default second.
  await waitFor(() => expect(view.queryByTestId('cron-rename-sheet')).toBeNull(), { timeout: 5000 });
}
function nameOf(view: ReturnType<typeof render>): string {
  return String(view.getByTestId('agent-cron-name').props.accessibilityLabel).replace(/^Task name, /, '');
}

/** The list lands on the run records once it has jobs; these cases inspect the job rows. */
async function showJobs(view: ReturnType<typeof render>): Promise<void> {
  await waitFor(() => expect(view.getByTestId('agent-cron-tabs-jobs')).toBeTruthy());
  fireEvent.press(view.getByTestId('agent-cron-tabs-jobs'));
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
    await waitFor(() => expect(data.add).toHaveBeenCalledWith(expect.objectContaining({ schedule: { kind: 'every', everyMs: 3_600_000 }, sessionTarget: 'isolated', payload: { kind: 'agentTurn', message: 'Summarize my inbox' } })));
    view.unmount();
    const fresh = render(<CronEditorScreen {...data} agent={agent} online />);
    fireEvent.press(fresh.getByTestId('cron-template-custom'));
    expect(fresh.getByTestId('agent-cron-prompt').props.value).toBe('');
  });

  it('creates new tasks enabled without step labels, pause or advanced controls, which stay on edit', async () => {
    const data = setup('openclaw');
    const view = render(<CronEditorScreen {...data} agent={agent} online />);
    expect(view.queryByText('1 Choose a starting point')).toBeNull();
    expect(view.queryByText('Choose a template, then adjust the task.')).toBeNull();
    fireEvent.press(view.getByTestId('cron-template-daily-briefing'));
    expect(view.queryByText('2 Configure the task')).toBeNull();
    expect(view.queryByTestId('agent-cron-enabled')).toBeNull();
    expect(view.queryByTestId('cron-advanced')).toBeNull();
    fireEvent.press(view.getByTestId('agent-cron-save'));
    await waitFor(() => expect(data.add).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, delivery: { mode: 'none' } })));
    view.unmount();
    const editor = render(<CronEditorScreen {...data} agent={agent} online jobId="daily" />);
    await waitFor(() => expect(editor.getByTestId('agent-cron-enabled')).toBeTruthy());
    fireEvent.press(editor.getByTestId('cron-advanced'));
    expect(editor.getByTestId('cron-use-expression')).toBeTruthy();
    expect(editor.getByTestId('cron-description')).toBeTruthy();
  });

  it('retains timezone, stagger and delivery when editing only the content', async () => {
    const original: CronJob = { ...existing, schedule: { kind: 'cron', expr: '0 9 28-31 * *', tz: 'Asia/Tokyo', staggerMs: 8000 }, delivery: { mode: 'webhook', to: 'https://example.com/hook', bestEffort: true } };
    const data = setup('openclaw', [original]);
    const view = render(<CronEditorScreen {...data} agent={agent} online jobId="daily" />);
    await waitFor(() => expect(view.getByTestId('cron-prompt-summary')).toBeTruthy());
    expect(view.getByTestId('agent-cron-save').props.disabled).toBe(true);
    fireEvent.press(view.getByTestId('cron-prompt-summary'));
    fireEvent.changeText(view.getByTestId('agent-cron-prompt'), 'Updated');
    fireEvent.press(view.getByTestId('cron-prompt-done'));
    expect(view.getByText('Updated')).toBeTruthy();
    fireEvent.press(view.getByTestId('agent-cron-save'));
    await waitFor(() => expect(data.update).toHaveBeenCalledTimes(1));
    expect(data.update.mock.calls[0][1]).toMatchObject({ payload: { kind: 'systemEvent', text: 'Updated' } });
    expect(data.update.mock.calls[0][1]).not.toHaveProperty('schedule');
    expect(data.update.mock.calls[0][1]).not.toHaveProperty('delivery');
  });

  it('edits the prompt on its own page and keeps the edit page to rows, three runs and no repeated schedule', async () => {
    const data = setup('openclaw', [{ ...existing, state: { nextRunAtMs: Date.UTC(2026, 8, 20, 2, 32), lastRunAtMs: Date.UTC(2026, 8, 19, 2, 32) } }]);
    (data.runs as jest.Mock).mockImplementation(async ({ offset, limit }: { offset: number; limit: number }) => ({
      entries: Array.from({ length: limit }, (_, index) => ({ ts: 1000 - offset - index, jobId: 'daily', status: 'ok' as const, summary: 'Summarize today' })),
      total: 13, offset, limit, hasMore: offset + limit < 13, nextOffset: offset + limit,
    }));
    const view = render(<CronEditorScreen {...data} agent={agent} online jobId="daily" />);
    await waitFor(() => expect(view.getByTestId('cron-prompt-summary')).toBeTruthy());
    expect(view.queryByTestId('agent-cron-prompt')).toBeNull();
    expect(view.getByText('Summarize today')).toBeTruthy();
    expect(view.queryByTestId('cron-schedule-preview')).toBeNull();
    expect(view.queryByText('Last run')).toBeNull();
    expect(view.getByText(/^Next run /)).toBeTruthy();
    await waitFor(() => expect(data.runs).toHaveBeenCalledWith(expect.objectContaining({ limit: 3, offset: 0 })));
    await waitFor(() => expect(view.getAllByTestId(/cron-editor-run-/)).toHaveLength(3));
    fireEvent.press(view.getByTestId('cron-runs-more'));
    await waitFor(() => expect(view.getAllByTestId(/cron-editor-run-/)).toHaveLength(13));
    expect(data.runs).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 10, offset: 3 }));
    expect(view.queryByTestId('cron-runs-more')).toBeNull();
    fireEvent.press(view.getByTestId('cron-prompt-summary'));
    expect(view.getByTestId('agent-cron-prompt').props.value).toBe('Summarize today');
    fireEvent.press(view.getByTestId('editor-back'));
    expect(view.queryByTestId('agent-cron-prompt')).toBeNull();
    fireEvent.press(view.getByTestId('cron-advanced'));
    expect(view.getByTestId('cron-use-expression')).toBeTruthy();
    fireEvent.press(view.getByTestId('cron-advanced-done'));
    expect(view.queryByTestId('cron-use-expression')).toBeNull();
    fireEvent.press(view.getByTestId('cron-edit-schedule'));
    expect(view.getByTestId('cron-schedule-preview')).toBeTruthy();
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
    await rename(view, 'Changed');
    fireEvent.press(view.getByTestId('editor-back'));
    expect(view.getByTestId('cron-discard')).toBeTruthy();
    fireEvent.press(view.getByTestId('cron-discard-cancel'));
    expect(nameOf(view)).toBe('Changed');
    const [blocked, callback] = mockPreventRemove.mock.calls.at(-1)!;
    expect(blocked).toBe(true);
    act(() => callback({ data: { action: { type: 'POP' } } }));
    fireEvent.press(view.getByTestId('cron-discard-confirm'));
    await waitFor(() => expect(data.navigation.dispatch).toHaveBeenCalledWith({ type: 'POP' }));
  }, RENAME_TEST_TIMEOUT);

  it('keeps acknowledged list toggles if refresh fails and prevents duplicate writes', async () => {
    const data = setup();
    const view = render(<CronSection adapter={data.adapter} agent={agent} online onCreate={jest.fn()} onEdit={jest.fn()} />);
    await showJobs(view);
    expect(view.getByTestId('agent-cron-switch-daily')).toBeTruthy();
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
    await rename(view, 'Offline draft');
    view.rerender(<CronEditorScreen {...data} agent={agent} online={false} jobId="daily" />);
    expect(nameOf(view)).toBe('Offline draft');
    expect(view.getByTestId('agent-cron-save').props.disabled).toBe(true);
    expect(data.update).not.toHaveBeenCalled();
    view.unmount();
    const unavailable = { ...data.adapter, capabilities: { ...data.adapter.capabilities, cronCreate: false } };
    const blocked = render(<CronEditorScreen adapter={unavailable} navigation={data.navigation} agent={agent} online />);
    expect(blocked.queryByTestId('cron-template-custom')).toBeNull();
    expect(data.add).not.toHaveBeenCalled();
  }, RENAME_TEST_TIMEOUT);

  it('shows a paused task and its previous failure independently', async () => {
    const data = setup('hermes', [{ ...existing, enabled: false, state: { lastRunStatus: 'error', lastError: 'Credentials expired' } }]);
    const view = render(<CronSection adapter={data.adapter} agent={agent} online onCreate={jest.fn()} onEdit={jest.fn()} />);
    await showJobs(view);
    expect(view.getByTestId('agent-cron-switch-daily').props.value).toBe(false);
    expect(view.getByText('Paused')).toBeTruthy();
    expect(view.getByText('Failed · Credentials expired')).toBeTruthy();
    expect(view.queryByTestId('agent-cron-heartbeat')).toBeNull();
  });

  it('uses acknowledged edits on returning to a list even when refresh fails', async () => {
    const data = setup();
    const list = render(<CronSection adapter={data.adapter} agent={agent} online refreshKey={0} onCreate={jest.fn()} onEdit={jest.fn()} />);
    await showJobs(list);
    expect(list.getByTestId('agent-cron-job-daily')).toBeTruthy();
    const editor = render(<CronEditorScreen {...data} agent={agent} online jobId="daily" />);
    await waitFor(() => expect(editor.getByTestId('agent-cron-name')).toBeTruthy());
    await rename(editor, 'Acknowledged name');
    fireEvent.press(editor.getByTestId('agent-cron-save'));
    await waitFor(() => expect(data.navigation.goBack).toHaveBeenCalledTimes(1));
    editor.unmount();
    data.list.mockRejectedValueOnce(new Error('Refresh failed'));
    list.rerender(<CronSection adapter={data.adapter} agent={agent} online refreshKey={1} onCreate={jest.fn()} onEdit={jest.fn()} />);
    await waitFor(() => expect(list.getByText('Refresh failed')).toBeTruthy());
    expect(list.getByText('Acknowledged name')).toBeTruthy();
  }, RENAME_TEST_TIMEOUT);

  it('offers the model row outside advanced settings on create and stores the picked reference', async () => {
    const data = setup('openclaw');
    const view = render(<CronEditorScreen {...data} agent={agent} online initialPrompt="Summarize my inbox" />);
    await waitFor(() => expect(view.getByTestId('cron-model').props.accessibilityLabel).toBe('Model, Default · Claude Sonnet 4.5'));
    expect(data.getSelection).toHaveBeenCalledTimes(1);
    expect(view.queryByTestId('cron-advanced')).toBeNull();
    fireEvent.press(view.getByTestId('cron-model'));
    expect(view.getByTestId('cron-model-picker').props.selectedModelId).toBe('');
    fireEvent.press(view.getByTestId('cron-model-pick-openai:gpt-5-mini'));
    expect(view.queryByTestId('cron-model-picker')).toBeNull();
    expect(view.getByTestId('cron-model').props.accessibilityLabel).toBe('Model, GPT-5 mini');
    fireEvent.changeText(view.getByTestId('agent-cron-name'), 'Inbox');
    fireEvent.press(view.getByTestId('agent-cron-save'));
    await waitFor(() => expect(data.add).toHaveBeenCalledWith(expect.objectContaining({
      sessionTarget: 'isolated', payload: { kind: 'agentTurn', message: 'Summarize my inbox', model: 'openai/gpt-5-mini' },
    })));
  });

  it('shows the stored model on edit, clears it with null, and keeps main-session jobs read-only', async () => {
    const isolated: CronJob = { ...existing, id: 'iso', name: 'Digest', sessionTarget: 'isolated', payload: { kind: 'agentTurn', message: 'Digest', model: 'openai/gpt-5-mini', thinking: 'low' } };
    const data = setup('openclaw', [existing, isolated]);
    const list = render(<CronSection adapter={data.adapter} agent={agent} online onCreate={jest.fn()} onEdit={jest.fn()} />);
    await showJobs(list);
    expect(list.getByTestId('agent-cron-job-model-iso').props.children).toBe('Model · gpt-5-mini');
    expect(list.queryByTestId('agent-cron-job-model-daily')).toBeNull();
    list.unmount();
    const editor = render(<CronEditorScreen {...data} agent={agent} online jobId="iso" />);
    await waitFor(() => expect(editor.getByTestId('cron-model').props.accessibilityLabel).toBe('Model, GPT-5 mini'));
    expect(editor.getByTestId('agent-cron-save').props.disabled).toBe(true);
    fireEvent.press(editor.getByTestId('cron-model'));
    expect(editor.getByTestId('cron-model-picker').props.selectedModelId).toBe('openai/gpt-5-mini');
    fireEvent.press(editor.getByTestId('cron-model-pick-default'));
    expect(editor.getByTestId('cron-model').props.accessibilityLabel).toBe('Model, Default · Claude Sonnet 4.5');
    fireEvent.press(editor.getByTestId('agent-cron-save'));
    await waitFor(() => expect(data.update).toHaveBeenCalledWith('iso', expect.objectContaining({
      payload: { kind: 'agentTurn', message: 'Digest', model: null, thinking: 'low' },
    })));
    expect(data.update.mock.calls[0][1].sessionTarget).toBeUndefined();
    editor.unmount();
    const main = render(<CronEditorScreen {...data} agent={agent} online jobId="daily" />);
    await waitFor(() => expect(main.getByText('Follows main session')).toBeTruthy());
    // Read-only: rendered as a plain row without a press handler or picker.
    expect(main.getByTestId('cron-model').props.onPress).toBeUndefined();
    expect(main.queryByTestId('cron-model-picker')).toBeNull();
    fireEvent.press(main.getByTestId('cron-advanced'));
    // Advanced settings no longer carry a free-text model field, and main-session jobs get no delivery menu.
    expect(main.queryByLabelText('Model')).toBeNull();
    expect(main.queryByTestId('cron-delivery')).toBeNull();
  });

  it('hides the model row and list label on backends without cronModel and keeps Hermes creates prompt-only', async () => {
    const isolated: CronJob = { ...existing, id: 'iso', sessionTarget: 'isolated', payload: { kind: 'agentTurn', message: 'Digest', model: 'openai/gpt-5-mini' } };
    const data = setup('hermes', [isolated]);
    const list = render(<CronSection adapter={data.adapter} agent={agent} online onCreate={jest.fn()} onEdit={jest.fn()} />);
    await showJobs(list);
    expect(list.getByTestId('agent-cron-job-iso')).toBeTruthy();
    expect(list.queryByTestId('agent-cron-job-model-iso')).toBeNull();
    list.unmount();
    const editor = render(<CronEditorScreen {...data} agent={agent} online jobId="iso" />);
    await waitFor(() => expect(editor.getByTestId('agent-cron-name')).toBeTruthy());
    expect(editor.queryByTestId('cron-model')).toBeNull();
    expect(data.getSelection).not.toHaveBeenCalled();
    editor.unmount();
    const create = render(<CronEditorScreen {...data} agent={agent} online initialPrompt="Ping" />);
    expect(create.queryByTestId('cron-model')).toBeNull();
    fireEvent.changeText(create.getByTestId('agent-cron-name'), 'Ping');
    fireEvent.press(create.getByTestId('agent-cron-save'));
    await waitFor(() => expect(data.add).toHaveBeenCalledWith(expect.objectContaining({ sessionTarget: 'isolated', payload: { kind: 'agentTurn', message: 'Ping' } })));
  });

  it('keeps the model row usable when the catalog fails to load', async () => {
    const data = setup('openclaw');
    data.getSelection.mockRejectedValueOnce(new Error('models offline'));
    const view = render(<CronEditorScreen {...data} agent={agent} online initialPrompt="Summarize" />);
    await waitFor(() => expect(data.getSelection).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(view.getByTestId('cron-model').props.accessibilityLabel).toBe('Model, Default'));
    fireEvent.press(view.getByTestId('cron-model'));
    expect(view.getByTestId('cron-model-picker')).toBeTruthy();
  });

  // Owner-reported 2026-09-19: the record could not be scrolled (a plain ScrollView in a
  // dynamic sheet handed its drags to the sheet, which snapped back) and its rows sat 16
  // points inside the summary text and the close button.
  it('opens the execution record as a fixed-detent integrated scroll with rows on the 24-point content edge', async () => {
    const data = setup('openclaw');
    const summary = Array.from({ length: 40 }, (_, index) => `Line ${index + 1} of the diary run.`).join('\n');
    (data.runs as jest.Mock).mockResolvedValue({
      entries: [{ ts: 900, runAtMs: 900, jobId: 'daily', jobName: 'Brief', status: 'ok', durationMs: 140_500, delivered: false, deliveryStatus: 'not-requested', summary }],
      total: 1, offset: 0, limit: 3, hasMore: false, nextOffset: null,
    });
    const view = render(<CronEditorScreen {...data} agent={agent} online jobId="daily" />);
    await waitFor(() => expect(view.getByTestId('cron-editor-run-900')).toBeTruthy());
    fireEvent.press(view.getByTestId('cron-editor-run-900'));

    const sheet = view.getByTestId('agent-cron-run-detail');
    expect(sheet.props.snapPoints).toEqual(['68%', '92%']);
    expect(sheet.props.maxHeight).toBeUndefined();
    const scroll = view.getByTestId('agent-cron-run-detail-scroll');
    expect(scroll.type).toBe('BottomSheetScrollView');
    expect(scroll.props.contentContainerStyle).toMatchObject({ paddingHorizontal: 24, paddingBottom: 32 });
    expect(scroll.props.contentContainerStyle.paddingTop).toBeUndefined();

    // The job row and the metadata group are borderless and their rows carry no horizontal
    // inset, so they share the summary's edge; hairlines run full width.
    const group = view.getByTestId('agent-cron-run-detail-group');
    const groupStyle = Object.assign({}, ...[group.props.style].flat(Infinity).filter(Boolean));
    const { colors } = require('../../theme/theme').buildInterfaceTheme('light', 'light', require('../../theme/accents').builtInAccents.iceBlue);
    expect(groupStyle.backgroundColor).toBe(colors.canvas);
    // The edit page's name row also reads 'Brief'; look inside the sheet only.
    expect(within(sheet).getByText('Brief')).toBeTruthy();
    expect(view.getByText('Duration')).toBeTruthy();
    expect(view.getByText('Notifications')).toBeTruthy();
    // Delivery mode `none` reports `delivered: false` next to `not-requested`: the explicit status wins.
    expect(view.getByText('Not requested')).toBeTruthy();
    expect(view.queryByText('Not delivered')).toBeNull();
    const flatten = (style: unknown) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean)) as Record<string, unknown>;
    const meta = view.getByTestId('agent-cron-run-detail-meta');
    expect(flatten(meta.props.style).backgroundColor).toBe(colors.canvas);
    const groupStyles = [group, meta].flatMap((host) => host.findAll((node) => (node.type as unknown) === 'View' && node !== host).map((node) => flatten(node.props.style)));
    const rowStyles = groupStyles.filter((style) => style.minHeight !== undefined);
    expect(rowStyles).toHaveLength(3);
    for (const style of rowStyles) expect(style).toMatchObject({ paddingHorizontal: 0, minHeight: 64 });
    const dividerStyles = groupStyles.filter((style) => style.height === 1);
    expect(dividerStyles).toHaveLength(1);
    for (const style of dividerStyles) expect(style.marginStart).toBeUndefined();
    expect(groupStyles.some((style) => style.paddingHorizontal === 16)).toBe(false);
    expect(view.getByText('Summary')).toBeTruthy();
    expect(view.getByText(summary)).toBeTruthy();
    // No sends, no stored output: nothing to load and no delivered-content section.
    expect(view.queryByTestId('agent-cron-run-deliveries')).toBeNull();
    expect(view.queryByTestId('agent-cron-run-open-session')).toBeNull();
  });
});
