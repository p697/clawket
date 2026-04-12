import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Copy } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { ModalSheet } from '../ui';
import { useAppTheme } from '../../theme';
import { MessageUsage } from '../../types/chat';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import { JsonTree } from './JsonTree';

type Props = {
  visible: boolean;
  onClose: () => void;
  name: string;
  status: 'running' | 'success' | 'error';
  args?: string;
  detail?: string;
  durationMs?: number;
  startedAtMs?: number;
  finishedAtMs?: number;
  usage?: MessageUsage;
};

function formatJson(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function isStructuredJson(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === 'object' && parsed !== null;
  } catch {
    return false;
  }
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

function formatTokenCount(n?: number): string {
  if (n === undefined || n === null) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

function CopyButton({ text, colors }: { text: string; colors: ReturnType<typeof useAppTheme>['theme']['colors'] }) {
  const [copied, setCopied] = useState(false);
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      style={{
        position: 'absolute',
        top: Space.xs,
        right: Space.xs,
        padding: Space.xs,
        borderRadius: Radius.sm,
        backgroundColor: copied ? colors.primarySoft : 'transparent',
      }}
      onPress={async () => {
        await Clipboard.setStringAsync(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied
        ? <Text style={{ fontSize: FontSize.xs, color: colors.primary, fontWeight: FontWeight.semibold }}>✓</Text>
        : <Copy size={13} color={colors.textSubtle} strokeWidth={2} />}
    </TouchableOpacity>
  );
}

function DurationBadge({ ms, colors }: { ms: number; colors: ReturnType<typeof useAppTheme>['theme']['colors'] }) {
  return (
    <Text style={{
      color: colors.textMuted,
      fontSize: FontSize.sm,
      fontFamily: 'monospace',
      marginRight: Space.sm,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: Space.xs + 2,
      paddingVertical: 2,
      borderRadius: Radius.sm,
      overflow: 'hidden',
    }}>
      {formatDuration(ms)}
    </Text>
  );
}

export function ToolDetailModal({
  visible,
  onClose,
  name,
  status,
  args,
  detail,
  durationMs,
  startedAtMs,
  finishedAtMs,
  usage,
}: Props): React.JSX.Element {
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);

  // Snapshot props while visible so content doesn't collapse during fade-out
  const snapshot = useRef({ name, status, args, detail, durationMs, startedAtMs, finishedAtMs, usage });
  useEffect(() => {
    if (visible) {
      snapshot.current = { name, status, args, detail, durationMs, startedAtMs, finishedAtMs, usage };
    }
  }, [visible, name, status, args, detail, durationMs, startedAtMs, finishedAtMs, usage]);
  const s = visible ? { name, status, args, detail, durationMs, startedAtMs, finishedAtMs, usage } : snapshot.current;

  const hasArgs = !!s.args && s.args.trim().length > 0;
  const hasOutput = !!s.detail && s.detail.trim().length > 0;
  const formattedArgs = hasArgs ? formatJson(s.args!) : '';
  const formattedOutput = hasOutput ? formatJson(s.detail!) : '';
  const argsIsJson = hasArgs ? isStructuredJson(s.args!) : false;
  const outputIsJson = hasOutput ? isStructuredJson(s.detail!) : false;

  const durationBadge = typeof s.durationMs === 'number' && s.status !== 'running'
    ? <DurationBadge ms={s.durationMs} colors={theme.colors} />
    : undefined;

  const formatDateTime = (timestampMs: number): string => {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(timestampMs));
  };

  const showTimeSection = typeof s.startedAtMs === 'number' || typeof s.finishedAtMs === 'number';

  return (
    <ModalSheet visible={visible} onClose={onClose} title={s.name} headerRight={durationBadge} maxHeight="70%">
      <ScrollView style={styles.modalScroll}>
        {hasArgs && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('Input')}</Text>
            <View style={styles.codeBlock}>
              {argsIsJson
                ? <JsonTree text={formattedArgs} />
                : <Text style={styles.codeText}>{formattedArgs}</Text>}
              <CopyButton text={s.args!} colors={theme.colors} />
            </View>
          </View>
        )}
        {hasOutput && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('Output')}</Text>
            <View style={styles.codeBlock}>
              {outputIsJson
                ? <JsonTree text={formattedOutput} />
                : <Text style={styles.codeText}>{formattedOutput}</Text>}
              <CopyButton text={s.detail!} colors={theme.colors} />
            </View>
          </View>
        )}
        {s.usage && (s.usage.inputTokens || s.usage.outputTokens || s.usage.totalTokens) ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('Usage')}</Text>
            <View style={styles.usageRow}>
              {typeof s.usage.inputTokens === 'number' && <Text style={styles.usageItem}>{t('Input')}: {formatTokenCount(s.usage.inputTokens)}</Text>}
              {typeof s.usage.outputTokens === 'number' && <Text style={styles.usageItem}>{t('Output')}: {formatTokenCount(s.usage.outputTokens)}</Text>}
              {typeof s.usage.totalTokens === 'number' && <Text style={styles.usageItem}>{t('Total')}: {formatTokenCount(s.usage.totalTokens)}</Text>}
            </View>
          </View>
        ) : null}
        {!hasArgs && !hasOutput && !s.usage && (
          <Text style={styles.emptyText}>{t('No output — tool completed successfully.')}</Text>
        )}
        {showTimeSection && (
          <View style={[styles.section, styles.timeSection]}>
            {typeof s.startedAtMs === 'number' && (
              <Text style={styles.timeItem}>{t('Started')}: {formatDateTime(s.startedAtMs)}</Text>
            )}
            {typeof s.finishedAtMs === 'number' && (
              <Text style={styles.timeItem}>{t('Finished')}: {formatDateTime(s.finishedAtMs)}</Text>
            )}
          </View>
        )}
      </ScrollView>
    </ModalSheet>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    modalScroll: {
      paddingHorizontal: Space.md,
      paddingBottom: Space.md,
      paddingTop: 0,
      marginBottom: Space.xs,
    },
    section: {
      marginBottom: Space.md,
    },
    sectionLabel: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: Space.xs,
    },
    codeBlock: {
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.sm,
      padding: Space.sm + 2,
      paddingRight: Space.lg + Space.sm,
    },
    codeText: {
      color: colors.text,
      fontSize: FontSize.sm,
      lineHeight: 17,
      fontFamily: 'monospace',
    },
    usageRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Space.md,
    },
    usageItem: {
      color: colors.text,
      fontSize: FontSize.sm,
      fontFamily: 'monospace',
    },
    timeItem: {
      color: colors.text,
      fontSize: FontSize.sm,
      fontFamily: 'monospace',
      marginBottom: Space.xs,
    },
    timeSection: {
      marginTop: Space.lg,
    },
    emptyText: {
      color: colors.textMuted,
      fontSize: FontSize.md,
      fontStyle: 'italic',
    },
  });
}
