import React, { useEffect, useMemo, useState } from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import * as Clipboard from 'expo-clipboard';
import { Check, ChevronRight, Copy, Download, ExternalLink } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Card, LoadingState, createCardContentStyle } from '../../components/ui';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import {
  createChatMarkdownStyle,
  getChatMarkdownFlavor,
  openChatMarkdownLink,
} from '../../components/chat/chatMarkdown';
import { fetchDiscoverSkillDetail, fetchRelatedDiscoverSkills } from '../../features/discover';
import { resolveSourceLabel } from '../../features/discover/helpers';
import type { DiscoverSkillDetail, DiscoverSkillItem } from '../../features/discover/types';
import { DiscoverSkillRow } from './components/DiscoverSkillCard';
import { dismissDiscoverFlowForChat } from './discover-navigation';
import { useAppContext } from '../../contexts/AppContext';
import { analyticsEvents } from '../../services/analytics/events';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import type { DiscoverStackParamList } from './sharedNavigator';

type DetailNavigation = NativeStackNavigationProp<DiscoverStackParamList, 'DiscoverDetail'>;
type DetailRouteProps = NativeStackScreenProps<DiscoverStackParamList, 'DiscoverDetail'>['route'];
const CHAT_MARKDOWN_FLAVOR = getChatMarkdownFlavor();

