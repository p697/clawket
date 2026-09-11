import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Check, ChevronDown, ChevronRight, CircleAlert, Clock3, Copy } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { FloatingButton, Sheet } from '../ui';
import { useAppTheme } from '../../theme';
import type { MessageUsage } from '../../types/chat';
import { ControlSize, FontSize, FontWeight, IconSize, LineHeight, Radius, Space } from '../../theme/tokens';
import { formatToolDisplayName } from '../../utils/tool-display';
import { JsonTree } from './JsonTree';
import { formatToolDuration, prepareToolPayload } from './tool-detail-model';

type Props = {
  visible: boolean;
  onClose: () => void;
  name: string;
  status: 'running' | 'success' | 'error' | 'unknown';
  args?: string;
  detail?: string;
  durationMs?: number;
  startedAtMs?: number;
  finishedAtMs?: number;
  usage?: MessageUsage;
};

function PayloadSection({ label, raw, testID }: { label: string; raw: string; testID: string }) {
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const [limit, setLimit] = useState(6000);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { setLimit(6000); setCopyState('idle'); }, [raw]);
  const payload = useMemo(() => prepareToolPayload(raw, limit), [raw, limit]);
  const copy = async () => {
    clearTimeout(timer.current);
    try { await Clipboard.setStringAsync(raw); setCopyState('copied'); }
    catch { setCopyState('error'); }
    timer.current = setTimeout(() => setCopyState('idle'), 2000);
  };
  return <View style={styles.section} testID={testID}>
    <View style={styles.sectionHeading}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {copyState !== 'idle' ? <Text accessibilityLiveRegion="polite" style={styles.caption}>
        {copyState === 'copied' ? t('Copied') : t('Copy failed')}
      </Text> : null}
      <FloatingButton icon={copyState === 'copied' ? Check : Copy} onPress={() => void copy()}
        appearance="plain" iconSize={IconSize.sm} accessibilityLabel={t('Copy {{section}}', { section: label })}
        testID={`${testID}-copy`} />
    </View>
    <View style={styles.payload}>
      {payload.structured ? <JsonTree text={payload.text} /> : <Text selectable style={styles.code}>{payload.text}</Text>}
    </View>
    {payload.truncated ? <Pressable accessibilityRole="button" onPress={() => setLimit(n => n + 6000)}
      testID={`${testID}-more`} style={styles.disclosure}>
      <Text style={styles.secondary}>{t('Show more')}</Text><ChevronDown size={IconSize.sm} color={theme.colors.inkSecondary} />
    </Pressable> : null}
  </View>;
}

export function ToolDetailModal(props: Props): React.JSX.Element {
  const { visible, onClose } = props;
  const { t, i18n } = useTranslation('chat');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const snapshot = useRef(props);
  useEffect(() => { if (visible) snapshot.current = props; }, [visible, props]);
  const s = visible ? props : snapshot.current;
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (visible) setExpanded(false); }, [visible, s.name, s.startedAtMs]);
  const title = formatToolDisplayName(s.name, t);
  const duration = s.status === 'running' ? undefined : formatToolDuration(s.durationMs);
  const statusLabel = s.status === 'running' ? t('Running') : s.status === 'error' ? t('Failed') : s.status === 'unknown' ? t('Result unavailable') : t('Completed');
  const StateIcon = s.status === 'error' || s.status === 'unknown' ? CircleAlert : Check;
  const stateColor = s.status === 'error' ? theme.colors.bad : theme.colors.inkSecondary;
  const date = (ms?: number) => typeof ms === 'number' && Number.isFinite(ms) && ms > 0
    ? new Intl.DateTimeFormat(i18n.language, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(ms)
    : undefined;
  const metadata = [
    [t('Tool identifier'), s.name], [t('Started'), date(s.startedAtMs)], [t('Finished'), date(s.finishedAtMs)],
    [t('Input tokens'), s.usage?.inputTokens?.toLocaleString(i18n.language)],
    [t('Output tokens'), s.usage?.outputTokens?.toLocaleString(i18n.language)],
    [t('Total tokens'), s.usage?.totalTokens?.toLocaleString(i18n.language)],
  ].filter((row): row is [string, string] => typeof row[1] === 'string');
  return <Sheet visible={visible} onClose={onClose} title={title}
    closeAccessibilityLabel={t('Close', { ns: 'common' })} maxHeight="85%" contentStyle={styles.scroll} testID="tool-detail-sheet">
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.statusRow}>
        {s.status === 'running' ? <ActivityIndicator size="small" color={stateColor} /> : <StateIcon size={IconSize.sm} color={stateColor} />}
        <Text style={[styles.secondary, { color: stateColor }]}>{statusLabel}</Text>
        {duration ? <View style={styles.duration}><Clock3 size={IconSize.sm} color={theme.colors.inkTertiary} />
          <Text numberOfLines={1} style={styles.caption} testID="tool-detail-duration">{duration}</Text></View> : null}
      </View>
      {s.args?.trim() ? <PayloadSection key={`input-${s.name}-${s.startedAtMs}`} label={t('Input')} raw={s.args} testID="tool-detail-input" /> : null}
      {s.detail?.trim() ? <PayloadSection key={`output-${s.name}-${s.startedAtMs}`} label={t('Output')} raw={s.detail} testID="tool-detail-output" />
        : <View style={styles.empty}><Text style={styles.secondary}>
          {s.status === 'running' ? t('Waiting for output…') : t('No output recorded.')}
        </Text></View>}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(v => !v)}
        style={styles.disclosure} testID="tool-detail-metadata-toggle">
        <Text style={styles.secondary}>{t('Execution details')}</Text>
        {expanded ? <ChevronDown size={IconSize.sm} color={theme.colors.inkSecondary} /> : <ChevronRight size={IconSize.sm} color={theme.colors.inkSecondary} />}
      </Pressable>
      {expanded ? <View style={styles.metadata} testID="tool-detail-metadata">
        {metadata.map(([label, value]) => <View key={label} style={styles.metadataRow}>
          <Text style={styles.caption}>{label}</Text><Text selectable style={styles.metadataValue}>{value}</Text>
        </View>)}
      </View> : null}
    </ScrollView>
  </Sheet>;
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    scroll: { flexShrink: 1 },
    content: { paddingHorizontal: Space.xl, paddingBottom: Space.lg, gap: Space.sm },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: Space.sm },
    secondary: { color: colors.inkSecondary, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary },
    caption: { color: colors.inkSecondary, fontSize: FontSize.caption, lineHeight: LineHeight.caption },
    duration: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, marginLeft: 'auto', flexShrink: 0 },
    section: { gap: Space.xs },
    sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: ControlSize.floatingButton },
    sectionLabel: { flex: 1, color: colors.ink, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, fontWeight: FontWeight.semibold },
    payload: { backgroundColor: colors.surface, borderRadius: Radius.settingsGroup, padding: Space.lg },
    code: { color: colors.ink, fontSize: FontSize.caption, lineHeight: LineHeight.secondary,
      fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
    empty: { paddingVertical: Space.lg },
    disclosure: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm, minHeight: ControlSize.floatingButton },
    metadata: { gap: Space.md, paddingBottom: Space.sm },
    metadataRow: { gap: Space.xs },
    metadataValue: { color: colors.inkSecondary, fontSize: FontSize.caption, lineHeight: LineHeight.caption },
  });
}
