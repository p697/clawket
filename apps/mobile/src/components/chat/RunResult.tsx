import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import { FontSize, LineHeight, Space } from '../../theme/tokens';

/**
 * A real execution summary, including runs that do not own a child conversation.
 * `presentation="sheet"` renders inside a fixed-detent `Sheet` through the
 * Gorhom-integrated scroll view (a plain ScrollView hands its drags to the
 * sheet) with the sheet body insets; the page keeps the plain scroll view.
 */
export function RunResult({ summary, statusLabel, presentation = 'page' }: {
  summary?: string;
  statusLabel: string;
  presentation?: 'page' | 'sheet';
}) {
  const { theme } = useAppTheme();
  const { t } = useTranslation('chat');
  const Scroll = presentation === 'sheet' ? BottomSheetScrollView : ScrollView;
  return <Scroll
    testID={presentation === 'sheet' ? 'run-result-scroll' : undefined}
    contentContainerStyle={presentation === 'sheet' ? styles.sheetContent : styles.content}
  >
    <Text style={[styles.status, { color: theme.colors.inkSecondary }]}>{statusLabel}</Text>
    <Text selectable style={[styles.body, { color: theme.colors.ink }]}>
      {summary?.trim() === 'NO_REPLY' ? t('Completed without a text reply.') : summary || t('No execution summary was recorded.')}
    </Text>
  </Scroll>;
}
const styles = StyleSheet.create({
  content: { padding: Space.lg, gap: Space.md },
  // Sheet bodies carry horizontal and bottom insets only; SheetHeader owns the air above.
  sheetContent: { paddingHorizontal: Space.xl, paddingBottom: Space.xxl, gap: Space.md },
  status: { fontSize: FontSize.caption, lineHeight: LineHeight.caption },
  body: { fontSize: FontSize.body, lineHeight: LineHeight.body },
});
