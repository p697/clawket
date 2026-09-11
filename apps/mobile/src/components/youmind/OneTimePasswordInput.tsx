import React from 'react';
import { Platform, Pressable, StyleSheet, Text, type TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import { ControlSize, FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import { CompositionSafeTextInput } from '../ui/CompositionSafeTextInput';

/** One native field preserves paste, autofill and backspace across all six cells. */
export function OneTimePasswordInput({ value, onChangeText, onComplete, editable = true, invalid = false }: {
  value: string;
  onChangeText: (value: string) => void;
  onComplete: (value: string) => void;
  editable?: boolean;
  invalid?: boolean;
}) {
  const { theme } = useAppTheme();
  const { t } = useTranslation('chat');
  const input = React.useRef<TextInput>(null);
  const [focused, setFocused] = React.useState(false);
  const lastValue = React.useRef(value);
  React.useEffect(() => { if (editable) input.current?.focus(); }, [editable]);
  React.useEffect(() => { lastValue.current = value; }, [value]);
  return <View style={styles.container}>
    <Pressable accessible={false} disabled={!editable} onPress={() => input.current?.focus()} style={styles.row}>
      {Array.from({ length: 6 }, (_, index) => <View
        key={index}
        testID={`otp-cell-${index}`}
        accessible={false}
        style={[styles.cell, {
          backgroundColor: theme.colors.surface,
          borderColor: invalid ? theme.colors.bad : focused && index === Math.min(value.length, 5) ? theme.colors.ink : theme.colors.line,
        }]}
      ><Text accessible={false} style={[styles.digit, { color: theme.colors.ink }]}>{value[index] ?? ''}</Text></View>)}
    </Pressable>
    <CompositionSafeTextInput
      ref={input}
      testID="youmind-otp-input"
      accessibilityLabel={t('Verification code')}
      value={value}
      onChangeText={(text) => {
        if (!editable) return;
        const digits = text.replace(/\D/g, '').slice(0, 6);
        // This numeric-only field must also normalize native-owned iOS text
        // when stripping characters does not change the controlled value.
        if (text !== digits) input.current?.setNativeProps({ text: digits, selection: { start: digits.length, end: digits.length } });
        if (digits === lastValue.current) return;
        lastValue.current = digits;
        onChangeText(digits);
        if (digits.length === 6) onComplete(digits);
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      autoFocus
      editable={editable}
      keyboardType="number-pad"
      textContentType="oneTimeCode"
      autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
      selection={{ start: value.length, end: value.length }}
      caretHidden
      contextMenuHidden={false}
      style={styles.input}
    />
  </View>;
}

const styles = StyleSheet.create({
  container: { width: '100%' },
  row: { flexDirection: 'row', gap: Space.sm },
  cell: { flex: 1, minWidth: 0, minHeight: ControlSize.settingsRow, borderRadius: Radius.settingsGroup, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  digit: { fontSize: FontSize.title, fontWeight: FontWeight.semibold, fontVariant: ['tabular-nums'] },
  input: { ...StyleSheet.absoluteFillObject, opacity: 0.01 },
});
