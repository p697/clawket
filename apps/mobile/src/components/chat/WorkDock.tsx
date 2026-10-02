import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  ChevronUp,
  Ellipsis,
  MessageCircleQuestion,
  MessageSquare,
  ShieldAlert,
  WifiOff,
  type LucideIcon,
} from 'lucide-react-native';
import Animated, { Easing, FadeIn, FadeOut, useReducedMotion, withTiming, type EntryExitAnimationFunction } from 'react-native-reanimated';
import { useAppTheme } from '../../theme';
import { withAlpha } from '../../theme/color';
import { FontSize, FontWeight, LineHeight, Motion, Radius, Space } from '../../theme/tokens';
import { createChatGlassStyle, resolveChatPresenceColors } from '../../features/chat-appearance/resolver';
import { formatToolActivity, resolveToolTitle } from '../../utils/tool-display';
import { PresenceRing } from '../ui/PresenceRing';
import { SwapEntrance } from '../ui/SwapEntrance';
import { useConversationTheme } from './ChatPresentation';
import { describeLiveStep, effectiveTool } from './tool-activity-model';
import { toolIcon, useElapsed } from './ToolActivityPill';
import type { TurnWork } from './turn-work';
import { formatWorkDockCaption, type WorkDockPhase } from './work-dock-model';

/** Dock metrics (design C): a 52-point capsule, 36 while the keyboard is up. */
export const WORK_DOCK_HEIGHT = 52;
export const WORK_DOCK_COMPACT_HEIGHT = 36;
/** The glyph well the presence ring turns around. */
const WELL = 24;
const COMPACT_WELL = 16;
const GLYPH = 14;
const COMPACT_GLYPH = 11;
const CHEVRON = 18;
// `monospace` is a family only Android resolves; iOS falls back to the system face without Menlo.
const CODE_FONT = Platform.select({ ios: 'Menlo', default: 'monospace' });

type Translate = (key: string, options?: Record<string, unknown>) => string;

export type WorkDockProps = Readonly<{
  phase: WorkDockPhase;
  work: TurnWork;
  /** When the turn began; the dock counts from it. */
  startedAt?: number;
  /** The keyboard is up: one line, title only. */
  compact?: boolean;
  /** Glass over a wallpaper, the neutral surface over the plain canvas, like the composer. */
  appearance?: 'glass' | 'surface';
  /** Opens the work panel. */
  onExpand: () => void;
  /** Goes to the request waiting for the user (approval or question). */
  onAttend?: () => void;
  /** The second line for a question: what the Agent asks. */
  detail?: string;
  testID?: string;
}>;

function stepTitle(step: NonNullable<TurnWork['current']>, t: Translate): Readonly<{ text: string; code?: string; before?: string; after?: string }> {
  const tool = effectiveTool(step);
  // The Agent's own words for the call lead, as in the work record.
  const titled = resolveToolTitle(tool.args);
  if (titled) return { text: titled };
  const live = describeLiveStep(step, t);
  if (live) return { text: `${live.before}${live.value}${live.after}`, before: live.before, code: live.value, after: live.after };
  return { text: formatToolActivity(tool.name || t('Tool', { ns: 'chat' }), t) };
}


/**
 * The work dock (tool process design C, owner decision 2026-10-02): while an
 * Agent turn runs, one glass capsule above the composer says what it is doing
 * — the step running now, how far along, how long — so the conversation keeps
 * only what was said. Tapping it opens every step so far. A request waiting
 * for the user turns it amber and takes the user there. A failure the Agent
 * moved past is one quiet clause, never red.
 */
