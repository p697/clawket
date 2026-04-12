import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  LayoutAnimation,
  Modal,
  Platform,
  RefreshControl,
  SectionList,
  SectionListData,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { CircleHelp, Wifi } from 'lucide-react-native';
import {
  Card,
  EmptyState,
  IconButton,
  LoadingState,
  ScreenHeader,
  ThemedSwitch,
  createListContentStyle,
  createListHeaderSpacing,
} from '../ui';
import { CopyableCommand } from '../config/CopyableCommand';
import { useTranslation } from 'react-i18next';
import { useAppContext } from '../../contexts/AppContext';
import { analyticsEvents } from '../../services/analytics/events';
import { GatewayClient } from '../../services/gateway';
import { loadGatewayNodesBundle } from '../../services/gateway-nodes';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import type { DevicePairRequest, NodeInfo, NodePairRequest } from '../../types';
import { relativeTime } from '../../utils/chat-message';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type TFunc = (key: string, options?: Record<string, unknown>) => string;

type Props = {
  gateway: GatewayClient;
  topInset: number;
  onBack: () => void;
  onOpenNode: (node: NodeInfo) => void;
  onOpenNodeDocs?: () => void;
  hideHeader?: boolean;
};

type NodesSection = {
  key: 'pending' | 'nodes';
  title: string;
  icon: string;
  tone: 'default' | 'warning';
  count: number;
  data: NodeRow[];
};

type UnifiedPairRequest =
  | { source: 'node'; request: NodePairRequest }
  | { source: 'device'; request: DevicePairRequest };

type NodeRow =
  | { kind: 'pending'; item: UnifiedPairRequest }
  | { kind: 'node'; item: NodeInfo }
  | { kind: 'placeholder'; key: string; message: string };

const CAP_ICONS: Record<string, string> = {
  camera: '📷',
  location: '📍',
  notifications: '🔔',
  tts: '🎤',
  screen: '🖥',
  exec: '⚡',
};

const PLATFORM_LABELS: Record<string, string> = {
  ios: 'iOS',
  android: 'Android',
  darwin: 'macOS',
  linux: 'Linux',
  windows: 'Windows',
};

function animateListChange(): void {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
}

function normalizePlatform(t: TFunc, platform?: string): string {
  if (!platform) return t('Unknown platform');
  return PLATFORM_LABELS[platform.toLowerCase()] ?? platform;
}

