import React from 'react';
import type { TextInput } from 'react-native';
import PasteInput, {
  type PastedFile,
  type PasteTextInputInstance,
} from '@mattermost/react-native-paste-input';
import { NATIVE_INPUT_TEXT_DEFAULTS, type CompositionSafeTextInputProps } from './CompositionSafeTextInput';
import { useCompositionSafeTextInput } from './useCompositionSafeTextInput';

export type { PastedFile };

export type PasteCapableTextInputProps = CompositionSafeTextInputProps & {
  /** Files pasted from the system paste menu; text paste remains native. */
  onPasteFiles?: (files: readonly PastedFile[]) => void;
  /** The native paste bridge could not hand over the selected file. */
  onPasteFailed?: () => void;
};

export const PasteCapableTextInput = React.forwardRef<
  TextInput,
  PasteCapableTextInputProps
>(function PasteCapableTextInput({
  value,
  onChangeText,
  onPasteFiles,
  onPasteFailed,
  ...props
}, forwardedRef): React.JSX.Element {
  const bindings = useCompositionSafeTextInput({
    forwardedRef,
    value,
    onChangeText,
  });

  const handlePaste = React.useCallback((
    error: string | null | undefined,
    files: PastedFile[],
  ) => {
    if (error) {
      onPasteFailed?.();
      return;
    }
    if (files.length > 0) onPasteFiles?.(files);
  }, [onPasteFailed, onPasteFiles]);

  return (
    <PasteInput
      {...props}
      style={[NATIVE_INPUT_TEXT_DEFAULTS, props.style]}
      ref={bindings.handleInputRef as unknown as React.Ref<PasteTextInputInstance>}
      {...bindings.valueProps}
      onChangeText={bindings.handleChangeText}
      onPaste={handlePaste}
    />
  );
});
