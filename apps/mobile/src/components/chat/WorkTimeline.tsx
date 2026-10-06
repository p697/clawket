import React, { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated, { Easing, FadeIn, FadeOut, LinearTransition, useReducedMotion, withTiming, type EntryExitAnimationFunction } from 'react-native-reanimated';
import { Ellipsis, MessageSquare, ShieldCheck, ShieldX } from 'lucide-react-native';
import { resolveChatPresenceColors } from '../../features/chat-appearance/resolver';
import { useAppTheme } from '../../theme';
import { withAlpha } from '../../theme/color';
import { FontSize, FontWeight, LineHeight, Motion, Radius, Space } from '../../theme/tokens';
import { formatThreadClockTime } from '../../screens/Thread/timestamps';
import type { UiMessage } from '../../types/chat';
import { formatToolDisplayName, resolveQuestionExchange, resolveToolDetail, resolveToolTitle, unwrapShellCommand } from '../../utils/tool-display';
import { effectiveTool, formatActivityDuration, stepDurationMs } from './tool-activity-model';
import { useConversationTheme } from './ChatPresentation';
import { toolIcon } from './toolIcon';
import { renderKeyOf, type TurnEntry, type TurnWork } from './turn-work';
import { useElapsed } from './useElapsed';
import type { WorkDockPhase } from './work-dock-model';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The glyph well beside each step. */
const STEP_WELL = 30;
const RING = 2;
/** The well's backing: it hides the rail behind a tinted well and carries the "now" ring. */
const NODE = STEP_WELL + RING * 2;
const RAIL_LINE = 2;
/** The start and end markers of the rail. */
const END_DOT = 12;
/** The backing of the small quote glyph on the rail. */
const SAID_NODE = 18;
/** A spinner scaled into the step glyph's box. */
const STEP_SPINNER_SCALE = 0.7;
// `monospace` is a family only Android resolves; iOS falls back to the system face without Menlo.
const CODE_FONT = Platform.select({ ios: 'Menlo', default: 'monospace' });

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

function validTime(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * A row's identity. A step keeps its tool call's through the live row and the
 * history row that replaces it (`toolcall_` / `toolresult_`), so a finished
 * step never enters a second time (device check 2026-10-06).
 */
function entryKey(entry: TurnEntry): string {
  const call = entry.kind === 'step' ? /^tool(?:call|result)_(.+)$/.exec(entry.message.id)?.[1] : undefined;
  return call ? `step:${call}` : `${entry.kind}:${renderKeyOf(entry.message)}`;
}

/** When an entry happened: a step when it started, anything else when it arrived. */
function entryTime(entry: TurnEntry): number | undefined {
  return entry.kind === 'step'
    ? validTime(entry.message.toolStartedAt) ?? validTime(entry.message.timestampMs)
    : validTime(entry.message.timestampMs);
}

/** A row that arrives while the panel is open slides down into the top, like the dock's next step. */
const enterFromTop: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: -Motion.step.rise }] },
    animations: {
      opacity: withTiming(1, { duration: Motion.step.duration, easing: Easing.out(Easing.cubic) }),
      transform: [{ translateY: withTiming(0, { duration: Motion.step.duration, easing: Easing.out(Easing.cubic) }) }],
    },
  };
};
const fadeIntoTop = FadeIn.duration(Motion.step.duration);
/** Rows make way for an arrival by gliding, never by jumping a row in one frame. */
const glide = LinearTransition.duration(Motion.duration.normal).easing(Easing.out(Easing.cubic));
/** Only rows near the top can be on screen when one arrives; the rest move without work. */
const GLIDING_ROWS = 24;
/** "Thinking…" and a step that starts cross in the same place. */
const nowIn = FadeIn.duration(Motion.step.duration);
const nowOut = FadeOut.duration(Motion.duration.fast);
/** A step that stops running changes its glyph and time in a quick fade, not a swap. */
const settleIn = FadeIn.duration(Motion.duration.fast);

/**
 * One row on the rail: its node centred on a line that joins the row above
 * and below, the words, and the time on the right. The topmost row has no
 * line above it and the start of the turn none below.
 */
