import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { Platform, type TextInput } from 'react-native';
import { useCompositionSafeTextInput } from './useCompositionSafeTextInput';

describe('useCompositionSafeTextInput', () => {
  const originalPlatform = Platform.OS;
  const clear = jest.fn();
  const setNativeProps = jest.fn();
  const nativeInput = { clear, setNativeProps } as unknown as TextInput;

  beforeEach(() => {
    Platform.OS = 'ios';
    clear.mockClear();
    setNativeProps.mockClear();
  });

  afterAll(() => {
    Platform.OS = originalPlatform;
  });

  it('keeps iOS native-owned and ignores controlled composing echoes', () => {
    const onChangeText = jest.fn();
    const forwardedRef = React.createRef<TextInput>();
    const { result, rerender } = renderHook<
      ReturnType<typeof useCompositionSafeTextInput>,
      { value: string }
    >(
      ({ value }) => useCompositionSafeTextInput({ forwardedRef, value, onChangeText }),
      { initialProps: { value: '' } },
    );

    act(() => {
      result.current.handleInputRef(nativeInput);
      result.current.handleChangeText('pin');
    });
    rerender({ value: 'pin' });

    expect(forwardedRef.current).toBe(nativeInput);
    expect(onChangeText).toHaveBeenCalledWith('pin');
    expect(result.current.valueProps).toEqual({ defaultValue: '' });
    expect(clear).not.toHaveBeenCalled();
    expect(setNativeProps).not.toHaveBeenCalled();
  });

  it('applies genuine external replacements and clears on iOS', () => {
    const { result, rerender } = renderHook<
      ReturnType<typeof useCompositionSafeTextInput>,
      { value: string }
    >(
      ({ value }) => useCompositionSafeTextInput({
        forwardedRef: null,
        value,
        onChangeText: jest.fn(),
      }),
      { initialProps: { value: '' } },
    );

    act(() => {
      result.current.handleInputRef(nativeInput);
      result.current.handleChangeText('pin');
    });
    rerender({ value: 'pin' });
    rerender({ value: '拼音' });
    expect(setNativeProps).toHaveBeenCalledWith({ text: '拼音' });

    rerender({ value: '' });
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('remains controlled on Android', () => {
    Platform.OS = 'android';
    const { result } = renderHook(() => useCompositionSafeTextInput({
      forwardedRef: null,
      value: 'pinyin',
      onChangeText: jest.fn(),
    }));

    expect(result.current.valueProps).toEqual({ value: 'pinyin' });
  });
});
