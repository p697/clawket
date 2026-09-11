import React, { useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  ChevronLeft,
  Clock3,
  LockKeyhole,
  MessageSquare,
  MessagesSquare,
  Star,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { AgentAvatar } from '../../components/ui/AgentAvatar';
import { Banner } from '../../components/ui/Banner';
import { FloatingButton } from '../../components/ui/FloatingButton';
import { SearchInput } from '../../components/ui/SearchInput';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
import { Skeleton } from '../../components/ui/Skeleton';
import { useAppTheme } from '../../theme';
import type { CanonicalThemeColors } from '../../theme/theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  IconSize,
  LineHeight,
  Radius,
  Space,
} from '../../theme/tokens';
import { relativeTime } from '../../utils/chat-message';
import {
  shouldShowSearchFilters,
  splitHighlightSegments,
  type SearchFilter,
  type SearchPageState,
  type SearchResult,
  type SearchSection,
  type SearchSectionKind,
} from './model';

const SEARCH_SKELETON_KEYS = Object.freeze(['one', 'two', 'three', 'four', 'five']);

export type SearchViewProps = Readonly<{
  state: SearchPageState;
  query: string;
  filter: SearchFilter;
  sections: ReadonlyArray<SearchSection>;
  recentSearches: ReadonlyArray<string>;
  availableResultCount: number;
  errorCode?: string | null;
  topInset: number;
  bottomInset: number;
  autoFocus?: boolean;
  onBack: () => void;
  onChangeQuery: (query: string) => void;
  onChangeFilter: (filter: SearchFilter) => void;
  onSelectResult: (result: SearchResult) => void;
  onSelectRecent: (query: string) => void;
  onRetry?: () => void;
  onOpenPermission?: () => void;
}>;

function HighlightedText({
  value,
  query,
  style,
}: Readonly<{
  value: string;
  query: string;
  style: object;
}>): React.JSX.Element {
  const { theme } = useAppTheme();
  return (
    <Text style={style} numberOfLines={1}>
      {splitHighlightSegments(value, query).map((segment, index) => (
        <Text
          key={`${segment.text}:${index}`}
          style={segment.matched ? { color: theme.colors.accent, fontWeight: FontWeight.semibold } : undefined}
        >
          {segment.text}
        </Text>
      ))}
    </Text>
  );
}

function SearchResultLeading({ result }: Readonly<{ result: SearchResult }>): React.JSX.Element {
  const { theme } = useAppTheme();
  if (result.kind === 'agent') {
    return (
      <AgentAvatar
        testID={`search-avatar-${result.id}`}
        variant="sheet"
        agentId={result.agentId}
        name={result.title}
        emoji={result.emoji}
        avatarUrl={result.avatarUrl}
        status={result.lockedReason ? 'locked' : result.source === 'cache' ? 'offline' : 'idle'}
      />
    );
  }
  const Icon = result.kind === 'session'
    ? MessagesSquare
    : result.kind === 'favorite'
      ? Star
      : MessageSquare;
  return (
    <View style={[styles.resultIcon, { backgroundColor: theme.colors.surface }]}>
      <Icon size={IconSize.md} color={theme.colors.inkSecondary} strokeWidth={1.75} />
    </View>
  );
}