function RailRow({ node, top, bottom, trailing, onPress, testID, accessibilityLabel, accessibilityRole, children }: Readonly<{
  node: React.ReactNode;
  top: boolean;
  bottom: boolean;
  trailing?: React.ReactNode;
  onPress?: () => void;
  testID: string;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'text';
  children: React.ReactNode;
}>): React.JSX.Element {
  const { theme } = useAppTheme();
  const { colors } = theme;
  const content = (
    <>
      <View style={styles.rail}>
        {top ? null : <View style={[styles.lineAbove, { backgroundColor: colors.line }]} />}
        {bottom ? null : <View style={[styles.lineBelow, { backgroundColor: colors.line }]} />}
        {node}
      </View>
      <View style={styles.copy}>{children}</View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </>
  );
  if (!onPress) {
    return <View testID={testID} style={styles.row} accessibilityRole={accessibilityRole} accessibilityLabel={accessibilityLabel}>{content}</View>;
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      {content}
    </Pressable>
  );
}

/** What is happening now wears the work dock's colour, so the panel's top row matches the dock. */
export function useWorkingColor(): string {
  const conversation = useConversationTheme();
  return useMemo(() => resolveChatPresenceColors(conversation).working, [conversation]);
}

/**
 * A glyph well on an opaque backing that hides the rail behind its tint; the
 * rail runs right up to it. `ring` circles it to mark what is happening now.
 */
function Well({ backgroundColor, ring, children }: Readonly<{ backgroundColor: string; ring?: string; children: React.ReactNode }>): React.JSX.Element {
  const { theme } = useAppTheme();
  const { canvas } = theme.colors;
  const well = (
    <View style={[styles.well, { backgroundColor: canvas }]}>
      <View style={[styles.well, { backgroundColor }]}>{children}</View>
    </View>
  );
  return ring ? <View style={[styles.node, { backgroundColor: ring }]}>{well}</View> : well;
}

function TimeLines({ first, second, firstColor, secondColor }: Readonly<{
  first?: string;
  second?: string;
  firstColor: string;
  secondColor?: string;
}>): React.JSX.Element | null {
  if (!first && !second) return null;
  return (
    <>
      {first ? <Text style={[styles.time, { color: firstColor }]}>{first}</Text> : null}
      {second ? <Text style={[styles.time, { color: secondColor ?? firstColor }]}>{second}</Text> : null}
    </>
  );
}

/** A running step's own clock under "Now". */
function RunningFor({ message, color }: Readonly<{ message: UiMessage; color: string }>): React.JSX.Element | null {
  const { t } = useTranslation('chat');
  const elapsed = useElapsed(message.toolStartedAt ?? message.timestampMs);
  return elapsed !== undefined ? <Text style={[styles.time, { color }]}>{t('{{count}} s', { count: Math.floor(elapsed / 1000) })}</Text> : null;
}

/**
 * One entry of a turn's work (tool process design C): a step with its own
 * words leading — the Agent's title for it, else the tool — and the command,
 * path or query below; a failure keeps a red cross and one line of why; the
 * Agent's words between steps read as a quiet quote; an approval says what
 * the user decided. Its time is when it happened, with the step's own time
 * under it; a running step says "Now" and rings its well.
 */
