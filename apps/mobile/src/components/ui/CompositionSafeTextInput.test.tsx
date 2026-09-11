import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { CompositionSafeTextInput } from './CompositionSafeTextInput';
import { PasteCapableTextInput } from './PasteCapableTextInput';

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  return {
    Platform: { OS: 'ios' },
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => style,
    },
    TextInput: ReactRuntime.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => (
      ReactRuntime.createElement('TextInput', { ...props, ref })
    )),
  };
});

describe('composition-safe input components', () => {
  const originalPlatform = Platform.OS;

  afterAll(() => {
    Platform.OS = originalPlatform;
  });

  it('leaves the iOS host uncontrolled while forwarding changes', () => {
    Platform.OS = 'ios';
    const onChangeText = jest.fn();
    const view = render(
      <CompositionSafeTextInput
        testID="input"
        value=""
        onChangeText={onChangeText}
      />,
    );

    fireEvent.changeText(view.getByTestId('input'), '拼音');
    expect(view.getByTestId('input').props.defaultValue).toBe('');
    expect(view.getByTestId('input').props.value).toBeUndefined();
    expect(onChangeText).toHaveBeenCalledWith('拼音');
  });

  it('keeps Android controlled', () => {
    Platform.OS = 'android';
    const view = render(
      <CompositionSafeTextInput testID="input" value="pinyin" onChangeText={jest.fn()} />,
    );

    expect(view.getByTestId('input').props.value).toBe('pinyin');
    expect(view.getByTestId('input').props.defaultValue).toBeUndefined();
  });

  it('routes file paste success and native failure separately', () => {
    Platform.OS = 'ios';
    const onPasteFiles = jest.fn();
    const onPasteFailed = jest.fn();
    const file = {
      uri: 'file:///tmp/pasted.png',
      fileName: 'pasted.png',
      fileSize: 512,
      type: 'image/png',
    };
    const view = render(
      <PasteCapableTextInput
        testID="paste-input"
        value=""
        onChangeText={jest.fn()}
        onPasteFiles={onPasteFiles}
        onPasteFailed={onPasteFailed}
      />,
    );

    fireEvent(view.getByTestId('paste-input'), 'paste', null, [file]);
    expect(onPasteFiles).toHaveBeenCalledWith([file]);
    expect(onPasteFailed).not.toHaveBeenCalled();

    fireEvent(view.getByTestId('paste-input'), 'paste', 'native error', []);
    expect(onPasteFailed).toHaveBeenCalledTimes(1);
  });
});

it('resets native tracking after a spaced field while preserving explicit overrides', () => {
  const view = render(<CompositionSafeTextInput testID="tracking" value="" placeholder="123 456" style={{ letterSpacing: 4 }} />);
  const style = () => Object.assign({}, ...view.getByTestId('tracking').props.style.flat(Infinity));
  expect(style().letterSpacing).toBe(4);
  view.rerender(<CompositionSafeTextInput testID="tracking" value="" placeholder="搜索组件" />);
  expect(style().letterSpacing).toBe(0);
});
