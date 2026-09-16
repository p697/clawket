import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ChevronLeft } from '../../components/ui/DirectionalIcon';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner } from '../../components/ui/Banner';
import { ConnectionStatusPill } from '../../components/ui/ConnectionStatusPill';
import { Button } from '../../components/ui/Button';
import { FloatingButton } from '../../components/ui/FloatingButton';
import { Skeleton } from '../../components/ui/Skeleton';
import { useConnections } from '../../connection';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import type { RootStackParamList } from '../../navigation/root-stack';
import { ChatCacheService } from '../../services/chat-cache';
import { MessageFavoritesService } from '../../services/message-favorites';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  LineHeight,
  Space,
} from '../../theme/tokens';
import { relativeTime } from '../../utils/chat-message';
import {
  loadSearchMessageDetail,
  type SearchMessageDetail,
} from './message-detail';

type NavigationProps = NativeStackScreenProps<RootStackParamList, 'MessageDetail'>;

export type MessageDetailScreenProps = NavigationProps & Readonly<{
  isProOverride?: boolean;
  onViewInThread?: (detail: SearchMessageDetail) => void;
}>;

type MessageDetailState = 'loading' | 'empty' | 'error' | 'offline' | 'permission' | 'ready';

function resolveMessageDetailState(input: Readonly<{
  isPro: boolean;
  loaded: boolean;
  hasDetail: boolean;
  hasError: boolean;
  offline: boolean;
}>): MessageDetailState {
  if (!input.isPro) return 'permission';
  if (!input.loaded) return 'loading';
  if (input.hasError) return 'error';
  if (input.offline) return 'offline';
  if (!input.hasDetail) return 'empty';
  return 'ready';
}

