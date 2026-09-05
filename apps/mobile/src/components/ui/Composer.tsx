import React, { useImperativeHandle, useMemo, useRef } from 'react';
import {
  type StyleProp,
  StyleSheet,
  type TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';
import { ArrowUp, Mic, Plus, Square } from 'lucide-react-native';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  LineHeight,
  Radius,
  Space,
} from '../../theme/tokens';
import { createFloatingSurfaceStyle, FloatingButton } from './FloatingButton';
import { CompositionSafeTextInput } from './CompositionSafeTextInput';
import {
  PasteCapableTextInput,
  type PastedFile,
} from './PasteCapableTextInput';

const MAX_VISIBLE_INPUT_LINES = 5;
const MAX_INPUT_HEIGHT = LineHeight.body * MAX_VISIBLE_INPUT_LINES;

export type ComposerHandle = {
  focus: () => void;
  blur: () => void;
  clear: () => void;
};

export type ComposerAccessibilityLabels = {
  add: string;
  voice: string;
  send: string;
  stop: string;
};

export type ComposerProps = {
  value: string;
  placeholder: string;
  accessibilityLabels: ComposerAccessibilityLabels;
  onChangeText: (value: string) => void;
  onSend: () => void;
  onStop?: () => void;
  onAddPress?: () => void;
  onVoicePress?: () => void;
  onPasteFiles?: (files: readonly PastedFile[]) => void;
  onPasteFailed?: () => void;
  editable?: boolean;
  canSend?: boolean;
  isRunning?: boolean;
  addDisabled?: boolean;
  voiceDisabled?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
  onFocus?: TextInputProps['onFocus'];
  onBlur?: TextInputProps['onBlur'];
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * The 3.0 thread composer owns only input chrome and primary actions. Attachment,
 * prompt, and skill menus stay with the caller and open from the leading action.
 */
export const Composer = React.forwardRef<ComposerHandle, ComposerProps>(function Composer({
  value,
  placeholder,
  accessibilityLabels,
  onChangeText,
  onSend,
  onStop,
  onAddPress,
  onVoicePress,
  onPasteFiles,
  onPasteFailed,
  editable = true,
  canSend = true,
  isRunning = false,
  addDisabled = false,
  voiceDisabled = false,
  autoFocus = false,
  maxLength,
  onFocus,
  onBlur,
  style,
  testID,
}, forwardedRef): React.JSX.Element {
  const { theme } = useAppTheme();
  const inputRef = useRef<TextInput>(null);
  const styles = useMemo(
    () => createStyles(theme.colors, theme.scheme),
    [theme.colors, theme.scheme],
  );
  const hasText = value.trim().length > 0;
  const showPrimaryAction = isRunning || hasText;
  const primaryDisabled = isRunning ? !onStop : !editable || !canSend || !hasText;
  const inputProps = {
    ref: inputRef,
    testID: testID ? `${testID}-input` : undefined,
    accessibilityLabel: placeholder,
    value,
    onChangeText,
    placeholder,
    placeholderTextColor: theme.colors.inkTertiary,
    style: styles.input,
    editable,
    autoFocus,
    maxLength,
    multiline: true,
    scrollEnabled: true,
    textAlignVertical: 'top' as const,
    onFocus,
    onBlur,
  };

  useImperativeHandle(forwardedRef, () => ({
    focus: () => inputRef.current?.focus(),
    blur: () => inputRef.current?.blur(),
    clear: () => {
      inputRef.current?.clear();
      onChangeText('');
    },
  }), [onChangeText]);

  return (
    <View testID={testID} style={[styles.composer, style]}>
      {onAddPress ? (
        <FloatingButton
          icon={Plus}
          onPress={onAddPress}
          accessibilityLabel={accessibilityLabels.add}
          disabled={addDisabled || !editable}
          testID={testID ? `${testID}-add` : undefined}
        />
      ) : null}
      <View
        testID={testID ? `${testID}-input-shell` : undefined}
        style={[styles.inputShell, !editable ? styles.disabled : null]}
      >
        {onPasteFiles ? (
          <PasteCapableTextInput
            {...inputProps}
            onPasteFiles={onPasteFiles}
            onPasteFailed={onPasteFailed}
          />
        ) : (
          <CompositionSafeTextInput {...inputProps} />
        )}
        {onVoicePress ? (
          <FloatingButton
            icon={Mic}
            onPress={onVoicePress}
            accessibilityLabel={accessibilityLabels.voice}
            appearance="quiet"
            disabled={voiceDisabled || !editable}
            testID={testID ? `${testID}-voice` : undefined}
          />
        ) : null}
      </View>
      {showPrimaryAction ? (
        <FloatingButton
          icon={isRunning ? Square : ArrowUp}
          onPress={isRunning ? (onStop ?? (() => undefined)) : onSend}
          accessibilityLabel={isRunning ? accessibilityLabels.stop : accessibilityLabels.send}
          appearance={isRunning ? 'ink' : 'accent'}
          disabled={primaryDisabled}
          testID={testID ? `${testID}-primary` : undefined}
        />
      ) : null}
    </View>
  );
});

function createStyles(
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
  scheme: ReturnType<typeof useAppTheme>['theme']['scheme'],
) {
  return StyleSheet.create({
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: Space.sm,
    },
    inputShell: {
      flex: 1,
      minHeight: ControlSize.floatingButton,
      flexDirection: 'row',
      alignItems: 'flex-end',
      borderRadius: Radius.full,
      paddingLeft: Space.lg,
      ...createFloatingSurfaceStyle(colors, scheme),
    },
    input: {
      flex: 1,
      minHeight: ControlSize.floatingButton,
      maxHeight: MAX_INPUT_HEIGHT,
      color: colors.ink,
      fontSize: FontSize.body,
      lineHeight: LineHeight.body,
      fontWeight: FontWeight.regular,
      paddingHorizontal: 0,
      paddingVertical: Space.sm,
    },
    disabled: {
      opacity: 0.6,
    },
  });
}
