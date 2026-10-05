import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BottomSheetScrollView, type BottomSheetScrollViewMethods } from '@gorhom/bottom-sheet';
import { useTranslation } from 'react-i18next';
import { MessageSquare, ShieldCheck, ShieldX, X } from 'lucide-react-native';
import { useAppTheme } from '../../theme';
import { withAlpha } from '../../theme/color';
import { FontSize, FontWeight, LineHeight, Motion, Radius, Space } from '../../theme/tokens';
import type { UiMessage } from '../../types/chat';
import { formatToolDisplayName, resolveQuestionExchange, resolveToolDetail, resolveToolTitle, unwrapShellCommand } from '../../utils/tool-display';
import { effectiveTool, failureReason, formatActivityDuration, stepDurationMs } from './tool-activity-model';
import { Sheet } from '../ui/Sheet';
import { toolIcon } from './toolIcon';
import { useElapsed } from './useElapsed';
import type { TurnWork } from './turn-work';
import type { TurnEntry } from './turn-work';
import { formatWorkDockCaption, type WorkDockPhase } from './work-dock-model';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The glyph well beside each step. */
const STEP_WELL = 30;
/** A spinner scaled into the step glyph's box. */
const STEP_SPINNER_SCALE = 0.7;
// A long run outgrows the screen: the same fixed detents and Gorhom scroll view as the work record.
const SNAP_POINTS: string[] = ['62%', '92%'];
// `monospace` is a family only Android resolves; iOS falls back to the system face without Menlo.
const CODE_FONT = Platform.select({ ios: 'Menlo', default: 'monospace' });

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

/** A step's own time: tenths under a second (a read is often 0.2 s), whole seconds above. */
export function formatStepDuration(ms: number | undefined, t: Translate): string | undefined {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return undefined;
  if (ms < 1000) return t('{{count}} s', { ns: 'chat', count: Math.max(0.1, Math.round(ms / 100) / 10) });
  return formatActivityDuration(ms, t);
}

function singleLine(value: string | undefined): string | undefined {
  const line = value?.replace(/\s+/g, ' ').trim();
  return line || undefined;
}

function StepTime({ message, color }: Readonly<{ message: UiMessage; color: string }>): React.JSX.Element | null {
  const { t } = useTranslation('chat');
  const running = message.toolStatus === 'running';
  const elapsed = useElapsed(running ? message.toolStartedAt ?? message.timestampMs : undefined);
  const time = running
    ? (elapsed !== undefined ? t('{{count}} s', { count: Math.floor(elapsed / 1000) }) : undefined)
    : formatStepDuration(stepDurationMs(message), t);
  return time ? <Text style={[styles.time, { color }]}>{time}</Text> : null;
}

/**
 * One entry of a turn's work (tool process design C): a step with its own
 * words leading — the Agent's title for it, else the tool — and the command,
 * path or query below; a failure keeps a red cross and one line of why; the
 * Agent's words between steps read as a quiet quote; an approval says what
 * the user decided. Shared by the live work panel and the work record.
 */
export function WorkEntryRow({ entry, onOpenStep, testID }: Readonly<{
  entry: TurnEntry;
  onOpenStep?: (message: UiMessage) => void;
  testID?: string;
}>): React.JSX.Element {
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const { colors } = theme;
  const message = entry.message;

  if (entry.kind === 'said') {
    return (
      <View testID={testID ?? `work-said-${message.id}`} style={styles.said} accessibilityRole="text">
        <MessageSquare size={13} color={colors.inkTertiary} strokeWidth={2} />
        <Text numberOfLines={1} style={[styles.saidText, { color: colors.inkSecondary }]}>
          {t('“{{text}}”', { text: singleLine(message.text) ?? '' })}
        </Text>
      </View>
    );
  }

  if (entry.kind === 'approval') {
    const approval = message.approval;
    const command = approval && approval.kind !== 'pair' ? singleLine(unwrapShellCommand(approval.command.trim())) : undefined;
    const status = approval?.status ?? 'pending';
    const denied = status === 'denied' || status === 'expired';
    const title = status === 'allowed' ? t('You allowed it')
      : status === 'denied' ? t('You declined it')
        : status === 'expired' ? t('The request expired') : t('Waiting for your approval');
    const Icon = denied ? ShieldX : ShieldCheck;
    return (
      <View testID={testID ?? `work-approval-${message.id}`} style={styles.row} accessibilityLabel={[title, command].filter(Boolean).join(', ')}>
        <View style={[styles.well, { backgroundColor: denied ? colors.surface : colors.warnSoft }]}>
          <Icon size={15} color={denied ? colors.inkSecondary : colors.warn} strokeWidth={2} />
        </View>
        <View style={styles.copy}>
          <Text numberOfLines={1} style={[styles.title, { color: colors.ink }]}>{title}</Text>
          {command ? <Text numberOfLines={1} style={[styles.code, { color: colors.inkSecondary }]}>{command}</Text> : null}
        </View>
      </View>
    );
  }

  const tool = effectiveTool(message);
  const name = tool.name || t('Tool');
  const Icon = toolIcon(name);
  const failed = message.toolStatus === 'error';
  const running = message.toolStatus === 'running';
  const displayName = formatToolDisplayName(name, t);
  // A question step reads as the exchange: what was asked, then the user's answer.
  const exchange = resolveQuestionExchange(name, tool.args, message.toolDetail);
  const stepTitle = exchange?.question ?? resolveToolTitle(tool.args) ?? displayName;
  const target = exchange ? (exchange.answer ? t('Your answer: {{answer}}', { answer: exchange.answer }) : undefined)
    : singleLine(resolveToolDetail(name, tool.args));
  const reason = failed ? failureReason(message.toolDetail) : undefined;
  const status = failed ? t('Failed') : message.toolStatus === 'unknown' ? t('Result unavailable') : undefined;
  return (
    <Pressable
      testID={testID ?? `thread-run-${message.id}`}
      accessibilityRole="button"
      accessibilityLabel={[stepTitle, stepTitle !== displayName ? displayName : undefined, target, reason, status].filter(Boolean).join(', ')}
      disabled={!onOpenStep}
      onPress={() => onOpenStep?.(message)}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      <View style={[styles.well, {
        backgroundColor: failed ? colors.badSoft : running ? withAlpha(colors.accent, 0.12) : colors.surface,
      }]}>
        {running ? <ActivityIndicator size="small" color={colors.accent} style={styles.spinner} />
          : failed ? <X size={15} color={colors.bad} strokeWidth={2.4} />
            : <Icon size={15} color={colors.inkSecondary} strokeWidth={1.75} />}
      </View>
      <View style={styles.copy}>
        <Text numberOfLines={1} style={[styles.title, { color: colors.ink }, running ? styles.titleLive : null]}>{stepTitle}</Text>
        {reason ? (
          <Text numberOfLines={1} style={[styles.reason, { color: colors.bad }]}>{reason}</Text>
        ) : target ? (
          <Text numberOfLines={1} style={[exchange ? styles.answer : styles.code, { color: colors.inkSecondary }]}>{target}</Text>
        ) : null}
      </View>
      {failed || message.toolStatus === 'unknown' ? (
        <Text style={[styles.time, { color: failed ? colors.bad : colors.inkTertiary }]}>{status}</Text>
      ) : (
        <StepTime message={message} color={running ? colors.accent : colors.inkTertiary} />
      )}
    </Pressable>
  );
}

