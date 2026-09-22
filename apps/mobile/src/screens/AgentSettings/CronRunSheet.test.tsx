import React, { useState } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { CronRunContent, CronRunLogEntry } from '@clawket/agent-protocol';
import { CronRunSheet } from './CronRunSheet';

let mockSheetProps: Record<string, unknown> | null = null;
jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => ReactRuntime.forwardRef(({ children, style, ...props }: Record<string, unknown>, ref: unknown) =>
    ReactRuntime.createElement(name, { ...props, ref, style: typeof style === 'function' ? style({ pressed: false }) : style }, children));
  return {
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
    Pressable: host('Pressable'), View: host('View'), Text: host('Text'), TextInput: host('TextInput'), ScrollView: host('ScrollView'), ActivityIndicator: host('ActivityIndicator'),
    StyleSheet: { create: <T,>(styles: T) => styles, flatten: (style: unknown) => style, hairlineWidth: 1 },
  };
});
jest.mock('react-native-enriched-markdown', () => ({ EnrichedMarkdownText: ({ markdown, ...props }: any) => require('react').createElement('Text', props, markdown) }));
jest.mock('lucide-react-native', () => new Proxy({}, {
  get: (_target, key) => key === '__esModule' ? true : (props: unknown) => require('react').createElement('Icon', props),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, values?: Record<string, unknown>) => key.replace(/{{(.*?)}}/g, (_, name) => String(values?.[name] ?? name)),
  i18n: { resolvedLanguage: 'en' },
}) }));
jest.mock('../../theme', () => ({ useAppTheme: () => ({ theme: require('../../theme/theme').buildInterfaceTheme('light', 'light', require('../../theme/accents').builtInAccents.iceBlue) }) }));
jest.mock('../../components/ui/Skeleton', () => ({ Skeleton: (props: unknown) => require('react').createElement('View', props) }));
jest.mock('../../components/ui/Sheet', () => ({ Sheet: ({ visible, children, ...props }: Record<string, unknown>) => {
  mockSheetProps = props;
  return visible ? require('react').createElement('View', props, children) : null;
} }));
jest.mock('@gorhom/bottom-sheet', () => ({ BottomSheetScrollView: ({ children, ...props }: Record<string, unknown>) => require('react').createElement('BottomSheetScrollView', props, children) }));

const BRIEF = '早。昨天周五，主站 DAU 36.5k，比七日均低了 26%。';
const STABLE_KEY = 'agent:main:cron:41230a62';

// Recorded 2026-09-19 from OpenClaw 2026.9.1: delivery mode `none`, the Agent sent
// the brief itself through the message tool, the summary is its own narration.
const messageToolRun: CronRunLogEntry = {
  ts: 1_789_772_706_577,
  runAtMs: 1_789_772_400_041,
  jobId: '41230a62',
  jobName: 'YouMind 日报 07:00',
  action: 'finished',
  status: 'ok',
  summary: '已发送：2026-09-18 简报已发到褚一 Telegram 私聊，messageId 31853。',
  delivered: false,
  deliveryStatus: 'not-requested',
  delivery: { intended: { channel: 'last', to: null }, messageToolSentTo: [{ channel: 'telegram', to: 'telegram:8053522863' }], delivered: false },
  sessionId: '9e1dda96',
  sessionKey: `${STABLE_KEY}:run:9e1dda96`,
  durationMs: 306_536,
  model: 'deepseek-flash',
};

function Host({ run, loadContent, onOpenSession }: Readonly<{
  run: CronRunLogEntry;
  loadContent?: (entry: CronRunLogEntry) => Promise<CronRunContent>;
  onOpenSession?: (sessionKey: string) => void;
}>): React.JSX.Element {
  const [current, setCurrent] = useState<CronRunLogEntry | null>(run);
  return <CronRunSheet run={current} loadContent={loadContent} onOpenSession={onOpenSession} onClose={() => setCurrent(null)} />;
}

