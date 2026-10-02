import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Text, StyleSheet } from 'react-native';
import { UserMessageDisclosureProvider, UserMessageText } from './UserMessageText';
import { ControlSize } from '../../theme/tokens';

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const flatten = (style: any): any => Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style ?? {};
  const host = (name: string) => ({ children, style, ...props }: any) => ReactRuntime.createElement(name,
    { ...props, style: typeof style === 'function' ? style({ pressed: false }) : style }, children);
  return {
    Platform: { OS: 'ios', select: (options: any) => options.ios ?? options.default },
    Text: host('Text'), View: host('View'), Pressable: host('Pressable'),
    StyleSheet: { create: (styles: any) => styles, flatten },
  };
});
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('lucide-react-native', () => ({ ChevronDown: () => null, ChevronUp: () => null }));

const defaults = { id: 'prompt', text: '完整用户消息 '.repeat(100), width: 260, fontSize: 17, fontScale: 1, color: 'white', textStyle: { fontSize: 17, lineHeight: 24 } };
const props = () => ({ ...defaults, meta: <Text testID="meta">12:30</Text>, metaSpacer: <Text testID="spacer"> </Text> });
function measure(view: ReturnType<typeof render>, count: number, id = 'prompt') {
  fireEvent(view.getByTestId(`user-message-measure-${id}`, { includeHiddenElements: true }), 'textLayout', { nativeEvent: { lines: Array.from({ length: count }, () => ({ text: 'wrapped line' })) } });
}
function press(view: ReturnType<typeof render>, id = 'prompt') {
  const stopPropagation = jest.fn();
  fireEvent.press(view.getByTestId(`user-message-toggle-${id}`), { stopPropagation });
  expect(stopPropagation).toHaveBeenCalledTimes(1);
}

it.each([1, 5, 6])('keeps %i visual lines fully readable with the original inline metadata', count => {
  const view = render(<UserMessageText {...props()} />);
  measure(view, count);
  expect(view.queryByTestId('user-message-toggle-prompt')).toBeNull();
  // A sixth body line may need a seventh line for the inline clock spacer.
  expect(view.getByTestId('user-message-text-prompt').props.numberOfLines).toBeUndefined();
  expect(view.getByTestId('spacer')).toBeTruthy();
  expect(view.getByTestId('meta')).toBeTruthy();
});

it('caps the first frame and uses native overflow for wrapped text, with metadata outside the ellipsis', () => {
  const view = render(<UserMessageText {...props()} />);
  expect(view.getByTestId('user-message-text-prompt').props.numberOfLines).toBe(6);
  const measurement = view.getByTestId('user-message-measure-prompt', { includeHiddenElements: true });
  expect(measurement.props.numberOfLines).toBe(7);
  expect(measurement.props.accessible).toBe(false);
  expect(measurement.props.importantForAccessibility).toBe('no-hide-descendants');
  measure(view, 7);
  expect(view.queryByTestId('spacer')).toBeNull();
  expect(view.getByTestId('user-message-text-prompt').props.children).toContain(defaults.text);
  const toggle = view.getByTestId('user-message-toggle-prompt');
  expect(toggle.props.accessibilityState.expanded).toBe(false);
  expect(StyleSheet.flatten(toggle.props.style).minHeight).toBe(ControlSize.floatingButton);
  expect(view.getByTestId('meta')).toBeTruthy();
  press(view);
  expect(view.getByTestId('user-message-text-prompt').props.numberOfLines).toBeUndefined();
  expect(view.getByTestId('user-message-toggle-prompt').props.accessibilityLabel).toBe('Collapse message');
  measure(view, 7);
  expect(view.getByTestId('user-message-text-prompt').props.numberOfLines).toBeUndefined();
  press(view);
  expect(view.getByTestId('user-message-text-prompt').props.numberOfLines).toBe(6);
});

it('retains expansion across recycling and in the lifted clone, but isolates messages and conversations', () => {
  const onToggle = jest.fn();
  const tree = (scope: string, show: boolean, clone = false) => <UserMessageDisclosureProvider scope={scope} onToggle={onToggle}>
    {show ? <UserMessageText {...props()} selectable={clone} /> : null}
    <UserMessageText {...props()} id="other" />
  </UserMessageDisclosureProvider>;
  const view = render(tree('one', true));
  measure(view, 7); measure(view, 7, 'other'); press(view);
  expect(onToggle).toHaveBeenCalledTimes(1);
  expect(view.getByTestId('user-message-text-other').props.numberOfLines).toBe(6);
  view.rerender(tree('one', false));
  view.rerender(tree('one', true, true));
  expect(view.getByTestId('user-message-text-prompt').props.numberOfLines).toBeUndefined();
  expect(view.getByTestId('user-message-text-prompt').props.selectable).toBe(true);
  expect(view.getByTestId('user-message-toggle-prompt').props.disabled).toBe(true);
  view.rerender(tree('two', true));
  measure(view, 7);
  expect(view.getByTestId('user-message-toggle-prompt').props.accessibilityState.expanded).toBe(false);
});

it('remeasures width, font size and font scale without discarding an explicit expansion', () => {
  const view = render(<UserMessageText {...props()} />);
  measure(view, 7); press(view);
  view.rerender(<UserMessageText {...props()} width={400} fontSize={20} fontScale={1.3} />);
  expect(StyleSheet.flatten(view.getByTestId('user-message-measure-prompt', { includeHiddenElements: true }).props.style).width).toBe(400);
  expect(view.getByTestId('user-message-text-prompt').props.numberOfLines).toBeUndefined();
  measure(view, 7);
  expect(view.getByTestId('user-message-text-prompt').props.numberOfLines).toBeUndefined();
  measure(view, 6);
  expect(view.queryByTestId('user-message-toggle-prompt')).toBeNull();
});

it('rejects stale measurements after text replacement and ignores empty native events', () => {
  const view = render(<UserMessageText {...props()} />);
  const stale = view.getByTestId('user-message-measure-prompt', { includeHiddenElements: true }).props.onTextLayout;
  measure(view, 7); press(view);
  view.rerender(<UserMessageText {...props()} text="New message" />);
  act(() => stale({ nativeEvent: { lines: new Array(7).fill({}) } }));
  measure(view, 0);
  expect(view.queryByTestId('user-message-toggle-prompt')).toBeNull();
  measure(view, 1);
  expect(view.queryByTestId('user-message-toggle-prompt')).toBeNull();
});

it('keeps long-press selection actions available on the readable text', () => {
  const onLongPress = jest.fn();
  const view = render(<UserMessageText {...props()} onLongPress={onLongPress} />);
  fireEvent(view.getByTestId('user-message-text-prompt'), 'accessibilityAction', { nativeEvent: { actionName: 'longpress' } });
  expect(onLongPress).toHaveBeenCalledTimes(1);
});

it('folds short-character multiline messages and updates only the affected row', () => {
  const otherRender = jest.fn();
  const view = render(<UserMessageDisclosureProvider scope="one" onToggle={() => {}}>
    <UserMessageText {...props()} text={'1\n2\n3\n4\n5\n6\n7'} />
    <React.Profiler id="other" onRender={otherRender}><UserMessageText {...props()} id="other" /></React.Profiler>
  </UserMessageDisclosureProvider>);
  otherRender.mockClear();
  measure(view, 7); press(view);
  expect(otherRender).not.toHaveBeenCalled();
  expect(view.getByTestId('user-message-text-prompt').props.numberOfLines).toBeUndefined();
});