export type WorkPanelProps = Readonly<{
  visible: boolean;
  phase: WorkDockPhase;
  work: TurnWork;
  /** When the turn began, for the caption's clock. */
  startedAt?: number;
  onClose: () => void;
  onOpenStep: (message: UiMessage) => void;
}>;

/**
 * The work dock opened (tool process design C): every step of the running
 * turn in order, newest in view as steps arrive; tapping a step opens its
 * detail. A standard `Sheet` like the work record (owner request
 * 2026-10-02): its grabber and a downward swipe, the close button, the
 * backdrop and the system back gesture close it — the former in-tree card's
 * "Done ⌄" pill read as a picker.
 */
export function WorkPanel({ visible, phase, work, startedAt, onClose, onOpenStep }: WorkPanelProps): React.JSX.Element {
  const { t } = useTranslation('chat');
  const elapsed = useElapsed(visible ? startedAt : undefined);
  // Keep the turn's steps while the sheet slides away after the turn ends.
  const shown = useRef(work);
  useEffect(() => { if (visible && work.entries.length > 0) shown.current = work; }, [visible, work]);
  const turn = visible && work.entries.length > 0 ? work : shown.current;
  const caption = formatWorkDockCaption({ phase, work: turn, elapsed, t });
  const scrollRef = useRef<BottomSheetScrollViewMethods>(null);
  const atEndRef = useRef(true);
  useEffect(() => { if (visible) atEndRef.current = true; }, [visible]);
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
        onScroll={({ nativeEvent }) => {
          atEndRef.current = nativeEvent.contentOffset.y + nativeEvent.layoutMeasurement.height >= nativeEvent.contentSize.height - Space.lg;
        }}
        // The newest step stays in view as steps arrive, unless the reader scrolled back.
        onContentSizeChange={() => { if (atEndRef.current) scrollRef.current?.scrollToEnd({ animated: false }); }}
      >
        {turn.entries.map((entry) => (
          <WorkEntryRow key={`${entry.kind}:${entry.message.renderKey ?? entry.message.id}`} entry={entry} onOpenStep={onOpenStep} />
        ))}
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
  // The work record's body insets.
  list: {
    paddingHorizontal: Space.sm,
    paddingBottom: Space.xl,
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm + 2,
    paddingVertical: Space.sm - 1,
    paddingHorizontal: Space.sm,
    borderRadius: Radius.settingsGroup,
  },
  pressed: {
    opacity: Motion.pressedOpacity,
  },
  well: {
    width: STEP_WELL,
    height: STEP_WELL,
    borderRadius: STEP_WELL / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    transform: [{ scale: STEP_SPINNER_SCALE }],
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
  },
  titleLive: {
    fontWeight: FontWeight.semibold,
  },
  code: {
    fontFamily: CODE_FONT,
    fontSize: FontSize.meta,
    lineHeight: 17,
  },
  reason: {
    fontSize: FontSize.caption,
    lineHeight: 17,
  },
  answer: {
    fontSize: FontSize.caption,
    lineHeight: 17,
  },
  time: {
    fontSize: FontSize.meta,
    lineHeight: LineHeight.secondary,
    fontVariant: ['tabular-nums'],
  },
  said: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingVertical: Space.xs + 1,
    paddingLeft: Space.lg,
    paddingRight: Space.sm,
  },
  saidText: {
    flex: 1,
    minWidth: 0,
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
  },
});
