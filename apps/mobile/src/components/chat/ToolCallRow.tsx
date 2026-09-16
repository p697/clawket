import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Brain, CalendarClock, Check, ChevronDown, CircleAlert, FilePenLine, FileSearch, FolderSearch, Globe, Layers, MessageSquare, Search, Terminal, Wrench } from 'lucide-react-native';
import { ChevronRight } from '../ui/DirectionalIcon';
import type { UiMessage } from '../../types/chat';
import { useAppTheme } from '../../theme';
import { ControlSize, FontSize, FontWeight, IconSize, LineHeight, Radius, Space } from '../../theme/tokens';
import { formatToolDisplayName, resolveToolDetail } from '../../utils/tool-display';

function toolIcon(name: string) {
  const key = name.toLowerCase();
  if (/^(exec|bash|shell|terminal|run_command)$/.test(key)) return Terminal;
  if (/^(read|read_file)$/.test(key)) return FileSearch;
  if (/^(write|edit|write_file|edit_file|apply_patch)$/.test(key)) return FilePenLine;
  if (/^(glob|grep|ls|list_directory|file_search)$/.test(key)) return FolderSearch;
  if (key.includes('search')) return Search;
  if (key.includes('memory')) return Brain;
  if (/browser|web_fetch|fetch_url/.test(key)) return Globe;
  if (/cron|schedule/.test(key)) return CalendarClock;
  if (/message|send/.test(key)) return MessageSquare;
  return Wrench;
}

/** Tool plumbing stays one quiet line; payloads live in the existing detail sheet. */
export function ToolCallRow({ message, onPress }: {
  message: UiMessage; onPress: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('chat');
  const name = message.toolName?.trim() || t('Tool');
  const title = formatToolDisplayName(name, t);
  const summary = resolveToolDetail(name, message.toolArgs)?.replace(/\s+/g, ' ').trim();
  return <ToolActivityRow testID={`thread-run-${message.id}`} icon={toolIcon(name)}
    title={title} summary={summary} status={message.toolStatus} onPress={onPress} />;
}

export function ToolGroupRow({ count, expanded, running, incomplete, onPress, testID }: {
  count: number; expanded: boolean; running: boolean; incomplete?: boolean; onPress: () => void; testID: string;
}): React.JSX.Element {
  const { t } = useTranslation('chat');
  return <ToolActivityRow testID={testID} icon={Layers}
    title={t('Tool activity ({{count}})', { count })} expanded={expanded}
    status={running ? 'running' : incomplete ? 'unknown' : 'success'} onPress={onPress} />;
}

function ToolActivityRow({ title, summary, status, icon: Icon, onPress, expanded, testID }: {
  title: string; summary?: string; status?: UiMessage['toolStatus'];
  icon: typeof Wrench; onPress: () => void; expanded?: boolean; testID: string;
}): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('chat');
  const styles = useMemo(() => StyleSheet.create({
    row: { minHeight: ControlSize.floatingButton, flexDirection: 'row', alignItems: 'center',
      gap: Space.sm, paddingHorizontal: Space.md, paddingVertical: Space.sm,
      borderRadius: Radius.settingsGroup, backgroundColor: theme.colors.surface },
    copy: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: Space.sm },
    title: { flexShrink: 1, color: theme.colors.inkSecondary, fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary, fontWeight: FontWeight.regular },
    summary: { flex: 1, color: theme.colors.inkTertiary, fontSize: FontSize.caption,
      lineHeight: LineHeight.caption },
    pressed: { opacity: 0.65 },
  }), [theme.colors]);
  const stateLabel = status === 'running' ? t('Running') : status === 'error' ? t('Failed') : status === 'unknown' ? t('Result unavailable') : t('Completed');
  const Disclosure = expanded ? ChevronDown : ChevronRight;
  return <Pressable testID={testID} accessibilityRole="button"
    accessibilityLabel={[title, summary, stateLabel].filter(Boolean).join(', ')}
    accessibilityState={expanded === undefined ? undefined : { expanded }} onPress={onPress}
    style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
    <Icon size={IconSize.sm} strokeWidth={1.75} color={theme.colors.inkSecondary} />
    <View style={styles.copy}>
      <Text numberOfLines={1} style={styles.title}>{title}</Text>
      {summary ? <Text numberOfLines={1} style={styles.summary}>{summary}</Text> : null}
      {status === 'error' ? <Text numberOfLines={1} style={styles.summary}>{stateLabel}</Text> : null}
    </View>
    {status === 'running' ? <ActivityIndicator size="small" color={theme.colors.inkSecondary} />
      : status === 'error' ? <CircleAlert size={IconSize.sm} color={theme.colors.bad} />
      : expanded !== undefined ? <Disclosure size={IconSize.sm} color={theme.colors.inkTertiary} />
      : status === 'unknown' ? <ChevronRight size={IconSize.sm} color={theme.colors.inkTertiary} />
      : <Check size={IconSize.sm} color={theme.colors.inkTertiary} />}
  </Pressable>;
}
