import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useTranslation } from 'react-i18next';
import { Sheet } from '../ui/Sheet';
import { useAppTheme } from '../../theme';
import type { UiMessage } from '../../types/chat';
import { FontSize, FontWeight, LineHeight, Space } from '../../theme/tokens';
import { formatTurnReceipt } from './tool-activity-model';
import type { TurnWork } from './turn-work';
import { WorkEntryRow } from './WorkPanel';

// A long run outgrows the screen: scroll inside fixed detents with the
// Gorhom-integrated scroll view rather than a plain ScrollView the sheet drag steals.
const SNAP_POINTS: string[] = ['62%', '92%'];

export type WorkRecordSheetProps = Readonly<{
  visible: boolean;
  /** The finished turn a receipt or pill stands for. */
  work: TurnWork;
  onClose: () => void;
  onOpenStep: (message: UiMessage) => void;
}>;

/**
 * Everything the Agent did for one prompt (A+ chat design 2026-09-30; rows
 * shared with the live work panel since tool process design C, 2026-10-02):
 * each step, the Agent's words between steps and the approvals, in order.
 * The receipt's own sentence heads it; each step opens its full input and output.
 */
export function WorkRecordSheet({ visible, work, onClose, onOpenStep }: WorkRecordSheetProps): React.JSX.Element {
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const { colors } = theme;
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Keep the last turn while the sheet animates away.
  const shown = useRef(work);
  useEffect(() => { if (visible && work.entries.length > 0) shown.current = work; }, [visible, work]);
  const turn = visible && work.entries.length > 0 ? work : shown.current;
  const subtitle = turn.steps.length > 0 ? formatTurnReceipt(turn.steps, t) : '';
  const title = t('Work record');
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      titleContent={(
        <View style={styles.heading}>
          <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>{title}</Text>
          {subtitle ? <Text testID="work-record-subtitle" numberOfLines={1} style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
      )}
      closeAccessibilityLabel={t('Close', { ns: 'common' })}
      snapPoints={SNAP_POINTS}
      testID="work-record-sheet"
    >
      <BottomSheetScrollView testID="work-record-scroll" contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {turn.entries.map((entry) => (
          <WorkEntryRow key={`${entry.kind}:${entry.message.renderKey ?? entry.message.id}`} entry={entry} onOpenStep={onOpenStep} />
        ))}
      </BottomSheetScrollView>
    </Sheet>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    heading: { alignSelf: 'stretch', alignItems: 'center' },
    title: { color: colors.ink, fontSize: FontSize.body, lineHeight: LineHeight.body, fontWeight: FontWeight.semibold, textAlign: 'center' },
    subtitle: { color: colors.inkSecondary, fontSize: FontSize.caption, lineHeight: LineHeight.caption, textAlign: 'center' },
    content: { paddingHorizontal: Space.sm, paddingBottom: Space.xl, gap: 2 },
  });
}
