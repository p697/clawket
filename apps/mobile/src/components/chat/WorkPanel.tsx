import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, LineHeight, Space } from '../../theme/tokens';
import type { UiMessage } from '../../types/chat';
import { Sheet } from '../ui/Sheet';
import type { TurnWork } from './turn-work';
import { useElapsed } from './useElapsed';
import { formatWorkDockCaption, type WorkDockPhase } from './work-dock-model';
import { WorkTimeline } from './WorkTimeline';

// A long run outgrows the screen: the same fixed detents and Gorhom scroll view as the work record.
const SNAP_POINTS: string[] = ['62%', '92%'];
/** Within this of the top the reader is at the newest step: new ones join the view. */
const TOP_SLACK = Space.xl;

/** The title block both work sheets share: the title and one centred grey line under it. */
export function WorkSheetHeading({ title, detail, detailTestID }: Readonly<{
  title: string;
  detail?: string;
  detailTestID?: string;
}>): React.JSX.Element {
  const { theme } = useAppTheme();
  const { colors } = theme;
  return (
    <View style={styles.heading}>
      <Text accessibilityRole="header" numberOfLines={1} style={[styles.headingTitle, { color: colors.ink }]}>{title}</Text>
      {detail ? <Text testID={detailTestID} numberOfLines={1} style={[styles.headingDetail, { color: colors.inkSecondary }]}>{detail}</Text> : null}
    </View>
  );
}

export type WorkPanelProps = Readonly<{
  visible: boolean;
  phase: WorkDockPhase;
  work: TurnWork;
  /** When the turn began, for the caption's clock. */
  startedAt?: number;
  /** The conversation's locale, for each row's clock. */
  locale?: string;
  onClose: () => void;
  onOpenStep: (message: UiMessage) => void;
}>;

/**
 * The work dock opened (tool process design C): the running turn as a
 * timeline, newest first (owner decision 2026-10-06), so a long run opens on
 * what is happening now; tapping a step opens its detail. A standard `Sheet`
 * like the work record (owner request 2026-10-02): its grabber and a downward
 * swipe, the close button, the backdrop and the system back gesture close it.
 * At the top an arriving step slides in while the rows below glide down;
 * further down the reader's place holds still (owner decision 2026-10-06: no
 * "new steps" chip, the caption already counts the steps).
 */
export function WorkPanel({ visible, phase, work, startedAt, locale, onClose, onOpenStep }: WorkPanelProps): React.JSX.Element {
  const { t } = useTranslation('chat');
  const elapsed = useElapsed(visible ? startedAt : undefined);
  // Keep the turn as it was while the sheet slides away after the turn ends:
  // its steps, what it was doing and its caption, never a late "Thinking…".
  const live = visible && work.entries.length > 0;
  const shown = useRef({ work, phase, caption: '' });
  const caption = live ? formatWorkDockCaption({ phase, work, elapsed, t }) : shown.current.caption;
  useEffect(() => { if (live) shown.current = { work, phase, caption }; }, [live, work, phase, caption]);
  const turn = live ? work : shown.current.work;
  const turnPhase = live ? phase : shown.current.phase;
  const [reading, setReading] = useState(false);
  const readingRef = useRef(false);
  useEffect(() => {
    if (!visible) return;
    readingRef.current = false;
    setReading(false);
  }, [visible]);
  const title = t('Work so far');
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      titleContent={<WorkSheetHeading title={title} detail={caption || undefined} detailTestID="work-panel-caption" />}
      closeAccessibilityLabel={t('Close', { ns: 'common' })}
      snapPoints={SNAP_POINTS}
      testID="work-panel"
    >
      <BottomSheetScrollView
        testID="work-panel-scroll"
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        // At the top new rows push the rest down (they glide); further down
        // the view holds the reader's rows still while rows land above them.
        maintainVisibleContentPosition={reading ? { minIndexForVisible: 0 } : undefined}
        onScroll={({ nativeEvent }) => {
          const next = nativeEvent.contentOffset.y > TOP_SLACK;
          if (next === readingRef.current) return;
          readingRef.current = next;
          setReading(next);
        }}
      >
        <WorkTimeline work={turn} live={turnPhase} glideRows={!reading} locale={locale} onOpenStep={onOpenStep} />
      </BottomSheetScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  heading: {
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  headingTitle: {
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
    fontWeight: FontWeight.semibold,
    textAlign: 'center',
  },
  headingDetail: {
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  // The work record's body insets; rows on the rail sit flush so the line stays unbroken.
  list: {
    paddingHorizontal: Space.sm,
    paddingBottom: Space.xl,
  },
});