function SearchResultRow({
  result,
  query,
  onPress,
}: Readonly<{
  result: SearchResult;
  query: string;
  onPress: () => void;
}>): React.JSX.Element {
  const { t } = useTranslation('common');
  const { theme } = useAppTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme.colors), [theme.colors]);
  const fallbackTitle = result.kind === 'agent'
    ? t('Agent')
    : result.kind === 'session'
      ? t('Session')
      : result.kind === 'favorite'
        ? t('Favorite')
        : t('Message');
  const secondary = result.kind === 'message' || result.kind === 'favorite'
    ? result.text
    : result.subtitle;

  return (
    <Pressable
      testID={`search-result-${result.kind}-${result.id}`}
      accessibilityRole="button"
      accessibilityLabel={result.title || fallbackTitle}
      onPress={onPress}
      style={({ pressed }) => [styles.resultRow, pressed ? themedStyles.resultPressed : null]}
    >
      <SearchResultLeading result={result} />
      <View style={styles.resultCopy}>
        <HighlightedText
          value={result.title || fallbackTitle}
          query={query}
          style={[styles.resultTitle, { color: theme.colors.ink }]}
        />
        {secondary ? (
          <HighlightedText
            value={secondary}
            query={query}
            style={[styles.resultSubtitle, { color: theme.colors.inkSecondary }]}
          />
        ) : null}
      </View>
      <View style={styles.resultTail}>
        {result.lockedReason ? (
          <LockKeyhole
            testID={`search-result-lock-${result.id}`}
            size={IconSize.sm}
            color={theme.colors.inkSecondary}
            strokeWidth={1.75}
          />
        ) : null}
        {result.updatedAt ? (
          <Text style={[styles.resultTime, { color: theme.colors.inkTertiary }]}>
            {relativeTime(result.updatedAt)}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function sectionLabel(
  section: SearchSectionKind,
  t: (key: string) => string,
): string {
  if (section === 'agents') return t('Agents');
  if (section === 'sessions') return t('Sessions');
  if (section === 'favorites') return t('Favorites');
  return t('Messages');
}

function SearchSections({
  sections,
  query,
  onSelectResult,
}: Pick<SearchViewProps, 'sections' | 'query' | 'onSelectResult'>): React.JSX.Element {
  const { t } = useTranslation('common');
  const { theme } = useAppTheme();
  return (
    <View testID="search-sections" style={styles.sections}>
      {sections.map((section) => (
        <View key={section.kind} testID={`search-section-${section.kind}`} style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.inkSecondary }]}>
            {sectionLabel(section.kind, t)}
          </Text>
          {section.results.map((result) => (
            <SearchResultRow
              key={result.id}
              result={result}
              query={query}
              onPress={() => onSelectResult(result)}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

function RecentSearches({
  searches,
  onSelect,
}: Readonly<{
  searches: ReadonlyArray<string>;
  onSelect: (query: string) => void;
}>): React.JSX.Element {
  const { t } = useTranslation('common');
  const { theme } = useAppTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme.colors), [theme.colors]);
  return (
    <View testID="search-recent" style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.colors.inkSecondary }]}>
        {t('Recent searches')}
      </Text>
      {searches.map((search) => (
        <Pressable
          key={search.toLocaleLowerCase()}
          testID={`search-recent-${search}`}
          accessibilityRole="button"
          accessibilityLabel={search}
          onPress={() => onSelect(search)}
          style={({ pressed }) => [styles.resultRow, pressed ? themedStyles.resultPressed : null]}
        >
          <View style={[styles.resultIcon, { backgroundColor: theme.colors.surface }]}>
            <Clock3 size={IconSize.md} color={theme.colors.inkSecondary} strokeWidth={1.75} />
          </View>
          <Text
            numberOfLines={1}
            style={[styles.recentText, { color: theme.colors.ink }]}
          >
            {search}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function SearchLoading(): React.JSX.Element {
  const { t } = useTranslation('common');
  return (
    <View testID="search-loading" style={styles.loadingList}>
      {SEARCH_SKELETON_KEYS.map((key) => (
        <View key={key} style={styles.loadingRow}>
          <Skeleton
            accessibilityLabel={t('Loading search')}
            style={styles.loadingIcon}
          />
          <View style={styles.loadingCopy}>
            <Skeleton style={styles.loadingTitle} />
            <Skeleton style={styles.loadingSubtitle} />
          </View>
        </View>
      ))}
    </View>
  );
}

function SearchStatusBanner({
  state,
  errorCode,
  onRetry,
  onOpenPermission,
}: Pick<
  SearchViewProps,
  'state' | 'errorCode' | 'onRetry' | 'onOpenPermission'
>): React.JSX.Element | null {
  const { t } = useTranslation('common');
  if (state === 'offline') {
    return (
      <Banner
        testID="search-offline"
        message={t('Offline · showing cached results')}
      />
    );
  }
  if (state === 'error') {
    return (
      <Banner
        testID="search-error"
        tone="bad"
        message={t('Search unavailable · {{code}}', { code: errorCode ?? 'network' })}
        actionLabel={onRetry ? t('Retry') : undefined}
        onAction={onRetry}
      />
    );
  }
  if (state === 'permission') {
    return (
      <Banner
        testID="search-permission"
        message={t('Search requires access')}
        actionLabel={onOpenPermission ? t('View Pro') : undefined}
        onAction={onOpenPermission}
      />
    );
  }
  return null;
}

export function SearchView({
  state,
  query,
  filter,
  sections,
  recentSearches,
  availableResultCount,
  errorCode,
  topInset,
  bottomInset,
  autoFocus = true,
  onBack,
  onChangeQuery,
  onChangeFilter,
  onSelectResult,
  onSelectRecent,
  onRetry,
  onOpenPermission,
}: SearchViewProps): React.JSX.Element {
  const { t } = useTranslation('common');
  const { theme } = useAppTheme();
  const filterTabs = useMemo(() => [
    { key: 'all' as const, label: t('All') },
    { key: 'messages' as const, label: t('Messages') },
    { key: 'favorites' as const, label: t('Favorites') },
  ], [t]);
  const contentInsets = useMemo(() => ({ paddingBottom: bottomInset + Space.xl }), [bottomInset]);
  const headerInsets = useMemo(() => ({ paddingTop: topInset + Space.sm }), [topInset]);
  const hasQuery = query.trim().length > 0;
  const showFilters = hasQuery && shouldShowSearchFilters(availableResultCount);
  const showNoResults = state !== 'loading'
    && state !== 'permission'
    && (hasQuery ? sections.length === 0 : recentSearches.length === 0);

  return (
    <View testID="search-view" style={[styles.screen, { backgroundColor: theme.colors.canvas }]}>
      <View testID="search-header" style={[styles.header, headerInsets]}>
        <FloatingButton
          testID="search-back"
          icon={ChevronLeft}
          accessibilityLabel={t('Back')}
          onPress={onBack}
        />
        <SearchInput
          testID="search-input"
          style={styles.searchInput}
          autoFocus={autoFocus}
          value={query}
          onChangeText={onChangeQuery}
          placeholder={t('Search')}
        />
      </View>
      <ScrollView
        testID="search-scroll"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, contentInsets]}
      >
        <SearchStatusBanner
          state={state}
          errorCode={errorCode}
          onRetry={onRetry}
          onOpenPermission={onOpenPermission}
        />
        {showFilters ? (
          <SegmentedTabs
            testID="search-filters"
            size="sm"
            tabs={filterTabs}
            active={filter}
            onSwitch={onChangeFilter}
          />
        ) : null}
        {state === 'loading' ? <SearchLoading /> : null}
        {state !== 'loading' && state !== 'permission' && !hasQuery && recentSearches.length > 0 ? (
          <RecentSearches searches={recentSearches} onSelect={onSelectRecent} />
        ) : null}
        {state !== 'loading' && state !== 'permission' && hasQuery && sections.length > 0 ? (
          <SearchSections
            sections={sections}
            query={query}
            onSelectResult={onSelectResult}
          />
        ) : null}
        {showNoResults ? (
          <Text
            testID="search-empty"
            style={[styles.emptyText, { color: theme.colors.inkSecondary }]}
          >
            {hasQuery ? t('No results') : t('No recent searches')}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

function createThemedStyles(colors: CanonicalThemeColors) {
  return StyleSheet.create({
    resultPressed: {
      backgroundColor: colors.surface,
    },
  });
}

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
  content: {
    flexGrow: 1,
    paddingHorizontal: Space.lg,
    paddingTop: Space.sm,
    gap: Space.lg,
  },
  searchInput: {
    flex: 1,
  },
  sections: {
    gap: Space.xl,
  },
  section: {
    gap: Space.xs,
  },
  sectionTitle: {
    paddingHorizontal: Space.md,
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.semibold,
  },
  resultRow: {
    minHeight: ControlSize.settingsRow,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  resultIcon: {
    width: Space.xxl,
    height: Space.xxl,
    borderRadius: Radius.avatarSheet,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultCopy: {
    flex: 1,
    minWidth: 0,
  },
  resultTitle: {
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
    fontWeight: FontWeight.semibold,
  },
  resultSubtitle: {
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.regular,
  },
  resultTail: {
    alignItems: 'flex-end',
    gap: Space.xs,
  },
  resultTime: {
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
    fontWeight: FontWeight.regular,
    fontVariant: ['tabular-nums'],
  },
  recentText: {
    flex: 1,
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
    fontWeight: FontWeight.regular,
  },
  emptyText: {
    flex: 1,
    textAlign: 'center',
    textAlignVertical: 'center',
    paddingVertical: Space.xxl,
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.regular,
  },
  loadingList: {
    gap: Space.sm,
  },
  loadingRow: {
    minHeight: ControlSize.settingsRow,
    paddingHorizontal: Space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  loadingIcon: {
    width: Space.xxl,
    height: Space.xxl,
    borderRadius: Radius.avatarSheet,
  },
  loadingCopy: {
    flex: 1,
    gap: Space.sm,
  },
  loadingTitle: {
    width: '42%',
  },
  loadingSubtitle: {
    width: '76%',
  },
});
