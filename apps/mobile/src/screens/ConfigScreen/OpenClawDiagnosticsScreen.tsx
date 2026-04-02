import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CheckCircle2, CircleAlert, TriangleAlert } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { EmptyState, createCardContentStyle } from '../../components/ui';
import { useAppContext } from '../../contexts/AppContext';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import type { RelayDoctorCheckResult } from '../../services/gateway-relay';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import type { ConfigStackParamList } from './ConfigTab';

type Navigation = NativeStackNavigationProp<ConfigStackParamList, 'OpenClawDiagnostics'>;
type DiagnosticsRoute = RouteProp<ConfigStackParamList, 'OpenClawDiagnostics'>;
const MONOSPACE_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

function DoctorCheckRow({
  check,
  styles,
}: {
  check: RelayDoctorCheckResult;
  styles: ReturnType<typeof createStyles>;
}): React.JSX.Element {
  const statusIcon = check.status === 'pass'
    ? <CheckCircle2 size={15} strokeWidth={2.2} color="#22C55E" />
    : check.status === 'warn'
      ? <TriangleAlert size={15} strokeWidth={2.2} color="#F59E0B" />
      : check.status === 'skip'
        ? <CheckCircle2 size={15} strokeWidth={2.2} color="#94A3B8" />
        : <CircleAlert size={15} strokeWidth={2.2} color="#EF4444" />;

  return (
    <View style={styles.doctorCheckRow}>
      {statusIcon}
      <View style={styles.doctorCheckText}>
        <Text style={styles.doctorCheckName}>{check.name}</Text>
        {check.message ? (
          <Text style={styles.doctorCheckMessage}>{check.message}</Text>
        ) : null}
      </View>
    </View>
  );
}

function RawOutputBlock({
  value,
  styles,
}: {
  value: string;
  styles: ReturnType<typeof createStyles>;
}): React.JSX.Element {
  return (
    <View style={styles.rawShell}>
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        contentContainerStyle={styles.rawScrollContent}
      >
        <Text selectable style={styles.rawText}>
          {value}
        </Text>
      </ScrollView>
    </View>
  );
}

