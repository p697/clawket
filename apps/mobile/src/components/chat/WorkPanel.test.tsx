import React from 'react';
import { act, render, within } from '@testing-library/react-native';
import type { UiMessage } from '../../types/chat';
import { collectLiveTurnWork, EMPTY_TURN_WORK } from './turn-work';
import { WorkPanel } from './WorkPanel';

jest.mock('react-native', () => {
  const ReactModule = require('react');
  const host = (name: string) => ({ children, ...props }: Record<string, unknown>) => ReactModule.createElement(name, props, children);
  return {
    View: host('View'), Text: host('Text'), Pressable: host('Pressable'), ActivityIndicator: host('ActivityIndicator'),
    Platform: { OS: 'ios', select: (value: Record<string, unknown>) => value.ios ?? value.default },
    StyleSheet: { create: (value: unknown) => value, flatten: (value: unknown) => value, hairlineWidth: 1 },
  };
});
jest.mock('../../theme', () => ({
  useAppTheme: () => ({ theme: require('../../theme/theme').buildTheme('light', 'light', require('../../theme/accents').resolveAccentScale('purple')) }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => key.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, name: string) => String(values?.[name] ?? '')),
  }),
}));
jest.mock('lucide-react-native', () => new Proxy({}, {
  get: (_target, name: string) => (props: Record<string, unknown>) => require('react').createElement(name, props),
}));
// The sheet keeps drawing while it slides away, so its closing frames can be read.
jest.mock('../ui/Sheet', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return {
    Sheet: ({ visible, titleContent, children, testID }: { visible: boolean; titleContent?: React.ReactNode; children?: React.ReactNode; testID?: string }) => (
      ReactModule.createElement(View, { testID, accessibilityState: { expanded: visible } }, titleContent, children)
    ),
  };
});

const prompt: UiMessage = { id: 'ask', role: 'user', text: 'Check the repo' };
const step: UiMessage = { id: 'toolcall_a', role: 'tool', text: '', toolName: 'exec', toolArgs: JSON.stringify({ command: 'ls' }), toolStatus: 'success' };

describe('WorkPanel', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('keeps what the turn was doing and its caption while the sheet slides away', () => {
    const startedAt = Date.now();
    const work = collectLiveTurnWork([step, prompt]);
    const props = { work, startedAt, locale: 'en-US', onClose: jest.fn(), onOpenStep: jest.fn() };
    const view = render(<WorkPanel {...props} visible phase={{ kind: 'replying' }} />);
    act(() => jest.advanceTimersByTime(3_000));
    const caption = view.getByTestId('work-panel-caption').props.children;
    expect(caption).toBe('1 step · Elapsed 0:03');
    expect(within(view.getByTestId('work-timeline-now')).getByText('Replying…')).toBeTruthy();

    // The turn ends: the dock goes, the sheet closes and the live work empties.
    view.rerender(<WorkPanel {...props} visible={false} phase={{ kind: 'thinking' }} work={EMPTY_TURN_WORK} />);
    act(() => jest.advanceTimersByTime(1_000));
    expect(view.getByTestId('work-panel-caption').props.children).toBe(caption);
    expect(within(view.getByTestId('work-timeline-now')).getByText('Replying…')).toBeTruthy();
    expect(view.queryByText('Thinking…')).toBeNull();
    expect(view.getByTestId('thread-run-toolcall_a')).toBeTruthy();
  });
});
