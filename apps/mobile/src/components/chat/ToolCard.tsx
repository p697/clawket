import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Monitor } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import { MessageUsage } from '../../types/chat';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import { AGENT_AVATAR_SLOT_WIDTH } from './messageLayout';
import { ToolDetailModal } from './ToolDetailModal';
import { stripToolStatusPrefix } from '../../utils/tool-display';

type Props = {
  name: string;
  status: 'running' | 'success' | 'error';
  summary: string;
  args?: string;
  detail?: string;
  durationMs?: number;
  startedAtMs?: number;
  finishedAtMs?: number;
  usage?: MessageUsage;
  reserveAvatarSlot?: boolean;
};

function normalizeSummary(
  name: string,
  status: Props['status'],
  summary: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const trimmed = summary.trim();
  const base = stripToolStatusPrefix(trimmed, t);
  if (trimmed.length > 0) {
    if (status === 'running' && base.length > 0 && base === trimmed) return t('Running {{name}}', { name: base });
    return trimmed;
  }
  if (status === 'running') return t('Running {{name}}', { name });
  if (status === 'error') return t('Failed {{name}}', { name });
  return t('Completed {{name}}', { name });
}

function formatDuration(ms: number): string {
  const formatDecimal = (value: number): string => value.toFixed(2).replace(/\.?0+$/, '');
  if (ms < 1000) return `${formatDecimal(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${formatDecimal(s)}s`;
  const m = Math.floor(s / 60);
  const remainS = s % 60;
  return `${m}m${formatDecimal(remainS)}s`;
}

export function ToolCard({
  name,
  status,
  summary,
  args,
  detail,
  durationMs,
  startedAtMs,
  finishedAtMs,
  usage,
  reserveAvatarSlot = true,
}: Props): React.JSX.Element {
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors, reserveAvatarSlot), [reserveAvatarSlot, theme]);
  const [open, setOpen] = useState(false);
  const text = normalizeSummary(name, status, summary, t);
  const hasArgs = !!args && args.trim().length > 0;
  const hasOutput = !!detail && detail.trim().length > 0;
  const computedDurationMs = useMemo(() => {
    if (typeof durationMs === 'number') return durationMs;
    if (typeof startedAtMs !== 'number' || typeof finishedAtMs !== 'number') return undefined;
    return Math.max(0, finishedAtMs - startedAtMs);
  }, [durationMs, finishedAtMs, startedAtMs]);
  const hasTiming = typeof computedDurationMs === 'number'
    || typeof startedAtMs === 'number'
    || typeof finishedAtMs === 'number';
  const hasUsage = !!usage && (
    typeof usage.inputTokens === 'number'
    || typeof usage.outputTokens === 'number'
    || typeof usage.totalTokens === 'number'
  );
  const canOpen = hasArgs || hasOutput || hasTiming || hasUsage;

  return (
    <View style={styles.row}>
      <TouchableOpacity
        activeOpacity={canOpen ? 0.8 : 1}
        onPress={canOpen ? () => setOpen(true) : undefined}
        disabled={!canOpen}
        style={styles.card}
      >
        <Monitor size={14} color={theme.colors.textMuted} strokeWidth={2} />
        <Text
          numberOfLines={1}
          style={[styles.text, status === 'error' ? styles.textError : null]}
        >
          {text}
        </Text>
        {typeof computedDurationMs === 'number' && status !== 'running' && (
          <Text style={styles.duration}>{formatDuration(computedDurationMs)}</Text>
        )}
      </TouchableOpacity>

      <ToolDetailModal
        visible={open}
        onClose={() => setOpen(false)}
        name={name}
        status={status}
        args={args}
        detail={detail}
        durationMs={computedDurationMs}
        startedAtMs={startedAtMs}
        finishedAtMs={finishedAtMs}
        usage={usage}
      />
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors'], reserveAvatarSlot: boolean) {
  return StyleSheet.create({
    row: {
      width: '100%',
      marginVertical: Space.xs - 1,
      paddingHorizontal: Space.xs,
    },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm - 2,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
      borderRadius: Radius.sm,
      paddingHorizontal: Space.sm + 2,
      paddingVertical: Space.sm,
      marginLeft: reserveAvatarSlot ? AGENT_AVATAR_SLOT_WIDTH : 0,
    },
    text: {
      flex: 1,
      color: colors.textMuted,
      fontSize: FontSize.md,
      lineHeight: 18,
    },
    textError: {
      color: colors.error,
    },
    duration: {
      color: colors.textSubtle,
      fontSize: FontSize.xs,
      fontFamily: 'monospace',
      marginLeft: Space.xs,
    },
  });
}
