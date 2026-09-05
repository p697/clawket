import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import type {
  AgentAdapter,
  ChannelsStatusResult,
  DeviceInfo,
  DevicePairListResult,
  DevicePairRequest,
  NodeInfo,
  NodeListResult,
  NodePairRequest,
} from '@clawket/agent-protocol';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
import {
  SettingsDivider,
  SettingsGroup,
  SettingsRow,
} from '../../components/ui/SettingsGroup';
import { Sheet } from '../../components/ui/Sheet';
import { Skeleton } from '../../components/ui/Skeleton';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  LineHeight,
  Space,
} from '../../theme/tokens';
import {
  buildChannelRows,
  compactIdentifier,
  deviceLabel,
  deviceRequestLabel,
  getChannelsDevicesViews,
  nodeLabel,
  nodeRequestLabel,
  sortDeviceRequests,
  sortDevices,
  sortNodeRequests,
  sortNodes,
  type ChannelConnectionState,
  type ChannelsDevicesView,
} from './channels-devices-model';

const EMPTY_DEVICE_RESULT: DevicePairListResult = { pending: [], paired: [] };
const EMPTY_NODE_RESULT: NodeListResult = { ts: 0, nodes: [] };

export type ChannelsDevicesSectionProps = Readonly<{
  adapter: AgentAdapter;
  online: boolean;
}>;