function WorkEntryRow({ entry, top, running: runningNow = false, locale, onOpenStep }: Readonly<{
  entry: TurnEntry;
  top: boolean;
  /** The step runs now: only the running turn says so; a finished one never left it running. */
  running?: boolean;
  locale?: string;
  onOpenStep?: (message: UiMessage) => void;
}>): React.JSX.Element {
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const { colors } = theme;
  const working = useWorkingColor();
  // The glyph and time fade over only when the step stops or starts running while shown.
  const shownRunning = useRef(runningNow);
  const switched = shownRunning.current !== runningNow;
  useEffect(() => { shownRunning.current = runningNow; }, [runningNow]);
  const message = entry.message;
  const at = formatThreadClockTime(entryTime(entry), locale) || undefined;

  if (entry.kind === 'said') {
    return (
      <RailRow
        testID={`work-said-${message.id}`}
        top={top}
        bottom={false}
        accessibilityRole="text"
        node={(
          <View style={[styles.saidNode, { backgroundColor: colors.canvas }]}>
            <MessageSquare size={13} color={colors.inkTertiary} strokeWidth={2} />
          </View>
        )}
        trailing={<TimeLines first={at} firstColor={colors.inkTertiary} />}
      >
        <Text numberOfLines={1} style={[styles.saidText, { color: colors.inkSecondary }]}>
          {t('“{{text}}”', { text: singleLine(message.text) ?? '' })}
        </Text>
      </RailRow>
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
      <RailRow
        testID={`work-approval-${message.id}`}
        top={top}
        bottom={false}
        accessibilityLabel={[title, command, at].filter(Boolean).join(', ')}
        node={(
          <Well backgroundColor={denied ? colors.surface : colors.warnSoft}>
            <Icon size={15} color={denied ? colors.inkSecondary : colors.warn} strokeWidth={2} />
          </Well>
        )}
        trailing={<TimeLines first={at} firstColor={colors.inkTertiary} />}
      >
        <Text numberOfLines={1} style={[styles.title, { color: colors.ink }]}>{title}</Text>
        {command ? <Text numberOfLines={1} style={[styles.code, { color: colors.inkSecondary }]}>{command}</Text> : null}
      </RailRow>
    );
  }

  const tool = effectiveTool(message);
  const name = tool.name || t('Tool');
  const Icon = toolIcon(name);
  const running = runningNow;
  const unknown = !running && (message.toolStatus === 'unknown' || message.toolStatus === 'running');
  const displayName = formatToolDisplayName(name, t);
  // A question step reads as the exchange: what was asked, then the user's answer.
  const exchange = resolveQuestionExchange(name, tool.args, message.toolDetail);
  const stepTitle = exchange?.question ?? resolveToolTitle(tool.args) ?? displayName;
  const target = exchange ? (exchange.answer ? t('Your answer: {{answer}}', { answer: exchange.answer }) : undefined)
    : singleLine(resolveToolDetail(name, tool.args));
  // A failed step is an ordinary step whose status says so (owner decision 2026-10-06: no red).
  const status = message.toolStatus === 'error' ? t('Failed') : unknown ? t('Result unavailable') : undefined;
  const settle = switched ? settleIn : undefined;
  return (
    <RailRow
      testID={`thread-run-${message.id}`}
      top={top}
      bottom={false}
      accessibilityLabel={[stepTitle, stepTitle !== displayName ? displayName : undefined, target, status, running ? t('Now') : at]
        .filter(Boolean).join(', ')}
      onPress={onOpenStep ? () => onOpenStep(message) : undefined}
      node={(
        <Animated.View key={running ? 'running' : 'settled'} entering={settle}>
          <Well backgroundColor={running ? withAlpha(working, 0.12) : colors.surface} ring={running ? working : undefined}>
            {running ? <ActivityIndicator size="small" color={working} style={styles.spinner} />
              : <Icon size={15} color={colors.inkSecondary} strokeWidth={1.75} />}
          </Well>
        </Animated.View>
      )}
      trailing={(
        <Animated.View key={running ? 'running' : 'settled'} entering={settle} style={styles.trailingColumn}>
          {running ? (
            <>
              <Text style={[styles.time, styles.now, { color: working }]}>{t('Now')}</Text>
              <RunningFor message={message} color={colors.inkTertiary} />
            </>
          ) : (
            <TimeLines
              first={at}
              second={status ?? formatStepDuration(stepDurationMs(message), t)}
              firstColor={colors.inkTertiary}
            />
          )}
        </Animated.View>
      )}
    >
      <Text numberOfLines={1} style={[styles.title, { color: colors.ink }, running ? styles.titleLive : null]}>{stepTitle}</Text>
      {target ? (
        <Text numberOfLines={1} style={[exchange ? styles.answer : styles.code, { color: colors.inkSecondary }]}>{target}</Text>
      ) : null}
    </RailRow>
  );
}

