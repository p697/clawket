import React from 'react';
import { AppState, Text, type AppStateStatus } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';
import { ThinkingIndicator } from './ThinkingIndicator';
import { buildTheme } from '../../theme/theme';
import { builtInAccents } from '../../theme/accents';
import { Motion } from '../../theme/tokens';

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => (props: Record<string, unknown>) => ReactRuntime.createElement(name, props);
  return {
    ...jest.requireActual('react-native'),
    Text: host('Text'),
    View: host('View'),
    useWindowDimensions: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
  };
});

jest.mock('./ChatPresentation', () => ({
  useConversationTheme: () => buildTheme('light', 'light', builtInAccents.iceBlue),
}));

const lines = [
  { text: '正在处理', x: 0, y: 0, width: 60, height: 20, ascender: 16, descender: 4, capHeight: 14, xHeight: 8 },
  { text: '下一步', x: 0, y: 20, width: 45, height: 20, ascender: 16, descender: 4, capHeight: 14, xHeight: 8 },
];

afterEach(() => jest.restoreAllMocks());

it('uses measured lines and one forward gradient without blinking the whole label', () => {
  const timing = jest.spyOn(Reanimated, 'withTiming');
  const repeat = jest.spyOn(Reanimated, 'withRepeat');
  const view = render(<ThinkingIndicator label="正在处理下一步" testID="status" />);
  fireEvent(view.UNSAFE_getByType(Text), 'textLayout', { nativeEvent: { lines } });
  expect(view.getByTestId('status').props.accessibilityLabel).toBe('正在处理下一步');
  const glyphs = view.UNSAFE_getAllByType('SvgText' as never);
  expect(glyphs.map(node => node.props.y)).toEqual([16, 36]);
  expect(glyphs.map(node => node.props.children)).toEqual(['正在处理', '下一步']);
  expect(timing).toHaveBeenCalledWith(1, expect.objectContaining({ duration: Motion.activityShimmer }));
  expect(repeat).toHaveBeenCalledWith(expect.anything(), -1, false);
  view.rerender(<ThinkingIndicator label="执行命令" testID="status" />);
  expect(view.UNSAFE_queryAllByType('SvgText' as never)).toHaveLength(0);
  expect(view.getByText('执行命令')).toBeTruthy();
});

it('keeps native text static with reduced motion', () => {
  jest.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
  const repeat = jest.spyOn(Reanimated, 'withRepeat');
  const view = render(<ThinkingIndicator label="处理中" />);
  fireEvent(view.UNSAFE_getByType(Text), 'textLayout', { nativeEvent: { lines } });
  expect(view.getByText('处理中')).toBeTruthy();
  expect(view.UNSAFE_queryAllByType('SvgText' as never)).toHaveLength(0);
  expect(repeat).not.toHaveBeenCalled();
});

it('cancels on background/unmount and resumes only while active', () => {
  let change: (state: AppStateStatus) => void = () => {};
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    change = listener;
    return { remove };
  });
  const cancel = jest.spyOn(Reanimated, 'cancelAnimation');
  const view = render(<ThinkingIndicator label="处理中" />);
  fireEvent(view.UNSAFE_getByType(Text), 'textLayout', { nativeEvent: { lines } });
  expect(view.UNSAFE_queryAllByType('SvgText' as never)).toHaveLength(2);
  cancel.mockClear();
  act(() => change('background'));
  expect(cancel).toHaveBeenCalled();
  expect(view.getByText('处理中')).toBeTruthy();
  expect(view.UNSAFE_queryAllByType('SvgText' as never)).toHaveLength(0);
  act(() => change('active'));
  expect(view.UNSAFE_queryAllByType('SvgText' as never)).toHaveLength(2);
  cancel.mockClear();
  view.unmount();
  expect(cancel).toHaveBeenCalled();
  expect(remove).toHaveBeenCalled();
});
