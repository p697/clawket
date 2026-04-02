import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CheckCircle2, CircleAlert, ShieldAlert, TriangleAlert } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { EmptyState, ThemedSwitch, createCardContentStyle } from '../../components/ui';
import { useAppContext } from '../../contexts/AppContext';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import { useGatewayPatch } from '../../hooks/useGatewayPatch';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import type { RelayPermissionsResult, RelayPermissionsStatus } from '../../services/gateway-relay';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import { buildCurrentAgentCommandAccessPatch } from '../../utils/openclaw-agent-permissions';
import type { ConfigStackParamList } from './ConfigTab';
import { useGatewayToolSettings } from './hooks/useGatewayToolSettings';

type Navigation = NativeStackNavigationProp<ConfigStackParamList, 'OpenClawPermissions'>;
type PermissionsRoute = RouteProp<ConfigStackParamList, 'OpenClawPermissions'>;

type StatusCardProps = {
  title: string;
  summary: string;
  status: RelayPermissionsStatus;
  styles: ReturnType<typeof createStyles>;
};

function StatusCard({ title, summary, status, styles }: StatusCardProps): React.JSX.Element {
  const icon = status === 'available'
    ? <CheckCircle2 size={18} strokeWidth={2.2} color="#22C55E" />
    : status === 'needs_approval'
      ? <ShieldAlert size={18} strokeWidth={2.2} color="#F59E0B" />
      : status === 'configuration_needed' || status === 'restricted'
        ? <TriangleAlert size={18} strokeWidth={2.2} color="#F59E0B" />
        : <CircleAlert size={18} strokeWidth={2.2} color="#EF4444" />;

  return (
    <View style={styles.statusCard}>
      <View style={styles.statusHeader}>
        {icon}
        <Text style={styles.statusTitle}>{title}</Text>
      </View>
      <Text style={styles.statusSummary}>{summary}</Text>
    </View>
  );
}