function compactId(value: string): string {
  if (value.length <= 20) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function formatAgo(t: TFunc, timestampMs?: number | null): string | null {
  if (!timestampMs) return null;
  const relative = relativeTime(timestampMs);
  if (!relative) return null;
  if (relative === 'now') return t('just now');
  if (relative === 'Yesterday') return t('Yesterday');
  return `${relative} ago`;
}

function formatNodeSubtitle(t: TFunc, node: NodeInfo): string {
  const parts: string[] = [];
  if (node.platform) parts.push(normalizePlatform(t, node.platform));
  if (node.deviceFamily) {
    parts.push(node.deviceFamily);
  } else if (node.modelIdentifier) {
    parts.push(node.modelIdentifier);
  }
  return parts.length > 0 ? parts.join(' • ') : t('Unknown node');
}

function formatNodeConnection(t: TFunc, node: NodeInfo): string {
  const ago = formatAgo(t, node.connectedAtMs);
  if (node.connected) {
    return ago ? t('Connected {{ago}}', { ago }) : t('Connected');
  }
  if (ago) {
    return t('Last seen {{ago}}', { ago });
  }
  return t('Offline');
}

function sortUnifiedPending(items: UnifiedPairRequest[]): UnifiedPairRequest[] {
  return [...items].sort((a, b) => (b.request.requestedAtMs ?? 0) - (a.request.requestedAtMs ?? 0));
}

function sortNodes(nodes: NodeInfo[]): NodeInfo[] {
  return [...nodes].sort((a, b) => {
    if (a.connected !== b.connected) return a.connected ? -1 : 1;
    const aName = (a.displayName ?? a.nodeId).toLowerCase();
    const bName = (b.displayName ?? b.nodeId).toLowerCase();
    return aName.localeCompare(bName);
  });
}

export function NodesView({
  gateway,
  topInset,
  onBack,
  onOpenNode,
  onOpenNodeDocs,
  hideHeader = false,
}: Props): React.JSX.Element {
  const { gatewayEpoch, nodeEnabled, onNodeEnabledToggle } = useAppContext();
  const { t } = useTranslation('console');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [pendingRequests, setPendingRequests] = useState<UnifiedPairRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingBusyIds, setPendingBusyIds] = useState<Set<string>>(new Set());
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [renameTarget, setRenameTarget] = useState<NodeInfo | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nodeToggleRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nodeToggleFollowupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    animateListChange();
    setToastMessage(message);
    toastTimerRef.current = setTimeout(() => {
      animateListChange();
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 1800);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
      if (nodeToggleRefreshTimerRef.current) {
        clearTimeout(nodeToggleRefreshTimerRef.current);
        nodeToggleRefreshTimerRef.current = null;
      }
      if (nodeToggleFollowupTimerRef.current) {
        clearTimeout(nodeToggleFollowupTimerRef.current);
        nodeToggleFollowupTimerRef.current = null;
      }
    };
  }, []);

  const loadData = useCallback(async (mode: 'initial' | 'refresh' | 'background' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);

    try {
      const { nodes: loadedNodes, nodePairRequests, devicePairRequests } = await loadGatewayNodesBundle(gateway);
      const unified: UnifiedPairRequest[] = [
        ...nodePairRequests.map((r): UnifiedPairRequest => ({ source: 'node', request: r })),
        ...devicePairRequests.map((r): UnifiedPairRequest => ({ source: 'device', request: r })),
      ];

      setNodes(sortNodes(loadedNodes));
      setPendingRequests(sortUnifiedPending(unified));
      setError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('Failed to load nodes');
      setError(message);
    } finally {
      if (mode === 'initial') setLoading(false);
      if (mode === 'refresh') setRefreshing(false);
    }
  }, [gateway, gatewayEpoch]);

  useEffect(() => {
    loadData('initial').catch(() => {});
  }, [loadData]);

  const handleRefresh = useCallback(() => {
    loadData('refresh').catch(() => {});
  }, [loadData]);

  const handleNodeEnabledChange = useCallback((enabled: boolean) => {
    onNodeEnabledToggle(enabled);
    loadData('background').catch(() => {});

    if (nodeToggleRefreshTimerRef.current) {
      clearTimeout(nodeToggleRefreshTimerRef.current);
      nodeToggleRefreshTimerRef.current = null;
    }
    if (nodeToggleFollowupTimerRef.current) {
      clearTimeout(nodeToggleFollowupTimerRef.current);
      nodeToggleFollowupTimerRef.current = null;
    }

    // The local node reconnect is asynchronous, so refresh shortly after the
    // toggle to pick up the new connection state without leaving the screen.
    nodeToggleRefreshTimerRef.current = setTimeout(() => {
      loadData('background').catch(() => {});
      nodeToggleRefreshTimerRef.current = null;
    }, 200);

    nodeToggleFollowupTimerRef.current = setTimeout(() => {
      loadData('background').catch(() => {});
      nodeToggleFollowupTimerRef.current = null;
    }, 1200);
  }, [loadData, onNodeEnabledToggle]);

  const handleCopy = useCallback(async (value: string, message: string) => {
    await Clipboard.setStringAsync(value);
    showToast(message);
  }, [showToast]);

  const submitRenameNode = useCallback(async (nodeId: string, displayName: string): Promise<boolean> => {
    const trimmedName = displayName.trim();
    if (!trimmedName) {
      Alert.alert(t('Invalid Name'), t('Please enter a name.'));
      return false;
    }

    const previousNodes = nodes;
    animateListChange();
    setNodes((prev) => prev.map((node) => (
      node.nodeId === nodeId
        ? { ...node, displayName: trimmedName }
        : node
    )));

    try {
      await gateway.renameNode(nodeId, trimmedName);
      showToast(t('Node renamed.'));
      return true;
    } catch (err: unknown) {
      animateListChange();
      setNodes(previousNodes);
      const message = err instanceof Error ? err.message : t('Failed to rename node');
      Alert.alert(t('Rename failed'), message);
      return false;
    }
  }, [gateway, nodes, showToast]);

  const openRenameFlow = useCallback((node: NodeInfo) => {
    const initialValue = node.displayName ?? '';
    if (Platform.OS === 'ios' && typeof Alert.prompt === 'function') {
      Alert.prompt(
        t('Rename Node'),
        t('Enter a new display name.'),
        [
          { text: t('common:Cancel'), style: 'cancel' },
          {
            text: t('common:Save'),
            onPress: (value?: string) => {
              if (!value) return;
              submitRenameNode(node.nodeId, value).catch(() => {});
            },
          },
        ],
        'plain-text',
        initialValue,
      );
      return;
    }

    setRenameTarget(node);
    setRenameDraft(initialValue);
  }, [submitRenameNode]);

  const handleNodeLongPress = useCallback((node: NodeInfo) => {
    Alert.alert(
      node.displayName ?? compactId(node.nodeId),
      t('Choose an action.'),
      [
        {
          text: t('Rename'),
          onPress: () => openRenameFlow(node),
        },
        {
          text: t('Copy Node ID'),
          onPress: () => {
            handleCopy(node.nodeId, t('Node ID copied.')).catch(() => {
              Alert.alert(t('Copy failed'), t('Unable to copy Node ID.'));
            });
          },
        },
        { text: t('common:Cancel'), style: 'cancel' },
      ],
    );
  }, [handleCopy, openRenameFlow, t]);

  const handlePendingDecision = useCallback(async (unified: UnifiedPairRequest, action: 'approve' | 'reject') => {
    const requestId = unified.request.requestId;

    setPendingBusyIds((prev) => {
      const next = new Set(prev);
      next.add(requestId);
      return next;
    });

    const previousPending = pendingRequests;
    animateListChange();
    setPendingRequests((prev) => prev.filter((item) => item.request.requestId !== requestId));

    try {
      if (unified.source === 'node') {
        if (action === 'approve') {
          await gateway.approveNodePair(requestId);
        } else {
          await gateway.rejectNodePair(requestId);
        }
      } else {
        if (action === 'approve') {
          await gateway.approveDevicePair(requestId);
        } else {
          await gateway.rejectDevicePair(requestId);
        }
      }

      analyticsEvents.pairRequestResolved({
        target: unified.source === 'node' ? 'node' : 'device',
        decision: action,
        source: 'nodes_view',
      });

      showToast(action === 'approve' ? t('Request approved.') : t('Request rejected.'));
      loadData('background').catch(() => {});
      // Server may not have updated connection status yet; refresh again after a short delay
      if (action === 'approve') {
        setTimeout(() => { loadData('background').catch(() => {}); }, 2000);
      }
    } catch (err: unknown) {
      animateListChange();
      setPendingRequests(previousPending);
      const message = err instanceof Error ? err.message : t('Failed to update request');
      Alert.alert(action === 'approve' ? t('Approval failed') : t('Reject failed'), message);
    } finally {
      setPendingBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(requestId);
        return next;
      });
    }
  }, [gateway, loadData, pendingRequests, showToast]);

  const handleRenameConfirm = useCallback(async () => {
    if (!renameTarget) return;
    setRenameSaving(true);
    const saved = await submitRenameNode(renameTarget.nodeId, renameDraft);
    setRenameSaving(false);
    if (saved) {
      setRenameTarget(null);
      setRenameDraft('');
    }
  }, [renameDraft, renameTarget, submitRenameNode]);

  const onlineNodes = useMemo(
    () => nodes.filter((node) => node.connected).length,
    [nodes],
  );

  const hasData = pendingRequests.length > 0 || nodes.length > 0;

  const sections = useMemo<NodesSection[]>(() => {
    const nextSections: NodesSection[] = [];

    const pendingRows: NodeRow[] = pendingRequests.length > 0
      ? pendingRequests.map((item) => ({ kind: 'pending', item }))
      : [{ kind: 'placeholder', key: 'pending-empty', message: t('No pending requests.') }];

    const nodeRows: NodeRow[] = nodes.length > 0
      ? nodes.map((item) => ({ kind: 'node', item }))
      : [{ kind: 'placeholder', key: 'nodes-empty', message: t('No nodes available.') }];

    nextSections.push({
      key: 'pending',
      title: t('Pending Requests'),
      icon: '⚡',
      tone: 'warning',
      count: pendingRequests.length,
      data: pendingRows,
    });

    nextSections.push({
      key: 'nodes',
      title: t('Nodes'),
      icon: '🖥',
      tone: 'default',
      count: nodes.length,
      data: nodeRows,
    });

    return nextSections;
  }, [nodes, pendingRequests, t]);

  const renderSectionHeader = useCallback(({ section }: { section: SectionListData<NodeRow, NodesSection> }) => (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderTitleWrap}>
        <Text style={styles.sectionHeaderIcon}>{section.icon}</Text>
        <Text
          style={[
            styles.sectionHeaderTitle,
            section.tone === 'warning' ? styles.sectionHeaderTitleWarning : undefined,
          ]}
        >
          {section.title.toUpperCase()}
        </Text>
      </View>
      <View style={styles.sectionCountBadge}>
        <Text style={styles.sectionCountText}>{section.count}</Text>
      </View>
    </View>
  ), [styles]);

  const renderPendingCard = useCallback((unified: UnifiedPairRequest) => {
    const { source, request } = unified;
    const entityId = source === 'node'
      ? (request as NodePairRequest).nodeId
      : (request as DevicePairRequest).deviceId;
    const title = request.displayName ?? compactId(entityId ?? request.requestId);
    const subtitleParts: string[] = [source === 'node' ? t('Node') : t('Device')];
    if (request.platform) subtitleParts.push(normalizePlatform(t, request.platform));

    const isBusy = pendingBusyIds.has(request.requestId);

    return (
      <Card style={styles.pendingCard}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSubtitle}>{subtitleParts.join(' • ')}</Text>

        <View style={styles.pendingActionsRow}>
          <TouchableOpacity
            style={[styles.approveButton, isBusy && styles.buttonDisabled]}
            onPress={() => {
              handlePendingDecision(unified, 'approve').catch(() => {});
            }}
            activeOpacity={0.7}
            disabled={isBusy}
          >
            <Text style={styles.approveButtonText}>{t('Approve')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.rejectButton, isBusy && styles.buttonDisabled]}
            onPress={() => {
              handlePendingDecision(unified, 'reject').catch(() => {});
            }}
            activeOpacity={0.7}
            disabled={isBusy}
          >
            <Text style={styles.rejectButtonText}>{t('Reject')}</Text>
          </TouchableOpacity>
        </View>
      </Card>
    );
  }, [handlePendingDecision, pendingBusyIds, styles, t]);

  const renderNodeCard = useCallback((node: NodeInfo) => (
    <TouchableOpacity
      activeOpacity={0.82}
      onPress={() => onOpenNode(node)}
      onLongPress={() => handleNodeLongPress(node)}
      delayLongPress={350}
    >
      <Card style={styles.card}>
        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: node.connected ? theme.colors.success : theme.colors.textSubtle },
            ]}
          />
          <Text style={styles.cardTitle}>{node.displayName ?? compactId(node.nodeId)}</Text>
        </View>

        <Text style={styles.cardSubtitle}>{formatNodeSubtitle(t, node)}</Text>
        <Text style={styles.metaText}>{formatNodeConnection(t, node)}</Text>
        <Text style={styles.longPressHint}>{t('Tap for details · Long press for actions')}</Text>

        {node.caps.length > 0 ? (
          <View style={styles.capRow}>
            {node.caps.map((cap) => {
              const capLabel = CAP_ICONS[cap] ?? cap;
              const isIconCap = capLabel !== cap;
              return (
                <View key={`${node.nodeId}:${cap}`} style={styles.capPill}>
                  <Text style={isIconCap ? styles.capIconText : styles.capText}>{capLabel}</Text>
                </View>
              );
            })}
          </View>
        ) : null}
      </Card>
    </TouchableOpacity>
  ), [handleNodeLongPress, onOpenNode, styles, t, theme.colors.success, theme.colors.textSubtle]);

  const renderPlaceholderCard = useCallback((message: string) => (
    <Card style={styles.placeholderCard}>
      <Text style={styles.placeholderText}>{message}</Text>
    </Card>
  ), [styles]);

  const renderItem = useCallback(({ item }: { item: NodeRow }) => {
    if (item.kind === 'pending') return renderPendingCard(item.item);
    if (item.kind === 'node') return renderNodeCard(item.item);
    return renderPlaceholderCard(item.message);
  }, [renderNodeCard, renderPendingCard, renderPlaceholderCard]);

  const keyExtractor = useCallback((item: NodeRow): string => {
    if (item.kind === 'pending') return `pending:${item.item.source}:${item.item.request.requestId}`;
    if (item.kind === 'node') return `node:${item.item.nodeId}`;
    return `placeholder:${item.key}`;
  }, []);

  const listHeader = useMemo(() => (
    <View style={styles.listHeaderWrap}>
      <Card style={styles.infoCard}>
        <Text style={styles.infoCardTitle}>{t('What This Node Is For')}</Text>
        <Text style={styles.infoCardDescription}>
          {t('node_description')}
        </Text>
      </Card>

      <Card style={styles.infoCard}>
        <View style={styles.lanHintTitleRow}>
          <Wifi size={16} color={theme.colors.primary} strokeWidth={2} />
          <Text style={styles.infoCardTitle}>{t('LAN Connection Required')}</Text>
        </View>
        <Text style={styles.infoCardDescription}>
          {t('node_lan_hint')}
        </Text>
        <CopyableCommand command="clawket pair --local" />
        <Text style={styles.nodeToggleMeta}>
          {t('node_lan_copy_hint')}
        </Text>
      </Card>

      <Card style={styles.infoCard}>
        <View style={styles.nodeToggleHeaderRow}>
          <View style={styles.nodeToggleTitleWrap}>
            <View style={styles.nodeToggleLabelRow}>
              <Text style={styles.infoCardTitle}>{t('Node Mode')}</Text>
              {onOpenNodeDocs && (
                <IconButton
                  icon={<CircleHelp size={14} color={theme.colors.textSubtle} strokeWidth={2} />}
                  onPress={onOpenNodeDocs}
                  size={20}
                />
              )}
            </View>
            <Text style={styles.infoCardDescription}>{t('Expose this device to agents as a node.')}</Text>
          </View>
          <ThemedSwitch
            value={nodeEnabled}
            onValueChange={handleNodeEnabledChange}
            trackColor={{ false: theme.colors.borderStrong, true: theme.colors.primarySoft }}
            thumbColor={nodeEnabled ? theme.colors.primary : theme.colors.surfaceMuted}
          />
        </View>
      </Card>

      <Text style={styles.summaryText}>
        {t('{{count}} nodes ({{online}} online)', { count: nodes.length, online: onlineNodes })}
      </Text>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorTitle}>{t('Failed to refresh nodes')}</Text>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {!hasData ? (
        <Text style={styles.noDataHint}>{t('No nodes yet. Pair a node to get started.')}</Text>
      ) : null}
    </View>
  ), [error, handleNodeEnabledChange, hasData, nodeEnabled, nodes.length, onOpenNodeDocs, onlineNodes, styles, t, theme.colors]);

  if (loading) {
    return (
      <View style={styles.root}>
        {!hideHeader ? <ScreenHeader title={t('Nodes')} topInset={topInset} onBack={onBack} /> : null}
        <LoadingState message={t('Loading nodes...')} />
      </View>
    );
  }

  if (error && !hasData) {
    return (
      <View style={styles.root}>
        {!hideHeader ? <ScreenHeader title={t('Nodes')} topInset={topInset} onBack={onBack} /> : null}
        <View style={styles.errorWrap}>
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>{t('Failed to load nodes')}</Text>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={() => { loadData('initial').catch(() => {}); }}
              activeOpacity={0.7}
            >
              <Text style={styles.retryText}>{t('Retry')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {!hideHeader ? <ScreenHeader title={t('Nodes')} topInset={topInset} onBack={onBack} /> : null}

      <SectionList
        sections={sections}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.content}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.colors.primary}
          />
        )}
        ListHeaderComponent={listHeader}
      />

      {toastMessage ? (
        <View style={styles.toastOverlay}>
          <View style={styles.toastBanner}>
            <Text style={styles.toastText}>{toastMessage}</Text>
          </View>
        </View>
      ) : null}

      <Modal
        visible={renameTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (renameSaving) return;
          setRenameTarget(null);
          setRenameDraft('');
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('Rename Node')}</Text>
            <TextInput
              value={renameDraft}
              onChangeText={setRenameDraft}
              style={styles.modalInput}
              placeholder={t('Node name')}
              placeholderTextColor={theme.colors.textSubtle}
              autoCapitalize="words"
              autoCorrect={false}
              editable={!renameSaving}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonSecondary, renameSaving && styles.buttonDisabled]}
                onPress={() => {
                  if (renameSaving) return;
                  setRenameTarget(null);
                  setRenameDraft('');
                }}
                activeOpacity={0.7}
                disabled={renameSaving}
              >
                <Text style={styles.modalButtonSecondaryText}>{t('common:Cancel')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonPrimary, renameSaving && styles.buttonDisabled]}
                onPress={() => { handleRenameConfirm().catch(() => {}); }}
                activeOpacity={0.7}
                disabled={renameSaving}
              >
                <Text style={styles.modalButtonPrimaryText}>{renameSaving ? t('common:Saving...') : t('common:Save')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
      ...createListContentStyle(),
      gap: Space.md,
    },
    listHeaderWrap: {
      ...createListHeaderSpacing(),
      gap: Space.md,
    },
    infoCard: {
      padding: Space.md,
      borderRadius: Radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      gap: Space.sm,
    },
    infoCardTitle: {
      fontSize: FontSize.lg,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    infoCardDescription: {
      fontSize: FontSize.base,
      lineHeight: 21,
      color: colors.textMuted,
    },
    lanHintTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
    },
    nodeToggleHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.md,
    },
    nodeToggleTitleWrap: {
      flex: 1,
      gap: Space.xs,
    },
    nodeToggleLabelRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: Space.xs,
    },
    nodeToggleMeta: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
    },
    summaryText: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
      paddingTop: Space.sm,
      paddingHorizontal: Space.xs,
    },
    noDataHint: {
      fontSize: FontSize.sm,
      color: colors.textSubtle,
      paddingHorizontal: Space.xs,
    },
    toastOverlay: {
      position: 'absolute',
      left: Space.lg,
      right: Space.lg,
      bottom: Space.xl,
    },
    toastBanner: {
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: Radius.sm,
      paddingHorizontal: Space.md,
      paddingVertical: Space.sm,
    },
    toastText: {
      color: colors.text,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
    },
    sectionHeader: {
      marginTop: Space.sm,
      borderRadius: Radius.sm,
      paddingHorizontal: Space.sm,
      paddingVertical: Space.xs,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surfaceMuted,
    },
    sectionHeaderTitleWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
    },
    sectionHeaderIcon: {
      fontSize: FontSize.md,
    },
    sectionHeaderTitle: {
      fontSize: FontSize.xs,
      fontWeight: FontWeight.bold,
      letterSpacing: 1,
      color: colors.textMuted,
    },
    sectionHeaderTitleWarning: {
      color: colors.warning,
    },
    sectionCountBadge: {
      minWidth: 22,
      height: 22,
      borderRadius: Radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Space.sm,
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
    },
    sectionCountText: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
      fontWeight: FontWeight.semibold,
    },
    card: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.md,
      padding: Space.md,
      gap: Space.xs,
    },
    pendingCard: {
      borderWidth: 1,
      borderColor: colors.warning,
      borderRadius: Radius.md,
      padding: Space.md,
      gap: Space.xs,
      backgroundColor: colors.surfaceElevated,
    },
    placeholderCard: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.md,
      padding: Space.md,
      backgroundColor: colors.surface,
    },
    placeholderText: {
      fontSize: FontSize.sm,
      color: colors.textSubtle,
    },
    cardTitle: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    cardSubtitle: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
    },
    metaText: {
      fontSize: FontSize.xs,
      color: colors.textSubtle,
    },
    pendingActionsRow: {
      flexDirection: 'row',
      gap: Space.sm,
      marginTop: Space.sm,
    },
    approveButton: {
      flex: 1,
      borderRadius: Radius.sm,
      paddingVertical: Space.sm,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
    },
    approveButtonText: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
      color: colors.primaryText,
    },
    rejectButton: {
      flex: 1,
      borderRadius: Radius.sm,
      paddingVertical: Space.sm,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.surface,
    },
    rejectButtonText: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
      color: colors.error,
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
    },
    statusDot: {
      width: Space.sm,
      height: Space.sm,
      borderRadius: Radius.full,
    },
    capRow: {
      marginTop: Space.xs,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Space.xs,
    },
    capPill: {
      borderRadius: Radius.full,
      paddingHorizontal: Space.sm,
      paddingVertical: 3,
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.border,
      minWidth: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },
    capIconText: {
      fontSize: FontSize.sm,
    },
    capText: {
      fontSize: FontSize.xs,
      color: colors.textMuted,
      fontWeight: FontWeight.medium,
    },
    longPressHint: {
      fontSize: FontSize.xs,
      color: colors.textSubtle,
    },
    errorWrap: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: Space.xl,
    },
    errorBanner: {
      borderRadius: Radius.sm,
      borderWidth: 1,
      borderColor: colors.error,
      backgroundColor: colors.surfaceElevated,
      paddingHorizontal: Space.md,
      paddingVertical: Space.sm,
      gap: Space.xs,
    },
    errorCard: {
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: Space.lg,
      gap: Space.sm,
    },
    errorTitle: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    errorText: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
    },
    retryButton: {
      marginTop: Space.sm,
      borderRadius: Radius.sm,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: Space.sm,
    },
    retryText: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.primaryText,
    },
    modalBackdrop: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: Space.xl,
      backgroundColor: colors.overlay,
    },
    modalCard: {
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: Space.lg,
      gap: Space.md,
    },
    modalTitle: {
      fontSize: FontSize.lg,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    modalInput: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.sm,
      paddingHorizontal: Space.md,
      paddingVertical: Space.sm,
      fontSize: FontSize.base,
      color: colors.text,
      backgroundColor: colors.inputBackground,
    },
    modalActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: Space.sm,
    },
    modalButton: {
      minWidth: 86,
      borderRadius: Radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: Space.sm,
      paddingHorizontal: Space.md,
    },
    modalButtonPrimary: {
      backgroundColor: colors.primary,
    },
    modalButtonPrimaryText: {
      color: colors.primaryText,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
    modalButtonSecondary: {
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.surface,
    },
    modalButtonSecondaryText: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
  });
}
