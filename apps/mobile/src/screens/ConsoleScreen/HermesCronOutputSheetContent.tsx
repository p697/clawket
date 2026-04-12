import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import { useTranslation } from 'react-i18next';
import { createChatMarkdownStyle, getChatMarkdownFlavor, openChatMarkdownLink } from '../../components/chat/chatMarkdown';
import { useAppTheme } from '../../theme';
import { FontSize, Radius, Space } from '../../theme/tokens';
import type { HermesCronOutputDetail } from '../../types/hermes-cron';
import { formatRelativeTime } from '../../utils/cron';

const CHAT_MARKDOWN_FLAVOR = getChatMarkdownFlavor();

export function HermesCronOutputSheetContent({
  output,
}: {
  output: HermesCronOutputDetail;
}): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('console');
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const markdownStyle = useMemo(() => createChatMarkdownStyle(theme.colors), [theme.colors]);

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.metaCard}>
        <Text style={styles.metaText}>
          {formatRelativeTime(output.createdAt)}  ·  {output.fileName}
        </Text>
        <Text style={styles.metaText}>
          {t('Status')}: {output.status === 'error' ? t('Failed') : t('Succeeded')}
        </Text>
      </View>

      <View style={styles.markdownWrap}>
        <EnrichedMarkdownText
          flavor={CHAT_MARKDOWN_FLAVOR}
          markdown={output.content}
          markdownStyle={markdownStyle}
          onLinkPress={openChatMarkdownLink}
          selectable
        />
      </View>
    </ScrollView>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    content: {
      paddingHorizontal: Space.lg,
      paddingTop: Space.md,
      paddingBottom: Space.xl,
      gap: Space.md,
    },
    metaCard: {
      gap: Space.xs,
    },
    metaText: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
    },
    markdownWrap: {
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: Radius.md,
      padding: Space.md,
    },
  });
}
