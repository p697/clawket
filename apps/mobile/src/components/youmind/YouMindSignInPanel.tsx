import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type {
  YouMindEmailAuthClient,
  YouMindOnboardingAuthSession,
} from '../../connection';
import { analyticsEvents } from '../../services/analytics/events';
import { openExternalUrl } from '../../utils/openExternalUrl';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import { Banner } from '../ui/Banner';
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
  client: YouMindEmailAuthClient;
  source: string;
  headline?: string | null;
  description?: string | null;
  onSignedIn?: (session: YouMindOnboardingAuthSession) => Promise<void> | void;
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
  const [authBusy, setAuthBusy] = React.useState(false);
  const [authError, setAuthError] = React.useState<string | null>(null);

  const handleSendCode = React.useCallback(async () => {
    if (!email.trim()) {
      setAuthError(t('Please enter your YouMind email first.', { ns: 'chat' }));
      return;
    }
    setAuthError(null);
    analyticsEvents.youMindSignInTapped({ method: 'email', source: otpSent ? 'otp' : source });
    setAuthBusy(true);
    try {
      await client.sendOtp(email);
      setOtpSent(true);
      setSignInStep('email');
    } catch (error) {
      analyticsEvents.youMindSignInResolved({ method: 'email', result: 'failure', source: otpSent ? 'otp' : source });
      setAuthError(error instanceof Error && error.message.trim()
        ? error.message
        : t('Unable to send code', { ns: 'chat' }));
    } finally {
      setAuthBusy(false);
    }
  }, [client, email, otpSent, source, t]);

  const handleVerify = React.useCallback(async () => {
    if (!email.trim() || !code.trim()) {
      setAuthError(t('Enter both your email and the verification code.', { ns: 'chat' }));
      return false;
    }
    setAuthError(null);
    analyticsEvents.youMindSignInTapped({ method: 'email', source: 'otp' });
    setAuthBusy(true);
    try {
      const session = await client.verifyOtp(email, code);
      analyticsEvents.youMindSignInResolved({ method: 'email', result: 'success', source: 'otp' });
      await onSignedIn?.(session);
      return true;
    } catch (error) {
      analyticsEvents.youMindSignInResolved({ method: 'email', result: 'failure', source: 'otp' });
      setAuthError(error instanceof Error && error.message.trim()
        ? error.message
        : t('Unable to sign in', { ns: 'chat' }));
      return false;
    } finally {
      setAuthBusy(false);
    }
  }, [client, code, email, onSignedIn, t]);

  const handleOpenYouMindWebsite = React.useCallback(() => {
    void openExternalUrl(YOUMIND_WEBSITE_URL, () => {
      setAuthError(t('Unable to open link', { ns: 'chat' }));
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
            {t('Back', { ns: 'common' })}
          </Text>
        </Pressable>
      ) : null}
      {headline ? (
        <Text style={[styles.headline, { color: theme.colors.ink }]}>
          {headline}
        </Text>
      ) : null}
      {description ? (
        <Text style={[styles.description, { color: theme.colors.inkSecondary }]}>
          {description}
        </Text>
      ) : null}
      {authError ? (
        <Banner
          testID="youmind-sign-in-error"
          tone="bad"
          message={authError}
          style={styles.errorBanner}
        />
      ) : null}
      <View style={styles.cardWrap}>
        <YouMindSignInCard
          step={signInStep}
          email={email}
          code={code}
          busy={authBusy}
          otpSent={otpSent}
          emailBusy={authBusy}
          onBack={() => {
            if (authBusy) return;
            setSignInStep('options');
          }}
          onEditEmail={() => {
            if (authBusy) return;
            setAuthError(null);
            setOtpSent(false);
            setCode('');
            setSignInStep('email');
          }}
          onChangeEmail={(value) => {
            setAuthError(null);
            setEmail(value);
          }}
          onChangeCode={(value) => {
            setAuthError(null);
            setCode(value);
          }}
          onSendCode={() => {
            void handleSendCode();
          }}
          onVerify={handleVerify}
          cardStyle={styles.card}
        />
      </View>
      <View style={styles.websitePrompt}>
        <Text style={[styles.websitePromptText, { color: theme.colors.inkSecondary }]}>
          {t('New to YouMind? Learn more or create an account on the official website.', { ns: 'chat' })}
        </Text>
        <Pressable
          accessibilityRole="link"
          onPress={handleOpenYouMindWebsite}
          style={({ pressed }) => [styles.websitePromptLink, pressed && styles.websitePromptLinkPressed]}
        >
          <Text style={[styles.websitePromptLinkText, { color: theme.colors.accent }]}>
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
      marginBottom: Space.xs,
      paddingHorizontal: 0,
    },
    inlineBackButtonPressed: {
      opacity: 0.72,
    },
    inlineBackButtonText: {
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      fontWeight: FontWeight.semibold,
    },
    inlineBackButtonTextConfigInline: {
      color: colors.accent,
    },
    headline: {
      fontSize: FontSize.title,
      fontWeight: FontWeight.semibold,
      letterSpacing: -0.6,
      textAlign: 'center',
    },
    description: {
      fontSize: FontSize.secondary,
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
    errorBanner: {
      marginHorizontal: Space.lg,
      marginTop: Space.md,
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
      fontSize: FontSize.secondary,
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
      fontSize: FontSize.secondary,
      fontWeight: FontWeight.semibold,
      textAlign: 'center',
    },
  });
}
