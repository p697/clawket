import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card, LoadingState, ScreenHeader, ThemedSwitch } from '../ui';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import type { NodeInfo } from '../../types';
import { GatewayClient } from '../../services/gateway';
import type { NodeCapabilityToggleKey, NodeCapabilityToggles } from '../../services/node-capabilities';
import { NodeInvokeAuditEntry, StorageService } from '../../services/storage';

const NODE_INVOKE_AUDIT_DISPLAY_LIMIT = 20;

type Props = {
  gateway: GatewayClient;
  nodeId: string;
  topInset: number;
  displayName?: string;
  nodeCapabilityToggles: NodeCapabilityToggles;
  onNodeCapabilityTogglesChange: (toggles: NodeCapabilityToggles) => void;
  onBack: () => void;
  dismissStyle?: 'back' | 'close';
};

type RawSnapshot = {
  payload: unknown | null;
  error: string | null;
  unsupported: boolean;
};

function compactId(value: string): string {
  if (value.length <= 20) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function toPrettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatDate(timestampMs?: number): string {
  if (!timestampMs) return '—';
  return new Date(timestampMs).toLocaleString();
}

type TFunc = (key: string, options?: Record<string, unknown>) => string;

function formatValue(t: TFunc, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? t('Yes') : t('No');
  return String(value);
}

function normalizeCap(value: string): string {
  return value.trim().toLowerCase();
}

const DISPLAY_COMMAND_ALIASES: Partial<Record<NodeCapabilityToggleKey, string[]>> = {
  'camera.snap': ['camera.capture'],
  'photos.latest': ['camera.pick'],
};

async function invokeNodeRead(gateway: GatewayClient, nodeId: string, command: string): Promise<unknown> {
  const raw = await gateway.request<unknown>('node.invoke', {
    nodeId,
    command,
    params: {},
    idempotencyKey: `clawket_${command}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  });

  if (!raw || typeof raw !== 'object') return raw;
  const record = raw as Record<string, unknown>;

  if (record.ok === false) {
    const error = record.error && typeof record.error === 'object'
      ? (record.error as Record<string, unknown>)
      : null;
    const message = typeof error?.message === 'string'
      ? error.message
      : `Node invoke failed: ${command}`;
    throw new Error(message);
  }

  if ('payload' in record) {
    return record.payload;
  }
  return raw;
}

export function NodeDetailView({
  gateway,
  nodeId,
  topInset,
  displayName,
  nodeCapabilityToggles,
  onNodeCapabilityTogglesChange,
  onBack,
  dismissStyle = 'back',
}: Props): React.JSX.Element {
  const { t } = useTranslation('console');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [node, setNode] = useState<NodeInfo | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<RawSnapshot>({ payload: null, error: null, unsupported: false });
  const [deviceStatus, setDeviceStatus] = useState<RawSnapshot>({ payload: null, error: null, unsupported: false });
  const [auditEntries, setAuditEntries] = useState<NodeInvokeAuditEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [localDeviceId, setLocalDeviceId] = useState<string | null>(null);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);

    try {
      const allAuditEntries = await StorageService.getNodeInvokeAuditEntries();
      setAuditEntries(
        allAuditEntries
          .filter((entry) => entry.nodeId === nodeId)
          .slice(0, NODE_INVOKE_AUDIT_DISPLAY_LIMIT),
      );

      const list = await gateway.listNodes();
      const current = list.nodes.find((item) => item.nodeId === nodeId) ?? null;
      setNode(current);

      if (!current) {
        setLoadError(t('This node is not in the latest node list.'));
        setDeviceInfo({ payload: null, error: null, unsupported: true });
        setDeviceStatus({ payload: null, error: null, unsupported: true });
        return;
      }

      setLoadError(null);
      const supportsInfo = current.commands.includes('device.info');
      const supportsStatus = current.commands.includes('device.status');

      if (supportsInfo) {
        try {
          const payload = await invokeNodeRead(gateway, nodeId, 'device.info');
          setDeviceInfo({ payload, error: null, unsupported: false });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Failed to load device.info';
          setDeviceInfo({ payload: null, error: message, unsupported: false });
        }
      } else {
        setDeviceInfo({ payload: null, error: null, unsupported: true });
      }

      if (supportsStatus) {
        try {
          const payload = await invokeNodeRead(gateway, nodeId, 'device.status');
          setDeviceStatus({ payload, error: null, unsupported: false });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Failed to load device.status';
          setDeviceStatus({ payload: null, error: message, unsupported: false });
        }
      } else {
        setDeviceStatus({ payload: null, error: null, unsupported: true });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('Failed to load node detail');
      setLoadError(message);
      setNode(null);
      setDeviceInfo({ payload: null, error: null, unsupported: true });
      setDeviceStatus({ payload: null, error: null, unsupported: true });
    } finally {
      if (mode === 'initial') setLoading(false);
      if (mode === 'refresh') setRefreshing(false);
    }
  }, [gateway, nodeId, t]);

  useEffect(() => {
    load('initial').catch(() => {
      // handled in load
    });
  }, [load]);

  useEffect(() => {
    gateway.getDeviceIdentity()
      .then((identity) => {
        setLocalDeviceId(identity.deviceId);
      })
      .catch(() => {
        setLocalDeviceId(null);
      });
  }, [gateway]);

  const title = node?.displayName ?? displayName ?? compactId(nodeId);
  const isLocalNode = localDeviceId === nodeId;
  const advertisedCommands = useMemo(
    () => new Set((node?.commands ?? []).map(normalizeCap)),
    [node?.commands],
  );

  const infoRows = useMemo(() => ([
    { label: t('Display Name'), value: node?.displayName },
    { label: t('Platform'), value: node?.platform },
    { label: t('Version'), value: node?.version },
    { label: t('Core Version'), value: node?.coreVersion },
    { label: t('UI Version'), value: node?.uiVersion },
    { label: t('Device Family'), value: node?.deviceFamily },
    { label: t('Model Identifier'), value: node?.modelIdentifier },
    { label: t('Remote IP'), value: node?.remoteIp },
    { label: t('Paired'), value: node?.paired },
    { label: t('Connected'), value: node?.connected },
    { label: t('Connected At'), value: formatDate(node?.connectedAtMs) },
    { label: t('Caps Count'), value: node?.caps?.length ?? 0 },
    { label: t('Commands Count'), value: node?.commands?.length ?? 0 },
    { label: t('Node ID'), value: node?.nodeId ?? nodeId },
  ]), [node, nodeId, t]);

  const actionRows = useMemo<{ key: NodeCapabilityToggleKey; label: string; description: string }[]>(() => [
    { key: 'device.info', label: 'device.info', description: t('Share basic device information with agents.') },
    { key: 'device.status', label: 'device.status', description: t('Share battery, storage and system status with agents.') },
    { key: 'system.notify', label: 'system.notify', description: t('Show a local notification on this device.') },
    { key: 'camera.snap', label: 'camera.snap', description: t('Open the camera and capture a new photo.') },
    { key: 'photos.latest', label: 'photos.latest', description: t('Pick recent photos from this device.') },
    { key: 'location.get', label: 'location.get', description: t('Read this device\'s current location.') },
    { key: 'clipboard.read', label: 'clipboard.read', description: t('Read the current clipboard text.') },
    { key: 'clipboard.write', label: 'clipboard.write', description: t('Write text to the clipboard.') },
    { key: 'media.save', label: 'media.save', description: t('Save generated images to this device.') },
  ], [t]);

  if (loading) {
    return (
      <View style={styles.root}>
        <ScreenHeader title={t('Node Detail')} topInset={topInset} onBack={onBack} dismissStyle={dismissStyle} />
        <LoadingState message={t('Loading node detail...')} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title={title} topInset={topInset} onBack={onBack} dismissStyle={dismissStyle} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              load('refresh').catch(() => {
                // handled in load
              });
            }}
            tintColor={theme.colors.primary}
          />
        )}
      >
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>{t('Node Capabilities')}</Text>
          <Text style={styles.sectionHint}>
            {isLocalNode
              ? t('Control which capabilities agents can use on this device.')
              : t('These are the actions this node currently exposes to agents.')}
          </Text>

          <View style={styles.capabilityList}>
            {actionRows.map((item, index) => {
              const isLast = index === actionRows.length - 1;
              const rowStyle = isLast
                ? [styles.capabilityRow, styles.capabilityRowLast]
                : styles.capabilityRow;
              if (isLocalNode) {
                return (
                  <View key={item.key} style={rowStyle}>
                    <View style={styles.capabilityTextWrap}>
                      <Text style={styles.governanceLabel}>{item.label}</Text>
                      <Text style={styles.governanceDescription}>{item.description}</Text>
                    </View>
                    <ThemedSwitch
                      value={nodeCapabilityToggles[item.key]}
                      onValueChange={(enabled) => {
                        onNodeCapabilityTogglesChange({
                          ...nodeCapabilityToggles,
                          [item.key]: enabled,
                        });
                      }}
                    />
                  </View>
                );
              }
              const aliases = DISPLAY_COMMAND_ALIASES[item.key] ?? [];
              const available = advertisedCommands.has(item.key)
                || aliases.some((alias) => advertisedCommands.has(alias));
              return (
                <View key={item.key} style={rowStyle}>
                  <View style={styles.capabilityTextWrap}>
                    <Text style={styles.governanceLabel}>{item.label}</Text>
                    <Text style={styles.governanceDescription}>{item.description}</Text>
                  </View>
                  <View style={available ? styles.statusBadgeAvailable : styles.statusBadgeUnavailable}>
                    <Text style={available ? styles.statusBadgeAvailableText : styles.statusBadgeUnavailableText}>
                      {available ? t('Available') : t('Off')}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>

          {!isLocalNode && (
            <Text style={[styles.sectionHint, { marginTop: Space.sm }]}>
              {t('Only this device can change which actions it exposes to agents.')}
            </Text>
          )}
        </Card>

        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>{t('Recent Invocations')}</Text>
          <Text style={styles.sectionHint}>
            {t('Showing up to {{limit}} most recent node.invoke calls for this node.', { limit: NODE_INVOKE_AUDIT_DISPLAY_LIMIT })}
          </Text>
          {auditEntries.length === 0 ? (
            <Text style={styles.emptyText}>{t('No invocation records yet.')}</Text>
          ) : (
            <View style={styles.auditList}>
              {auditEntries.map((entry) => (
                <View key={entry.id} style={styles.auditRow}>
                  <View style={styles.auditRowTop}>
                    <Text selectable style={styles.auditCommand}>{entry.command}</Text>
                    <View style={entry.result === 'success' ? styles.auditSuccessBadge : styles.auditErrorBadge}>
                      <Text style={entry.result === 'success' ? styles.auditSuccessText : styles.auditErrorText}>
                        {entry.result}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.auditMeta}>
                    {`Source: ${entry.source} · ${new Date(entry.timestampMs).toLocaleString()}`}
                  </Text>
                  {entry.result === 'error' ? (
                    <Text style={styles.auditErrorDetail}>
                      {entry.errorCode ? `[${entry.errorCode}] ` : ''}
                      {entry.errorMessage ?? t('Unknown error')}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </Card>

        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>{t('Basic Information')}</Text>
          {infoRows.map((row) => {
            const valueText = formatValue(t, row.value);
            return (
              <View key={row.label} style={styles.row}>
                <Text style={styles.rowLabel}>{row.label}</Text>
                <Text selectable style={styles.rowValue}>{valueText}</Text>
              </View>
            );
          })}
        </Card>

        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>{t('Advertised Commands')}</Text>
          {node?.commands?.length ? (
            <View style={styles.commandWrap}>
              {node.commands.map((command) => (
                <View key={command} style={styles.commandPill}>
                  <Text style={styles.commandText}>{command}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyText}>{t('No commands advertised.')}</Text>
          )}
        </Card>

        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>{t('Raw Information (Permission-Free)')}</Text>
          <Text style={styles.sectionHint}>
            {t('These snapshots are fetched directly from node commands that do not require extra system permissions.')}
          </Text>

          <View style={styles.rawBlock}>
            <Text style={styles.rawTitle}>device.info</Text>
            {deviceInfo.unsupported ? (
              <Text style={styles.emptyText}>{t('This node does not advertise device.info.')}</Text>
            ) : deviceInfo.error ? (
              <Text style={styles.errorText}>{deviceInfo.error}</Text>
            ) : (
              <Text style={styles.rawText}>{toPrettyJson(deviceInfo.payload)}</Text>
            )}
          </View>

          <View style={styles.rawBlock}>
            <Text style={styles.rawTitle}>device.status</Text>
            {deviceStatus.unsupported ? (
              <Text style={styles.emptyText}>{t('This node does not advertise device.status.')}</Text>
            ) : deviceStatus.error ? (
              <Text style={styles.errorText}>{deviceStatus.error}</Text>
            ) : (
              <Text style={styles.rawText}>{toPrettyJson(deviceStatus.payload)}</Text>
            )}
          </View>
        </Card>

        {loadError ? (
          <Card style={styles.card}>
            <Text style={styles.errorTitle}>{t('Failed to load node detail')}</Text>
            <Text style={styles.errorText}>{loadError}</Text>
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      paddingHorizontal: Space.lg,
      paddingVertical: Space.lg,
      gap: Space.md,
      paddingBottom: Space.xxxl,
    },
    card: {
      padding: Space.md,
      borderRadius: Radius.md,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      gap: Space.sm,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: FontSize.lg,
      fontWeight: FontWeight.semibold,
    },
    sectionHint: {
      color: colors.textSubtle,
      fontSize: FontSize.md,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Space.md,
      paddingVertical: Space.xs,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    rowLabel: {
      color: colors.textMuted,
      fontSize: FontSize.md,
      width: '34%',
    },
    rowValue: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.medium,
      flex: 1,
      textAlign: 'left',
    },
    capabilityList: {
      gap: Space.sm,
    },
    capabilityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.md,
      paddingVertical: Space.xs,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    capabilityRowLast: {
      borderBottomWidth: 0,
    },
    capabilityTextWrap: {
      flex: 1,
      gap: Space.xs,
    },
    statusBadgeAvailable: {
      borderRadius: Radius.full,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.success,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: Space.sm,
      paddingVertical: 2,
    },
    statusBadgeUnavailable: {
      borderRadius: Radius.full,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderStrong,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: Space.sm,
      paddingVertical: 2,
    },
    statusBadgeAvailableText: {
      color: colors.success,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
    statusBadgeUnavailableText: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
    },
    governanceTextWrap: {
      flex: 1,
      gap: Space.xs,
    },
    governanceLabel: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.medium,
    },
    governanceDescription: {
      color: colors.textSubtle,
      fontSize: FontSize.md,
    },
    commandWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Space.sm,
    },
    commandPill: {
      borderRadius: Radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
      paddingVertical: Space.xs,
      paddingHorizontal: Space.sm,
    },
    commandText: {
      color: colors.text,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
    },
    auditList: {
      gap: Space.sm,
    },
    auditRow: {
      borderRadius: Radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
      padding: Space.sm,
      gap: Space.xs,
    },
    auditRowTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.sm,
    },
    auditCommand: {
      flex: 1,
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.medium,
    },
    auditMeta: {
      color: colors.textSubtle,
      fontSize: FontSize.md,
    },
    auditSuccessBadge: {
      borderRadius: Radius.full,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.success,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: Space.sm,
      paddingVertical: 2,
    },
    auditErrorBadge: {
      borderRadius: Radius.full,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.error,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: Space.sm,
      paddingVertical: 2,
    },
    auditSuccessText: {
      color: colors.success,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
    auditErrorText: {
      color: colors.error,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
    auditErrorDetail: {
      color: colors.error,
      fontSize: FontSize.md,
      lineHeight: 18,
    },
    rawBlock: {
      borderRadius: Radius.sm,
      backgroundColor: colors.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: Space.sm,
      gap: Space.sm,
    },
    rawTitle: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    rawText: {
      color: colors.textMuted,
      fontSize: FontSize.md,
      lineHeight: 19,
      fontFamily: 'Menlo',
    },
    emptyText: {
      color: colors.textSubtle,
      fontSize: FontSize.md,
    },
    errorTitle: {
      color: colors.error,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    errorText: {
      color: colors.error,
      fontSize: FontSize.md,
      lineHeight: 20,
    },
  });
}
