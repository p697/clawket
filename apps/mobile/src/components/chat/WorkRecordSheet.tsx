import React, { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useTranslation } from 'react-i18next';
import { Sheet } from '../ui/Sheet';
import { useAppTheme } from '../../theme';
import type { UiMessage } from '../../types/chat';
import { FontSize, FontWeight, IconSize, LineHeight, Motion, Radius, Space } from '../../theme/tokens';
import { formatToolDisplayName, resolveToolDetail } from '../../utils/tool-display';
import { effectiveTool, formatActivityDuration, toolActivityDuration } from './tool-activity-model';
import { toolIcon } from './ToolActivityPill';

// A long run outgrows the screen: scroll inside fixed detents with the
// Gorhom-integrated scroll view rather than a plain ScrollView the sheet drag steals.
const SNAP_POINTS: string[] = ['62%', '92%'];
/** The glyph well beside each step. */
const STEP_ICON_WELL = 36;
const STEP_ROW_HEIGHT = 56;
/** A spinner scaled into the step glyph's box. */
const STEP_SPINNER_SCALE = 0.8;

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** A step's own time: tenths under a second (a read is often 0.2 s), whole seconds above. */
export function formatStepDuration(ms: number | undefined, t: Translate): string | undefined {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return undefined;
  if (ms < 1000) return t('{{count}} s', { ns: 'chat', count: Math.max(0.1, Math.round(ms / 100) / 10) });
  return formatActivityDuration(ms, t);
}

export type WorkRecordSheetProps = Readonly<{
  visible: boolean;
  /** The turn's tool calls, oldest first. */
  steps: ReadonlyArray<UiMessage>;
  onClose: () => void;
  onOpenStep: (message: UiMessage) => void;
}>;

/**
 * Everything the Agent did for one prompt, one row per tool call (A+ chat
 * design, owner decision 2026-09-30). Tool pills in the timeline stay one
 * line; this sheet carries the steps, and each step opens its full input and
 * output.
 */
export function WorkRecordSheet({ visible, steps, onClose, onOpenStep }: WorkRecordSheetProps): React.JSX.Element {
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const { colors } = theme;
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Keep the last steps while the sheet animates away.
  const shown = useRef(steps);
  useEffect(() => { if (visible && steps.length > 0) shown.current = steps; }, [steps, visible]);
  const list = visible && steps.length > 0 ? steps : shown.current;
  const duration = toolActivityDuration(list);
  const stepCount = list.length === 1 ? t('1 step') : t('{{count}} steps', { count: list.length });
  const subtitle = duration !== undefined ? `${formatActivityDuration(duration, t)} · ${stepCount}` : stepCount;
  const title = t('Work record');
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      titleContent={(
        <View style={styles.heading}>
          <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>{title}</Text>
          <Text testID="work-record-subtitle" numberOfLines={1} style={styles.subtitle}>{subtitle}</Text>
        </View>
      )}
      closeAccessibilityLabel={t('Close', { ns: 'common' })}
      snapPoints={SNAP_POINTS}
      testID="work-record-sheet"
    >
      <BottomSheetScrollView testID="work-record-scroll" contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {list.map((message) => {
          const tool = effectiveTool(message);
          const name = tool.name || t('Tool');
          const Icon = toolIcon(name);
          const detail = resolveToolDetail(name, tool.args)?.replace(/\s+/g, ' ').trim();
          const failed = message.toolStatus === 'error';
          const running = message.toolStatus === 'running';
          const status = failed ? t('Failed') : running ? t('Running') : message.toolStatus === 'unknown' ? t('Result unavailable') : undefined;
          const time = running ? undefined : formatStepDuration(message.toolDurationMs, t);
          const displayName = formatToolDisplayName(name, t);
          return (
            <Pressable
              key={message.renderKey ?? message.id}
              testID={`thread-run-${message.id}`}
              accessibilityRole="button"
              accessibilityLabel={[displayName, detail, status, time].filter(Boolean).join(', ')}
              onPress={() => onOpenStep(message)}
              style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
            >
              <View style={[styles.well, { backgroundColor: failed ? colors.badSoft : colors.surface }]}>
                {running ? <ActivityIndicator size="small" color={colors.inkSecondary} style={styles.spinner} />
                  : <Icon size={IconSize.md} strokeWidth={1.75} color={failed ? colors.bad : colors.inkSecondary} />}
              </View>
              <View style={styles.copy}>
                <Text numberOfLines={1} style={styles.name}>{displayName}</Text>
                {status || detail ? (
                  <Text numberOfLines={1} style={styles.detail}>
                    {status ? <Text style={failed ? { color: colors.bad } : undefined}>{status}</Text> : null}
                    {status && detail ? ' · ' : null}
                    {detail ? <Text style={styles.code}>{detail}</Text> : null}
                  </Text>
                ) : null}
              </View>
              {time ? <Text style={styles.time}>{time}</Text> : null}
            </Pressable>
          );
        })}
      </BottomSheetScrollView>
    </Sheet>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    heading: { alignSelf: 'stretch', alignItems: 'center' },
    title: { color: colors.ink, fontSize: FontSize.body, lineHeight: LineHeight.body, fontWeight: FontWeight.semibold, textAlign: 'center' },
    subtitle: { color: colors.inkSecondary, fontSize: FontSize.caption, lineHeight: LineHeight.caption, textAlign: 'center' },
    content: { paddingHorizontal: Space.lg, paddingBottom: Space.xl },
    row: { minHeight: STEP_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: Space.md },
    pressed: { opacity: Motion.pressedOpacity },
    well: { width: STEP_ICON_WELL, height: STEP_ICON_WELL, borderRadius: Radius.avatarSheet, alignItems: 'center', justifyContent: 'center' },
    spinner: { transform: [{ scale: STEP_SPINNER_SCALE }] },
    copy: { flex: 1, minWidth: 0 },
    name: { color: colors.ink, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary },
    detail: { color: colors.inkSecondary, fontSize: FontSize.caption, lineHeight: LineHeight.caption },
    code: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: FontSize.meta },
    time: { color: colors.inkTertiary, fontSize: FontSize.caption, lineHeight: LineHeight.caption, fontVariant: ['tabular-nums'] },
  });
}