/** The running turn between steps: what the dock says, ringed as now. */
function NowRow({ phase }: Readonly<{ phase: 'thinking' | 'replying' }>): React.JSX.Element {
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const { colors } = theme;
  const working = useWorkingColor();
  const title = phase === 'replying' ? t('Replying…') : t('Thinking…');
  const Icon = phase === 'replying' ? MessageSquare : Ellipsis;
  return (
    <RailRow
      testID="work-timeline-now"
      top
      bottom={false}
      accessibilityLabel={`${t('Now')}, ${title}`}
      node={(
        <Well backgroundColor={withAlpha(working, 0.12)} ring={working}>
          <Icon size={15} color={working} strokeWidth={2} />
        </Well>
      )}
      trailing={<Text style={[styles.time, styles.now, { color: working }]}>{t('Now')}</Text>}
    >
      <Text numberOfLines={1} style={[styles.title, styles.titleLive, { color: colors.ink }]}>{title}</Text>
    </RailRow>
  );
}

/** Where a finished turn ended: the top of its record. */
function EndRow({ at }: Readonly<{ at?: string }>): React.JSX.Element {
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const { colors } = theme;
  return (
    <RailRow
      testID="work-timeline-end"
      top
      bottom={false}
      accessibilityLabel={[t('Finished'), at].filter(Boolean).join(', ')}
      node={<View style={[styles.endDot, { backgroundColor: colors.inkTertiary }]} />}
      trailing={<TimeLines first={at} firstColor={colors.inkTertiary} />}
    >
      <Text numberOfLines={1} style={[styles.title, { color: colors.inkSecondary }]}>{t('Finished')}</Text>
    </RailRow>
  );
}

/** Where the turn started: the user's prompt at the bottom of the rail. */
function StartRow({ prompt, at }: Readonly<{ prompt?: UiMessage; at?: string }>): React.JSX.Element {
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const { colors } = theme;
  const asked = singleLine(prompt?.text);
  const said = asked ? t('You: “{{text}}”', { text: asked }) : undefined;
  return (
    <RailRow
      testID="work-timeline-start"
      top={false}
      bottom
      accessibilityLabel={[t('Started'), said, at].filter(Boolean).join(', ')}
      node={(
        <View style={[styles.endDot, { backgroundColor: colors.inkTertiary }]}>
          <View style={[styles.startHole, { backgroundColor: colors.canvas }]} />
        </View>
      )}
      trailing={<TimeLines first={at} firstColor={colors.inkTertiary} />}
    >
      <Text numberOfLines={1} style={[styles.title, { color: colors.inkSecondary }]}>{t('Started')}</Text>
      {said ? <Text numberOfLines={1} style={[styles.saidText, { color: colors.inkSecondary }]}>{said}</Text> : null}
    </RailRow>
  );
}

/**
 * A turn's work as a timeline, newest first (owner decision 2026-10-06): the
 * running turn starts at what is happening now — the running step ringed and
 * marked "Now", or what the dock says between steps — and a finished one at
 * where it ended; the rail runs down through every step, the Agent's words
 * and approvals, each with its time, to where the turn started. A row that
 * arrives while it is open slides down into place while the rows below glide
 * to make room (`glide`, while the reader is at the top), and "Thinking…"
 * crosses with the step that replaces it. Returns the rows as direct children
 * of the scroll view, so it can keep the reader's place.
 */
