import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ArrowRight, FileText, Trash2, Wrench } from 'lucide-react-native';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { HeaderActionButton, LoadingState } from '../../components/ui';
import { useAppContext } from '../../contexts/AppContext';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import { resolveGatewayBackendKind } from '../../services/gateway-backends';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import type { RequirementStatus, SkillStatusEntry, SkillStatusReport } from '../../types';
import { formatTimestamp } from '../../utils/cron';
import { buildSkillFixPrompt } from '../../utils/skill-fix';
import type { ConsoleStackParamList } from './ConsoleTab';

type SkillDetailNavigation = NativeStackNavigationProp<ConsoleStackParamList, 'SkillDetail'>;
type SkillDetailRoute = RouteProp<ConsoleStackParamList, 'SkillDetail'>;

function hasListItems(value?: string[]): boolean {
  return Array.isArray(value) && value.length > 0;
}

function hasRequirementContent(requirements: RequirementStatus): boolean {
  return (
    hasListItems(requirements.bins) ||
    hasListItems(requirements.anyBins) ||
    hasListItems(requirements.env) ||
    hasListItems(requirements.config) ||
    hasListItems(requirements.os)
  );
}

function hasMissingContent(missing: RequirementStatus): boolean {
  return (
    hasListItems(missing.bins) ||
    hasListItems(missing.anyBins) ||
    hasListItems(missing.env) ||
    hasListItems(missing.config) ||
    hasListItems(missing.os)
  );
}

function resolveSkillStatus(skill: SkillStatusEntry): {
  label: 'Active' | 'Unavailable' | 'Disabled';
  colorToken: 'success' | 'warning' | 'muted';
} {
  if (skill.disabled) return { label: 'Disabled', colorToken: 'muted' };
  if (skill.eligible) return { label: 'Active', colorToken: 'success' };
  return { label: 'Unavailable', colorToken: 'warning' };
}

function resolveSourceBadge(
  source: string,
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
): {
  label: string;
  textColor: string;
  borderColor: string;
} {
  const normalized = source.trim().toLowerCase();

  if (normalized === 'workspace' || normalized === 'openclaw-workspace') {
    return {
      label: 'Workspace',
      textColor: colors.success,
      borderColor: colors.success,
    };
  }

  if (normalized === 'openclaw-bundled' || normalized === 'built-in') {
    return {
      label: 'Built-in',
      textColor: colors.sessionBadgeDiscord,
      borderColor: colors.sessionBadgeDiscord,
    };
  }

  if (normalized === 'openclaw-extension' || normalized === 'extension' || normalized === 'openclaw-extra') {
    return {
      label: 'Extension',
      textColor: colors.sessionBadgeSubagent,
      borderColor: colors.sessionBadgeSubagent,
    };
  }

  if (normalized === 'managed' || normalized === 'openclaw-managed') {
    return {
      label: 'Managed',
      textColor: colors.warning,
      borderColor: colors.warning,
    };
  }

  return {
    label: source.trim() || 'Other',
    textColor: colors.textMuted,
    borderColor: colors.borderStrong,
  };
}

function hasConfiguredApiKey(skill: SkillStatusEntry): boolean {
  return skill.configChecks.some((check) => {
    const lowerPath = check.path.toLowerCase();
    return check.satisfied && lowerPath.includes('apikey');
  });
}

