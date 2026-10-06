import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { ChevronDown, ChevronUp, Copy, Check, Lock, type LucideIcon } from 'lucide-react-native';
import { ChevronLeft, ChevronRight } from './DirectionalIcon';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import { ControlSize, FontSize, FontWeight, IconSize, LineHeight, Radius, Space } from '../../theme/tokens';
import { FloatingButton } from './FloatingButton';
import { Button } from './Button';

/** Shared onboarding and design-review recipes; no backend or network state. */
export function FlowHeader({ onBack, title, right, testID }: { onBack?: () => void; title?: string; right?: React.ReactNode; testID?: string }) {
  const { theme: { colors } } = useAppTheme();
  const { t } = useTranslation('common');
  return <View style={styles.header}>
    <View style={styles.slot}>{onBack ? <FloatingButton testID={testID} icon={ChevronLeft} appearance="plain" onPress={onBack} accessibilityLabel={t('Back')} /> : null}</View>
    <Text numberOfLines={1} style={[styles.headerTitle, { color: colors.inkSecondary }]}>{title}</Text>
    <View style={styles.slot}>{right}</View>
  </View>;
}

export function PageIntro({ title, description }: { title: string; description?: string }) {
  const { theme: { colors } } = useAppTheme();
  return <View style={styles.intro}>
    <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{title}</Text>
    {description ? <Text style={[styles.description, { color: colors.inkSecondary }]}>{description}</Text> : null}
  </View>;
}

/**
 * `locked` swaps the chevron for the Pro lock; the row stays pressable so the caller can open its paywall.
 * `compact` grid cells carry no chevron (owner decision 2026-10-06): the official mark and name read as one tile.
 */
export function ChoiceRow({ icon: Icon, leading, title, description, locked = false, compact = false, onPress, testID }: { icon?: LucideIcon; leading?: React.ReactNode; title: string; description?: string; locked?: boolean; compact?: boolean; onPress: () => void; testID?: string }) {
  const { theme: { colors } } = useAppTheme();
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={description ? `${title}, ${description}` : title} onPress={onPress}
    style={({ pressed }) => [styles.choice, description ? styles.choiceDescribed : null, compact ? styles.choiceCompact : null, { backgroundColor: pressed ? colors.surface : 'transparent' }]}>
    <View style={[styles.icon, description ? styles.iconDescribed : null, compact ? styles.iconCompact : null, { backgroundColor: leading ? 'transparent' : colors.surface }]}>{leading ?? (Icon ? <Icon size={IconSize.lg} color={colors.ink} strokeWidth={1.5} /> : null)}</View>
    <View style={styles.choiceCopy}>
      <Text style={[styles.choiceTitle, compact ? styles.choiceTitleCompact : null, { color: colors.ink }]}>{title}</Text>
      {description ? <Text style={[styles.description, { color: colors.inkSecondary }]}>{description}</Text> : null}
    </View>
    {locked
      ? <Lock testID={testID ? `${testID}-lock-icon` : undefined} size={IconSize.sm} color={colors.inkTertiary} strokeWidth={2} />
      : compact ? null : <ChevronRight size={IconSize.sm} color={colors.inkTertiary} strokeWidth={1.75} />}
  </Pressable>;
}

export function FormStep({ number, title, children, action, style }: { number: string; title: string; children: React.ReactNode; action?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { theme: { colors } } = useAppTheme();
  return <View style={[styles.step, style]}>
    <View style={styles.stepHeader}>
      <Text style={[styles.number, { color: colors.inkSecondary }]}>{number}</Text>
      <Text accessibilityRole="header" style={[styles.stepTitle, { color: colors.ink }]}>{title}</Text>
      {action}
    </View>
    {children}
  </View>;
}

export function CommandBlock({ command, onCopy, copied = false, prose = false, stacked = false, footer, accessibilityLabel, testID = 'onboarding-command', copyTestID = 'onboarding-copy-command' }: {
  command: string;
  onCopy?: () => void;
  copied?: boolean;
  /** Natural-language text for an agent rather than a terminal command. */
  prose?: boolean;
  /** A full-width command with its copy action below, for terminal onboarding. */
  stacked?: boolean;
  /** A short execution hint beside the stacked copy action. */
  footer?: string;
  accessibilityLabel?: string;
  testID?: string;
  copyTestID?: string;
}) {
  const { theme: { colors } } = useAppTheme();
  const { t } = useTranslation('config');
  return <View testID={testID} style={[styles.commandBlock, prose ? styles.proseBlock : null, stacked ? styles.commandStacked : null, { backgroundColor: colors.surface }]}>
    <Text selectable accessibilityLabel={accessibilityLabel ?? t('Pairing command')} style={[styles.command, prose ? styles.prose : null, stacked ? styles.commandFullWidth : null, { color: colors.ink }]}>{command}</Text>
    {onCopy ? stacked
      ? <View style={[styles.commandCopy, footer ? styles.commandFooter : null]}>{footer ? <Text style={[styles.commandHint, { color: colors.inkSecondary }]}>{footer}</Text> : null}<Button testID={copyTestID} label={t(copied ? 'Copied' : 'Copy')} icon={copied ? Check : Copy} variant="card" size="sm" multiline style={styles.commandCopyButton} haptic onPress={onCopy} accessibilityLabel={t(copied ? 'Copied' : 'Copy command')} /></View>
      : <FloatingButton testID={copyTestID} icon={copied ? Check : Copy} appearance="plain" onPress={onCopy} accessibilityLabel={t(copied ? 'Copied' : 'Copy command')} /> : null}
  </View>;
}

/**
 * A message the user forwards rather than reads: collapsed to its first lines so the action
 * below stays the focus, expandable for anyone who wants to check what they are sending.
 */
export function MessagePreview({ message, expanded, onToggle, accessibilityLabel, testID }: {
  message: string;
  expanded: boolean;
  onToggle: () => void;
  accessibilityLabel: string;
  testID?: string;
}) {
  const { theme: { colors } } = useAppTheme();
  const Chevron = expanded ? ChevronUp : ChevronDown;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ expanded }} onPress={onToggle}
    style={({ pressed }) => [styles.messagePreview, { backgroundColor: colors.surface, opacity: pressed ? 0.84 : 1 }]}>
    <Text testID={testID ? `${testID}-text` : undefined} selectable={expanded} numberOfLines={expanded ? undefined : 2} accessibilityLabel={accessibilityLabel}
      style={[styles.prose, { color: colors.inkSecondary }]}>{message}</Text>
    <Chevron size={IconSize.sm} color={colors.inkTertiary} strokeWidth={1.75} />
  </Pressable>;
}

