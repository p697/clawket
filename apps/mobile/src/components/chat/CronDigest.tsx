import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Check, CircleAlert, CircleMinus } from 'lucide-react-native';
import { Bubble } from '../ui/Bubble';
import { FontSize, FontWeight, IconSize, LineHeight, Motion, Space } from '../../theme/tokens';
import { useConversationTheme } from './ChatPresentation';
import { InlineKeyboard, type InlineKeyboardButton } from './InlineKeyboard';

/** One scheduled result, as the digest reads it (a Thread run card). */
export type CronDigestRun = Readonly<{
  id: string;
  title: string;
  status: 'streaming' | 'tool_calling' | 'completed' | 'succeeded' | 'failed' | 'skipped';
  statusLabel: string;
  timeLabel: string;
  jobId?: string;
  canOpenLogs?: boolean;
  runnable?: boolean;
}>;

type RerunState = 'idle' | 'busy' | 'started' | 'failed';

export type CronDigestProps<T extends CronDigestRun> = Readonly<{
  /** Newest first, as the timeline groups them. */
  runs: ReadonlyArray<T>;
  onOpenRun: (run: T) => void;
  onOpenLogs?: (run: T) => void;
  onRerun?: (run: T) => Promise<unknown>;
  testID?: string;
}>;

/**
 * Adjacent scheduled results as one message from the Agent (A+ chat design,
 * owner decision 2026-09-30): one line per task — a quiet check when it ran,
 * red when it did not — each opening its execution record. A failure hangs
 * "View logs" and "Run again" under the message for the newest failed task,
 * Telegram style.
 */
export function CronDigest<T extends CronDigestRun>({ runs, onOpenRun, onOpenLogs, onRerun, testID }: CronDigestProps<T>): React.JSX.Element {
  const { t } = useTranslation('chat');
  const theme = useConversationTheme();
  const { colors } = theme;
  const styles = useMemo(() => createStyles(colors), [colors]);
  const ordered = useMemo(() => [...runs].reverse(), [runs]);
  const failed = runs.find((run) => run.status === 'failed');
  const [rerun, setRerun] = useState<{ runId: string; state: RerunState } | null>(null);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  const rerunState = failed && rerun?.runId === failed.id ? rerun.state : 'idle';

  const buttons: InlineKeyboardButton[] = [];
  if (failed?.canOpenLogs && onOpenLogs) {
    buttons.push({ key: 'logs', label: t('View logs'), onPress: () => onOpenLogs(failed), testID: testID ? `${testID}-logs` : undefined });
  }
  if (failed?.jobId && failed.runnable && onRerun) {
    buttons.push({
      key: 'rerun',
      label: rerunState === 'started' ? t('Run started') : rerunState === 'failed' ? t('Could not start the run') : t('Run again'),
      tone: 'primary',
      busy: rerunState === 'busy',
      disabled: rerunState === 'started',
      testID: testID ? `${testID}-rerun` : undefined,
      onPress: () => {
        setRerun({ runId: failed.id, state: 'busy' });
        onRerun(failed).then(
          () => { if (live.current) setRerun({ runId: failed.id, state: 'started' }); },
          () => { if (live.current) setRerun({ runId: failed.id, state: 'failed' }); },
        );
      },
    });
  }

  return (
    <View testID={testID} style={styles.message}>
      <Bubble testID={testID ? `${testID}-bubble` : undefined} role="assistant" style={styles.bubble}>
        <View style={styles.header}>
          <CalendarClock size={IconSize.sm} color={colors.accent} strokeWidth={2} />
          <Text style={[styles.headerLabel, { color: colors.accent }]} numberOfLines={1}>{t('Scheduled tasks')}</Text>
        </View>
        {ordered.map((run) => {
          const failedRun = run.status === 'failed';
          const skipped = run.status === 'skipped';
          const Icon = failedRun ? CircleAlert : skipped ? CircleMinus : Check;
          return (
            <Pressable
              key={run.id}
              testID={testID ? `${testID}-run-${run.id}` : undefined}
              accessibilityRole="button"
              accessibilityLabel={[run.title, run.statusLabel, run.timeLabel].filter(Boolean).join(', ')}
              onPress={() => onOpenRun(run)}
              style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
            >
              <View style={styles.rowIcon}>
                <Icon size={IconSize.sm} strokeWidth={failedRun ? 2 : 2.4}
                  color={failedRun ? colors.bad : skipped ? colors.inkTertiary : colors.good} />
              </View>
              <Text style={styles.title} numberOfLines={2}>
                {run.title}
                {failedRun || skipped ? (
                  <Text style={{ color: failedRun ? colors.bad : colors.inkSecondary }}>{` ${run.statusLabel}`}</Text>
                ) : null}
              </Text>
              <Text style={styles.time}>{run.timeLabel}</Text>
            </Pressable>
          );
        })}
      </Bubble>
      {buttons.length > 0 ? <InlineKeyboard testID={testID ? `${testID}-actions` : undefined} buttons={buttons} /> : null}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useConversationTheme>['colors']) {
  return StyleSheet.create({
    // A fixed share of the row, like an approval, so the buttons under it never squeeze.
    message: {
      alignSelf: 'flex-start',
      width: '88%',
      gap: Space.xs,
    },
    bubble: {
      alignSelf: 'stretch',
      maxWidth: '100%',
      gap: Space.sm,
      paddingVertical: Space.md,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs + 2,
    },
    headerLabel: {
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.semibold,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Space.sm,
    },
    pressed: {
      opacity: Motion.pressedOpacity,
    },
    // Centres the glyph on the first text line.
    rowIcon: {
      height: LineHeight.secondary,
      justifyContent: 'center',
    },
    title: {
      flex: 1,
      minWidth: 0,
      color: colors.ink,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
    },
    time: {
      color: colors.inkTertiary,
      fontSize: FontSize.meta,
      lineHeight: LineHeight.secondary,
      fontVariant: ['tabular-nums'],
    },
  });
}