export function WorkTimeline({ work, live, glideRows = false, locale, onOpenStep }: Readonly<{
  work: TurnWork;
  /** The running turn's dock phase; without it the turn is finished. */
  live?: WorkDockPhase;
  /** Rows glide to make room for an arrival; off while the reader holds a place further down. */
  glideRows?: boolean;
  locale?: string;
  onOpenStep?: (message: UiMessage) => void;
}>): React.JSX.Element {
  const reduceMotion = useReducedMotion();
  const runsNow = (entry: TurnEntry) => Boolean(live) && entry.kind === 'step'
    && (entry.message.toolStatus === 'running' || entry.message === work.current);
  // What runs now leads, even a step that started before later ones finished
  // (device check 2026-10-06: a Codex login waiting on the browser sat mid-list).
  const newestFirst = [...work.entries].reverse();
  const entries = live ? [...newestFirst.filter(runsNow), ...newestFirst.filter((entry) => !runsNow(entry))] : newestFirst;
  // Rows there when the timeline mounted stay still; later ones enter.
  const known = useRef<Set<string> | null>(null);
  const mounted = known.current !== null;
  known.current ??= new Set(entries.map(entryKey));
  useEffect(() => {
    for (const entry of entries) known.current!.add(entryKey(entry));
  });
  const head = live && !work.current && (live.kind === 'thinking' || live.kind === 'replying') ? live.kind : null;
  const ended = live ? undefined
    : formatThreadClockTime(work.endedAt ?? (entries[0] ? entryTime(entries[0]) : undefined), locale) || undefined;
  const oldest = newestFirst[newestFirst.length - 1];
  const started = formatThreadClockTime(validTime(work.prompt?.timestampMs) ?? (oldest ? entryTime(oldest) : undefined), locale) || undefined;
  const moving = Boolean(live) && glideRows && !reduceMotion;
  const layoutAt = (index: number) => (moving && index < GLIDING_ROWS ? glide : undefined);
  return (
    <>
      {head ? (
        <Animated.View key="now" testID="work-motion-now" layout={layoutAt(0)} entering={mounted ? nowIn : undefined} exiting={live ? nowOut : undefined}>
          <NowRow phase={head} />
        </Animated.View>
      ) : null}
      {live ? null : <EndRow key="end" at={ended} />}
      {entries.map((entry, index) => {
        const key = entryKey(entry);
        const arriving = Boolean(live) && !known.current!.has(key);
        return (
          <Animated.View key={key} testID={`work-motion-${entry.message.id}`} layout={layoutAt(index + 1)} entering={arriving ? (reduceMotion ? fadeIntoTop : enterFromTop) : undefined}>
            <WorkEntryRow entry={entry} top={index === 0 && Boolean(live) && !head} running={runsNow(entry)} locale={locale} onOpenStep={onOpenStep} />
          </Animated.View>
        );
      })}
      <Animated.View key="start" testID="work-motion-start" layout={layoutAt(entries.length + 1)}>
        <StartRow prompt={work.prompt} at={started} />
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: Space.sm + 2,
    paddingHorizontal: Space.sm,
    borderRadius: Radius.settingsGroup,
  },
  pressed: {
    opacity: Motion.pressedOpacity,
  },
  rail: {
    width: NODE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineAbove: {
    position: 'absolute',
    top: 0,
    height: '50%',
    left: (NODE - RAIL_LINE) / 2,
    width: RAIL_LINE,
  },
  // Overlaps the next row by a point: rounding never opens a gap between rows.
  lineBelow: {
    position: 'absolute',
    top: '50%',
    bottom: -1,
    left: (NODE - RAIL_LINE) / 2,
    width: RAIL_LINE,
  },
  node: {
    width: NODE,
    height: NODE,
    borderRadius: NODE / 2,
    alignItems: 'center',
    justifyContent: 'center',
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
  saidNode: {
    width: SAID_NODE,
    height: SAID_NODE,
    borderRadius: SAID_NODE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  endDot: {
    width: END_DOT,
    height: END_DOT,
    borderRadius: END_DOT / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The start is the same dot, hollow.
  startHole: {
    width: END_DOT - RING * 2,
    height: END_DOT - RING * 2,
    borderRadius: (END_DOT - RING * 2) / 2,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    paddingVertical: Space.sm - 1,
  },
  trailing: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingVertical: Space.sm - 1,
  },
  trailingColumn: {
    alignItems: 'flex-end',
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
  answer: {
    fontSize: FontSize.caption,
    lineHeight: 17,
  },
  time: {
    fontSize: FontSize.meta,
    lineHeight: 17,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  now: {
    fontWeight: FontWeight.semibold,
  },
  saidText: {
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
  },
});
