import React from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { useCompositionSafeTextInput } from './useCompositionSafeTextInput';

// Explicitly clear kerning in native placeholder attributes when a UITextField
// is reused after a tracked input (for example, the pairing code). Caller styles
// can still opt into tracking. Omitting the attribute can retain UIKit spacing.
export const NATIVE_INPUT_TEXT_DEFAULTS = { letterSpacing: 0 } as const;

export type CompositionSafeTextInputProps = Omit<
  TextInputProps,
  'defaultValue' | 'value'
> & {
  value: string;
};

export const CompositionSafeTextInput = React.forwardRef<
  TextInput,
  CompositionSafeTextInputProps
>(function CompositionSafeTextInput({
  value,
  onChangeText,
  ...props
}, forwardedRef): React.JSX.Element {
  const bindings = useCompositionSafeTextInput({
    forwardedRef,
    value,
    onChangeText,
  });

  return (
    <TextInput
      {...props}
      style={[NATIVE_INPUT_TEXT_DEFAULTS, props.style]}
      ref={bindings.handleInputRef}
      {...bindings.valueProps}
      onChangeText={bindings.handleChangeText}
    />
  );
});