export function ChannelsDevicesSection({
  adapter,
  online,
}: ChannelsDevicesSectionProps): React.JSX.Element {
  const { t } = useTranslation(['common', 'settings', 'config']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const management = adapter.management;
  const views = useMemo(
    () => getChannelsDevicesViews(adapter.capabilities, management),
    [adapter.capabilities, management],
  );
  const [view, setView] = useState<ChannelsDevicesView>(views[0] ?? 'channels');
  const [channels, setChannels] = useState<ChannelsStatusResult | null>(null);
  const [devices, setDevices] = useState<DevicePairListResult>(EMPTY_DEVICE_RESULT);
  const [nodes, setNodes] = useState<NodeListResult>(EMPTY_NODE_RESULT);
  const [nodeRequests, setNodeRequests] = useState<NodePairRequest[]>([]);
  const [loading, setLoading] = useState<Partial<Record<ChannelsDevicesView, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<ChannelsDevicesView, string>>>({});
  const [busyRequest, setBusyRequest] = useState<string | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<DeviceInfo | null>(null);
  const [removeCandidate, setRemoveCandidate] = useState<DeviceInfo | null>(null);
  const [selectedNode, setSelectedNode] = useState<NodeInfo | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [detailError, setDetailError] = useState<string | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);

  useEffect(() => {
    if (!views.includes(view) && views[0]) setView(views[0]);
  }, [view, views]);

  const loadView = useCallback(async (target: ChannelsDevicesView) => {
    if (!online || !views.includes(target)) return;
    setLoading((current) => ({ ...current, [target]: true }));
    setErrors((current) => ({ ...current, [target]: undefined }));
    try {
      if (target === 'channels') {
        const status = management?.channels?.status;
        if (!status) return;
        setChannels(await status({ probe: false }));
      } else if (target === 'devices') {
        const list = management?.devices?.list;
        if (!list) return;
        const result = await list();
        setDevices({
          pending: sortDeviceRequests(result.pending),
          paired: sortDevices(result.paired),
        });
      } else {
        const list = management?.nodes?.list;
        if (!list) return;
        const [result, pairResult] = await Promise.all([
          list(),
          adapter.capabilities.pairRequests && management?.nodes?.pairRequests
            ? management.nodes.pairRequests()
            : Promise.resolve(null),
        ]);
        setNodes({ ...result, nodes: sortNodes(result.nodes) });
        setNodeRequests(sortNodeRequests(pairResult?.pending ?? []));
      }
    } catch (loadError: unknown) {
      const fallback = target === 'channels'
        ? t('Failed to load channels', { ns: 'settings' })
        : target === 'devices'
          ? t('Failed to load devices', { ns: 'settings' })
          : t('Failed to load nodes', { ns: 'settings' });
      setErrors((current) => ({
        ...current,
        [target]: errorMessage(loadError, fallback),
      }));
    } finally {
      setLoading((current) => ({ ...current, [target]: false }));
    }
  }, [adapter.capabilities.pairRequests, management, online, t, views]);

  useEffect(() => {
    void loadView(view);
  }, [loadView, view]);

  const decideDeviceRequest = useCallback(async (
    request: DevicePairRequest,
    decision: 'approve' | 'reject',
  ) => {
    const operation = management?.devices?.[decision];
    if (!online || !adapter.capabilities.pairRequests || !operation || busyRequest) return;
    setBusyRequest(`device:${request.requestId}`);
    setErrors((current) => ({ ...current, devices: undefined }));
    try {
      await operation(request.requestId);
      setDevices((current) => ({
        ...current,
        pending: current.pending.filter((candidate) => candidate.requestId !== request.requestId),
      }));
      void loadView('devices');
    } catch (decisionError: unknown) {
      setErrors((current) => ({
        ...current,
        devices: errorMessage(
          decisionError,
          t('Failed to update request', { ns: 'settings' }),
        ),
      }));
    } finally {
      setBusyRequest(null);
    }
  }, [adapter.capabilities.pairRequests, busyRequest, loadView, management, online, t]);

  const decideNodeRequest = useCallback(async (
    request: NodePairRequest,
    decision: 'approve' | 'reject',
  ) => {
    const operation = management?.nodes?.[decision];
    if (!online || !adapter.capabilities.pairRequests || !operation || busyRequest) return;
    setBusyRequest(`node:${request.requestId}`);
    setErrors((current) => ({ ...current, nodes: undefined }));
    try {
      await operation(request.requestId);
      setNodeRequests((current) => current.filter(
        (candidate) => candidate.requestId !== request.requestId,
      ));
      void loadView('nodes');
    } catch (decisionError: unknown) {
      setErrors((current) => ({
        ...current,
        nodes: errorMessage(
          decisionError,
          t('Failed to update request', { ns: 'settings' }),
        ),
      }));
    } finally {
      setBusyRequest(null);
    }
  }, [adapter.capabilities.pairRequests, busyRequest, loadView, management, online, t]);

  const removeDevice = useCallback(async () => {
    if (!removeCandidate || !online || mutationBusy || !management?.devices?.remove) return;
    const deviceId = removeCandidate.deviceId;
    setMutationBusy(true);
    setErrors((current) => ({ ...current, devices: undefined }));
    try {
      await management.devices.remove(deviceId);
      setDevices((current) => ({
        ...current,
        paired: current.paired.filter((candidate) => candidate.deviceId !== deviceId),
      }));
      setRemoveCandidate(null);
      setSelectedDevice(null);
    } catch (removeError: unknown) {
      setErrors((current) => ({
        ...current,
        devices: errorMessage(removeError, t('Failed to remove device', { ns: 'settings' })),
      }));
      setRemoveCandidate(null);
    } finally {
      setMutationBusy(false);
    }
  }, [management, mutationBusy, online, removeCandidate, t]);

  const renameNode = useCallback(async () => {
    const name = renameDraft.trim();
    if (!selectedNode || !online || mutationBusy || !management?.nodes?.rename) return;
    if (!name) {
      setDetailError(t('Please enter a name.', { ns: 'settings' }));
      return;
    }
    setMutationBusy(true);
    setDetailError(null);
    try {
      const renamed = await management.nodes.rename(selectedNode.nodeId, name);
      setNodes((current) => ({
        ...current,
        nodes: current.nodes.map((candidate) => candidate.nodeId === renamed.nodeId
          ? { ...candidate, displayName: renamed.displayName }
          : candidate),
      }));
      setSelectedNode((current) => current && current.nodeId === renamed.nodeId
        ? { ...current, displayName: renamed.displayName }
        : current);
      setRenameDraft(renamed.displayName);
    } catch (renameError: unknown) {
      setDetailError(errorMessage(
        renameError,
        t('Failed to rename node', { ns: 'settings' }),
      ));
    } finally {
      setMutationBusy(false);
    }
  }, [management, mutationBusy, online, renameDraft, selectedNode, t]);

  const tabs = useMemo(() => views.map((item) => ({
    key: item,
    label: item === 'channels'
      ? t('Channels', { ns: 'settings' })
      : item === 'devices'
        ? t('Devices', { ns: 'settings' })
        : t('Nodes', { ns: 'settings' }),
  })), [t, views]);

  if (views.length === 0) {
    return (
      <Banner
        testID="agent-channels-devices-unavailable"
        message={t('No available settings', { ns: 'config' })}
      />
    );
  }

  const viewLoading = loading[view] === true;
  const viewError = errors[view];
  return (
    <>
      <View testID="agent-channels-devices-section" style={styles.root}>
        <SegmentedTabs
          testID="agent-channels-devices-tabs"
          tabs={tabs}
          active={view}
          onSwitch={(next) => {
            setDetailError(null);
            setView(next);
          }}
        />
        {!online ? (
          <Banner
            testID="agent-channels-devices-offline"
            message={t('Offline', { ns: 'common' })}
          />
        ) : null}
        {viewError ? (
          <Banner
            testID={`agent-channels-devices-${view}-error`}
            tone="bad"
            message={viewError}
            actionLabel={t('Retry', { ns: 'common' })}
            onAction={() => { void loadView(view); }}
          />
        ) : null}
        {online && viewLoading ? (
          <ConnectionsLoading />
        ) : online && view === 'channels' ? (
          <ChannelsContent status={channels} />
        ) : online && view === 'devices' ? (
          <View testID="agent-devices-content" style={styles.groups}>
            {devices.pending.length ? (
              <View style={styles.groupWrap}>
                <Text style={styles.groupTitle}>
                  {t('Pending Requests', { ns: 'settings' })}
                </Text>
                <SettingsGroup testID="agent-device-requests">
                  {devices.pending.map((request, index) => {
                    const requestBusy = busyRequest === `device:${request.requestId}`;
                    return (
                      <React.Fragment key={request.requestId}>
                        {index ? <SettingsDivider inset="content" /> : null}
                        <PairRequestRow
                          testID={`agent-device-request-${request.requestId}`}
                          title={deviceRequestLabel(request)}
                          value={formatPlatform(request.platform, t)}
                          busy={requestBusy}
                          canApprove={adapter.capabilities.pairRequests
                            && Boolean(management?.devices?.approve)}
                          canReject={adapter.capabilities.pairRequests
                            && Boolean(management?.devices?.reject)}
                          onApprove={() => { void decideDeviceRequest(request, 'approve'); }}
                          onReject={() => { void decideDeviceRequest(request, 'reject'); }}
                        />
                      </React.Fragment>
                    );
                  })}
                </SettingsGroup>
              </View>
            ) : null}
            {devices.paired.length ? (
              <View style={styles.groupWrap}>
                <Text style={styles.groupTitle}>{t('Devices', { ns: 'settings' })}</Text>
                <SettingsGroup testID="agent-paired-devices">
                  {devices.paired.map((device, index) => (
                    <React.Fragment key={device.deviceId}>
                      {index ? <SettingsDivider inset="content" /> : null}
                      <SettingsRow
                        testID={`agent-device-row-${device.deviceId}`}
                        title={deviceLabel(device)}
                        value={formatDeviceValue(device, t)}
                        showChevron
                        onPress={() => {
                          setSelectedDevice(device);
                          setDetailError(null);
                        }}
                      />
                    </React.Fragment>
                  ))}
                </SettingsGroup>
              </View>
            ) : null}
            {!devices.pending.length && !devices.paired.length ? (
              <EmptyMessage
                testID="agent-devices-empty"
                message={t('No paired devices.', { ns: 'settings' })}
              />
            ) : null}
          </View>
        ) : online ? (
          <View testID="agent-nodes-content" style={styles.groups}>
            {nodeRequests.length ? (
              <View style={styles.groupWrap}>
                <Text style={styles.groupTitle}>
                  {t('Pending Requests', { ns: 'settings' })}
                </Text>
                <SettingsGroup testID="agent-node-requests">
                  {nodeRequests.map((request, index) => {
                    const requestBusy = busyRequest === `node:${request.requestId}`;
                    return (
                      <React.Fragment key={request.requestId}>
                        {index ? <SettingsDivider inset="content" /> : null}
                        <PairRequestRow
                          testID={`agent-node-request-${request.requestId}`}
                          title={nodeRequestLabel(request)}
                          value={formatPlatform(request.platform, t)}
                          busy={requestBusy}
                          canApprove={adapter.capabilities.pairRequests
                            && Boolean(management?.nodes?.approve)}
                          canReject={adapter.capabilities.pairRequests
                            && Boolean(management?.nodes?.reject)}
                          onApprove={() => { void decideNodeRequest(request, 'approve'); }}
                          onReject={() => { void decideNodeRequest(request, 'reject'); }}
                        />
                      </React.Fragment>
                    );
                  })}
                </SettingsGroup>
              </View>
            ) : null}
            {nodes.nodes.length ? (
              <View style={styles.groupWrap}>
                <Text style={styles.groupTitle}>{t('Nodes', { ns: 'settings' })}</Text>
                <SettingsGroup testID="agent-connected-nodes">
                  {nodes.nodes.map((node, index) => (
                    <React.Fragment key={node.nodeId}>
                      {index ? <SettingsDivider inset="content" /> : null}
                      <SettingsRow
                        testID={`agent-node-row-${node.nodeId}`}
                        title={nodeLabel(node)}
                        value={node.connected
                          ? t('Online', { ns: 'common' })
                          : t('Offline', { ns: 'common' })}
                        showChevron
                        onPress={() => {
                          setSelectedNode(node);
                          setRenameDraft(node.displayName ?? '');
                          setDetailError(null);
                        }}
                      />
                    </React.Fragment>
                  ))}
                </SettingsGroup>
              </View>
            ) : null}
            {!nodeRequests.length && !nodes.nodes.length ? (
              <EmptyMessage
                testID="agent-nodes-empty"
                message={t('No nodes available.', { ns: 'settings' })}
              />
            ) : null}
          </View>
        ) : null}
      </View>

      <Sheet
        testID="agent-device-detail"
        visible={selectedDevice !== null}
        title={selectedDevice ? deviceLabel(selectedDevice) : undefined}
        closeAccessibilityLabel={t('Close', { ns: 'common' })}
        onClose={() => setSelectedDevice(null)}
      >
        {selectedDevice ? (
          <View style={styles.sheetContent}>
            <SettingsGroup>
              <SettingsRow
                title={t('Device', { ns: 'settings' })}
                value={compactIdentifier(selectedDevice.deviceId)}
              />
              <SettingsDivider inset="content" />
              <SettingsRow
                title={t('Platform', { ns: 'settings' })}
                value={formatPlatform(selectedDevice.platform, t)}
              />
            </SettingsGroup>
            {management?.devices?.remove ? (
              <Button
                testID="agent-device-remove"
                label={t('Remove Device', { ns: 'settings' })}
                variant="destructive"
                disabled={!online}
                onPress={() => {
                  setRemoveCandidate(selectedDevice);
                  setSelectedDevice(null);
                }}
              />
            ) : null}
          </View>
        ) : null}
      </Sheet>

      <Sheet
        testID="agent-device-remove-confirm"
        visible={removeCandidate !== null}
        title={t('Remove Device?', { ns: 'settings' })}
        closeAccessibilityLabel={t('Close', { ns: 'common' })}
        dismissOnBackdropPress={!mutationBusy}
        onClose={() => {
          if (!mutationBusy) setRemoveCandidate(null);
        }}
      >
        <View style={styles.sheetContent}>
          <Text style={styles.sheetMessage}>
            {t('This device will no longer be paired with your gateway.', { ns: 'settings' })}
          </Text>
          <View style={styles.actions}>
            <Button
              testID="agent-device-remove-cancel"
              label={t('Cancel', { ns: 'common' })}
              variant="secondary"
              disabled={mutationBusy}
              onPress={() => setRemoveCandidate(null)}
              style={styles.actionButton}
            />
            <Button
              testID="agent-device-remove-confirm-action"
              label={t('Remove', { ns: 'common' })}
              variant="destructive"
              loading={mutationBusy}
              onPress={() => { void removeDevice(); }}
              style={styles.actionButton}
            />
          </View>
        </View>
      </Sheet>

      <Sheet
        testID="agent-node-detail"
        visible={selectedNode !== null}
        title={selectedNode ? nodeLabel(selectedNode) : undefined}
        closeAccessibilityLabel={t('Close', { ns: 'common' })}
        onClose={() => setSelectedNode(null)}
      >
        {selectedNode ? (
          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
          >
            {detailError ? (
              <Banner testID="agent-node-detail-error" tone="bad" message={detailError} />
            ) : null}
            <SettingsGroup>
              <SettingsRow
                title={t('Display Name', { ns: 'settings' })}
                value={selectedNode.displayName || '—'}
              />
              <SettingsDivider inset="content" />
              <SettingsRow
                title={t('Platform', { ns: 'settings' })}
                value={formatPlatform(selectedNode.platform, t)}
              />
              <SettingsDivider inset="content" />
              <SettingsRow
                title={t('Version', { ns: 'settings' })}
                value={selectedNode.version || '—'}
              />
              <SettingsDivider inset="content" />
              <SettingsRow
                title={t('Commands Count', { ns: 'settings' })}
                value={String(selectedNode.commands.length)}
              />
              <SettingsDivider inset="content" />
              <SettingsRow
                title={t('Node ID', { ns: 'settings' })}
                value={compactIdentifier(selectedNode.nodeId)}
              />
            </SettingsGroup>
            {management?.nodes?.rename ? (
              <View style={styles.renameForm}>
                <FormTextInput
                  testID="agent-node-rename-input"
                  value={renameDraft}
                  onChangeText={setRenameDraft}
                  placeholder={t('Node name', { ns: 'settings' })}
                  editable={online && !mutationBusy}
                  returnKeyType="done"
                  onSubmitEditing={() => { void renameNode(); }}
                />
                <Button
                  testID="agent-node-rename"
                  label={t('Rename', { ns: 'common' })}
                  loading={mutationBusy}
                  disabled={!online || !renameDraft.trim()}
                  onPress={() => { void renameNode(); }}
                />
              </View>
            ) : null}
          </ScrollView>
        ) : null}
      </Sheet>
    </>
  );

  function ChannelsContent({ status }: Readonly<{
    status: ChannelsStatusResult | null;
  }>): React.JSX.Element {
    const rows = status ? buildChannelRows(status) : [];
    if (!rows.length) {
      return (
        <EmptyMessage
          testID="agent-channels-empty"
          message={t('No channels configured', { ns: 'settings' })}
        />
      );
    }
    return (
      <SettingsGroup testID="agent-channels-content">
        {rows.map((row, index) => (
          <React.Fragment key={row.id}>
            {index ? <SettingsDivider inset="content" /> : null}
            <SettingsRow
              testID={`agent-channel-row-${row.id}`}
              title={row.label}
              value={channelStateLabel(row.state, t)}
            />
          </React.Fragment>
        ))}
      </SettingsGroup>
    );
  }

  function PairRequestRow({
    testID,
    title,
    value,
    busy,
    canApprove,
    canReject,
    onApprove,
    onReject,
  }: Readonly<{
    testID: string;
    title: string;
    value: string;
    busy: boolean;
    canApprove: boolean;
    canReject: boolean;
    onApprove: () => void;
    onReject: () => void;
  }>): React.JSX.Element {
    return (
      <SettingsRow testID={testID} layout="column">
        <View style={styles.requestHeader}>
          <Text style={styles.requestTitle} numberOfLines={1}>{title}</Text>
          <Text style={styles.requestValue} numberOfLines={1}>{value}</Text>
        </View>
        {canApprove || canReject ? (
          <View style={styles.actions}>
            {canReject ? (
              <Button
                testID={`${testID}-reject`}
                label={t('Reject', { ns: 'settings' })}
                variant="secondary"
                disabled={busy || Boolean(busyRequest && !busy)}
                onPress={onReject}
                style={styles.actionButton}
              />
            ) : null}
            {canApprove ? (
              <Button
                testID={`${testID}-approve`}
                label={t('Approve', { ns: 'settings' })}
                loading={busy}
                disabled={Boolean(busyRequest && !busy)}
                onPress={onApprove}
                style={styles.actionButton}
              />
            ) : null}
          </View>
        ) : null}
      </SettingsRow>
    );
  }

  function EmptyMessage({ testID, message }: Readonly<{
    testID: string;
    message: string;
  }>): React.JSX.Element {
    return <Text testID={testID} style={styles.emptyText}>{message}</Text>;
  }
}

