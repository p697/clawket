import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  LayoutAnimation,
  Platform,
  RefreshControl,
  SectionList,
  SectionListData,
  StyleSheet,
  Text,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  Card,
  LoadingState,
  ScreenHeader,
  createListContentStyle,
  createListHeaderSpacing,
} from '../ui';
import { useTranslation } from 'react-i18next';
import { useAppContext } from '../../contexts/AppContext';
import { analyticsEvents } from '../../services/analytics/events';
import { GatewayClient } from '../../services/gateway';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import type { DeviceInfo, DevicePairRequest } from '../../types';
import { relativeTime } from '../../utils/chat-message';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Props = {
  gateway: GatewayClient;
  topInset: number;
  onBack: () => void;
  hideHeader?: boolean;
};

type DevicesSection = {
  key: 'pending' | 'devices';
  title: string;
  icon: string;
  tone: 'default' | 'warning';
  count: number;
  data: DeviceRow[];
};

type DeviceRow =
  | { kind: 'pending'; item: DevicePairRequest }
  | { kind: 'device'; item: DeviceInfo }
  | { kind: 'placeholder'; key: string; message: string };

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

type TFn = (key: string, opts?: Record<string, unknown>) => string;

function normalizePlatform(platform: string | undefined, t: TFn): string {
  if (!platform) return t('Unknown platform');
  return PLATFORM_LABELS[platform.toLowerCase()] ?? platform;
}