export function SkillDetailScreen(): React.JSX.Element {
  const { gateway, currentAgentId, requestChatWithInput, config } = useAppContext();
  const { requirePro } = useProPaywall();
  const { theme } = useAppTheme();
  const { t } = useTranslation('console');
  const navigation = useNavigation<SkillDetailNavigation>();
  const route = useRoute<SkillDetailRoute>();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const supportsHermesSkillContent = resolveGatewayBackendKind(config) === 'hermes';

  const { skillKey } = route.params;

  const [report, setReport] = useState<SkillStatusReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingSkill, setDeletingSkill] = useState(false);

  const loadDetail = useCallback(async (mode: 'initial' | 'refresh' | 'background' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);

    try {
      const nextReport = await gateway.getSkillsStatus(currentAgentId);
      setReport(nextReport);
      setError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load skills';
      setError(message);
    } finally {
      if (mode === 'initial') setLoading(false);
      if (mode === 'refresh') setRefreshing(false);
    }
  }, [currentAgentId, gateway]);

  useFocusEffect(
    useCallback(() => {
      loadDetail('initial').catch(() => {
        // Error state is handled in loadDetail.
      });
    }, [loadDetail]),
  );

  const skill = useMemo(
    () => report?.skills.find((entry) => entry.skillKey === skillKey) ?? null,
    [report, skillKey],
  );

  const status = skill ? resolveSkillStatus(skill) : null;
  const statusColor =
    status?.colorToken === 'success'
      ? theme.colors.success
      : status?.colorToken === 'warning'
        ? theme.colors.warning
        : theme.colors.textSubtle;

  const sourceBadge = skill ? resolveSourceBadge(skill.source, theme.colors) : null;

  const requirementsVisible =
    !!skill && (hasRequirementContent(skill.requirements) || skill.configChecks.length > 0);
  const missingVisible = !!skill && hasMissingContent(skill.missing);
  const configVisible = !!skill?.primaryEnv;
  const apiKeyConfigured = skill ? hasConfiguredApiKey(skill) : false;
  const fixableUnavailable = !!skill && !skill.disabled && !skill.eligible;

  const handleToggleEnabled = useCallback(async () => {
    if (!skill || toggling || skill.always) return;
    setToggling(true);
    try {
      const nextEnabled = skill.disabled;
      await gateway.updateSkill(skill.skillKey, { enabled: nextEnabled });
      await loadDetail('background');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update skill';
      Alert.alert(t('Update failed'), message);
    } finally {
      setToggling(false);
    }
  }, [gateway, loadDetail, skill, toggling, t]);

  const handleOpenHomepage = useCallback(async (url: string) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        Alert.alert(t('Cannot open link'), t('This URL is not supported on this device.'));
        return;
      }
      await Linking.openURL(url);
    } catch {
      Alert.alert(t('Cannot open link'), t('Failed to open homepage URL.'));
    }
  }, [t]);

  const handleFixWithAgent = useCallback(() => {
    if (!skill || !fixableUnavailable) return;
    const prompt = buildSkillFixPrompt(skill);
    navigation.popToTop();
    setTimeout(() => requestChatWithInput(prompt), 50);
  }, [fixableUnavailable, navigation, requestChatWithInput, skill]);

  const handleOpenSkillContent = useCallback(() => {
    if (!skill) return;
    navigation.navigate('SkillContent', { skillKey: skill.skillKey });
  }, [navigation, skill]);

  const handleDeleteSkillConfirmed = useCallback(async () => {
    if (!supportsHermesSkillContent || !skill?.deletable || deletingSkill) return;
    setDeletingSkill(true);
    try {
      await gateway.deleteSkill(skill.skillKey, currentAgentId);
      Alert.alert(t('Skill deleted'), t('This skill has been removed.'));
      navigation.goBack();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('Delete skill failed');
      Alert.alert(t('Delete skill failed'), message);
    } finally {
      setDeletingSkill(false);
    }
  }, [currentAgentId, deletingSkill, gateway, navigation, skill?.deletable, skill?.skillKey, supportsHermesSkillContent, t]);

  const handleDeleteSkillPress = useCallback(() => {
    if (!supportsHermesSkillContent || !skill?.deletable || deletingSkill) return;
    if (!requirePro('coreFileEditing')) return;
    Alert.alert(
      t('Delete Skill'),
      t('Delete this skill?'),
      [
        { text: t('common:Cancel'), style: 'cancel' },
        {
          text: t('Delete'),
          style: 'destructive',
          onPress: () => {
            handleDeleteSkillConfirmed().catch(() => {
              // Error state is handled in handleDeleteSkillConfirmed.
            });
          },
        },
      ],
    );
  }, [deletingSkill, handleDeleteSkillConfirmed, requirePro, skill?.deletable, supportsHermesSkillContent, t]);

  const renderCheckRow = (label: string, satisfied: boolean, key: string) => (
    <View key={key} style={styles.checkRow}>
      <Text style={[styles.checkIcon, { color: satisfied ? theme.colors.success : theme.colors.error }]}>
        {satisfied ? '✓' : '✗'}
      </Text>
      <Text style={styles.checkText}>{label}</Text>
    </View>
  );

  const renderMissingRow = (label: string, key: string) => (
    <View key={key} style={styles.checkRow}>
      <Text style={[styles.checkIcon, { color: theme.colors.error }]}>✗</Text>
      <Text style={styles.checkText}>{label}</Text>
    </View>
  );

  const headerRight = useMemo(
    () => (supportsHermesSkillContent && skill?.deletable ? (
      <HeaderActionButton
        icon={Trash2}
        onPress={handleDeleteSkillPress}
        tone="destructive"
        disabled={deletingSkill}
      />
    ) : null),
    [deletingSkill, handleDeleteSkillPress, skill?.deletable, supportsHermesSkillContent],
  );

  useNativeStackModalHeader({
    navigation,
    title: skill?.name || t('Skill'),
    rightContent: headerRight ?? undefined,
    onClose: () => navigation.goBack(),
  });

  if (loading) {
    return (
      <View style={styles.root}>
        <LoadingState message={t('Loading skill...')} />
      </View>
    );
  }

  if (error || !skill || !sourceBadge || !status) {
    const message = error ?? 'Skill not found';
    return (
      <View style={styles.root}>
        <View style={styles.centerState}>
          <Text style={styles.errorTitle}>{t('Failed to load skills')}</Text>
          <Text style={styles.stateText}>{message}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => loadDetail('initial')}>
            <Text style={styles.retryText}>{t('common:Retry')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const bins = skill.requirements.bins ?? [];
  const missingBins = new Set(skill.missing.bins ?? []);

  const envVars = skill.requirements.env ?? [];
  const missingEnv = new Set(skill.missing.env ?? []);

  const requirementConfig = skill.requirements.config ?? [];
  const missingConfig = new Set(skill.missing.config ?? []);

  const requiredOs = skill.requirements.os ?? [];

  const anyBins = skill.requirements.anyBins ?? [];
  const anyBinsSatisfied = (skill.missing.anyBins ?? []).length === 0;
  const homepage = skill.homepage;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              loadDetail('refresh').catch(() => {
                // Error state is handled in loadDetail.
              });
            }}
            tintColor={theme.colors.primary}
          />
        }
      >
        <View style={styles.sectionCard}>
          <View style={styles.heroRow}>
            <View style={styles.heroMain}>
              <Text style={styles.heroEmoji}>{skill.emoji ?? '⚡'}</Text>
              <View style={styles.heroTextWrap}>
                <Text style={styles.heroTitle} numberOfLines={2}>{skill.name}</Text>
                <View
                  style={[
                    styles.sourceBadge,
                    {
                      borderColor: sourceBadge.borderColor,
                      backgroundColor: theme.colors.surfaceMuted,
                    },
                  ]}
                >
                  <Text style={[styles.sourceBadgeText, { color: sourceBadge.textColor }]}>{sourceBadge.label}</Text>
                </View>
              </View>
            </View>

            <View style={styles.toggleWrap}>
              <View style={styles.toggleRow}>
                {toggling ? <ActivityIndicator size="small" color={theme.colors.primary} /> : null}
                <Switch
                  value={skill.always ? true : !skill.disabled}
                  onValueChange={() => handleToggleEnabled()}
                  disabled={skill.always || toggling}
                  trackColor={{ false: theme.colors.borderStrong, true: theme.colors.primary }}
                  thumbColor={theme.colors.iconOnColor}
                />
              </View>
              <Text style={styles.toggleLabel}>{skill.always ? t('Always active') : (skill.disabled ? t('Disabled') : t('Enabled'))}</Text>
            </View>
          </View>

        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('Info')}</Text>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('Description')}</Text>
            <Text style={styles.infoValue}>{skill.description}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('Location')}</Text>
            <Text style={styles.infoMonospace} numberOfLines={1} ellipsizeMode="middle">
              {skill.baseDir}
            </Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('Skill Key')}</Text>
            <Text style={styles.infoMonospace} numberOfLines={1} ellipsizeMode="middle">
              {skill.skillKey}
            </Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('Status')}</Text>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={styles.statusValue}>{t(status.label)}</Text>
            </View>
          </View>

          {typeof skill.createdAtMs === 'number' && Number.isFinite(skill.createdAtMs) ? (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>{t('Created')}</Text>
              <Text style={styles.infoValue}>{formatTimestamp(skill.createdAtMs)}</Text>
            </View>
          ) : null}

          {typeof skill.updatedAtMs === 'number' && Number.isFinite(skill.updatedAtMs) ? (
            <View style={homepage ? styles.infoRow : styles.infoRowLast}>
              <Text style={styles.infoLabel}>{t('Updated')}</Text>
              <Text style={styles.infoValue}>{formatTimestamp(skill.updatedAtMs)}</Text>
            </View>
          ) : null}

          {homepage ? (
            <View style={styles.infoRowLast}>
              <Text style={styles.infoLabel}>{t('Homepage')}</Text>
              <TouchableOpacity onPress={() => handleOpenHomepage(homepage)}>
                <Text style={styles.linkText} numberOfLines={1} ellipsizeMode="middle">
                  {homepage}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        {supportsHermesSkillContent ? (
          <TouchableOpacity style={styles.instructionsAction} onPress={handleOpenSkillContent} activeOpacity={0.9}>
            <View style={styles.instructionsActionContent}>
              <View style={styles.instructionsActionIconWrap}>
                <FileText size={18} color={theme.colors.primaryText} strokeWidth={2.1} />
              </View>
              <View style={styles.instructionsActionTextWrap}>
                <Text style={styles.instructionsActionTitle}>{t('View and edit Skill.md and related files')}</Text>
              </View>
              <ArrowRight size={18} color={theme.colors.primaryText} strokeWidth={2.2} />
            </View>
          </TouchableOpacity>
        ) : null}

        {requirementsVisible ? (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>{t('Requirements')}</Text>

            {bins.length > 0 ? <Text style={styles.subTitle}>{t('Binaries')}</Text> : null}
            {bins.map((bin) => renderCheckRow(bin, !missingBins.has(bin), `bin:${bin}`))}

            {anyBins.length > 0 ? <Text style={styles.subTitle}>{t('Any binary')}</Text> : null}
            {anyBins.length > 0
              ? renderCheckRow(anyBins.join(' or '), anyBinsSatisfied, `any-bin:${anyBins.join('|')}`)
              : null}

            {envVars.length > 0 ? <Text style={styles.subTitle}>{t('Environment')}</Text> : null}
            {envVars.map((envName) => renderCheckRow(envName, !missingEnv.has(envName), `env:${envName}`))}

            {skill.configChecks.length > 0 || requirementConfig.length > 0 ? <Text style={styles.subTitle}>{t('Config')}</Text> : null}
            {skill.configChecks.length > 0
              ? skill.configChecks.map((check) =>
                  renderCheckRow(check.label || check.path, check.satisfied, `config-check:${check.path}`),
                )
              : requirementConfig.map((configPath) =>
                  renderCheckRow(configPath, !missingConfig.has(configPath), `config:${configPath}`),
                )}

            {requiredOs.length > 0 ? <Text style={styles.subTitle}>{t('OS')}</Text> : null}
            {requiredOs.map((platformName) => renderCheckRow(platformName, true, `os:${platformName}`))}
          </View>
        ) : null}

        {missingVisible ? (
          <View style={styles.sectionCard}>
            <Text style={[styles.sectionTitle, { color: theme.colors.error }]}>{t('Missing')}</Text>

            {(skill.missing.bins ?? []).map((bin) => renderMissingRow(`${t('Binary')}: ${bin}`, `missing-bin:${bin}`))}
            {(skill.missing.anyBins ?? []).map((bin) => renderMissingRow(`${t('Any binary')}: ${bin}`, `missing-any-bin:${bin}`))}
            {(skill.missing.env ?? []).map((envName) => renderMissingRow(`${t('Environment')}: ${envName}`, `missing-env:${envName}`))}
            {(skill.missing.config ?? []).map((configPath) => renderMissingRow(`${t('Config')}: ${configPath}`, `missing-config:${configPath}`))}
            {(skill.missing.os ?? []).map((platformName) => renderMissingRow(`${t('OS')}: ${platformName}`, `missing-os:${platformName}`))}

            {skill.install.length > 0 ? <Text style={styles.subTitle}>{t('Install options')}</Text> : null}
            {skill.install.map((option) => {
              const installLabel = option.bins.length > 0 ? option.bins.join(', ') : option.label;
              return (
                <View key={option.id} style={styles.installCard}>
                  <Text style={styles.installText}>{t('Requires')}: {installLabel} ({option.kind})</Text>
                </View>
              );
            })}
          </View>
        ) : null}

        {configVisible ? (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>{t('Configuration')}</Text>

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>{t('Primary environment variable')}</Text>
              <Text style={styles.infoMonospace}>{skill.primaryEnv}</Text>
            </View>

            <View style={styles.infoRowLast}>
              <Text style={styles.infoLabel}>{t('API Key')}</Text>
              <Text style={styles.infoValue}>{apiKeyConfigured ? '••••••' : t('Not configured')}</Text>
            </View>
          </View>
        ) : null}

        {fixableUnavailable ? (
          <TouchableOpacity style={styles.fixButton} activeOpacity={0.88} onPress={handleFixWithAgent}>
            <Wrench size={15} color={theme.colors.primaryText} strokeWidth={2} />
            <Text style={styles.fixButtonText}>{t('One-click fix')}</Text>
          </TouchableOpacity>
        ) : null}

      </ScrollView>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  const monospaceFamily = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: Space.lg,
      gap: Space.md,
      paddingBottom: Space.xxxl - Space.sm,
    },
    sectionCard: {
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: Space.md,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.bold,
      marginBottom: Space.sm,
    },
    subTitle: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.bold,
      marginTop: Space.md - 2,
      marginBottom: 6,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    heroRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 10,
    },
    heroMain: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      minWidth: 0,
    },
    heroEmoji: {
      fontSize: 32,
      lineHeight: 38,
    },
    heroTextWrap: {
      flex: 1,
      minWidth: 0,
      gap: 6,
    },
    heroTitle: {
      fontSize: FontSize.lg + 4,
      fontWeight: FontWeight.bold,
      color: colors.text,
    },
    sourceBadge: {
      alignSelf: 'flex-start',
      borderRadius: Radius.full,
      borderWidth: 1,
      paddingHorizontal: 9,
      paddingVertical: Space.xs,
    },
    sourceBadgeText: {
      fontSize: FontSize.xs,
      fontWeight: FontWeight.bold,
    },
    toggleWrap: {
      alignItems: 'flex-end',
      gap: 6,
    },
    toggleRow: {
      minHeight: 32,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    toggleLabel: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
      fontWeight: FontWeight.semibold,
    },
    infoRow: {
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 4,
    },
    infoRowLast: {
      paddingTop: 8,
      gap: 4,
    },
    infoLabel: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
    infoValue: {
      color: colors.text,
      fontSize: FontSize.md,
      lineHeight: 19,
    },
    infoMonospace: {
      color: colors.text,
      fontSize: FontSize.sm,
      lineHeight: 18,
      fontFamily: monospaceFamily,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    statusValue: {
      color: colors.text,
      fontSize: FontSize.md,
      fontWeight: FontWeight.semibold,
    },
    linkText: {
      color: colors.primary,
      fontSize: FontSize.md,
      lineHeight: 19,
    },
    fixButton: {
      width: '100%',
      backgroundColor: colors.primary,
      borderRadius: Radius.md,
      paddingVertical: 11,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: Space.sm,
    },
    fixButtonText: {
      color: colors.primaryText,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    checkRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      paddingVertical: 3,
    },
    checkIcon: {
      width: 14,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.bold,
      marginTop: 1,
    },
    checkText: {
      flex: 1,
      color: colors.text,
      fontSize: FontSize.md,
      lineHeight: 18,
    },
    installCard: {
      borderRadius: Radius.sm + 2,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: 10,
      paddingVertical: Space.sm,
      marginBottom: Space.sm,
    },
    installText: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      lineHeight: 17,
    },
    instructionsAction: {
      width: '100%',
      borderRadius: Radius.md,
      backgroundColor: colors.primary,
      paddingHorizontal: Space.md,
      paddingVertical: Space.md,
    },
    instructionsActionContent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
    },
    instructionsActionIconWrap: {
      width: 40,
      height: 40,
      borderRadius: Radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primaryText + '22',
    },
    instructionsActionTextWrap: {
      flex: 1,
      gap: 2,
    },
    instructionsActionTitle: {
      color: colors.primaryText,
      fontSize: FontSize.base,
      lineHeight: 20,
      fontWeight: FontWeight.bold,
      flexShrink: 1,
    },
    primaryAction: {
      borderRadius: Radius.sm,
      backgroundColor: colors.primary,
      paddingHorizontal: Space.sm + 2,
      paddingVertical: 7,
      alignSelf: 'flex-start',
    },
    primaryActionText: {
      color: colors.primaryText,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
    centerState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Space.lg + Space.xs,
    },
    stateText: {
      marginTop: 8,
      color: colors.textMuted,
      fontSize: FontSize.md,
      textAlign: 'center',
    },
    errorTitle: {
      color: colors.error,
      fontSize: FontSize.md + 1,
      fontWeight: FontWeight.bold,
      textAlign: 'center',
    },
    retryButton: {
      marginTop: Space.md,
      backgroundColor: colors.primary,
      borderRadius: Radius.sm,
      paddingHorizontal: Space.md,
      paddingVertical: 6,
    },
    retryText: {
      color: colors.primaryText,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
  });
}
