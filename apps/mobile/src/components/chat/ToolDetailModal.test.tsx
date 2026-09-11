import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { ToolDetailModal } from './ToolDetailModal';
import { formatToolDuration, prepareToolPayload } from './tool-detail-model';

jest.mock('react-native', () => {
  const React = require('react');
  const host = (name: string) => ({ children, ...props }: Record<string, unknown>) => React.createElement(name, props, children);
  return { View: host('View'), Text: host('Text'), Pressable: host('Pressable'), ScrollView: host('ScrollView'), ActivityIndicator: host('ActivityIndicator'),
    Platform: { OS: 'ios', select: (v: Record<string, unknown>) => v.ios ?? v.default },
    StyleSheet: { create: (v: unknown) => v, flatten: (v: unknown) => v, hairlineWidth: 1 } };
});
jest.mock('lucide-react-native', () => {
  const React = require('react');
  return Object.fromEntries(['Check', 'ChevronDown', 'ChevronRight', 'CircleAlert', 'Clock3', 'Copy'].map(name => [name, (props: unknown) => React.createElement(name, props)]));
});
jest.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string, values?: Record<string, string>) => key.replace('{{section}}', values?.section ?? '') }) }));
jest.mock('../../theme', () => ({ useAppTheme: () => ({ theme: require('../../theme/theme').buildTheme('light', 'light', require('../../theme/accents').resolveAccentScale('purple')) }) }));
jest.mock('../ui', () => {
  const React = require('react');
  const { View, Text, Pressable } = require('react-native');
  return {
    Sheet: ({ visible, title, children, ...props }: Record<string, unknown>) => visible ? React.createElement(View, props, React.createElement(Text, null, title), children) : null,
    FloatingButton: ({ onPress, accessibilityLabel, testID }: Record<string, unknown>) => React.createElement(Pressable, { onPress, accessibilityLabel, testID }),
  };
});
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => undefined) }));

const props = { visible: true, onClose: jest.fn(), name: 'mcp__openclaw__session_status', status: 'success' as const, args: '{"sessionKey":"current"}' };

afterEach(() => jest.clearAllMocks());

it('separates the human title and duration from collapsed technical metadata', () => {
  const view = render(<ToolDetailModal {...props} durationMs={0} />);
  expect(view.getByText('Session status')).toBeTruthy();
  expect(view.getByTestId('tool-detail-duration').props.numberOfLines).toBe(1);
  expect(view.getByText('<1 ms')).toBeTruthy();
  expect(view.queryByText(props.name)).toBeNull();
  fireEvent.press(view.getByTestId('tool-detail-metadata-toggle'));
  expect(view.getByText(props.name)).toBeTruthy();
});

it('does not report success when a failed or running tool has no output', () => {
  const view = render(<ToolDetailModal {...props} status="error" args={undefined} />);
  expect(view.getByText('Failed')).toBeTruthy();
  expect(view.getByText('No output recorded.')).toBeTruthy();
  expect(view.queryByText('No output — tool completed successfully.')).toBeNull();
  view.rerender(<ToolDetailModal {...props} status="running" durationMs={20} />);
  expect(view.getByText('Waiting for output…')).toBeTruthy();
  expect(view.queryByTestId('tool-detail-duration')).toBeNull();
  view.rerender(<ToolDetailModal {...props} status="unknown" args={undefined} />);
  expect(view.getByText('Result unavailable')).toBeTruthy();
  expect(view.getByText('No output recorded.')).toBeTruthy();
  expect(view.queryByText('Completed')).toBeNull();
});

it('bounds long previews while copying the complete unmodified output', async () => {
  const detail = `  ${'output '.repeat(1200)}  `;
  const view = render(<ToolDetailModal {...props} detail={detail} />);
  expect(view.getByTestId('tool-detail-output-more')).toBeTruthy();
  fireEvent.press(view.getByTestId('tool-detail-output-copy'));
  await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith(detail));
  await waitFor(() => expect(view.getByText('Copied')).toBeTruthy());
  fireEvent.press(view.getByTestId('tool-detail-output-more'));
  expect(view.queryByTestId('tool-detail-output-more')).toBeNull();
  view.unmount();
});

it('keeps unavailable measurements absent and formats long durations without wrapping fragments', () => {
  expect(formatToolDuration(undefined)).toBeUndefined();
  expect(formatToolDuration(NaN)).toBeUndefined();
  expect(formatToolDuration(-1)).toBeUndefined();
  expect(formatToolDuration(1234)).toBe('1.2 s');
  expect(formatToolDuration(61000)).toBe('1 m 1 s');
});

it('preserves malformed and partial JSON and bounds large JSON before parsing', () => {
  expect(prepareToolPayload('{"unfinished":')).toEqual({ text: '{"unfinished":', structured: false, truncated: false });
  expect(prepareToolPayload('{"ok":true}').structured).toBe(true);
  expect(prepareToolPayload('[1,2,3]', 4)).toEqual({ text: '[1,2', structured: false, truncated: true });
});
