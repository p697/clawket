import React from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { useCompositionSafeTextInput } from './useCompositionSafeTextInput';

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
      ref={bindings.handleInputRef}
      {...bindings.valueProps}
      onChangeText={bindings.handleChangeText}
    />
  );
});