export function DiscoverDetailScreen(): React.JSX.Element {
  const navigation = useNavigation<DetailNavigation>();
  const route = useRoute<DetailRouteProps>();
  const { item } = route.params;
  const { theme } = useAppTheme();
  const { requestChatWithInput } = useAppContext();
  const { t } = useTranslation('common');
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<DiscoverSkillDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [related, setRelated] = useState<DiscoverSkillItem[] | null>(null);

  const markdownStyle = useMemo(() => createChatMarkdownStyle(theme.colors), [theme]);
  const stylesMemo = useMemo(() => createStyles(theme.colors), [theme]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchDiscoverSkillDetail(item.source, item.source === 'skills_sh' ? item.slug : item.slug, item)
      .then((next) => {
        if (!cancelled) {
          setDetail(next);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load detail');
          setDetail(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [item]);

  useEffect(() => {
    let cancelled = false;
    setRelated(null);
    fetchRelatedDiscoverSkills(item)
      .then((next) => { if (!cancelled) setRelated(next); })
      .catch(() => { if (!cancelled) setRelated([]); });
    return () => { cancelled = true; };
  }, [item]);

  const openRelated = (next: DiscoverSkillItem) => {
    analyticsEvents.discoverSkillOpened({ source: next.source, location: 'detail' });
    navigation.push('DiscoverDetail', { item: next });
  };

  const resolved = detail ?? {
    ...item,
    markdown: null,
    externalUrl: item.detailUrl,
    installPrompt: item.installCommand ?? item.title,
    metadata: [],
  };

  const handleInstall = () => {
    analyticsEvents.discoverInstallTapped({
      source: resolved.source,
      location: 'detail',
    });
    dismissDiscoverFlowForChat(navigation);
    setTimeout(() => requestChatWithInput(resolved.installPrompt), 50);
  };

  const handleOpenExternal = () => {
    analyticsEvents.discoverExternalOpened({
      source: resolved.source,
    });
    void Linking.openURL(resolved.externalUrl);
  };

  const handleMetadataPress = (entry: DiscoverSkillDetail['metadata'][number]) => {
    if (!entry.url) return;
    void Linking.openURL(entry.url);
  };

  const handleCopyCommand = async () => {
    if (!resolved.installCommand) return;
    await Clipboard.setStringAsync(resolved.installCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  useNativeStackModalHeader({
    navigation,
    title: resolved.title,
    onClose: () => navigation.goBack(),
  });

  if (loading && !detail && !error) {
    return <LoadingState message={t('Loading discover detail...')} />;
  }

  return (
    <View style={[stylesMemo.root, { backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={createCardContentStyle({ top: Space.md, bottom: Space.xxxl })}>
        <Card style={stylesMemo.heroCard}>
          <View style={stylesMemo.topMeta}>
            <View style={stylesMemo.sourceChip}>
              <Text style={stylesMemo.sourceChipText}>{resolveSourceLabel(resolved.source)}</Text>
            </View>
            <Text style={[stylesMemo.author, { color: theme.colors.textMuted }]}>{resolved.author}</Text>
          </View>

          <Text style={[stylesMemo.heroTitle, { color: theme.colors.text }]}>{resolved.title}</Text>
          <Text style={[stylesMemo.heroSummary, { color: theme.colors.textMuted }]}>{resolved.summary}</Text>

          <DetailStatsRow detail={resolved} />

          <View style={stylesMemo.actionRow}>
            <TouchableOpacity style={stylesMemo.primaryCta} onPress={handleInstall} activeOpacity={0.8}>
              <Download size={16} color={theme.colors.primaryText} strokeWidth={2.2} />
              <Text style={stylesMemo.primaryCtaText}>{t('Install via Chat')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={stylesMemo.secondaryCta} onPress={handleOpenExternal} activeOpacity={0.8}>
              <ExternalLink size={16} color={theme.colors.text} strokeWidth={2} />
              <Text style={[stylesMemo.secondaryCtaText, { color: theme.colors.text }]}>{t('Open source page')}</Text>
            </TouchableOpacity>
          </View>

          {resolved.installCommand ? (
            <View style={stylesMemo.commandWrap}>
              <Text style={stylesMemo.commandText} numberOfLines={2}>{resolved.installCommand}</Text>
              <TouchableOpacity
                onPress={handleCopyCommand}
                activeOpacity={0.7}
                hitSlop={8}
                style={stylesMemo.commandCopyButton}
              >
                {copied
                  ? <Check size={16} color={theme.colors.primary} strokeWidth={2.4} />
                  : <Copy size={16} color={theme.colors.textMuted} strokeWidth={2} />}
              </TouchableOpacity>
            </View>
          ) : null}
        </Card>

        {resolved.metadata.length > 0 ? (
          <Card style={stylesMemo.metaCard}>
            <Text style={[stylesMemo.sectionTitle, { color: theme.colors.text }]}>{t('Metadata')}</Text>
            <View style={stylesMemo.metaGrid}>
              {resolved.metadata.map((entry) => (
                <TouchableOpacity
                  key={`${entry.key}:${entry.value}`}
                  style={stylesMemo.metaPill}
                  activeOpacity={entry.url ? 0.75 : 1}
                  disabled={!entry.url}
                  onPress={() => handleMetadataPress(entry)}
                >
                  <Text style={[stylesMemo.metaKey, { color: theme.colors.textMuted }]}>{entry.key}</Text>
                  <View style={stylesMemo.metaValueRow}>
                    <Text style={[stylesMemo.metaValue, { color: theme.colors.text }]} numberOfLines={2}>
                      {entry.value}
                    </Text>
                    {entry.url ? (
                      <ChevronRight size={16} color={theme.colors.textMuted} strokeWidth={2} />
                    ) : null}
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </Card>
        ) : null}

        {resolved.markdown ? (
          <Card style={stylesMemo.markdownCard}>
            <Text style={[stylesMemo.sectionTitle, { color: theme.colors.text }]}>{t('Skill notes')}</Text>
            <EnrichedMarkdownText
              flavor={CHAT_MARKDOWN_FLAVOR}
              markdown={resolved.markdown}
              markdownStyle={markdownStyle}
              onLinkPress={openChatMarkdownLink}
            />
          </Card>
        ) : (
          <Card style={stylesMemo.summaryCard}>
            <Text style={[stylesMemo.sectionTitle, { color: theme.colors.text }]}>{t('Summary')}</Text>
            <Text style={[stylesMemo.summaryBody, { color: theme.colors.text }]}>{resolved.summary}</Text>
          </Card>
        )}

        {related && related.length > 0 ? (
          <View style={stylesMemo.relatedSection}>
            <Text style={[stylesMemo.sectionTitle, { color: theme.colors.text }]}>{t('You might also like')}</Text>
            <View style={stylesMemo.relatedList}>
              {related.map((next) => (
                <DiscoverSkillRow key={next.id} item={next} onPress={() => openRelated(next)} />
              ))}
            </View>
          </View>
        ) : null}

        {error ? (
          <Card style={stylesMemo.errorCard}>
            <Text style={[stylesMemo.errorTitle, { color: theme.colors.error }]}>{t('Detail load failed')}</Text>
            <Text style={[stylesMemo.summaryBody, { color: theme.colors.textMuted }]}>{error}</Text>
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}

function formatStatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

function DetailStatsRow({ detail }: { detail: DiscoverSkillDetail }): React.JSX.Element | null {
  const { theme } = useAppTheme();
  const { t } = useTranslation('common');
  const styles = useMemo(() => createStatsStyles(theme.colors), [theme]);

  const stats: { label: string; value: string }[] = [];
  if (detail.installs != null) {
    stats.push({ label: t('Installs'), value: formatStatNumber(detail.installs) });
  }
  if (detail.stars != null) {
    stats.push({ label: t('Stars'), value: formatStatNumber(detail.stars) });
  }
  if (detail.downloads != null) {
    stats.push({ label: t('Downloads'), value: formatStatNumber(detail.downloads) });
  }
  if (stats.length === 0) return null;

  return (
    <View style={styles.row}>
      {stats.map((stat, idx) => (
        <React.Fragment key={stat.label}>
          {idx > 0 ? <View style={styles.divider} /> : null}
          <View style={styles.cell}>
            <Text style={[styles.value, { color: theme.colors.text }]}>{stat.value}</Text>
            <Text style={[styles.label, { color: theme.colors.textMuted }]}>{stat.label}</Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

function createStatsStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'stretch',
      backgroundColor: colors.surfaceMuted,
      borderRadius: Radius.md,
      paddingVertical: Space.md,
      marginBottom: Space.lg,
    },
    cell: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    divider: {
      width: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
    },
    value: {
      fontSize: FontSize.xl,
      fontWeight: FontWeight.bold,
      letterSpacing: -0.3,
    },
    label: {
      marginTop: 2,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.medium,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
  });
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: {
      flex: 1,
    },
    topMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: Space.sm,
      marginBottom: Space.lg,
    },
    heroCard: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      marginBottom: Space.md,
      paddingVertical: Space.xl,
    },
    sourceChip: {
      borderRadius: Radius.full,
      paddingHorizontal: Space.sm,
      paddingVertical: 6,
      backgroundColor: colors.surfaceMuted,
    },
    sourceChipText: {
      color: colors.primary,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
    author: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
    },
    heroTitle: {
      fontSize: FontSize.xxl,
      fontWeight: FontWeight.bold,
      marginBottom: Space.md,
      letterSpacing: -0.4,
    },
    heroSummary: {
      fontSize: FontSize.base,
      lineHeight: 24,
      marginBottom: Space.lg,
    },
    summaryCard: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      marginBottom: Space.md,
    },
    metaCard: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      marginBottom: Space.md,
    },
    markdownCard: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      marginBottom: Space.md,
    },
    errorCard: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      marginBottom: Space.md,
    },
    sectionTitle: {
      fontSize: FontSize.lg,
      fontWeight: FontWeight.semibold,
      marginBottom: Space.sm,
    },
    summaryBody: {
      fontSize: FontSize.base,
      lineHeight: 22,
    },
    commandWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
      borderRadius: Radius.sm,
      paddingVertical: Space.md,
      paddingLeft: Space.md,
      paddingRight: Space.sm,
      backgroundColor: colors.surfaceMuted,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    commandText: {
      flex: 1,
      color: colors.text,
      fontSize: FontSize.md,
      fontWeight: FontWeight.medium,
    },
    commandCopyButton: {
      width: 32,
      height: 32,
      borderRadius: Radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Space.sm,
      marginBottom: Space.lg,
    },
    primaryCta: {
      borderRadius: Radius.md,
      paddingVertical: 11,
      paddingHorizontal: Space.lg,
      backgroundColor: colors.primary,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Space.sm,
      minHeight: 46,
      flexGrow: 1,
    },
    primaryCtaText: {
      color: colors.primaryText,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    secondaryCta: {
      borderRadius: Radius.md,
      paddingVertical: 11,
      paddingHorizontal: Space.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Space.sm,
      backgroundColor: colors.surface,
      minHeight: 46,
      flexGrow: 1,
    },
    secondaryCtaText: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.medium,
    },
    metaGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Space.sm,
    },
    metaPill: {
      minWidth: '47%',
      flexGrow: 1,
      borderRadius: Radius.md,
      padding: Space.md,
      backgroundColor: colors.surfaceMuted,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    metaKey: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
      textTransform: 'uppercase',
    },
    metaValueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.sm,
    },
    metaValue: {
      fontSize: FontSize.base,
      lineHeight: 21,
      flex: 1,
    },
    errorTitle: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      marginBottom: Space.xs,
    },
    relatedSection: {
      marginBottom: Space.md,
    },
    relatedList: {
      gap: Space.sm,
    },
  });
}