function compactId(value: string): string {
  if (value.length <= 20) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function formatAgo(timestampMs: number | null | undefined, t: TFn): string | null {
  if (!timestampMs) return null;
  const relative = relativeTime(timestampMs);
  if (!relative) return null;
  if (relative === 'now') return t('just now');
  if (relative === 'Yesterday') return t('Yesterday');
  return t('{{time}} ago', { time: relative });
}

function formatDeviceSubtitle(device: DeviceInfo, t: TFn): string {
  const parts: string[] = [];
  if (device.role) parts.push(device.role);
  if (device.platform) parts.push(normalizePlatform(device.platform, t));
  return parts.length > 0 ? parts.join(' · ') : t('Paired device');
}

function formatDevicePaired(device: DeviceInfo, t: TFn): string {
  const ago = formatAgo(device.pairedAtMs, t);
  return ago ? t('Paired {{ago}}', { ago }) : t('Paired');
}

function sortDevices(devices: DeviceInfo[]): DeviceInfo[] {
  return [...devices].sort((a, b) => {
    const timeDiff = (b.pairedAtMs ?? 0) - (a.pairedAtMs ?? 0);
    if (timeDiff !== 0) return timeDiff;
    const aName = (a.displayName ?? a.deviceId).toLowerCase();
    const bName = (b.displayName ?? b.deviceId).toLowerCase();
    return aName.localeCompare(bName);
  });
}

function sortPendingRequests(requests: DevicePairRequest[]): DevicePairRequest[] {
  return [...requests].sort((a, b) => (b.requestedAtMs ?? 0) - (a.requestedAtMs ?? 0));
}

export function DevicesView({
  gateway,
  topInset,
  onBack,
  hideHeader = false,
}: Props): React.JSX.Element {
  const { gatewayEpoch } = useAppContext();
  const { t } = useTranslation('console');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);

  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [pendingRequests, setPendingRequests] = useState<DevicePairRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [pendingBusyIds, setPendingBusyIds] = useState<Set<string>>(new Set());
  const [deviceBusyIds, setDeviceBusyIds] = useState<Set<string>>(new Set());
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    };
  }, []);

  useEffect(() => {
    gateway.getDeviceIdentity()
      .then((identity) => {
        setCurrentDeviceId(identity.deviceId);
      })
      .catch(() => {
        setCurrentDeviceId(null);
      });
  }, [gateway]);

  const loadData = useCallback(async (mode: 'initial' | 'refresh' | 'background' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);

    try {
      const result = await gateway.listDevices();
      setDevices(sortDevices(result.paired));
      setPendingRequests(sortPendingRequests(result.pending));
      setError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('Failed to load devices');
      setError(message);
    } finally {
      if (mode === 'initial') setLoading(false);
      if (mode === 'refresh') setRefreshing(false);
    }
  }, [gateway, gatewayEpoch, t]);

  useEffect(() => {
    loadData('initial').catch(() => {});
  }, [loadData]);

  const handleRefresh = useCallback(() => {
    loadData('refresh').catch(() => {});
  }, [loadData]);

  const handleCopy = useCallback(async (value: string, message: string) => {
    await Clipboard.setStringAsync(value);
    showToast(message);
  }, [showToast]);

  const removeDevice = useCallback(async (device: DeviceInfo) => {
    if (!device.deviceId) return;
    const previousDevices = devices;

    setDeviceBusyIds((prev) => {
      const next = new Set(prev);
      next.add(device.deviceId);
      return next;
    });

    animateListChange();
    setDevices((prev) => prev.filter((item) => item.deviceId !== device.deviceId));

    try {
      await gateway.removeDevice(device.deviceId);
      showToast(t('Device removed.'));
      loadData('background').catch(() => {});
    } catch (err: unknown) {
      animateListChange();
      setDevices(previousDevices);
      const message = err instanceof Error ? err.message : t('Failed to remove device');
      Alert.alert(t('Remove failed'), message);
    } finally {
      setDeviceBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(device.deviceId);
        return next;
      });
    }
  }, [devices, gateway, loadData, showToast, t]);

  const confirmRemoveDevice = useCallback((device: DeviceInfo) => {
    Alert.alert(
      t('Remove Device?'),
      t('This device will no longer be paired with your gateway.'),
      [
        { text: t('common:Cancel'), style: 'cancel' },
        {
          text: t('common:Remove'),
          style: 'destructive',
          onPress: () => {
            removeDevice(device).catch(() => {});
          },
        },
      ],
    );
  }, [removeDevice, t]);

  const handleDeviceLongPress = useCallback((device: DeviceInfo) => {
    Alert.alert(
      device.displayName ?? compactId(device.deviceId),
      t('Choose an action.'),
      [
        {
          text: t('Remove Device'),
          style: 'destructive',
          onPress: () => confirmRemoveDevice(device),
        },
        {
          text: t('Copy Device ID'),
          onPress: () => {
            handleCopy(device.deviceId, t('Device ID copied.')).catch(() => {
              Alert.alert(t('Copy failed'), t('Unable to copy Device ID.'));
            });
          },
        },
        { text: t('common:Cancel'), style: 'cancel' },
      ],
    );
  }, [confirmRemoveDevice, handleCopy, t]);

  const handlePendingDecision = useCallback(async (request: DevicePairRequest, action: 'approve' | 'reject') => {
    const requestId = request.requestId;

    setPendingBusyIds((prev) => {
      const next = new Set(prev);
      next.add(requestId);
      return next;
    });

    const previousPending = pendingRequests;
    animateListChange();
    setPendingRequests((prev) => prev.filter((item) => item.requestId !== requestId));

    try {
      if (action === 'approve') {
        await gateway.approveDevicePair(requestId);
      } else {
        await gateway.rejectDevicePair(requestId);
      }

      analyticsEvents.pairRequestResolved({
        target: 'device',
        decision: action,
        source: 'devices_view',
      });

      showToast(action === 'approve' ? t('Request approved.') : t('Request rejected.'));
      loadData('background').catch(() => {});
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
  }, [gateway, loadData, pendingRequests, showToast, t]);

  const hasData = pendingRequests.length > 0 || devices.length > 0;

  const sections = useMemo<DevicesSection[]>(() => {
    const nextSections: DevicesSection[] = [];

    const pendingRows: DeviceRow[] = pendingRequests.length > 0
      ? pendingRequests.map((item) => ({ kind: 'pending', item }))
      : [{ kind: 'placeholder', key: 'pending-empty', message: t('No pending device requests.') }];

    const deviceRows: DeviceRow[] = devices.length > 0
      ? devices.map((item) => ({ kind: 'device', item }))
      : [{ kind: 'placeholder', key: 'devices-empty', message: t('No paired devices.') }];

    nextSections.push({
      key: 'pending',
      title: t('Pending Requests'),
      icon: '⚡',
      tone: 'warning',
      count: pendingRequests.length,
      data: pendingRows,
    });

    nextSections.push({
      key: 'devices',
      title: t('Devices'),
      icon: '📱',
      tone: 'default',
      count: devices.length,
      data: deviceRows,
    });

    return nextSections;
  }, [devices, pendingRequests, t]);

  const renderSectionHeader = useCallback(({ section }: { section: SectionListData<DeviceRow, DevicesSection> }) => (
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

  const renderPendingCard = useCallback((request: DevicePairRequest) => {
    const title = request.displayName ?? compactId(request.deviceId ?? request.requestId);
    const subtitleParts: string[] = [request.role ?? t('Device')];
    if (request.platform) subtitleParts.push(normalizePlatform(request.platform, t));

    const isBusy = pendingBusyIds.has(request.requestId);

    return (
      <Card style={styles.pendingCard}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSubtitle}>{subtitleParts.join(' • ')}</Text>

        <View style={styles.pendingActionsRow}>
          <TouchableOpacity
            style={[styles.approveButton, isBusy && styles.buttonDisabled]}
            onPress={() => {
              handlePendingDecision(request, 'approve').catch(() => {});
            }}
            activeOpacity={0.7}
            disabled={isBusy}
          >
            <Text style={styles.approveButtonText}>{t('Approve')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.rejectButton, isBusy && styles.buttonDisabled]}
            onPress={() => {
              handlePendingDecision(request, 'reject').catch(() => {});
            }}
            activeOpacity={0.7}
            disabled={isBusy}
          >
            <Text style={styles.rejectButtonText}>{t('Reject')}</Text>
          </TouchableOpacity>
        </View>
      </Card>
    );
  }, [handlePendingDecision, pendingBusyIds, styles]);

  const renderDeviceCard = useCallback((device: DeviceInfo) => {
    const title = device.displayName ?? compactId(device.deviceId);
    const isCurrentDevice = currentDeviceId === device.deviceId;
    const tokenCount = device.tokens ? Object.keys(device.tokens).length : 0;
    const isBusy = deviceBusyIds.has(device.deviceId);

    return (
      <TouchableOpacity
        activeOpacity={0.82}
        onLongPress={() => handleDeviceLongPress(device)}
        delayLongPress={350}
      >
        <Card style={[styles.card, isCurrentDevice && styles.currentDeviceCard]}>
          <View style={styles.deviceHeaderRow}>
            <Text style={styles.cardTitle}>{title}</Text>
            {isCurrentDevice ? (
              <View style={styles.thisDeviceBadge}>
                <Text style={styles.thisDeviceBadgeText}>{t('This device')}</Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.cardSubtitle}>{formatDeviceSubtitle(device, t)}</Text>
          <Text style={styles.metaText}>{formatDevicePaired(device, t)}</Text>

          <View style={styles.deviceFooterRow}>
            {tokenCount > 0 ? (
              <View style={styles.tokenBadge}>
                <Text style={styles.tokenBadgeText}>{t('{{count}} tokens', { count: tokenCount })}</Text>
              </View>
            ) : <View />}

            <Text style={styles.longPressHint}>{isBusy ? t('Removing...') : t('Long press for actions')}</Text>
          </View>
        </Card>
      </TouchableOpacity>
    );
  }, [currentDeviceId, deviceBusyIds, handleDeviceLongPress, styles]);

  const renderPlaceholderCard = useCallback((message: string) => (
    <Card style={styles.placeholderCard}>
      <Text style={styles.placeholderText}>{message}</Text>
    </Card>
  ), [styles]);

  const renderItem = useCallback(({ item }: { item: DeviceRow }) => {
    if (item.kind === 'pending') return renderPendingCard(item.item);
    if (item.kind === 'device') return renderDeviceCard(item.item);
    return renderPlaceholderCard(item.message);
  }, [renderDeviceCard, renderPendingCard, renderPlaceholderCard]);

  const keyExtractor = useCallback((item: DeviceRow): string => {
    if (item.kind === 'pending') return `pending:${item.item.requestId}`;
    if (item.kind === 'device') return `device:${item.item.deviceId}`;
    return `placeholder:${item.key}`;
  }, []);

  const listHeader = useMemo(() => (
    <View style={styles.listHeaderWrap}>
      <Text style={styles.summaryText}>
        {t('{{count}} devices', { count: devices.length })}
      </Text>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorTitle}>{t('Failed to refresh devices')}</Text>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {!hasData ? (
        <Text style={styles.noDataHint}>{t('No devices yet. Pair a device to get started.')}</Text>
      ) : null}
    </View>
  ), [devices.length, error, hasData, styles]);

  if (loading) {
    return (
      <View style={styles.root}>
        {!hideHeader ? <ScreenHeader title={t('Devices')} topInset={topInset} onBack={onBack} /> : null}
        <LoadingState message={t('Loading devices...')} />
      </View>
    );
  }

  if (error && !hasData) {
    return (
      <View style={styles.root}>
        {!hideHeader ? <ScreenHeader title={t('Devices')} topInset={topInset} onBack={onBack} /> : null}
        <View style={styles.errorWrap}>
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>{t('Failed to load devices')}</Text>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={() => { loadData('initial').catch(() => {}); }}
              activeOpacity={0.7}
            >
              <Text style={styles.retryText}>{t('common:Retry')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {!hideHeader ? <ScreenHeader title={t('Devices')} topInset={topInset} onBack={onBack} /> : null}

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
      borderWidth: StyleSheet.hairlineWidth,
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
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    sectionCountText: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
      fontWeight: FontWeight.semibold,
    },
    card: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: Radius.md,
      padding: Space.md,
      gap: Space.xs,
    },
    pendingCard: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.warning,
      borderRadius: Radius.md,
      padding: Space.md,
      gap: Space.xs,
      backgroundColor: colors.surfaceElevated,
    },
    placeholderCard: {
      borderWidth: StyleSheet.hairlineWidth,
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
      borderWidth: StyleSheet.hairlineWidth,
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
    deviceHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.sm,
    },
    currentDeviceCard: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    thisDeviceBadge: {
      borderRadius: Radius.full,
      paddingHorizontal: Space.sm,
      paddingVertical: 2,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    thisDeviceBadgeText: {
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
      color: colors.textMuted,
    },
    deviceFooterRow: {
      marginTop: Space.xs,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.sm,
    },
    tokenBadge: {
      borderRadius: Radius.full,
      paddingHorizontal: Space.sm,
      paddingVertical: 2,
      backgroundColor: colors.surfaceMuted,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    tokenBadgeText: {
      fontSize: FontSize.xs,
      color: colors.textMuted,
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
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.error,
      backgroundColor: colors.surfaceElevated,
      paddingHorizontal: Space.md,
      paddingVertical: Space.sm,
      gap: Space.xs,
    },
    errorCard: {
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
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
  });
}