export function WorkDock({
  phase,
  work,
  startedAt,
  compact = false,
  appearance = 'surface',
  onExpand,
  onAttend,
  detail,
  testID = 'work-dock',
}: WorkDockProps): React.JSX.Element {
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const { colors } = theme;
  const conversation = useConversationTheme();
  const presence = useMemo(() => resolveChatPresenceColors(conversation), [conversation]);
  const chrome = useMemo(
    () => (appearance === 'glass' ? createChatGlassStyle(theme) : { backgroundColor: colors.surface }),
    [appearance, colors.surface, theme],
  );
  const reduceMotion = useReducedMotion();
  const elapsed = useElapsed(phase.kind === 'offline' ? undefined : startedAt);
  const waiting = phase.kind === 'approval' || phase.kind === 'question';

  let Icon: LucideIcon;
  let title: string;
  let titleParts: ReturnType<typeof stepTitle> | null = null;
  switch (phase.kind) {
    case 'step':
      titleParts = stepTitle(phase.step, t);
      title = titleParts.text;
      Icon = toolIcon(effectiveTool(phase.step).name);
      break;
    case 'replying':
      title = t('Replying…');
      Icon = MessageSquare;
      break;
    case 'approval':
      title = t('Waiting for your approval');
      Icon = phase.request.approval && phase.request.approval.kind !== 'pair'
        && (phase.request.approval.category ?? 'command') !== 'command' ? ShieldAlert : toolIcon('exec');
      break;
    case 'question':
      title = t('Agent needs your input');
      Icon = MessageCircleQuestion;
      break;
    case 'offline':
      title = t('Connection lost. Reconnecting…');
      Icon = WifiOff;
      break;
    default:
      title = t('Thinking…');
      Icon = Ellipsis;
  }

  const subtitle = formatWorkDockCaption({ phase, work, elapsed, detail, t });

  const ringTone = phase.kind === 'offline' ? null : waiting ? 'attention' as const : 'working' as const;
  const glyphColor = phase.kind === 'offline' ? colors.inkTertiary : waiting ? colors.warn : presence.working;
  const wellColor = phase.kind === 'offline' ? colors.surface : withAlpha(waiting ? colors.warn : presence.working, 0.12);
  const well = compact ? COMPACT_WELL : WELL;
  const height = compact ? WORK_DOCK_COMPACT_HEIGHT : WORK_DOCK_HEIGHT;
  const action = phase.kind === 'approval' ? t('Review') : phase.kind === 'question' ? t('Respond') : null;
  // The words shown when the dock rises stay still; a new step's words enter from below.
  const [titleReady, setTitleReady] = useState(false);
  useEffect(() => { setTitleReady(true); }, []);

  const titleText = (
    <Text testID={`${testID}-title`} numberOfLines={1} style={[compact ? styles.compactTitle : styles.title, { color: phase.kind === 'offline' ? colors.inkSecondary : colors.ink }]}>
      {titleParts?.code ? <>{titleParts.before}<Text style={styles.code}>{titleParts.code}</Text>{titleParts.after}</> : title}
    </Text>
  );
  return (
    <Animated.View testID={`${testID}-frame`} entering={reduceMotion ? dockFadeIn : dockRise} exiting={reduceMotion ? dockFadeOut : dockFall}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={[title, subtitle].filter(Boolean).join(', ')}
        accessibilityHint={waiting ? t('Goes to the request') : t('Shows every step so far')}
        onPress={waiting && onAttend ? onAttend : onExpand}
        style={({ pressed }) => [
          styles.dock,
          { height, borderRadius: height / 2, paddingLeft: compact ? Space.sm - 2 : Space.sm + 2 },
          chrome,
          pressed ? styles.pressed : null,
        ]}
      >
        <View style={[styles.wellSlot, { width: well + 8, height: well + 8 }]}>
          <View style={[styles.well, { width: well, height: well, borderRadius: well / 2, backgroundColor: wellColor }]}>
            <Icon size={compact ? COMPACT_GLYPH : GLYPH} color={glyphColor} strokeWidth={2} />
          </View>
          {ringTone ? (
            <PresenceRing
              testID={`${testID}-${ringTone}`}
              tone={ringTone}
              avatarSize={well}
              color={ringTone === 'working' ? presence.working : presence.attentionRing}
            />
          ) : null}
        </View>
        <View style={styles.copy}>
          <SwapEntrance swapKey={`${phase.kind}:${title}`} ready={titleReady} entering={stepRiseIn} reducedEntering={stepFadeIn}
            testID={`${testID}-title-motion`}>
            {titleText}
          </SwapEntrance>
          {!compact && subtitle ? (
            <Text testID={`${testID}-subtitle`} numberOfLines={1} style={[styles.subtitle, { color: colors.inkSecondary }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {action ? (
          <View style={[styles.action, { backgroundColor: colors.warnSoft }]}>
            <Text style={[styles.actionLabel, { color: presence.attentionText }]} numberOfLines={1}>{action}</Text>
          </View>
        ) : (
          <ChevronUp size={compact ? GLYPH : CHEVRON} color={colors.inkTertiary} strokeWidth={2} />
        )}
      </Pressable>
    </Animated.View>
  );
}

const RISE = Space.md;
const dockRise: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: RISE }] },
    animations: {
      opacity: withTiming(1, { duration: Motion.duration.normal, easing: Easing.out(Easing.cubic) }),
      transform: [{ translateY: withTiming(0, { duration: Motion.duration.normal, easing: Easing.out(Easing.cubic) }) }],
    },
  };
};
const dockFall: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }] },
    animations: {
      opacity: withTiming(0, { duration: Motion.duration.normal, easing: Easing.in(Easing.cubic) }),
      transform: [{ translateY: withTiming(RISE, { duration: Motion.duration.normal, easing: Easing.in(Easing.cubic) }) }],
    },
  };
};
const stepRiseIn: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: Motion.step.rise }] },
    animations: {
      opacity: withTiming(1, { duration: Motion.step.duration, easing: Easing.out(Easing.cubic) }),
      transform: [{ translateY: withTiming(0, { duration: Motion.step.duration, easing: Easing.out(Easing.cubic) }) }],
    },
  };
};
const stepFadeIn = FadeIn.duration(Motion.step.duration);
/** Reduced motion: the dock only fades. */
const dockFadeIn = FadeIn.duration(Motion.duration.normal);
const dockFadeOut = FadeOut.duration(Motion.duration.normal);

const styles = StyleSheet.create({
  dock: {
    marginHorizontal: Space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm + 2,
    paddingRight: Space.lg - 2,
  },
  pressed: {
    opacity: Motion.pressedOpacity,
  },
  wellSlot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  well: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  title: {
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.semibold,
  },
  compactTitle: {
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
    fontWeight: FontWeight.semibold,
  },
  code: {
    fontFamily: CODE_FONT,
    fontSize: FontSize.caption,
  },
  subtitle: {
    fontSize: FontSize.meta,
    lineHeight: LineHeight.meta,
    fontVariant: ['tabular-nums'],
  },
  action: {
    height: 28,
    paddingHorizontal: Space.sm + 2,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
    fontWeight: FontWeight.semibold,
  },
});
