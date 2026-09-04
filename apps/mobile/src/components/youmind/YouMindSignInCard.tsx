import React from 'react';
import {
  Image,
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
import { FontSize, FontWeight, Radius, Space, createSurfaceStyle } from '../../theme/tokens';
import { Button, Card, FormTextInput } from '../ui';

const YOUMIND_GOOGLE_ICON = require('../../../assets/youmind-google.png');

type SignInFieldKey = 'optionEmail' | 'email' | 'code';

export function YouMindSignInCard({
  step,
  email,
  code,
  busy,
  otpSent,
  appleAvailable,
  googleAvailable,
  appleBusy,
  googleBusy,
  emailBusy,
  onBack,
  onEditEmail,
  onChangeEmail,
  onChangeCode,
  onAppleSignIn,
  onGoogleSignIn,
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
  appleAvailable: boolean;
  googleAvailable: boolean;
  appleBusy: boolean;
  googleBusy: boolean;
  emailBusy: boolean;
  onBack: () => void;
  onEditEmail: () => void;
  onChangeEmail: (value: string) => void;
  onChangeCode: (value: string) => void;
  onAppleSignIn: () => void;
  onGoogleSignIn: () => void;
  onSendCode: () => void;
  onVerify: () => Promise<boolean>;
  rootStyle?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  cardStyle?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const { t } = useTranslation(['chat', 'common']);
  const { theme } = useAppTheme();
  const styles = React.useMemo(
    () => createStyles(theme.colors, theme.scheme),
    [theme.colors, theme.scheme],
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
              <Pressable
                style={({ pressed }) => [
                  styles.socialButton,
                  pressed && styles.primaryButtonPressed,
                  (!appleAvailable || appleBusy || busy) && styles.buttonDisabled,
                ]}
                onPress={onAppleSignIn}
                disabled={!appleAvailable || appleBusy || busy}
              >
                <View style={styles.socialButtonContent}>
                  <Text style={styles.appleLogo}></Text>
                  <Text style={styles.socialButtonText}>
                    {appleBusy ? t('Loading...', { ns: 'common' }) : t('Continue with Apple')}
                  </Text>
                </View>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.socialButton,
                  pressed && styles.primaryButtonPressed,
                  (!googleAvailable || googleBusy || busy) && styles.buttonDisabled,
                ]}
                onPress={onGoogleSignIn}
                disabled={!googleAvailable || googleBusy || busy}
              >
                <View style={styles.socialButtonContent}>
                  <Image source={YOUMIND_GOOGLE_ICON} style={styles.googleLogo} resizeMode="contain" />
                  <Text style={styles.socialButtonText}>
                    {googleBusy ? t('Loading...', { ns: 'common' }) : t('Continue with Google')}
                  </Text>
                </View>
              </Pressable>
              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>{t('or')}</Text>
                <View style={styles.dividerLine} />
              </View>
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
                <Text style={styles.inlineBackButtonText}>{t('Back')}</Text>
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

function createStyles(
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
  scheme: ReturnType<typeof useAppTheme>['theme']['scheme'],
) {
  return StyleSheet.create({
    root: {
      width: '100%',
    },
    scrollContent: {
      paddingBottom: Space.lg,
    },
    card: {
      borderRadius: Radius.lg,
      gap: Space.md,
      marginHorizontal: Space.sm,
    },
    title: {
      color: colors.text,
      fontSize: FontSize.xxl,
      fontWeight: FontWeight.semibold,
      letterSpacing: -0.7,
      textAlign: 'center',
    },
    socialButton: {
      borderRadius: Radius.lg,
      paddingHorizontal: Space.md,
      paddingVertical: Space.md,
      ...createSurfaceStyle(colors, scheme, 'flat'),
    },
    socialButtonContent: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: Space.sm,
      justifyContent: 'center',
    },
    socialButtonText: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.medium,
    },
    appleLogo: {
      color: colors.text,
      fontSize: FontSize.xl,
    },
    googleLogo: {
      height: 18,
      width: 18,
    },
    dividerRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: Space.sm,
      marginVertical: Space.xs,
    },
    dividerLine: {
      backgroundColor: colors.border,
      flex: 1,
      height: 1,
    },
    dividerText: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      textTransform: 'uppercase',
    },
    primaryButtonPressed: {
      opacity: 0.88,
    },
    buttonDisabled: {
      opacity: 0.45,
    },
    inlineBackButton: {
      alignSelf: 'flex-start',
      paddingVertical: Space.xs,
    },
    inlineBackButtonPressed: {
      opacity: 0.7,
    },
    inlineBackButtonText: {
      color: colors.primary,
      fontSize: FontSize.base,
      fontWeight: FontWeight.medium,
    },
    secondaryActions: {
      flexDirection: 'row',
      gap: Space.sm,
      justifyContent: 'space-between',
    },
    secondaryButton: {
      alignItems: 'center',
      borderColor: colors.border,
      borderRadius: Radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      flex: 1,
      justifyContent: 'center',
      minHeight: 44,
      paddingHorizontal: Space.md,
    },
    secondaryButtonText: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.medium,
    },
  });
}
