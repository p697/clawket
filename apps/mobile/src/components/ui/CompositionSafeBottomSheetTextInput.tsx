import React from 'react';
import { type TextInput } from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { NATIVE_INPUT_TEXT_DEFAULTS, type CompositionSafeTextInputProps } from './CompositionSafeTextInput';
import { useCompositionSafeTextInput } from './useCompositionSafeTextInput';

export type CompositionSafeBottomSheetTextInputProps = CompositionSafeTextInputProps;

export const CompositionSafeBottomSheetTextInput = React.forwardRef<
  TextInput,
  CompositionSafeBottomSheetTextInputProps
>(function CompositionSafeBottomSheetTextInput({
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
    <BottomSheetTextInput
      {...props}
      style={[NATIVE_INPUT_TEXT_DEFAULTS, props.style]}
      ref={bindings.handleInputRef}
      {...bindings.valueProps}
      onChangeText={bindings.handleChangeText}
    />
  );
});
