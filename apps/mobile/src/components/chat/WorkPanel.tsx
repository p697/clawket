import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomSheetScrollView, type BottomSheetScrollViewMethods } from '@gorhom/bottom-sheet';
import { useTranslation } from 'react-i18next';
import { useReducedMotion } from 'react-native-reanimated';
import { ArrowUp } from 'lucide-react-native';
import { useAppTheme } from '../../theme';
import { createThemedShadowStyle, FontSize, FontWeight, LineHeight, Motion, Radius, Shadow, Space } from '../../theme/tokens';
import type { UiMessage } from '../../types/chat';
import { Sheet } from '../ui/Sheet';
import { renderKeyOf, type TurnEntry, type TurnWork } from './turn-work';
import { useElapsed } from './useElapsed';
import { formatWorkDockCaption, type WorkDockPhase } from './work-dock-model';
import { useWorkingColor, WorkTimeline } from './WorkTimeline';

// A long run outgrows the screen: the same fixed detents and Gorhom scroll view as the work record.
const SNAP_POINTS: string[] = ['62%', '92%'];
/** Within this of the top the reader is at the newest step: new ones join the view. */
const TOP_SLACK = Space.xl;
const NEW_STEPS_HEIGHT = 32;

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

/** Steps that arrived above the newest step the reader had seen. */
function countNewSteps(entries: ReadonlyArray<TurnEntry>, seen: string | null): number {
  if (seen === null) return 0;
  let count = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (`${entry.kind}:${renderKeyOf(entry.message)}` === seen) return count;
    if (entry.kind === 'step') count += 1;
  }
  // The step the reader saw is gone (history replaced it): say nothing rather than guess.
  return 0;
}

/**
 * The work dock opened (tool process design C): the running turn as a
 * timeline, newest first (owner decision 2026-10-06), so a long run opens on
 * what is happening now; tapping a step opens its detail. A standard `Sheet`
 * like the work record (owner request 2026-10-02): its grabber and a downward
 * swipe, the close button, the backdrop and the system back gesture close it.
 * A step that arrives while the reader is at the top joins the view; one that
 * arrives while they read older steps keeps their place and counts on a
 * "new steps" chip that returns them to the top.
 */
export function WorkPanel({ visible, phase, work, startedAt, locale, onClose, onOpenStep }: WorkPanelProps): React.JSX.Element {
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const { colors, scheme } = theme;
  const reduceMotion = useReducedMotion();
  const elapsed = useElapsed(visible ? startedAt : undefined);
  // Keep the turn's steps while the sheet slides away after the turn ends.
  const shown = useRef(work);
  useEffect(() => { if (visible && work.entries.length > 0) shown.current = work; }, [visible, work]);
  const turn = visible && work.entries.length > 0 ? work : shown.current;
  const caption = formatWorkDockCaption({ phase, work: turn, elapsed, t });
  const scrollRef = useRef<BottomSheetScrollViewMethods>(null);
  const [reading, setReading] = useState(false);
  const readingRef = useRef(false);
  useEffect(() => {
    if (!visible) return;
    readingRef.current = false;
    setReading(false);
  }, [visible]);
  const newest = turn.entries[turn.entries.length - 1];
  const seenRef = useRef<string | null>(null);
  if (!reading) seenRef.current = newest ? `${newest.kind}:${renderKeyOf(newest.message)}` : null;
  const newSteps = reading ? countNewSteps(turn.entries, seenRef.current) : 0;
  const working = useWorkingColor();
  const chipShadow = createThemedShadowStyle(colors, scheme, Shadow.md);
  const title = t('Work so far');
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      titleContent={<WorkSheetHeading title={title} detail={caption} detailTestID="work-panel-caption" />}
      closeAccessibilityLabel={t('Close', { ns: 'common' })}
      snapPoints={SNAP_POINTS}
      testID="work-panel"
    >
      <BottomSheetScrollView
        ref={scrollRef}
        testID="work-panel-scroll"
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        // New rows land above the reader: near the top they join the view, further down the view holds still.
        maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: TOP_SLACK }}
        onScroll={({ nativeEvent }) => {
          const next = nativeEvent.contentOffset.y > TOP_SLACK;
          if (next === readingRef.current) return;
          readingRef.current = next;
          setReading(next);
        }}
      >
        <WorkTimeline work={turn} live={phase} locale={locale} onOpenStep={onOpenStep} />
      </BottomSheetScrollView>
      {newSteps > 0 ? (
        <View pointerEvents="box-none" style={styles.newStepsSlot}>
          <Pressable
            testID="work-panel-new-steps"
            accessibilityRole="button"
            onPress={() => scrollRef.current?.scrollTo({ y: 0, animated: !reduceMotion })}
            style={({ pressed }) => [styles.newSteps, chipShadow, { backgroundColor: colors.surfaceFloating }, pressed ? styles.pressed : null]}
          >
            <ArrowUp size={14} color={working} strokeWidth={2.2} />
            <Text style={[styles.newStepsLabel, { color: working }]}>
              {newSteps === 1 ? t('1 new step') : t('{{count}} new steps', { count: newSteps })}
            </Text>
          </Pressable>
        </View>
      ) : null}
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
  newStepsSlot: {
    position: 'absolute',
    top: Space.sm,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  newSteps: {
    height: NEW_STEPS_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.md,
    borderRadius: Radius.full,
  },
  newStepsLabel: {
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
    fontWeight: FontWeight.semibold,
  },
  pressed: {
    opacity: Motion.pressedOpacity,
  },
});
