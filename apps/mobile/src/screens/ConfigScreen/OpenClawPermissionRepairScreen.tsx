import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CheckCircle2, CircleAlert, ShieldAlert, TriangleAlert } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { EmptyState, createCardContentStyle } from '../../components/ui';
import { useAppContext } from '../../contexts/AppContext';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import { useGatewayPatch } from '../../hooks/useGatewayPatch';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import type { PermissionsReport, PermissionStatus } from '@clawket/agent-protocol';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import { buildCurrentAgentCommandAccessPatch } from '../../utils/openclaw-agent-permissions';
import { buildGatewayExecPatch } from '../../utils/gateway-tool-settings';
import type { ConfigStackParamList } from './ConfigTab';
import { useGatewayToolSettings } from './hooks/useGatewayToolSettings';

type Navigation = NativeStackNavigationProp<ConfigStackParamList, 'OpenClawPermissionRepair'>;

type StatusCardProps = {
  title: string;
  summary: string;
  status: PermissionStatus;
  styles: ReturnType<typeof createStyles>;
};

function StatusCard({ title, summary, status, styles }: StatusCardProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const icon = status === 'available'
    ? <CheckCircle2 size={18} strokeWidth={2.2} color={theme.colors.success} />
    : status === 'needs_approval'
      ? <ShieldAlert size={18} strokeWidth={2.2} color={theme.colors.warning} />
      : status === 'configuration_needed' || status === 'restricted'
        ? <TriangleAlert size={18} strokeWidth={2.2} color={theme.colors.warning} />
        : <CircleAlert size={18} strokeWidth={2.2} color={theme.colors.error} />;

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

function confirmAction(options: {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      options.title,
      options.message,
      [
        {
          text: options.cancelText,
          style: 'cancel',
          onPress: () => resolve(false),
        },
        {
          text: options.confirmText,
          style: 'default',
          onPress: () => resolve(true),
        },
      ],
      {
        cancelable: true,
        onDismiss: () => resolve(false),
      },
    );
  });
}

function trimReasonPrefix(reason: string): string {
  return reason.replace(/^\[[^\]]+\]\s*/, '').trim();
}

export function OpenClawPermissionRepairScreen(): React.JSX.Element {
  const navigation = useNavigation<Navigation>();
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
  const [result, setResult] = useState<PermissionsReport | null>(null);
  const [repairingAgentPermissions, setRepairingAgentPermissions] = useState(false);

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
    void loadPermissions();
  }, [loadPermissions, gatewayEpoch]);

  useNativeStackModalHeader({
    navigation,
    title: t('One-click Permission Repair'),
    onClose: () => navigation.goBack(),
  });

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
  const webSummary = useMemo(() => {
    if (!result) return '';
    return webReasons[0] ?? localizeWebSummary(result.web.summary);
  }, [localizeWebSummary, result, webReasons]);

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
  const currentAgentCommandAccess = result?.exec.execToolAvailable ? 'available' : 'blocked';
  const agentPermissionQuickFixApplied = currentAgentCommandAccess === 'available'
    && toolSettings.execSecurity === 'full'
    && toolSettings.execAsk === 'on-miss';

  const repairAgentPermissions = useCallback(async () => {
    if (!result || !hasActiveGateway || repairingAgentPermissions || agentPermissionQuickFixApplied) {
      return;
    }
    if (!requirePro('openclawPermissions')) {
      return;
    }

    const confirmed = await confirmAction({
      title: t('Repair agent permissions?'),
      message: t('This will fully enable command access for the current agent, set command permission level to Full, and set command confirmation mode to Unknown Only. OpenClaw Gateway will restart. Continue?'),
      confirmText: t('Repair Now'),
      cancelText: t('Cancel'),
    });
    if (!confirmed) {
      return;
    }

    const snapshot = await gateway.getConfig();
    if (!snapshot.hash) {
      setError(t('Gateway config hash is missing. Please refresh and try again.'));
      return;
    }

    const accessNeedsFix = currentAgentCommandAccess === 'blocked';
    const accessPatch = accessNeedsFix
      ? buildCurrentAgentCommandAccessPatch({
        config: snapshot.config,
        agentId: result.exec.currentAgentId,
        blocked: false,
      })
      : null;

    if (accessNeedsFix && !accessPatch) {
      setError(t('Current agent command access could not be updated. Please refresh and try again.'));
      return;
    }

    const patch: Record<string, unknown> = {
      ...buildGatewayExecPatch({
        execSecurity: 'full',
        execAsk: 'on-miss',
      }),
      ...(accessPatch ? { agents: accessPatch.patch.agents } : {}),
    };

    setRepairingAgentPermissions(true);
    try {
      await patchWithRestart({
        patch,
        configHash: snapshot.hash,
        savingMessage: t('Repairing agent permissions...'),
        restartingMessage: t('Restarting Gateway...'),
        onSuccess: async () => {
          await Promise.all([
            loadPermissions(),
            toolSettings.loadToolSettings(),
          ]);
          setError(null);
        },
        onError: async () => {
          await Promise.all([
            loadPermissions(),
            toolSettings.loadToolSettings(),
          ]);
        },
      });
    } finally {
      setRepairingAgentPermissions(false);
    }
  }, [
    agentPermissionQuickFixApplied,
    currentAgentCommandAccess,
    gateway,
    hasActiveGateway,
    loadPermissions,
    patchWithRestart,
    repairingAgentPermissions,
    requirePro,
    result,
    t,
    toolSettings,
  ]);

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
          <Pressable
            onPress={() => { void repairAgentPermissions(); }}
            disabled={repairingAgentPermissions || loading || agentPermissionQuickFixApplied}
            style={({ pressed }) => [
              styles.repairCard,
              (pressed && !repairingAgentPermissions && !agentPermissionQuickFixApplied) ? styles.repairCardPressed : null,
              (repairingAgentPermissions || loading || agentPermissionQuickFixApplied) ? styles.repairCardDisabled : null,
            ]}
          >
            <Text style={styles.repairTitle}>{t('One-click repair agent permissions')}</Text>
            <Text style={styles.repairSubtitle}>
              {t('Give agent full authorization so permissions stop getting in the way.')}
            </Text>
          </Pressable>

          <View style={styles.statusGrid}>
            <StatusCard title={t('Web Search & Fetch')} summary={webSummary} status={result.web.status} styles={styles} />
            <StatusCard title={t('Command Execution')} summary={execSummary} status={result.exec.status} styles={styles} />
            <StatusCard title={t('Code Execution')} summary={codeExecutionSummary} status={result.codeExecution.status} styles={styles} />
          </View>
        </>
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
    card: {
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: Space.lg,
      gap: Space.md,
    },
    statusGrid: {
      gap: Space.md,
    },
    statusCard: {
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
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
    repairCard: {
      borderRadius: Radius.md,
      backgroundColor: colors.primary,
      padding: Space.lg,
      gap: Space.xs,
    },
    repairCardPressed: {
      opacity: 0.9,
    },
    repairCardDisabled: {
      opacity: 0.55,
    },
    repairTitle: {
      color: colors.primaryText,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    repairSubtitle: {
      color: colors.primaryText,
      fontSize: FontSize.sm,
      lineHeight: 20,
      opacity: 0.92,
    },
    cardTitle: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
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
  });
}