export function OpenClawDiagnosticsScreen(): React.JSX.Element {
  const navigation = useNavigation<Navigation>();
  const route = useRoute<DiagnosticsRoute>();
  const { t } = useTranslation(['config', 'common']);
  const { theme } = useAppTheme();
  const { gateway } = useAppContext();
  const { requirePro } = useProPaywall();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const [runningFix, setRunningFix] = useState(false);
  const [fixResult, setFixResult] = useState<{ ok: boolean; raw?: string } | null>(null);
  const [fixError, setFixError] = useState<string | null>(null);

  const mode = route.params?.mode ?? 'doctor';
  const doctorResult = route.params?.doctorResult ?? null;
  const doctorError = route.params?.doctorError ?? null;
  const initialFixResult = route.params?.fixResult ?? null;
  const initialFixError = route.params?.fixError ?? null;

  const handleFixPress = useCallback(async () => {
    if (runningFix) return;
    setRunningFix(true);
    setFixResult(null);
    setFixError(null);

    try {
      const result = await gateway.requestDoctorFix();
      setFixResult(result);
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : '';
      setFixError(raw || t('Fix command failed.'));
    } finally {
      setRunningFix(false);
    }
  }, [gateway, runningFix, t]);

  useEffect(() => {
    if (!requirePro('openclawDiagnostics')) {
      navigation.goBack();
    }
  }, [navigation, requirePro]);

  useNativeStackModalHeader({
    navigation,
    title: mode === 'fix' ? t('OpenClaw Auto Fix') : t('Diagnostics'),
    onClose: () => navigation.goBack(),
  });

  if (mode === 'fix' && initialFixError) {
    return (
      <View style={styles.emptyWrap}>
        <EmptyState
          icon="!"
          title={t('OpenClaw Auto Fix')}
          subtitle={initialFixError}
        />
      </View>
    );
  }

  if (mode === 'fix' && initialFixResult) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heroSection}>
          <View style={styles.doctorSummaryRow}>
            {initialFixResult.ok
              ? <CheckCircle2 size={20} strokeWidth={2.2} color="#22C55E" />
              : <TriangleAlert size={20} strokeWidth={2.2} color="#F59E0B" />}
            <Text style={[
              styles.doctorSummaryText,
              { color: initialFixResult.ok ? '#22C55E' : '#F59E0B' },
            ]}>
              {initialFixResult.ok ? t('Fix completed successfully') : t('Fix completed with issues')}
            </Text>
          </View>
        </View>

        {initialFixResult.raw ? (
          <View style={styles.section}>
            <RawOutputBlock value={initialFixResult.raw} styles={styles} />
          </View>
        ) : null}
      </ScrollView>
    );
  }

  if (!doctorResult && doctorError) {
    return (
      <View style={styles.emptyWrap}>
        <EmptyState
          icon="!"
          title={t('Diagnostics')}
          subtitle={doctorError}
        />
      </View>
    );
  }

  if (!doctorResult) {
    return (
      <View style={styles.emptyWrap}>
        <EmptyState
          icon="!"
          title={t('Diagnostics')}
          subtitle={t('Doctor command failed.')}
        />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.heroSection}>
        <View style={styles.doctorSummaryRow}>
          {doctorResult.ok
            ? <CheckCircle2 size={20} strokeWidth={2.2} color="#22C55E" />
            : <CircleAlert size={20} strokeWidth={2.2} color="#EF4444" />}
          <Text style={[
            styles.doctorSummaryText,
            { color: doctorResult.ok ? '#22C55E' : theme.colors.error },
          ]}>
            {doctorResult.ok ? t('All checks passed') : t('Issues detected')}
          </Text>
        </View>

        {doctorResult.summary ? (
          <Text style={styles.doctorHint}>{doctorResult.summary}</Text>
        ) : null}
      </View>

      {doctorResult.checks.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.doctorCheckList}>
            {doctorResult.checks.map((check, index) => (
              <DoctorCheckRow key={`${check.name}-${index}`} check={check} styles={styles} />
            ))}
          </View>
        </View>
      ) : null}

      {doctorResult.raw ? (
        <View style={styles.section}>
          <RawOutputBlock value={doctorResult.raw} styles={styles} />
        </View>
      ) : null}

      {fixError ? (
        <View style={styles.section}>
          <View style={styles.doctorErrorContainer}>
            <CircleAlert size={20} strokeWidth={2} color={theme.colors.error} />
            <Text style={styles.doctorErrorText}>{fixError}</Text>
          </View>
        </View>
      ) : null}

      {fixResult ? (
        <View style={styles.section}>
          <View style={styles.doctorSummaryRow}>
            {fixResult.ok
              ? <CheckCircle2 size={20} strokeWidth={2.2} color="#22C55E" />
              : <TriangleAlert size={20} strokeWidth={2.2} color="#F59E0B" />}
            <Text style={[
              styles.doctorSummaryText,
              { color: fixResult.ok ? '#22C55E' : '#F59E0B' },
            ]}>
              {fixResult.ok ? t('Fix completed successfully') : t('Fix completed with issues')}
            </Text>
          </View>

          {fixResult.raw ? (
            <RawOutputBlock value={fixResult.raw} styles={styles} />
          ) : null}
        </View>
      ) : (
        <View style={styles.section}>
          <Pressable
            style={({ pressed }) => [
              styles.fixButton,
              pressed && styles.fixButtonPressed,
              runningFix && styles.fixButtonDisabled,
            ]}
            onPress={() => {
              void handleFixPress();
            }}
            disabled={runningFix}
          >
            {runningFix ? (
              <ActivityIndicator size="small" color={theme.colors.primaryText} />
            ) : null}
            <Text style={styles.fixButtonText}>
              {runningFix ? t('Running fix...') : t('Attempt Fix')}
            </Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    content: {
      ...createCardContentStyle(),
      // gap: Space.md,
    },
    emptyWrap: {
      flex: 1,
      backgroundColor: colors.background,
    },
    heroSection: {
      gap: Space.sm,
    },
    section: {
      gap: Space.md,
      paddingTop: Space.md,
    },
    doctorSummaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
    },
    doctorSummaryText: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    doctorHint: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      lineHeight: 18,
    },
    doctorCheckList: {
      gap: Space.sm,
    },
    doctorCheckRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Space.sm,
      paddingVertical: 2,
    },
    doctorCheckText: {
      flex: 1,
    },
    doctorCheckName: {
      color: colors.text,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
    },
    doctorCheckMessage: {
      color: colors.textSubtle,
      fontSize: FontSize.xs,
      marginTop: 1,
      lineHeight: 16,
    },
    rawShell: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    rawScrollContent: {
      minWidth: '100%',
      padding: Space.md,
    },
    rawText: {
      color: colors.text,
      fontSize: FontSize.xs,
      fontFamily: MONOSPACE_FONT,
      lineHeight: 19,
      flexShrink: 0,
    },
    doctorErrorContainer: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Space.md,
    },
    doctorErrorText: {
      color: colors.error,
      fontSize: FontSize.base,
      flex: 1,
      lineHeight: 22,
    },
    fixButton: {
      backgroundColor: colors.primary,
      borderRadius: Radius.md,
      paddingVertical: 11,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: Space.sm,
    },
    fixButtonPressed: {
      opacity: 0.88,
    },
    fixButtonDisabled: {
      opacity: 0.55,
    },
    fixButtonText: {
      color: colors.primaryText,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
  });
}