function ConnectionsLoading(): React.JSX.Element {
  return (
    <View testID="agent-channels-devices-loading" style={stylesStatic.loading}>
      {[0, 1, 2].map((row) => (
        <View key={row} style={stylesStatic.skeletonRow}>
          <Skeleton style={stylesStatic.skeletonTitle} />
          <Skeleton style={stylesStatic.skeletonValue} />
        </View>
      ))}
    </View>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

function channelStateLabel(state: ChannelConnectionState, t: Translate): string {
  if (state === 'connected') return t('Connected', { ns: 'settings' });
  if (state === 'running') return t('Running', { ns: 'settings' });
  if (state === 'linked') return t('Linked', { ns: 'settings' });
  if (state === 'configured') return t('Configured', { ns: 'settings' });
  return t('Not configured', { ns: 'settings' });
}

function formatDeviceValue(device: DeviceInfo, t: Translate): string {
  const values = [device.role, device.platform ? formatPlatform(device.platform, t) : null]
    .filter((value): value is string => Boolean(value));
  return values.join(' · ') || t('Paired', { ns: 'settings' });
}

function formatPlatform(platform: string | undefined, t: Translate): string {
  if (!platform) return t('Unknown platform', { ns: 'settings' });
  const labels: Record<string, string> = {
    ios: 'iOS',
    android: 'Android',
    darwin: 'macOS',
    linux: 'Linux',
    windows: 'Windows',
  };
  return labels[platform.toLocaleLowerCase()] ?? platform;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

const stylesStatic = StyleSheet.create({
  loading: { gap: Space.sm },
  skeletonRow: {
    minHeight: ControlSize.settingsRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.lg,
  },
  skeletonTitle: { flex: 1, height: LineHeight.body },
  skeletonValue: { width: '20%', height: LineHeight.secondary },
});

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: { gap: Space.lg },
    groups: { gap: Space.xl },
    groupWrap: { gap: Space.sm },
    groupTitle: {
      paddingHorizontal: Space.xs,
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
    },
    emptyText: {
      paddingVertical: Space.xxl,
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
      textAlign: 'center',
    },
    requestHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.md,
    },
    requestTitle: {
      flex: 1,
      color: colors.ink,
      fontSize: FontSize.body,
      lineHeight: LineHeight.body,
      fontWeight: FontWeight.regular,
    },
    requestValue: {
      maxWidth: '42%',
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
      textAlign: 'right',
    },
    actions: {
      flexDirection: 'row',
      gap: Space.sm,
    },
    actionButton: { flex: 1 },
    sheetScroll: { flexGrow: 0 },
    sheetContent: {
      paddingHorizontal: Space.lg,
      paddingBottom: Space.xl,
      gap: Space.lg,
    },
    sheetMessage: {
      color: colors.ink,
      fontSize: FontSize.body,
      lineHeight: LineHeight.body,
      fontWeight: FontWeight.regular,
    },
    renameForm: { gap: Space.sm },
  });
}
