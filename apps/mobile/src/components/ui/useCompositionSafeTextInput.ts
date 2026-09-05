import { useCallback, useEffect, useRef, type ForwardedRef } from 'react';
import { Platform, type TextInput, type TextInputProps } from 'react-native';

type Params = {
  forwardedRef: ForwardedRef<TextInput>;
  value: string;
  onChangeText?: TextInputProps['onChangeText'];
};

type CompositionSafeTextInputBindings = {
  handleChangeText: NonNullable<TextInputProps['onChangeText']>;
  handleInputRef: (input: TextInput | null | undefined) => void;
  valueProps: Pick<TextInputProps, 'defaultValue' | 'value'>;
};

function assignRef<T>(ref: ForwardedRef<T>, value: T | null): void {
  if (typeof ref === 'function') {
    ref(value);
    return;
  }
  if (ref) ref.current = value;
}

export function useCompositionSafeTextInput({
  forwardedRef,
  value,
  onChangeText,
}: Params): CompositionSafeTextInputBindings {
  const inputRef = useRef<TextInput>(null);
  const initialValueRef = useRef(value);
  const nativeValueRef = useRef(value);
  const lastPropValueRef = useRef(value);

  const handleInputRef = useCallback((input: TextInput | null | undefined) => {
    const nextInput = input ?? null;
    inputRef.current = nextInput;
    assignRef(forwardedRef, nextInput);
  }, [forwardedRef]);

  const handleChangeText = useCallback((nextValue: string) => {
    nativeValueRef.current = nextValue;
    onChangeText?.(nextValue);
  }, [onChangeText]);

  // Keep iOS native-owned while typing so a controlled JS echo cannot replace
  // marked/composing text. Genuine external changes still update the input.
  useEffect(() => {
    const propValueChanged = value !== lastPropValueRef.current;
    lastPropValueRef.current = value;
    if (
      Platform.OS !== 'ios'
      || !propValueChanged
      || value === nativeValueRef.current
    ) {
      return;
    }

    nativeValueRef.current = value;
    if (value.length === 0) {
      inputRef.current?.clear();
      return;
    }
    inputRef.current?.setNativeProps({ text: value });
  }, [value]);

  return {
    handleChangeText,
    handleInputRef,
    valueProps: Platform.OS === 'ios'
      ? { defaultValue: initialValueRef.current }
      : { value },
  };
}
