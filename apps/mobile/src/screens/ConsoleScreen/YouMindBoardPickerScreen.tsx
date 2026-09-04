import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import { Check, Star } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { type NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { EmptyState, SearchInput, createListContentStyle } from '../../components/ui';
import { useAppContext } from '../../contexts/AppContext';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import { StorageService } from '../../services/storage';
import { YouMindClient, type YouMindBoardSummary } from '../../services/youmind';
import { useAppTheme } from '../../theme';
import { ControlSize, FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import type { ConsoleStackParamList } from './ConsoleTab';
import { YouMindBoardIcon } from './components/YouMindBoardIcon';

type Navigation = NativeStackNavigationProp<ConsoleStackParamList, 'YouMindBoardPicker'>;
type PickerRoute = RouteProp<ConsoleStackParamList, 'YouMindBoardPicker'>;

export function YouMindBoardPickerScreen(): React.JSX.Element {
  const navigation = useNavigation<Navigation>();
  const route = useRoute<PickerRoute>();
  const { theme } = useAppTheme();
  const { t } = useTranslation('console');
  const { config, activeGatewayConfigId } = useAppContext();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const baseUrl = config?.url || 'https://youmind.com';
  const client = useMemo(() => new YouMindClient(baseUrl, { authScopeKey: activeGatewayConfigId }), [activeGatewayConfigId, baseUrl]);
  const [boards, setBoards] = useState<YouMindBoardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useNativeStackModalHeader({
    navigation,
    title: t('Select Board'),
    onClose: () => navigation.goBack(),
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const nextBoards = await client.listBoards();
        if (!active) return;
        setBoards(nextBoards.filter((board) => board.status === 'active'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [client]);

  const filteredBoards = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const visibleBoards = normalized
      ? boards.filter((board) => board.name.toLowerCase().includes(normalized))
      : boards;
    return visibleBoards
      .map((board, index) => ({ board, index }))
      .sort((left, right) => {
        if (left.board.isFavorited !== right.board.isFavorited) {
          return left.board.isFavorited ? -1 : 1;
        }
        return left.index - right.index;
      })
      .map(({ board }) => board);
  }, [boards, query]);

  const handleSelect = useCallback(async (board: YouMindBoardSummary) => {
    await StorageService.setYouMindLastOpenedBoardId(baseUrl, board.id, activeGatewayConfigId);
    navigation.goBack();
  }, [activeGatewayConfigId, baseUrl, navigation]);

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <FlashList
        data={filteredBoards}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={createListContentStyle({
          top: Space.md,
          bottom: Space.xxxl,
          grow: filteredBoards.length === 0,
        })}
        ListHeaderComponent={(
          <View style={styles.searchWrap}>
            <SearchInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('Search boards')}
              style={styles.searchInput}
            />
          </View>
        )}
        ListEmptyComponent={(
          <View style={styles.centerState}>
            <EmptyState
              icon={loading ? '🌀' : '🗂️'}
              title={loading
                ? t('Loading...')
                : query.trim()
                  ? t('No boards match your search')
                  : t('No boards yet')}
              subtitle={loading
                ? t('Loading your YouMind boards...')
                : query.trim()
                  ? t('Try a different board name or keyword.')
                  : t('Boards you create in YouMind will appear here.')}
            />
          </View>
        )}
        renderItem={({ item }) => {
          const selected = item.id === route.params.selectedBoardId;
          const isDefault = item.type === 'default';
          return (
            <Pressable
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: theme.colors.surface,
                  opacity: pressed ? 0.72 : 1,
                },
              ]}
              onPress={() => {
                void handleSelect(item);
              }}
            >
              <YouMindBoardIcon icon={item.icon} size={24} accentOnly />
              <View style={styles.rowBody}>
                <View style={styles.rowTopLine}>
                  <View style={styles.rowTitleWrap}>
                    <Text style={[styles.rowTitle, { color: theme.colors.text }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {item.isFavorited ? (
                      <Star
                        size={14}
                        color={theme.colors.warning}
                        fill={theme.colors.warning}
                        strokeWidth={1.8}
                      />
                    ) : null}
                  </View>
                  {isDefault ? (
                    <View style={[styles.badge, { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.primary }]}>
                      <Text style={[styles.badgeText, { color: theme.colors.primary }]}>{t('Default')}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
              {selected ? <Check size={18} color={theme.colors.primary} strokeWidth={2.2} /> : null}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: {
      flex: 1,
    },
    searchWrap: {
      marginBottom: Space.md,
    },
    searchInput: {
      borderWidth: 0,
      minHeight: ControlSize.field,
      borderRadius: Radius.lg,
    },
    centerState: {
      flex: 1,
      justifyContent: 'center',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
      borderRadius: Radius.lg,
      padding: Space.md,
      marginBottom: Space.sm,
    },
    rowBody: {
      flex: 1,
      justifyContent: 'center',
    },
    rowTopLine: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.sm,
    },
    rowTitleWrap: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
    },
    rowTitle: {
      flexShrink: 1,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    badge: {
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: Radius.full,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    badgeText: {
      fontSize: FontSize.xs,
      fontWeight: FontWeight.medium,
    },
  });
}