function ChipRow<T extends string>({
  options,
  selected,
  onSelect,
  disabled,
  styles,
}: {
  options: { key: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
  disabled: boolean;
  styles: ReturnType<typeof createStyles>;
}): React.JSX.Element {
  return (
    <View style={styles.chipRow}>
      {options.map((option) => {
        const active = option.key === selected;
        return (
          <Pressable
            key={option.key}
            onPress={() => onSelect(option.key)}
            disabled={disabled}
            style={[styles.chip, active && styles.chipActive, disabled && styles.chipDisabled]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function trimReasonPrefix(reason: string): string {
  return reason.replace(/^\[[^\]]+\]\s*/, '').trim();
}

export function OpenClawPermissionsScreen(): React.JSX.Element {
  const navigation = useNavigation<Navigation>();
  useRoute<PermissionsRoute>();
  const { t } = useTranslation(['config', 'common']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const { gateway, gatewayEpoch, config: activeGatewayConfig } = useAppContext();
  const { requirePro } = useProPaywall();
  const { patchWithRestart } = useGatewayPatch(gateway);
  const hasActiveGateway = Boolean(activeGatewayConfig?.url);
  const isRelayRoute = hasActiveGateway && gateway.getConnectionRoute() === 'relay';
  const toolSettings = useGatewayToolSettings({
    gateway,
    gatewayEpoch,
    hasActiveGateway,
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RelayPermissionsResult | null>(null);
  const [savingCurrentAgentAccess, setSavingCurrentAgentAccess] = useState(false);

  const loadPermissions = useCallback(async () => {
    if (!hasActiveGateway || !isRelayRoute) {
      setResult(null);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const next = await gateway.requestPermissions();
      setResult(next);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('Unable to load permission status'));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [gateway, hasActiveGateway, isRelayRoute, t]);

  useEffect(() => {
    if (!requirePro('openclawPermissions')) {
      navigation.goBack();
    }
  }, [navigation, requirePro]);

  useEffect(() => {
    void loadPermissions();
  }, [loadPermissions, gatewayEpoch]);

  useNativeStackModalHeader({
    navigation,
    title: t('OpenClaw Permissions'),
    onClose: () => navigation.goBack(),
  });

  const execSecurityOptions = useMemo(() => [
    { key: 'deny' as const, label: t('Deny') },
    { key: 'allowlist' as const, label: t('Allowlist') },
    { key: 'full' as const, label: t('Full') },
  ], [t]);
  const currentAgentAccessOptions = useMemo(() => [
    { key: 'blocked' as const, label: t('Blocked') },
    { key: 'available' as const, label: t('Available') },
  ], [t]);
  const execAskOptions = useMemo(() => [
    { key: 'always' as const, label: t('Every Command') },
    { key: 'on-miss' as const, label: t('Unknown Only') },
    { key: 'off' as const, label: t('Never') },
  ], [t]);
  const localizeExecSecurity = useCallback((value: string) => {
    if (value === 'deny') return t('Deny');
    if (value === 'allowlist') return t('Allowlist');
    if (value === 'full') return t('Full');
    return value;
  }, [t]);
  const localizeExecAsk = useCallback((value: string) => {
    if (value === 'always') return t('Every Command');
    if (value === 'on-miss') return t('Unknown Only');
    if (value === 'off') return t('Never');
    return value;
  }, [t]);
  const localizeExecHost = useCallback((value: string) => {
    if (value === 'sandbox') return t('OpenClaw Sandbox');
    if (value === 'gateway') return t('This OpenClaw machine');
    if (value === 'node') return t('Paired node device');
    return value;
  }, [t]);
  const localizeToolProfile = useCallback((value: string) => {
    if (value === 'minimal') return t('Minimal');
    if (value === 'coding') return t('Coding');
    if (value === 'messaging') return t('Messaging');
    if (value === 'full') return t('Full');
    return t('Not set');
  }, [t]);
  const localizeWebSummary = useCallback((summary: string) => {
    switch (summary) {
      case 'Web search and fetch are blocked by tool policy.':
        return t('Web search and fetch are blocked by tool policy.');
      case 'Web search and fetch are turned off.':
        return t('Web search and fetch are turned off.');
      case 'Web search is enabled, but no search provider key was found.':
        return t('Web search is enabled, but no search provider key was found.');
      case 'Common web tools look available.':
        return t('Common web tools look available.');
      case 'Web fetch is available, but web search is blocked by tool policy.':
        return t('Web fetch is available, but web search is blocked by tool policy.');
      case 'Web search is available, but web fetch is blocked by tool policy.':
        return t('Web search is available, but web fetch is blocked by tool policy.');
      default:
        return summary;
    }
  }, [t]);
  const localizeWebReason = useCallback((reason: string): string | null => {
    const normalized = trimReasonPrefix(reason);
    if (normalized === 'Global tool policy denies both web_search and web_fetch.') {
      return t('Web search and fetch are blocked by a higher-level restriction.');
    }
    if (normalized === 'tools.web.search.enabled is false.') {
      return t('Web search is turned off in your current settings.');
    }
    if (normalized === 'tools.web.fetch.enabled is false.') {
      return t('Web fetch is turned off in your current settings.');
    }
    if (normalized === 'No supported web search provider API key was found in config or current environment.') {
      return t('OpenClaw could not find any usable web search API key.');
    }
    if (normalized === 'Global tool policy denies web_search.') {
      return t('Web search is blocked by a higher-level restriction.');
    }
    if (normalized === 'Global tool policy denies web_fetch.') {
      return t('Web fetch is blocked by a higher-level restriction.');
    }
    if (normalized === 'Global tool policy denies exec.') {
      return t('Command execution is fully turned off right now.');
    }
    if (normalized === 'Sandbox mode is off, so commands run directly on the gateway host.') {
      return t('Sandbox is not turned on, so commands are currently running directly on your OpenClaw machine.');
    }
    if (normalized === 'No allowlist entries or safe bins are configured yet.') {
      return t('OpenClaw is currently in AllowList mode, but the allowlist is empty, so many commands will still be blocked.');
    }
    if (normalized === 'No allowlist entries or safe bins are configured yet, so most commands will still be denied.') {
      return t('OpenClaw is currently in AllowList mode, but the allowlist is empty, so many commands will still be blocked.');
    }
    if (normalized === 'Effective exec security is allowlist.') {
      return t('Right now, only commands on an approved list can run directly.');
    }
    if (normalized === 'Interpreter/runtime binaries appear in safeBins and may still be unsafe or blocked.') {
      return null;
    }
    if (normalized === 'Interpreter and runtime commands inherit exec approval rules.') {
      return t('Code execution follows the same confirmation rule as command execution.');
    }
    if (normalized === 'Approval-backed interpreter runs are conservative and may be denied when OpenClaw cannot bind one concrete file.') {
      return t('Some script runs may still be blocked if OpenClaw cannot safely identify what will be executed.');
    }
    if (normalized === 'Interpreter and runtime commands usually need explicit allowlist entries.') {
      return t('Script tools often need to be explicitly allowed before they can run freely.');
    }
    if (normalized === 'Interpreter/runtime binaries should not rely on safeBins alone.') {
      return null;
    }
    if (normalized === 'Recommendation: switch the actual rule to Full, or add the commands you trust to the allowlist.') {
      return t('If you want broader command access, switch the actual rule to Full or add the commands you trust to the allowlist.');
    }

    const providerMatch = normalized.match(/^Provider "([^"]+)" is selected, but its API key was not found in config or current environment\.$/);
    if (providerMatch) {
      return t('The selected search provider "{{provider}}" is missing its API key.', {
        provider: providerMatch[1],
      });
    }
    return normalized;
  }, [t]);
  const localizeReasons = useCallback((reasons: readonly string[]) => {
    const seen = new Set<string>();
    const items: string[] = [];
    for (const reason of reasons) {
      const localized = localizeWebReason(reason);
      if (!localized || seen.has(localized)) {
        continue;
      }
      seen.add(localized);
      items.push(localized);
    }
    return items;
  }, [localizeWebReason]);
  const webReasons = result ? localizeReasons(result.web.reasons) : [];
  const webSummary = result ? localizeWebSummary(result.web.summary) : '';

  const execSummary = useMemo(() => {
    if (!result) return '';
    if (!result.exec.execToolAvailable) {
      return t('This agent cannot run commands right now.');
    }
    if (result.exec.implicitSandboxFallback) {
      return t('Commands currently run directly on this OpenClaw machine.');
    }
    if (result.exec.effectiveHost === 'sandbox') {
      return t('Commands run inside OpenClaw\'s sandbox.');
    }
    if (result.exec.effectiveHost === 'node') {
      return t('Commands are being sent to a paired node device.');
    }
    if (result.exec.hostApprovalsApply && result.exec.effectiveSecurity === 'deny') {
      return t('Command execution is currently turned off.');
    }
    if (result.exec.hostApprovalsApply && result.exec.effectiveSecurity === 'allowlist' && result.exec.allowlistCount === 0) {
      return t('Commands are limited right now because OpenClaw is using AllowList mode and the list is empty.');
    }
    if (result.exec.hostApprovalsApply && result.exec.effectiveSecurity === 'allowlist') {
      return t('Commands are limited to things OpenClaw currently trusts.');
    }
    if (result.exec.hostApprovalsApply && result.exec.effectiveAsk === 'always') {
      return t('OpenClaw will confirm every command before it runs.');
    }
    if (result.exec.hostApprovalsApply && result.exec.effectiveAsk === 'on-miss') {
      return t('Commands can run. OpenClaw may still ask in unusual cases.');
    }
    return t('Commands can run on this OpenClaw machine.');
  }, [result, t]);
  const codeExecutionSummary = useMemo(() => {
    if (!result) return '';
    if (!result.exec.execToolAvailable) {
      return t('Scripts are currently unavailable because this agent cannot run commands.');
    }
    if (result.exec.implicitSandboxFallback) {
      return t('Scripts follow the same direct command path as command execution on this machine.');
    }
    if (result.exec.effectiveHost === 'sandbox') {
      return t('Scripts run inside OpenClaw\'s sandbox.');
    }
    if (result.exec.hostApprovalsApply && result.exec.effectiveSecurity === 'deny') {
      return t('Code execution is currently turned off.');
    }
    if (result.exec.hostApprovalsApply && result.exec.effectiveSecurity === 'allowlist' && result.exec.allowlistCount === 0) {
      return t('Scripts are heavily limited because the AllowList is empty.');
    }
    if (result.exec.hostApprovalsApply && result.exec.effectiveAsk === 'always') {
      return t('Scripts follow the same confirmation rule, so OpenClaw will ask before running them.');
    }
    return t('Scripts follow the same command path as command execution.');
  }, [result, t]);
  const execConfiguredDiffers = Boolean(result && result.exec.hostApprovalsApply && (
    result.exec.configSecurity !== result.exec.effectiveSecurity
    || result.exec.configAsk !== result.exec.effectiveAsk
  ));
  const execFacts = useMemo(() => {
    if (!result) return [];
    const items = [
      `${t('Current agent')}: ${result.exec.currentAgentName} (${result.exec.currentAgentId})`,
      `${t('Tool profile')}: ${localizeToolProfile(result.exec.toolProfile)}`,
      `${t('Command tool')}: ${result.exec.execToolAvailable ? t('Available to this agent') : t('Not available to this agent')}`,
      `${t('Running on')}: ${localizeExecHost(result.exec.effectiveHost)}`,
      `${t('Sandbox mode')}: ${result.exec.sandboxMode === 'off' ? t('Off') : result.exec.sandboxMode === 'all' ? t('All Sessions') : t('Non-Main Sessions')}`,
    ];
    if (result.exec.hostApprovalsApply) {
      items.push(`${t('Current rule')}: ${localizeExecSecurity(result.exec.effectiveSecurity)}`);
      items.push(`${t('Current confirmation')}: ${localizeExecAsk(result.exec.effectiveAsk)}`);
      if (result.exec.effectiveSecurity === 'allowlist') {
        items.push(`${t('Allowlist entries')}: ${result.exec.allowlistCount}`);
      }
    }
    return items;
  }, [result, t, localizeExecHost, localizeExecSecurity, localizeExecAsk, localizeToolProfile]);
  const currentAgentCommandAccess = result?.exec.execToolAvailable ? 'available' : 'blocked';
  const currentAgentAccessImpact = useMemo(() => {
    if (currentAgentCommandAccess === 'blocked') {
      return t('Blocked means this agent cannot run commands or manage background processes.');
    }
    return t('Available means this agent can use command tools when its current tool profile allows them.');
  }, [currentAgentCommandAccess, t]);
  const execSecurityImpact = useMemo(() => {
    if (toolSettings.execSecurity === 'deny') {
      return t('Deny turns command execution off on the paths that follow this global rule.');
    }
    if (toolSettings.execSecurity === 'allowlist') {
      return t('AllowList only lets through commands that OpenClaw already trusts.');
    }
    return t('Full broadly allows commands on the paths that follow this global rule.');
  }, [t, toolSettings.execSecurity]);
  const execAskImpact = useMemo(() => {
    if (toolSettings.execAsk === 'always') {
      return t('Every Command asks before each command.');
    }
    if (toolSettings.execAsk === 'on-miss') {
      return t('Unknown Only asks only when OpenClaw does not already recognize the command.');
    }
    return t('Never runs without asking on the paths that follow this global rule.');
  }, [t, toolSettings.execAsk]);
  const saveCurrentAgentCommandAccess = useCallback(async (next: 'blocked' | 'available') => {
    if (!result || !hasActiveGateway || savingCurrentAgentAccess) {
      return;
    }
    const snapshot = await gateway.getConfig();
    if (!snapshot.hash) {
      setError(t('Gateway config hash is missing. Please refresh and try again.'));
      return;
    }
    const built = buildCurrentAgentCommandAccessPatch({
      config: snapshot.config,
      agentId: result.exec.currentAgentId,
      blocked: next === 'blocked',
    });
    if (!built || !built.changed) {
      return;
    }

    setSavingCurrentAgentAccess(true);
    try {
      await patchWithRestart({
        patch: built.patch,
        configHash: snapshot.hash,
        confirmation: {
          title: t('Update current agent command access?'),
          message: t('This will change the current agent\'s deny list and restart OpenClaw Gateway. Continue?'),
          confirmText: t('Save'),
          cancelText: t('Cancel'),
        },
        savingMessage: t('Saving settings...'),
        restartingMessage: t('Restarting Gateway...'),
        onSuccess: async () => {
          await Promise.all([
            loadPermissions(),
            toolSettings.loadToolSettings(),
          ]);
        },
        onError: async () => {
          await loadPermissions();
        },
      });
    } finally {
      setSavingCurrentAgentAccess(false);
    }
  }, [gateway, hasActiveGateway, loadPermissions, patchWithRestart, result, savingCurrentAgentAccess, t, toolSettings]);

  if (!hasActiveGateway) {
    return (
      <View style={styles.emptyWrap}>
        <EmptyState icon="!" title={t('No Active Gateway')} subtitle={t('Please add and activate a gateway connection first.')} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {!isRelayRoute ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('Detailed checks need Clawket Bridge')}</Text>
          <Text style={styles.mutedText}>
            {t('This page can still adjust common toggles, but local permission diagnostics require a relay connection to the paired Bridge runtime.')}
          </Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.card}>
          <Text style={styles.mutedText}>{t('Loading permission status...')}</Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.card}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {result ? (
        <>
          <View style={styles.statusGrid}>
            <StatusCard title={t('Web Search & Fetch')} summary={webSummary} status={result.web.status} styles={styles} />
            <StatusCard title={t('Command Execution')} summary={execSummary} status={result.exec.status} styles={styles} />
            <StatusCard title={t('Code Execution')} summary={codeExecutionSummary} status={result.codeExecution.status} styles={styles} />
          </View>
        </>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('Web Search & Fetch')}</Text>

        <View style={styles.toggleRow}>
          <View style={styles.toggleText}>
            <Text style={styles.rowLabel}>{t('Web Search')}</Text>
            <Text style={styles.rowMeta}>
              {result?.web.searchConfigured
                ? t('Search provider looks configured.')
                : t('Search provider key was not detected.')}
            </Text>
          </View>
          <ThemedSwitch
            value={toolSettings.webSearchEnabled}
            onValueChange={toolSettings.setWebSearchEnabled}
            trackColor={{ false: theme.colors.borderStrong, true: theme.colors.primarySoft }}
            thumbColor={toolSettings.webSearchEnabled ? theme.colors.primary : theme.colors.surfaceMuted}
            disabled={toolSettings.loadingToolSettings || toolSettings.savingToolSettings}
          />
        </View>

        <View style={styles.divider} />

        <View style={styles.toggleRow}>
          <View style={styles.toggleText}>
            <Text style={styles.rowLabel}>{t('Web Fetch')}</Text>
            <Text style={styles.rowMeta}>
              {result?.web.firecrawlConfigured
                ? t('Firecrawl fallback is configured.')
                : t('Basic fetch is available even without Firecrawl.')}
            </Text>
          </View>
          <ThemedSwitch
            value={toolSettings.webFetchEnabled}
            onValueChange={toolSettings.setWebFetchEnabled}
            trackColor={{ false: theme.colors.borderStrong, true: theme.colors.primarySoft }}
            thumbColor={toolSettings.webFetchEnabled ? theme.colors.primary : theme.colors.surfaceMuted}
            disabled={toolSettings.loadingToolSettings || toolSettings.savingToolSettings}
          />
        </View>

        {webReasons.length ? (
          <View style={styles.reasonList}>
            {webReasons.map((reason) => (
              <Text key={reason} style={styles.reasonText}>• {reason}</Text>
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('Command Execution')}</Text>
        <View style={styles.reasonBlock}>
          <Text style={styles.calloutText}>{execSummary}</Text>
        </View>
        <View style={styles.infoList}>
          {execFacts.map((item) => (
            <Text key={item} style={styles.rowMeta}>
              {item}
            </Text>
          ))}
        </View>

        <View style={styles.controlGroup}>
          <Text style={styles.rowLabel}>{t('Current agent command access')}</Text>
          <Text style={styles.rowMeta}>{t('OpenClaw config field: agents.list[].tools.deny')}</Text>
          <Text style={styles.rowMeta}>{currentAgentAccessImpact}</Text>
          <ChipRow
            options={currentAgentAccessOptions}
            selected={currentAgentCommandAccess}
            onSelect={(value) => { void saveCurrentAgentCommandAccess(value); }}
            disabled={savingCurrentAgentAccess || loading || !result}
            styles={styles}
          />
        </View>

        {execConfiguredDiffers ? (
          <View style={styles.reasonBlock}>
            <Text style={styles.calloutText}>
              {t('OpenClaw still has a stricter host approval rule than the App setting below.')}
            </Text>
          </View>
        ) : null}

        {!result?.exec.hostApprovalsApply ? (
          <View style={styles.reasonBlock}>
            <Text style={styles.calloutText}>
              {t('The settings below are global exec settings. The control above is the one that directly changes this agent\'s command access.')}
            </Text>
          </View>
        ) : null}

        <View style={styles.controlGroup}>
          <Text style={styles.sectionLabel}>{t('Advanced global exec settings')}</Text>
          <Text style={styles.rowLabel}>{t('Command permission level')}</Text>
          <Text style={styles.rowMeta}>{t('OpenClaw config field: tools.exec.security')}</Text>
          <Text style={styles.rowMeta}>{execSecurityImpact}</Text>
          <ChipRow
            options={execSecurityOptions}
            selected={toolSettings.execSecurity}
            onSelect={toolSettings.setExecSecurity}
            disabled={toolSettings.loadingToolSettings || toolSettings.savingToolSettings}
            styles={styles}
          />
        </View>

        <View style={styles.controlGroup}>
          <Text style={styles.rowLabel}>{t('Command confirmation mode')}</Text>
          <Text style={styles.rowMeta}>{t('OpenClaw config field: tools.exec.ask')}</Text>
          <Text style={styles.rowMeta}>{execAskImpact}</Text>
          <ChipRow
            options={execAskOptions}
            selected={toolSettings.execAsk}
            onSelect={toolSettings.setExecAsk}
            disabled={toolSettings.loadingToolSettings || toolSettings.savingToolSettings}
            styles={styles}
          />
        </View>

      </View>

      {result ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('Code Execution')}</Text>
          <View style={styles.infoList}>
            <Text style={styles.rowMeta}>
              {t('Current agent')}: {result.exec.currentAgentName} ({result.exec.currentAgentId})
            </Text>
            <Text style={styles.rowMeta}>
              {t('Running on')}: {localizeExecHost(result.exec.effectiveHost)}
            </Text>
          </View>
          <View style={styles.reasonBlock}>
            <Text style={styles.calloutText}>{codeExecutionSummary}</Text>
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    content: {
      ...createCardContentStyle(),
      gap: Space.md,
    },
    emptyWrap: {
      flex: 1,
      backgroundColor: colors.background,
    },
    statusGrid: {
      gap: Space.md,
    },
    statusCard: {
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: Space.lg,
      gap: Space.sm,
    },
    statusHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
    },
    statusTitle: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    statusSummary: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      lineHeight: 20,
    },
    card: {
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: Space.lg,
      gap: Space.md,
    },
    cardTitle: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    sectionLabel: {
      color: colors.text,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
    infoList: {
      gap: Space.xs,
    },
    mutedText: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      lineHeight: 20,
    },
    errorText: {
      color: colors.error,
      fontSize: FontSize.sm,
      lineHeight: 20,
    },
    detailText: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      lineHeight: 20,
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.md,
    },
    toggleText: {
      flex: 1,
      gap: 4,
    },
    rowLabel: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.medium,
    },
    rowMeta: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      lineHeight: 20,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
    },
    controlGroup: {
      gap: Space.sm,
    },
    reasonBlock: {
      gap: Space.xs,
    },
    calloutText: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      lineHeight: 20,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Space.sm,
    },
    chip: {
      paddingHorizontal: Space.md,
      paddingVertical: 8,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
    },
    chipActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primary,
    },
    chipDisabled: {
      opacity: 0.55,
    },
    chipText: {
      color: colors.text,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
    },
    chipTextActive: {
      color: colors.primaryText,
      fontWeight: FontWeight.semibold,
    },
    reasonList: {
      gap: 6,
    },
    reasonText: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      lineHeight: 20,
    },
  });
}
