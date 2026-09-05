import React from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  type StyleProp,
  Text,
  type ViewStyle,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import { Button, Card, FormTextInput } from '../ui';

type SignInFieldKey = 'optionEmail' | 'email' | 'code';

export function YouMindSignInCard({
  step,
  email,
  code,
  busy,
  otpSent,
  emailBusy,
  onBack,
  onEditEmail,
  onChangeEmail,
  onChangeCode,
  onSendCode,
  onVerify,
  rootStyle,
  contentContainerStyle,
  cardStyle,
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
  onVerify: () => Promise<boolean>;
  rootStyle?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  cardStyle?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const { t } = useTranslation(['chat', 'common']);
  const { theme } = useAppTheme();
  const styles = React.useMemo(
    () => createStyles(theme.colors),
    [theme.colors],
  );
  const scrollRef = React.useRef<ScrollView | null>(null);
  const fieldOffsetsRef = React.useRef<Partial<Record<SignInFieldKey, number>>>({});

  const handleFieldLayout = React.useCallback((field: SignInFieldKey, event: LayoutChangeEvent) => {
    fieldOffsetsRef.current[field] = event.nativeEvent.layout.y;
  }, []);

  const scrollToField = React.useCallback((field: SignInFieldKey) => {
    const targetY = fieldOffsetsRef.current[field];
    if (typeof targetY !== 'number') return;
    const topPadding = step === 'options' ? 120 : 96;
    requestAnimationFrame(() => {
      setTimeout(() => {
        scrollRef.current?.scrollTo({
          y: Math.max(0, targetY - topPadding),
          animated: true,
        });
      }, 80);
    });
  }, [step]);

  return (
    <View style={[styles.root, rootStyle]}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.scrollContent, contentContainerStyle]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        automaticallyAdjustKeyboardInsets
      >
        <Card style={[styles.card, cardStyle]} padding="lg">
          {step === 'options' ? (
            <>
              <Text style={styles.title}>{t('Sign in to YouMind')}</Text>
              <View onLayout={(event) => handleFieldLayout('optionEmail', event)}>
                <FormTextInput
                  value={email}
                  onChangeText={onChangeEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  placeholder={t('Email address')}
                  surface="sunken"
                  onFocus={() => scrollToField('optionEmail')}
                />
              </View>
              <Button
                label={emailBusy ? t('Loading...', { ns: 'common' }) : t('Send verification code')}
                onPress={onSendCode}
                disabled={busy}
                loading={emailBusy}
              />
            </>
          ) : (
            <>
              <Pressable
                disabled={busy}
                onPress={onBack}
                style={({ pressed }) => [styles.inlineBackButton, pressed && styles.inlineBackButtonPressed]}
              >
                <Text style={styles.inlineBackButtonText}>{t('Back', { ns: 'common' })}</Text>
              </Pressable>
              <Text style={styles.title}>{t('Sign in with email')}</Text>
              {!otpSent ? (
                <View onLayout={(event) => handleFieldLayout('email', event)}>
                  <FormTextInput
                    value={email}
                    onChangeText={onChangeEmail}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    placeholder={t('Email address')}
                    surface="sunken"
                    onFocus={() => scrollToField('email')}
                  />
                </View>
              ) : null}
              {otpSent ? (
                <View onLayout={(event) => handleFieldLayout('code', event)}>
                  <FormTextInput
                    value={code}
                    onChangeText={onChangeCode}
                    keyboardType="number-pad"
                    placeholder={t('Verification code')}
                    surface="sunken"
                    onFocus={() => scrollToField('code')}
                    autoFocus
                  />
                </View>
              ) : null}
              <Button
                label={emailBusy ? t('Loading...', { ns: 'common' }) : otpSent ? t('Verify and Sign In') : t('Send verification code')}
                onPress={otpSent ? () => { void onVerify(); } : onSendCode}
                disabled={busy}
                loading={emailBusy}
              />
              {otpSent ? (
                <View style={styles.secondaryActions}>
                  <Pressable style={styles.secondaryButton} onPress={onSendCode} disabled={busy}>
                    <Text style={styles.secondaryButtonText}>{t('Resend code')}</Text>
                  </Pressable>
                  <Pressable style={styles.secondaryButton} onPress={onEditEmail} disabled={busy}>
                    <Text style={styles.secondaryButtonText}>{t('Change email')}</Text>
                  </Pressable>
                </View>
              ) : null}
            </>
          )}
        </Card>
      </ScrollView>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: {
      width: '100%',
    },
    scrollContent: {
      paddingBottom: Space.lg,
    },
    card: {
      borderRadius: Radius.card,
      gap: Space.md,
      marginHorizontal: Space.sm,
    },
    title: {
      color: colors.ink,
      fontSize: FontSize.title,
      fontWeight: FontWeight.semibold,
      letterSpacing: -0.7,
      textAlign: 'center',
    },
    inlineBackButton: {
      alignSelf: 'flex-start',
      paddingVertical: Space.xs,
    },
    inlineBackButtonPressed: {
      opacity: 0.7,
    },
    inlineBackButtonText: {
      color: colors.accent,
      fontSize: FontSize.secondary,
      fontWeight: FontWeight.semibold,
    },
    secondaryActions: {
      flexDirection: 'row',
      gap: Space.sm,
      justifyContent: 'space-between',
    },
    secondaryButton: {
      alignItems: 'center',
      borderColor: colors.line,
      borderRadius: Radius.full,
      borderWidth: StyleSheet.hairlineWidth,
      flex: 1,
      justifyContent: 'center',
      minHeight: 44,
      paddingHorizontal: Space.md,
    },
    secondaryButtonText: {
      color: colors.ink,
      fontSize: FontSize.secondary,
      fontWeight: FontWeight.semibold,
    },
  });
}
