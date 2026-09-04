import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Gift } from 'lucide-react-native';
import { Card, EmptyState, LoadingState } from '../../components/ui';
import { useAppContext } from '../../contexts/AppContext';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import { resolveGatewayBackendKind } from '@clawket/agent-protocol';
import {
  YouMindClient,
  getYouMindAuthFailureReason,
  type YouMindPagination,
  type YouMindPermanentCreditGrant,
} from '../../services/youmind';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import type { ProfileStackParamList } from './ProfileTab';

const PAGE_SIZE = 10;

type AddOnCreditsNavigation = NativeStackNavigationProp<ProfileStackParamList, 'AddOnCredits'>;

function formatDateTime(valueMs: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(valueMs));
  } catch {
    return new Date(valueMs).toLocaleString();
  }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: Space.lg,
      paddingBottom: Space.xxxl,
      gap: Space.lg,
    },
    errorText: {
      fontSize: FontSize.sm,
      lineHeight: 18,
      color: colors.error,
    },
    listCard: {
      paddingTop: Space.md,
      paddingBottom: Space.sm,
    },
    listMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.md,
      marginBottom: Space.sm,
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: Space.md,
      paddingVertical: Space.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rowLast: {
      borderBottomWidth: 0,
    },
    rowCopy: {
      flex: 1,
      gap: 2,
    },
    rowReason: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.medium,
      color: colors.text,
    },
    rowDate: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
    },
    rowAmount: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.primary,
    },
    loadingRow: {
      paddingVertical: Space.md,
      alignItems: 'center',
    },
    pagerCard: {
      gap: Space.md,
    },
    pagerTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.md,
    },
    pagerSummary: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
    },
    pagerControls: {
      flexDirection: 'row',
      gap: Space.sm,
    },
    pagerButton: {
      minWidth: 88,
      borderRadius: Radius.full,
      paddingHorizontal: Space.md,
      paddingVertical: Space.sm + 2,
      backgroundColor: colors.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pagerButtonDisabled: {
      opacity: 0.5,
    },
    pagerButtonText: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.medium,
      color: colors.text,
    },
    pageNumberRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Space.sm,
    },
    pageNumberButton: {
      minWidth: 40,
      borderRadius: Radius.full,
      paddingHorizontal: Space.sm + 2,
      paddingVertical: Space.sm,
      backgroundColor: colors.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pageNumberButtonActive: {
      backgroundColor: colors.primarySoft,
    },
    pageNumberText: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
      color: colors.textMuted,
    },
    pageNumberTextActive: {
      color: colors.primary,
      fontWeight: FontWeight.semibold,
    },
    emptyWrap: {
      paddingVertical: Space.xl,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Space.sm,
    },
    emptyText: {
      fontSize: FontSize.base,
      color: colors.textMuted,
      textAlign: 'center',
    },
  });
}

