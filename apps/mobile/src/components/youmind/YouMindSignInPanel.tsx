import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { analyticsEvents } from '../../services/analytics/events';
import type { YouMindAuthSession } from '../../services/storage';
import { openExternalUrl } from '../../utils/openExternalUrl';
import type { YouMindEmailAuthApi } from '../../connection/adapters/youmind-sprite-api';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import { YouMindSignInCard } from './YouMindSignInCard';

const YOUMIND_WEBSITE_URL = 'https://youmind.com/';

export function YouMindSignInPanel({
  client,
  source,
  headline,
  description,
  onSignedIn,
  onBack,
  backButtonVariant = 'default',
  centered = false,
}: {
  client: YouMindEmailAuthApi;
  source: string;
  headline?: string | null;
  description?: string | null;
  onSignedIn?: (session: YouMindAuthSession) => Promise<void> | void;
  onBack?: () => void;
  backButtonVariant?: 'default' | 'configInline';
  centered?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation(['chat', 'common']);
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => createStyles(theme.colors), [theme.colors]);
  const [signInStep, setSignInStep] = React.useState<'options' | 'email'>('options');
  const [email, setEmail] = React.useState('');
  const [code, setCode] = React.useState('');
  const [otpSent, setOtpSent] = React.useState(false);
  const [authBusyMethod, setAuthBusyMethod] = React.useState<'apple' | 'google' | 'email' | null>(null);
  const authBusy = authBusyMethod !== null;

  const handleSendCode = React.useCallback(async () => {
    if (!email.trim()) {
      Alert.alert(t('Missing email', { ns: 'chat' }), t('Please enter your YouMind email first.', { ns: 'chat' }));
      return;
    }
    analyticsEvents.youMindSignInTapped({ method: 'email', source: otpSent ? 'otp' : source });
    setAuthBusyMethod('email');
    try {
      await client.sendOtp(email);
      setOtpSent(true);
      setSignInStep('email');
    } catch (error) {
      analyticsEvents.youMindSignInResolved({ method: 'email', result: 'failure', source: otpSent ? 'otp' : source });
      Alert.alert(
        t('Unable to send code', { ns: 'chat' }),
        error instanceof Error ? error.message : t('Please try again later.', { ns: 'common' }),
      );
    } finally {
      setAuthBusyMethod(null);
    }
  }, [client, email, otpSent, source, t]);

  const handleVerify = React.useCallback(async () => {
    if (!email.trim() || !code.trim()) {
      Alert.alert(
        t('Missing verification code', { ns: 'chat' }),
        t('Enter both your email and the verification code.', { ns: 'chat' }),
      );
      return false;
    }
    analyticsEvents.youMindSignInTapped({ method: 'email', source: 'otp' });
    setAuthBusyMethod('email');
    try {
      const session = await client.verifyOtp(email, code);
      analyticsEvents.youMindSignInResolved({ method: 'email', result: 'success', source: 'otp' });
      await onSignedIn?.(session);
      return true;
    } catch (error) {
      analyticsEvents.youMindSignInResolved({ method: 'email', result: 'failure', source: 'otp' });
      Alert.alert(
        t('Unable to sign in', { ns: 'chat' }),
        error instanceof Error ? error.message : t('Please try again later.', { ns: 'common' }),
      );
      return false;
    } finally {
      setAuthBusyMethod(null);
    }
  }, [client, code, email, onSignedIn, t]);

  const handleUnsupportedSocialSignIn = React.useCallback((method: 'apple' | 'google') => {
    analyticsEvents.youMindSignInTapped({ method, source });
    analyticsEvents.youMindSignInResolved({ method, result: 'failure', source });
    Alert.alert(
      t('Not supported yet', { ns: 'chat' }),
      t('Please sign in with email for now.', { ns: 'chat' }),
    );
  }, [source, t]);

  const handleOpenYouMindWebsite = React.useCallback(() => {
    void openExternalUrl(YOUMIND_WEBSITE_URL, () => {
      Alert.alert(
        t('Unable to open link', { ns: 'chat' }),
        t('Please try again later.', { ns: 'common' }),
      );
    });
  }, [t]);

  return (
    <View style={[styles.container, centered && styles.centered]}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          style={({ pressed }) => [
            styles.inlineBackButton,
            backButtonVariant === 'configInline' && styles.inlineBackButtonConfigInline,
            pressed && styles.inlineBackButtonPressed,
          ]}
        >
          <Text
            style={[
              styles.inlineBackButtonText,
              backButtonVariant === 'configInline' && styles.inlineBackButtonTextConfigInline,
            ]}
          >
            {t('Back', { ns: 'chat' })}
          </Text>
        </Pressable>
      ) : null}
      {headline ? (
        <Text style={[styles.headline, { color: theme.colors.text }]}>
          {headline}
        </Text>
      ) : null}
      {description ? (
        <Text style={[styles.description, { color: theme.colors.textMuted }]}>
          {description}
        </Text>
      ) : null}
      <View style={styles.cardWrap}>
        <YouMindSignInCard
          step={signInStep}
          email={email}
          code={code}
          busy={authBusy}
          otpSent={otpSent}
          appleAvailable
          googleAvailable
          appleBusy={authBusyMethod === 'apple'}
          googleBusy={authBusyMethod === 'google'}
          emailBusy={authBusyMethod === 'email'}
          onBack={() => {
            if (authBusy) return;
            setSignInStep('options');
          }}
          onEditEmail={() => {
            if (authBusy) return;
            setOtpSent(false);
            setCode('');
            setSignInStep('email');
          }}
          onChangeEmail={setEmail}
          onChangeCode={setCode}
          onAppleSignIn={() => {
            handleUnsupportedSocialSignIn('apple');
          }}
          onGoogleSignIn={() => {
            handleUnsupportedSocialSignIn('google');
          }}
          onSendCode={() => {
            void handleSendCode();
          }}
          onVerify={handleVerify}
          cardStyle={styles.card}
        />
      </View>
      <View style={styles.websitePrompt}>
        <Text style={[styles.websitePromptText, { color: theme.colors.textMuted }]}>
          {t('New to YouMind? Learn more or create an account on the official website.', { ns: 'chat' })}
        </Text>
        <Pressable
          accessibilityRole="link"
          onPress={handleOpenYouMindWebsite}
          style={({ pressed }) => [styles.websitePromptLink, pressed && styles.websitePromptLinkPressed]}
        >
          <Text style={[styles.websitePromptLinkText, { color: theme.colors.primary }]}>
            {t('Visit youmind.com', { ns: 'chat' })}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    container: {
      width: '100%',
    },
    centered: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: Space.xl,
    },
    inlineBackButton: {
      alignSelf: 'flex-start',
      borderRadius: Radius.full,
      marginBottom: Space.md,
      paddingHorizontal: Space.sm,
      paddingVertical: Space.xs,
    },
    inlineBackButtonConfigInline: {
      borderRadius: Radius.none,
      marginBottom: Space.xs,
      paddingHorizontal: 0,
    },
    inlineBackButtonPressed: {
      opacity: 0.72,
    },
    inlineBackButtonText: {
      color: colors.textMuted,
      fontSize: FontSize.base,
      fontWeight: FontWeight.medium,
    },
    inlineBackButtonTextConfigInline: {
      color: colors.primary,
    },
    headline: {
      fontSize: FontSize.xxl,
      fontWeight: FontWeight.semibold,
      letterSpacing: -0.6,
      textAlign: 'center',
    },
    description: {
      fontSize: FontSize.base,
      lineHeight: 24,
      marginTop: Space.sm,
      textAlign: 'center',
    },
    cardWrap: {
      width: '100%',
      maxWidth: 520,
      alignSelf: 'center',
      marginTop: Space.lg,
    },
    card: {
      marginHorizontal: 0,
    },
    websitePrompt: {
      alignItems: 'center',
      alignSelf: 'center',
      marginTop: Space.lg,
      maxWidth: 520,
      paddingHorizontal: Space.lg,
      width: '100%',
    },
    websitePromptText: {
      fontSize: FontSize.base,
      lineHeight: 22,
      textAlign: 'center',
    },
    websitePromptLink: {
      borderRadius: Radius.full,
      marginTop: Space.sm,
      paddingHorizontal: Space.sm,
      paddingVertical: Space.xs,
    },
    websitePromptLinkPressed: {
      opacity: 0.72,
    },
    websitePromptLinkText: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      textAlign: 'center',
    },
  });
}