const styles = StyleSheet.create({
  header: { minHeight: ControlSize.settingsRow, paddingHorizontal: Space.lg, flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  slot: { width: ControlSize.floatingButton, minHeight: ControlSize.floatingButton, justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: FontSize.secondary, lineHeight: LineHeight.secondary },
  intro: { gap: Space.md, paddingVertical: Space.lg },
  title: { fontSize: FontSize.display, lineHeight: LineHeight.display, fontWeight: FontWeight.semibold },
  description: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, fontWeight: FontWeight.regular },
  // A title-only choice is a 68-point row around a 44-point slot (owner request 2026-09-27) so the
  // Onboarding chooser and its help fit one phone screen; a described choice keeps the 52-point tile
  // and the roster's two-line height.
  choice: { paddingVertical: Space.md, paddingHorizontal: Space.xs, flexDirection: 'row', alignItems: 'center', gap: Space.lg, borderRadius: Radius.card },
  choiceDescribed: { minHeight: ControlSize.rosterRow, paddingVertical: Space.lg },
  choiceCompact: { minHeight: ControlSize.settingsRow, paddingVertical: Space.sm, gap: Space.sm },
  iconCompact: { width: Space.xxl, height: Space.xxl },
  choiceTitleCompact: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary },
  icon: { width: ControlSize.floatingButton, height: ControlSize.floatingButton, borderRadius: Radius.card, alignItems: 'center', justifyContent: 'center' },
  iconDescribed: { width: ControlSize.settingsRow, height: ControlSize.settingsRow },
  choiceCopy: { flex: 1, gap: Space.xs },
  choiceTitle: { fontSize: FontSize.body, lineHeight: LineHeight.body, fontWeight: FontWeight.semibold },
  step: { gap: Space.md },
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: ControlSize.floatingButton },
  number: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, fontVariant: ['tabular-nums'] },
  stepTitle: { flex: 1, fontSize: FontSize.body, lineHeight: LineHeight.body, fontWeight: FontWeight.semibold },
  commandBlock: { flexDirection: 'row', alignItems: 'center', minHeight: ControlSize.settingsRow, paddingLeft: Space.lg, paddingRight: Space.xs, paddingVertical: Space.xs, borderRadius: Radius.settingsGroup, gap: Space.xs },
  command: { flex: 1, fontSize: FontSize.caption, lineHeight: LineHeight.secondary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  commandStacked: { flexDirection: 'column', alignItems: 'stretch', paddingLeft: Space.lg, paddingRight: Space.lg, paddingVertical: Space.lg, gap: Space.sm },
  commandFullWidth: { flex: undefined },
  commandCopy: { alignSelf: 'flex-end', maxWidth: '100%' },
  commandFooter: { alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm },
  commandHint: { flexShrink: 1, fontSize: FontSize.caption, lineHeight: LineHeight.caption },
  commandCopyButton: { minHeight: ControlSize.floatingButton, maxWidth: '100%', flexShrink: 1 },
  proseBlock: { paddingVertical: Space.md, paddingRight: Space.lg },
  messagePreview: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: Space.md, paddingHorizontal: Space.lg, borderRadius: Radius.settingsGroup },
  prose: { flex: 1, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, fontFamily: undefined },
});
