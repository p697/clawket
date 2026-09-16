import React, { useMemo } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { ArrowLeft } from '../../components/ui/DirectionalIcon';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type {
  YouMindEmailAuthClient,
  YouMindOnboardingAuthSession,
} from '../../connection';
import { YouMindSignInPanel } from '../../components/youmind/YouMindSignInPanel';
import { FloatingButton } from '../../components/ui/FloatingButton';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Space } from '../../theme/tokens';

export type YouMindOnboardingScreenProps = Readonly<{
  client: YouMindEmailAuthClient;
  onBack: () => void;
  onSignedIn: (session: YouMindOnboardingAuthSession) => Promise<void> | void;
}>;

export function YouMindOnboardingScreen({
  client,
  onBack,
  onSignedIn,
}: YouMindOnboardingScreenProps): React.JSX.Element {
  const { t } = useTranslation(['config', 'chat']);
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);

  return (
    <View
      testID="youmind-onboarding-screen"
      style={[
        styles.screen,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <View style={styles.header}>
        <FloatingButton
          testID="youmind-onboarding-back"
          icon={ArrowLeft}
          appearance="plain"
          accessibilityLabel={t('Back', { ns: 'common' })}
          onPress={onBack}
        />
        <Text testID="youmind-onboarding-title" style={styles.title}>
          {t('YouMind Sprite', { ns: 'config' })}
        </Text>
        <View style={styles.headerSpacer} />
      </View>
      <KeyboardAvoidingView style={styles.content} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <YouMindSignInPanel
            client={client}
            source="onboarding"
            onSignedIn={onSignedIn}
            centered
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    screen: {
      backgroundColor: colors.canvas,
      flex: 1,
    },
    content: { flex: 1 },
    scrollContent: { flexGrow: 1 },
    header: {
      alignItems: 'center',
      flexDirection: 'row',
      minHeight: 52,
      paddingHorizontal: Space.md,
    },
    title: {
      color: colors.ink,
      flex: 1,
      fontSize: FontSize.body,
      fontWeight: FontWeight.semibold,
      textAlign: 'center',
    },
    headerSpacer: {
      width: 44,
    },
  });
}
