import React from 'react';
import { StyleSheet, type StyleProp, Text, type ViewStyle, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import { ControlSize, FontSize, FontWeight, LineHeight, Space } from '../../theme/tokens';
import { Button, FormTextInput } from '../ui';
import { OneTimePasswordInput } from './OneTimePasswordInput';

export function YouMindSignInCard({
  email, code, busy, otpSent, emailBusy, onEditEmail, onChangeEmail, onChangeCode,
  onSendCode, onVerify, resendCountdown = 0, invalid = false, rootStyle, contentContainerStyle, cardStyle,
}: {
  step: 'options' | 'email';
  email: string;
  code: string;
  busy: boolean;
  otpSent: boolean;
  emailBusy: boolean;
  onBack: () => void;
  onEditEmail: () => void;
  onChangeEmail: (value: string) => void;
  onChangeCode: (value: string) => void;
  onSendCode: () => void;
  onVerify: (code?: string) => Promise<boolean>;
  resendCountdown?: number;
  invalid?: boolean;
  rootStyle?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  cardStyle?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const { t } = useTranslation(['chat', 'common']);
  const { theme } = useAppTheme();
  return <View style={[styles.root, rootStyle, contentContainerStyle, cardStyle]}>
    <View style={styles.intro}>
      <Text accessibilityRole="header" style={[styles.title, { color: theme.colors.ink }]}>
        {otpSent ? t('Check your email') : t('Sign in to YouMind')}
      </Text>
      <Text style={[styles.description, { color: theme.colors.inkSecondary }]}>
        {otpSent ? t('Enter the 6-digit code sent to {{email}}.', { email }) : t('Sign in with your YouMind email.')}
      </Text>
    </View>
    {otpSent ? <>
      <OneTimePasswordInput value={code} onChangeText={onChangeCode} onComplete={(digits) => { void onVerify(digits); }} editable={!busy} invalid={invalid} />
      <Button label={t('Verify and Sign In')} onPress={() => { void onVerify(); }} disabled={busy || code.length !== 6} loading={emailBusy} />
      <Button variant="ghost" label={resendCountdown > 0 ? t('Resend code in {{seconds}}s', { seconds: resendCountdown }) : t('Resend code')} onPress={onSendCode} disabled={busy || resendCountdown > 0} />
      <Button variant="ghost" label={t('Change email')} onPress={onEditEmail} disabled={busy} />
    </> : <>
      <FormTextInput
        testID="youmind-email-input"
        accessibilityLabel={t('Email address')}
        value={email}
        onChangeText={onChangeEmail}
        editable={!busy}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        autoComplete="email"
        placeholder={t('Email address')}
        surface="quiet"
        minHeight={ControlSize.settingsRow}
        returnKeyType="go"
        onSubmitEditing={onSendCode}
      />
      <Button label={t('Send verification code')} onPress={onSendCode} disabled={busy || !email.trim()} loading={emailBusy} />
    </>}
  </View>;
}

const styles = StyleSheet.create({
  root: { width: '100%', gap: Space.md },
  intro: { gap: Space.md, marginBottom: Space.xl },
  title: { fontSize: FontSize.display, lineHeight: LineHeight.display, fontWeight: FontWeight.semibold },
  description: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary },
});
