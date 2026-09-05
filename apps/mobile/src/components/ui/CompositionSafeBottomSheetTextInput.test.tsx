import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { CompositionSafeBottomSheetTextInput } from './CompositionSafeBottomSheetTextInput';

const mockClear = jest.fn();
const mockSetNativeProps = jest.fn();

jest.mock('@gorhom/bottom-sheet', () => {
  const ReactRuntime = require('react');
  return {
    BottomSheetTextInput: ReactRuntime.forwardRef((
      props: Record<string, unknown>,
      ref: React.Ref<unknown>,
    ) => {
      ReactRuntime.useImperativeHandle(ref, () => ({
        clear: mockClear,
        setNativeProps: mockSetNativeProps,
      }));
      return ReactRuntime.createElement('BottomSheetTextInput', props);
    }),
  };
});

describe('CompositionSafeBottomSheetTextInput', () => {
  const originalPlatform = Platform.OS;
  let consoleErrorSpy: jest.SpyInstance;

  beforeAll(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
  });

  beforeEach(() => {
    Platform.OS = 'ios';
    mockClear.mockClear();
    mockSetNativeProps.mockClear();
  });

  afterAll(() => {
    Platform.OS = originalPlatform;
    consoleErrorSpy.mockRestore();
  });

  it('keeps iOS native-owned and ignores a controlled composing echo', () => {
    const onChangeText = jest.fn();
    const view = render(
      <CompositionSafeBottomSheetTextInput
        testID="input"
        value=""
        onChangeText={onChangeText}
      />,
    );
    const input = view.getByTestId('input');
    fireEvent.changeText(input, 'pin');
    view.rerender(
      <CompositionSafeBottomSheetTextInput
        testID="input"
        value="pin"
        onChangeText={onChangeText}
      />,
    );

    expect(input.props.defaultValue).toBe('');
    expect(input.props.value).toBeUndefined();
    expect(onChangeText).toHaveBeenCalledWith('pin');
    expect(mockClear).not.toHaveBeenCalled();
    expect(mockSetNativeProps).not.toHaveBeenCalled();
  });

  it('applies external replacement and clear on iOS', () => {
    const view = render(
      <CompositionSafeBottomSheetTextInput
        testID="input"
        value=""
        onChangeText={jest.fn()}
      />,
    );
    fireEvent.changeText(view.getByTestId('input'), 'pin');
    view.rerender(
      <CompositionSafeBottomSheetTextInput testID="input" value="pin" onChangeText={jest.fn()} />,
    );
    view.rerender(
      <CompositionSafeBottomSheetTextInput testID="input" value="拼音" onChangeText={jest.fn()} />,
    );
    expect(mockSetNativeProps).toHaveBeenCalledWith({ text: '拼音' });

    view.rerender(
      <CompositionSafeBottomSheetTextInput testID="input" value="" onChangeText={jest.fn()} />,
    );
    expect(mockClear).toHaveBeenCalledTimes(1);
  });

  it('remains controlled on Android', () => {
    Platform.OS = 'android';
    const view = render(
      <CompositionSafeBottomSheetTextInput
        testID="input"
        value="pinyin"
        onChangeText={jest.fn()}
      />,
    );
    expect(view.getByTestId('input').props.value).toBe('pinyin');
    expect(view.getByTestId('input').props.defaultValue).toBeUndefined();
  });
});
