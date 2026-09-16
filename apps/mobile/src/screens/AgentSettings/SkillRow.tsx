import React, { memo, useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { CircleAlert } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import type { SkillStatusEntry } from '@clawket/agent-protocol';
import { ChevronRight } from '../../components/ui/DirectionalIcon';
import { ThemedSwitch } from '../../components/ui/ThemedSwitch';
import { useAppTheme } from '../../theme';
import { ControlSize, FontSize, FontWeight, IconSize, LineHeight, Space } from '../../theme/tokens';
import { skillRequirementIssues } from './skills-model';

export function useSkillIssues(skill: SkillStatusEntry | null): string[] {
  const { t } = useTranslation('settings');
  return skill ? skillRequirementIssues(skill).map(({ kind, requirements }) => {
    if (kind === 'blocked') return t('Blocked by allowlist');
    if (kind === 'missing') return t('Missing: {{requirements}}', { requirements });
    if (kind === 'any') return t('Requires one of: {{requirements}}', { requirements });
    if (kind === 'os') return t('Requires OS: {{requirements}}', { requirements });
    return t('Unavailable');
  }) : [];
}

export function SkillSwitch({ skill, disabled, busy, testID, onToggle }: Readonly<{
  skill: SkillStatusEntry;
  disabled: boolean;
  busy: boolean;
  testID: string;
  onToggle: (skill: SkillStatusEntry) => void;
}>): React.JSX.Element {
  const { t } = useTranslation('settings');
  return (
    <View style={stylesStatic.switchTarget}>
      <ThemedSwitch
        testID={testID}
        hitSlop={Space.sm}
        accessibilityRole="switch"
        accessibilityLabel={`${t('Enabled')}: ${skill.name}`}
        accessibilityState={{ disabled, busy }}
        value={skill.always || !skill.disabled}
        disabled={disabled}
        onValueChange={() => onToggle(skill)}
      />
    </View>
  );
}

export const SkillRow = memo(function SkillRow({ skill, canToggle, disabled, busy, onPress, onToggle }: Readonly<{
  skill: SkillStatusEntry;
  canToggle: boolean;
  disabled: boolean;
  busy: boolean;
  onPress: (skill: SkillStatusEntry) => void;
  onToggle: (skill: SkillStatusEntry) => void;
}>): React.JSX.Element {
  const { t } = useTranslation('settings');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const issues = useSkillIssues(skill);
  return (
    <View style={styles.row}>
      <Pressable
        testID={`agent-skill-installed-${skill.skillKey}`}
        accessibilityRole="button"
        accessibilityLabel={[skill.name, skill.description, ...issues].filter(Boolean).join('. ')}
        onPress={() => onPress(skill)}
        style={({ pressed }) => [styles.main, pressed ? styles.pressed : null]}
      >
        <View style={styles.nameRow}>
          <Text style={styles.name}>{skill.name}</Text>
          {busy ? <ActivityIndicator size="small" color={theme.colors.inkSecondary} />
            : <ChevronRight size={IconSize.sm} color={theme.colors.inkTertiary} />}
        </View>
        {skill.description.trim() ? <Text numberOfLines={1} style={styles.description}>{skill.description}</Text> : null}
        {issues.length ? (
          <View style={styles.issue}>
            <CircleAlert size={IconSize.sm} color={theme.colors.warn} />
            <Text numberOfLines={2} style={styles.issueText}>{issues[0]}</Text>
          </View>
        ) : null}
      </Pressable>
      {canToggle ? (
        <SkillSwitch skill={skill} testID={`agent-skill-switch-${skill.skillKey}`} disabled={disabled} busy={busy} onToggle={onToggle} />
      ) : (
        <Text style={styles.readOnly}>
          {skill.always ? t('Always on') : skill.disabled ? t('Disabled') : skill.eligible ? t('Active') : t('Unavailable')}
        </Text>
      )}
    </View>
  );
});

const stylesStatic = StyleSheet.create({
  switchTarget: { minWidth: ControlSize.settingsRow, minHeight: ControlSize.floatingButton, alignItems: 'center', justifyContent: 'center' },
});

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    row: { minHeight: ControlSize.rosterRow, flexDirection: 'row', alignItems: 'center', gap: Space.lg, paddingVertical: Space.md },
    main: { flex: 1, minHeight: ControlSize.floatingButton, justifyContent: 'center', gap: Space.xs },
    pressed: { backgroundColor: colors.surface },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
    name: { flexShrink: 1, color: colors.ink, fontSize: FontSize.body, lineHeight: LineHeight.body, fontWeight: FontWeight.semibold },
    description: { color: colors.inkSecondary, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, fontWeight: FontWeight.regular },
    readOnly: { flexShrink: 1, maxWidth: '30%', color: colors.inkSecondary, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, fontWeight: FontWeight.regular },
    issue: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
    issueText: { flex: 1, color: colors.warn, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, fontWeight: FontWeight.regular },
  });
}