function MessageDetailView({
  state,
  detail,
  reconnecting = false,
  topInset,
  bottomInset,
  onBack,
  onRetry,
  onOpenPaywall,
  onViewInThread,
}: Readonly<{
  state: MessageDetailState;
  detail: SearchMessageDetail | null;
  /** The runtime's foreground grace window is open: show quiet reconnecting instead of offline. */
  reconnecting?: boolean;
  topInset: number;
  bottomInset: number;
  onBack: () => void;
  onRetry: () => void;
  onOpenPaywall: () => void;
  onViewInThread: () => void;
}>): React.JSX.Element {
  const { t } = useTranslation('common');
  const { theme } = useAppTheme();
  const headerInsets = useMemo(() => ({ paddingTop: topInset + Space.sm }), [topInset]);
  const contentInsets = useMemo(() => ({ paddingBottom: bottomInset + Space.xl }), [bottomInset]);
  // The title yields its slot to connection state so the header never grows.
  const connectionStatus = state === 'offline' && reconnecting ? (
    <ConnectionStatusPill
      testID="message-detail-reconnecting"
      placement="inline"
      status="reconnecting"
      message={t('Reconnecting…')}
    />
  ) : state === 'offline' ? (
    <ConnectionStatusPill
      testID="message-detail-offline"
      placement="inline"
      status="offline"
      message={t('Offline · showing cached message')}
    />
  ) : state === 'error' ? (
    <ConnectionStatusPill
      testID="message-detail-error"
      placement="inline"
      status="error"
      message={t('Message unavailable')}
      actionLabel={t('Retry')}
      onAction={onRetry}
    />
  ) : null;

  return (
    <View testID="message-detail-view" style={[styles.screen, { backgroundColor: theme.colors.canvas }]}>
      <View testID="message-detail-header" style={[styles.header, headerInsets]}>
        <FloatingButton
          testID="message-detail-back"
          icon={ChevronLeft}
          accessibilityLabel={t('Back')}
          onPress={onBack}
        />
        {connectionStatus ? (
          <View testID="message-detail-header-status" style={styles.headerStatus}>{connectionStatus}</View>
        ) : (
          <Text style={[styles.headerTitle, { color: theme.colors.ink }]} numberOfLines={1}>
            {t('Message details')}
          </Text>
        )}
        <View style={styles.headerSlot} />
      </View>
      <ScrollView contentContainerStyle={[styles.detailContent, contentInsets]}>
        {state === 'permission' ? (
          <Banner
            testID="message-detail-permission"
            message={t('Message details require Pro')}
            actionLabel={t('View Pro')}
            onAction={onOpenPaywall}
          />
        ) : null}
        {state === 'loading' ? (
          <View testID="message-detail-loading" style={styles.detailBody}>
            <Skeleton accessibilityLabel={t('Loading message')} style={styles.detailTitleSkeleton} />
            <Skeleton style={styles.detailBodySkeleton} />
          </View>
        ) : null}
        {state === 'empty' ? (
          <Text testID="message-detail-empty" style={[styles.emptyText, { color: theme.colors.inkSecondary }]}>
            {t('Message unavailable')}
          </Text>
        ) : null}
        {detail && state !== 'loading' && state !== 'permission' ? (
          <View testID="message-detail-content" style={styles.detailBody}>
            <View>
              <Text style={[styles.detailTitle, { color: theme.colors.ink }]}>
                {detail.title}
              </Text>
              {detail.timestampMs ? (
                <Text style={[styles.detailMeta, { color: theme.colors.inkSecondary }]}>
                  {relativeTime(detail.timestampMs)}
                </Text>
              ) : null}
            </View>
            <Text selectable style={[styles.messageText, { color: theme.colors.ink }]}>
              {detail.text}
            </Text>
            <Button
              testID="message-detail-view-thread"
              label={t('View in thread')}
              onPress={onViewInThread}
            />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

export function MessageDetailScreen({
  navigation,
  route,
  isProOverride,
  onViewInThread,
}: MessageDetailScreenProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const runtime = useConnections();
  const { isPro: contextIsPro } = useProPaywall();
  const isPro = isProOverride ?? contextIsPro;
  const [detail, setDetail] = useState<SearchMessageDetail | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryRevision, setRetryRevision] = useState(0);
  const { connectionId, sessionKey, messageId } = route.params;

  useEffect(() => {
    if (!isPro) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    setLoaded(false);
    setError(null);
    setDetail(null);
    void loadSearchMessageDetail(
      { connectionId, sessionKey, messageId },
      ChatCacheService,
      MessageFavoritesService,
    ).then((result) => {
      if (cancelled) return;
      setDetail(result);
      setLoaded(true);
    }).catch((loadError: unknown) => {
      if (cancelled) return;
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [connectionId, isPro, messageId, retryRevision, sessionKey]);

  const offline = runtime.activeConnectionId === connectionId
    && (runtime.activeState === 'offline' || runtime.activeState === 'reconnecting');
  const state = resolveMessageDetailState({
    isPro,
    loaded,
    hasDetail: Boolean(detail),
    hasError: Boolean(error),
    offline,
  });
  const viewInThread = useCallback(() => {
    if (!detail) return;
    if (onViewInThread) {
      onViewInThread(detail);
      return;
    }
    navigation.navigate('Thread', {
      connectionId: detail.connectionId,
      agentId: detail.agentId,
      sessionKey: detail.sessionKey,
      from: 'search',
    });
  }, [detail, navigation, onViewInThread]);

  return (
    <MessageDetailView
      state={state}
      detail={detail}
      reconnecting={runtime.recovering === true}
      topInset={insets.top}
      bottomInset={insets.bottom}
      onBack={() => navigation.goBack()}
      onRetry={() => setRetryRevision((revision) => revision + 1)}
      onOpenPaywall={() => navigation.navigate('Paywall', { reason: 'messageHistory' })}
      onViewInThread={viewInThread}
    />
  );
}

export {
  MessageDetailView,
  resolveMessageDetailState,
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
    fontWeight: FontWeight.semibold,
  },
  headerStatus: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSlot: {
    width: ControlSize.floatingButton,
    height: ControlSize.floatingButton,
  },
  detailContent: {
    flexGrow: 1,
    paddingHorizontal: Space.lg,
    paddingTop: Space.sm,
    gap: Space.lg,
  },
  detailBody: {
    gap: Space.lg,
  },
  detailTitle: {
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
    fontWeight: FontWeight.semibold,
  },
  detailMeta: {
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
    fontWeight: FontWeight.regular,
    fontVariant: ['tabular-nums'],
  },
  messageText: {
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
    fontWeight: FontWeight.regular,
  },
  emptyText: {
    flex: 1,
    paddingVertical: Space.xxl,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.regular,
  },
  detailTitleSkeleton: {
    width: '42%',
  },
  detailBodySkeleton: {
    minHeight: ControlSize.rosterRow,
  },
});
