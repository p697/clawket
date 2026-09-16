import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Copy, Check, Lock, type LucideIcon } from 'lucide-react-native';
import { ChevronLeft, ChevronRight } from './DirectionalIcon';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import { ControlSize, FontSize, FontWeight, IconSize, LineHeight, Radius, Space } from '../../theme/tokens';
import { FloatingButton } from './FloatingButton';

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

/** `locked` swaps the chevron for the Pro lock; the row stays pressable so the caller can open its paywall. */
export function ChoiceRow({ icon: Icon, leading, title, description, locked = false, onPress, testID }: { icon?: LucideIcon; leading?: React.ReactNode; title: string; description?: string; locked?: boolean; onPress: () => void; testID?: string }) {
  const { theme: { colors } } = useAppTheme();
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={description ? `${title}, ${description}` : title} onPress={onPress}
    style={({ pressed }) => [styles.choice, { backgroundColor: pressed ? colors.surface : 'transparent' }]}>
    <View style={[styles.icon, { backgroundColor: leading ? 'transparent' : colors.surface }]}>{leading ?? (Icon ? <Icon size={IconSize.lg} color={colors.ink} strokeWidth={1.5} /> : null)}</View>
    <View style={styles.choiceCopy}>
      <Text style={[styles.choiceTitle, { color: colors.ink }]}>{title}</Text>
      {description ? <Text style={[styles.description, { color: colors.inkSecondary }]}>{description}</Text> : null}
    </View>
    {locked
      ? <Lock testID={testID ? `${testID}-lock-icon` : undefined} size={IconSize.sm} color={colors.inkTertiary} strokeWidth={2} />
      : <ChevronRight size={IconSize.sm} color={colors.inkTertiary} strokeWidth={1.75} />}
  </Pressable>;
}

export function FormStep({ number, title, children, action }: { number: string; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  const { theme: { colors } } = useAppTheme();
  return <View style={styles.step}>
    <View style={styles.stepHeader}>
      <Text style={[styles.number, { color: colors.inkSecondary }]}>{number}</Text>
      <Text accessibilityRole="header" style={[styles.stepTitle, { color: colors.ink }]}>{title}</Text>
      {action}
    </View>
    {children}
  </View>;
}

export function CommandBlock({ command, onCopy, copied = false, prose = false, accessibilityLabel, testID = 'onboarding-command', copyTestID = 'onboarding-copy-command' }: {
  command: string;
  onCopy?: () => void;
  copied?: boolean;
  /** Natural-language text for an agent rather than a terminal command. */
  prose?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  copyTestID?: string;
}) {
  const { theme: { colors } } = useAppTheme();
  const { t } = useTranslation('config');
  return <View testID={testID} style={[styles.commandBlock, prose ? styles.proseBlock : null, { backgroundColor: colors.surface }]}>
    <Text selectable accessibilityLabel={accessibilityLabel ?? t('Pairing command')} style={[styles.command, prose ? styles.prose : null, { color: colors.ink }]}>{command}</Text>
    {onCopy ? <FloatingButton testID={copyTestID} icon={copied ? Check : Copy} appearance="plain" onPress={onCopy} accessibilityLabel={t(copied ? 'Copied' : 'Copy command')} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  header: { minHeight: ControlSize.settingsRow, paddingHorizontal: Space.md, flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  slot: { width: ControlSize.floatingButton, minHeight: ControlSize.floatingButton, justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: FontSize.secondary, lineHeight: LineHeight.secondary },
  intro: { gap: Space.md, paddingVertical: Space.lg },
  title: { fontSize: FontSize.display, lineHeight: LineHeight.display, fontWeight: FontWeight.semibold },
  description: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, fontWeight: FontWeight.regular },
  choice: { minHeight: ControlSize.rosterRow, paddingVertical: Space.lg, paddingHorizontal: Space.xs, flexDirection: 'row', alignItems: 'center', gap: Space.lg, borderRadius: Radius.card },
  icon: { width: ControlSize.settingsRow, height: ControlSize.settingsRow, borderRadius: Radius.card, alignItems: 'center', justifyContent: 'center' },
  choiceCopy: { flex: 1, gap: Space.xs },
  choiceTitle: { fontSize: FontSize.body, lineHeight: LineHeight.body, fontWeight: FontWeight.semibold },
  step: { gap: Space.md },
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: ControlSize.floatingButton },
  number: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, fontVariant: ['tabular-nums'] },
  stepTitle: { flex: 1, fontSize: FontSize.body, lineHeight: LineHeight.body, fontWeight: FontWeight.semibold },
  commandBlock: { flexDirection: 'row', alignItems: 'center', minHeight: ControlSize.settingsRow, paddingLeft: Space.lg, paddingRight: Space.xs, paddingVertical: Space.xs, borderRadius: Radius.settingsGroup, gap: Space.xs },
  command: { flex: 1, fontSize: FontSize.caption, lineHeight: LineHeight.secondary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  proseBlock: { paddingVertical: Space.md, paddingRight: Space.lg },
  prose: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, fontFamily: undefined },
});
