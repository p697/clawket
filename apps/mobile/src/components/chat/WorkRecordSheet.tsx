import React, { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useTranslation } from 'react-i18next';
import { Sheet } from '../ui/Sheet';
import type { UiMessage } from '../../types/chat';
import { Space } from '../../theme/tokens';
import { formatTurnReceipt } from './tool-activity-model';
import type { TurnWork } from './turn-work';
import { WorkSheetHeading } from './WorkPanel';
import { WorkTimeline } from './WorkTimeline';

// A long run outgrows the screen: scroll inside fixed detents with the
// Gorhom-integrated scroll view rather than a plain ScrollView the sheet drag steals.
const SNAP_POINTS: string[] = ['62%', '92%'];

export type WorkRecordSheetProps = Readonly<{
  visible: boolean;
  /** The finished turn a receipt or pill stands for. */
  work: TurnWork;
  /** The conversation's locale, for each row's clock. */
  locale?: string;
  onClose: () => void;
  onOpenStep: (message: UiMessage) => void;
}>;

/**
 * Everything the Agent did for one prompt (A+ chat design 2026-09-30; rows
 * shared with the live work panel since tool process design C, 2026-10-02):
 * each step, the Agent's words between steps and the approvals, on the same
 * newest-first timeline as the work panel, from where the turn ended down to
 * where it started (owner decision 2026-10-06). The receipt's own sentence
 * heads it; each step opens its full input and output.
 */
export function WorkRecordSheet({ visible, work, locale, onClose, onOpenStep }: WorkRecordSheetProps): React.JSX.Element {
  const { t } = useTranslation('chat');
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
      titleContent={<WorkSheetHeading title={title} detail={subtitle} detailTestID="work-record-subtitle" />}
      closeAccessibilityLabel={t('Close', { ns: 'common' })}
      snapPoints={SNAP_POINTS}
      testID="work-record-sheet"
    >
      <BottomSheetScrollView testID="work-record-scroll" contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <WorkTimeline work={turn} locale={locale} onOpenStep={onOpenStep} />
      </BottomSheetScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  // Rows on the rail sit flush so the line stays unbroken.
  content: { paddingHorizontal: Space.sm, paddingBottom: Space.xl },
});