describe('CronRunSheet', () => {
  it('omits optional metadata that the backend did not provide', () => {
    const view = render(<Host run={{ ts: 1000, jobId: 'local', action: 'finished', status: 'ok', deliveryStatus: 'unknown' }} />);
    expect(view.queryByTestId('agent-cron-run-detail-meta')).toBeNull();
    expect(view.queryByText('Duration')).toBeNull();
    expect(view.queryByText('Notifications')).toBeNull();
  });

  it('leads with the messages the run sent and opens the stable session after dismissing', async () => {
    const loadContent = jest.fn(async () => ({
      deliveries: [{ channel: 'telegram', target: '8053522863', text: BRIEF }],
      sessionKey: STABLE_KEY,
    }));
    const onOpenSession = jest.fn();
    const view = render(<Host run={messageToolRun} loadContent={loadContent} onOpenSession={onOpenSession} />);

    expect(view.getByTestId('agent-cron-run-content-loading')).toBeTruthy();
    await waitFor(() => expect(view.getByTestId('agent-cron-run-deliveries')).toBeTruthy());
    expect(loadContent).toHaveBeenCalledWith(messageToolRun);
    expect(view.getByText('Delivered content')).toBeTruthy();
    expect(view.getByText('Telegram · 8053522863')).toBeTruthy();
    expect(view.getByTestId('agent-cron-run-delivery-0').props.children).toBe(BRIEF);
    // The Agent's narration stays as the summary; the notification row says who sent.
    expect(view.getByText('Summary')).toBeTruthy();
    expect(view.getByText(messageToolRun.summary!)).toBeTruthy();
    expect(view.getByText('Sent by the Agent')).toBeTruthy();
    expect(view.getByText('deepseek-flash')).toBeTruthy();

    fireEvent.press(view.getByTestId('agent-cron-run-open-session'));
    // The sheet closes first; navigation waits for its completion callback, never racing the dismissal.
    expect(view.queryByTestId('agent-cron-run-detail')).toBeNull();
    expect(onOpenSession).not.toHaveBeenCalled();
    act(() => { (mockSheetProps?.onAfterClose as () => void)(); });
    expect(onOpenSession).toHaveBeenCalledWith(STABLE_KEY);
    act(() => { (mockSheetProps?.onAfterClose as () => void)(); });
    expect(onOpenSession).toHaveBeenCalledTimes(1);
  });

  it('tells the reader when the run sent messages but its conversation was recycled', async () => {
    const loadContent = jest.fn(async () => ({ deliveries: [] }));
    const view = render(<Host run={messageToolRun} loadContent={loadContent} onOpenSession={jest.fn()} />);

    await waitFor(() => expect(view.getByTestId('agent-cron-run-content-unavailable')).toBeTruthy());
    expect(view.getByText('Telegram · 8053522863')).toBeTruthy();
    expect(view.getByText('The conversation for this run is no longer available.')).toBeTruthy();
    expect(view.queryByTestId('agent-cron-run-open-session')).toBeNull();
    expect(view.getByText(messageToolRun.summary!)).toBeTruthy();
  });

  it('treats a load failure like a recycled conversation and keeps the record readable', async () => {
    const loadContent = jest.fn(async () => { throw new Error('offline'); });
    const view = render(<Host run={messageToolRun} loadContent={loadContent} />);

    await waitFor(() => expect(view.getByTestId('agent-cron-run-content-unavailable')).toBeTruthy());
    expect(view.getByText('Summary')).toBeTruthy();
    expect(view.getByText('Sent by the Agent')).toBeTruthy();
  });

  it('shows an announced run as delivered content without repeating it as the summary', () => {
    const run: CronRunLogEntry = {
      ...messageToolRun, delivered: true, deliveryStatus: 'delivered', delivery: { resolved: { channel: 'discord', to: 'channel:123' }, delivered: true },
      summary: 'Nightly digest: all green.', sessionKey: undefined,
    };
    const view = render(<Host run={run} />);

    expect(view.getByTestId('agent-cron-run-announced')).toBeTruthy();
    expect(view.getByText('Discord · channel:123')).toBeTruthy();
    expect(view.getByText('Nightly digest: all green.')).toBeTruthy();
    expect(view.queryByText('Summary')).toBeNull();
    expect(view.getByText('Delivered')).toBeTruthy();
    expect(view.queryByTestId('agent-cron-run-content-loading')).toBeNull();
  });

  it('renders a stored output for backends that keep one and labels a job that never asked for delivery', async () => {
    const run: CronRunLogEntry = {
      ts: 5_000, jobId: 'digest', jobName: 'Digest', action: 'finished', status: 'ok', summary: 'Digest ran.',
      delivered: false, deliveryStatus: 'not-requested', outputRef: '2026-09-19T07-00.md',
    };
    const loadContent = jest.fn(async () => ({ deliveries: [], output: '# Digest\n\nAll systems nominal.' }));
    const view = render(<Host run={run} loadContent={loadContent} onOpenSession={jest.fn()} />);

    await waitFor(() => expect(view.getByTestId('agent-cron-run-output')).toBeTruthy());
    expect(view.getByText('Run output')).toBeTruthy();
    expect(view.getByText('# Digest\n\nAll systems nominal.')).toBeTruthy();
    expect(view.getByText('Not requested')).toBeTruthy();
    expect(view.queryByText('Not delivered')).toBeNull();
    // No session behind a stored output: nothing to open.
    expect(view.queryByTestId('agent-cron-run-open-session')).toBeNull();
  });

  it('shows the error as the summary of a failed run and loads nothing without a backend reader', () => {
    const run: CronRunLogEntry = {
      ts: 5_000, jobId: 'digest', jobName: 'Digest', action: 'finished', status: 'error', error: 'model quota',
      deliveryStatus: 'not-delivered', deliveryError: 'telegram: 429', sessionKey: 'agent:main:cron:digest:run:abc',
    };
    const view = render(<Host run={run} />);

    expect(view.getByText('model quota')).toBeTruthy();
    expect(view.getByText('telegram: 429')).toBeTruthy();
    expect(view.getByText('Not delivered')).toBeTruthy();
    expect(view.queryByTestId('agent-cron-run-content-loading')).toBeNull();
    expect(view.queryByTestId('agent-cron-run-open-session')).toBeNull();
  });

  it('ignores a stale content response after the record changed', async () => {
    let resolveFirst: (value: CronRunContent) => void = () => {};
    const loadContent = jest.fn()
      .mockImplementationOnce(() => new Promise<CronRunContent>((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(async () => ({ deliveries: [{ text: 'second run' }], sessionKey: STABLE_KEY }));
    const second: CronRunLogEntry = { ...messageToolRun, sessionId: 'b0baab9a', sessionKey: `${STABLE_KEY}:run:b0baab9a`, runAtMs: 1 };
    const view = render(<CronRunSheet run={messageToolRun} loadContent={loadContent} onClose={jest.fn()} />);
    view.rerender(<CronRunSheet run={second} loadContent={loadContent} onClose={jest.fn()} />);
    await waitFor(() => expect(view.getByTestId('agent-cron-run-delivery-0').props.children).toBe('second run'));
    await act(async () => { resolveFirst({ deliveries: [{ text: 'first run' }], sessionKey: STABLE_KEY }); });
    expect(view.getByTestId('agent-cron-run-delivery-0').props.children).toBe('second run');
  });
});