export function YouMindAddOnCreditsScreen(): React.JSX.Element {
  const navigation = useNavigation<AddOnCreditsNavigation>();
  const { theme } = useAppTheme();
  const { config, activeGatewayConfigId } = useAppContext();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const backendKind = resolveGatewayBackendKind(config);
  const client = useMemo(
    () => new YouMindClient(config?.url || 'https://youmind.com', { authScopeKey: activeGatewayConfigId }),
    [activeGatewayConfigId, config?.url],
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(0);
  const [grants, setGrants] = useState<YouMindPermanentCreditGrant[]>([]);
  const [paging, setPaging] = useState<YouMindPagination | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const initialLoadKeyRef = useRef<string | null>(null);
  const loadKey = `${backendKind}:${config?.url ?? ''}:${activeGatewayConfigId ?? ''}`;

  useNativeStackModalHeader({
    navigation,
    title: 'Add-on Credits',
    onClose: () => navigation.goBack(),
  });

  const load = useCallback(async (nextPage: number, mode: 'initial' | 'refresh' | 'page' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    if (mode === 'page') setLoading(true);
    setError(null);

    try {
      if (backendKind !== 'youmind') {
        setError('Add-on credits are only available for YouMind connections.');
        return;
      }

      const session = await client.getValidSession();
      if (!session) {
        setAuthRequired(true);
        return;
      }

      setAuthRequired(false);
      const result = await client.listPermanentCreditGrants({
        current: nextPage,
        pageSize: PAGE_SIZE,
      });
      setPage(nextPage);
      setGrants(result.data);
      setPaging(result.paging);
    } catch (nextError) {
      if (getYouMindAuthFailureReason(nextError, { hadStoredSession: true })) {
        setAuthRequired(true);
        setError(null);
        return;
      }
      setError(nextError instanceof Error ? nextError.message : 'Failed to load add-on credits.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [backendKind, client]);

  useEffect(() => {
    if (initialLoadKeyRef.current === loadKey) {
      return;
    }
    initialLoadKeyRef.current = loadKey;
    void load(0, 'initial');
  }, [load, loadKey]);

  const totalPages = paging ? Math.max(1, Math.ceil(paging.total / paging.pageSize)) : 1;
  const visiblePages = (() => {
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, index) => index);
    }

    const start = Math.max(0, Math.min(page - 2, totalPages - 5));
    return Array.from({ length: 5 }, (_, index) => start + index);
  })();

  if (loading && grants.length === 0) {
    return <LoadingState message="Loading add-on credits..." />;
  }

  if (authRequired) {
    return (
      <View style={styles.root}>
        <EmptyState
          icon="🪪"
          title="YouMind sign-in required"
          subtitle="Sign in to YouMind in Chat first, then come back to view your add-on credits."
          actionLabel="Close"
          onAction={() => navigation.goBack()}
        />
      </View>
    );
  }

  if (error && grants.length === 0) {
    return (
      <View style={styles.root}>
        <EmptyState
          icon="⚠️"
          title="Failed to load add-on credits"
          subtitle={error}
          actionLabel="Try again"
          onAction={() => {
            void load(page, 'initial');
          }}
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={(
        <RefreshControl
          refreshing={refreshing}
          tintColor={theme.colors.primary}
          onRefresh={() => {
            void load(page, 'refresh');
          }}
        />
      )}
    >
      {error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : null}

      <Card style={styles.listCard}>
        <View style={styles.listMetaRow}>
          <Text style={styles.pagerSummary}>
            {paging?.total ? `${formatNumber(paging.total)} total entries` : '0 entries'}
          </Text>
          <Text style={styles.pagerSummary}>
            Page {page + 1} of {totalPages}
          </Text>
        </View>
        {grants.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Gift size={24} color={theme.colors.textMuted} strokeWidth={2} />
            <Text style={styles.emptyText}>No permanent credit grants yet.</Text>
          </View>
        ) : (
          grants.map((grant, index) => (
            <View
              key={grant.id}
              style={[styles.row, index === grants.length - 1 ? styles.rowLast : null]}
            >
              <View style={styles.rowCopy}>
                <Text style={styles.rowReason}>{grant.reason}</Text>
                <Text style={styles.rowDate}>{formatDateTime(grant.createdAtMs)}</Text>
              </View>
              <Text style={styles.rowAmount}>+{formatNumber(grant.amount)}</Text>
            </View>
          ))
        )}
        {loading && grants.length > 0 ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : null}
      </Card>

      <Card style={styles.pagerCard}>
        <View style={styles.pagerControls}>
          <Pressable
            style={[styles.pagerButton, page <= 0 ? styles.pagerButtonDisabled : null]}
            disabled={page <= 0}
            onPress={() => {
              void load(page - 1, 'page');
            }}
          >
            <Text style={styles.pagerButtonText}>Previous</Text>
          </Pressable>
          <Pressable
            style={[styles.pagerButton, page >= totalPages - 1 ? styles.pagerButtonDisabled : null]}
            disabled={page >= totalPages - 1}
            onPress={() => {
              void load(page + 1, 'page');
            }}
          >
            <Text style={styles.pagerButtonText}>Next</Text>
          </Pressable>
        </View>

        {visiblePages.length > 1 ? (
          <View style={styles.pageNumberRow}>
            {visiblePages.map((pageIndex) => (
              <Pressable
                key={pageIndex}
                style={[
                  styles.pageNumberButton,
                  pageIndex === page ? styles.pageNumberButtonActive : null,
                ]}
                onPress={() => {
                  void load(pageIndex, 'page');
                }}
              >
                <Text
                  style={[
                    styles.pageNumberText,
                    pageIndex === page ? styles.pageNumberTextActive : null,
                  ]}
                >
                  {pageIndex + 1}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </Card>
    </ScrollView>
  );
}
