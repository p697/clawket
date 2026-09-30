import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, CircleAlert, Clock3, X } from 'lucide-react-native';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  IconSize,
  LineHeight,
  Radius,
  Space,
} from '../../theme/tokens';

export type ApprovalCardAction = {
  label: string;
  onPress: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
};

export type ApprovalCardOutcome = {
  kind: 'allowed' | 'denied' | 'expired';
  label: string;
};

export type ApprovalCardProps = {
  title: string;
  /** Category glyph before the title, from the same vocabulary as the tool rows. */
  icon?: React.ComponentType<{ size: number; color: string; strokeWidth: number }>;
  command?: string;
  detail?: string;
  /** A failed resolution; replaces the detail while both actions stay usable. */
  error?: string;
  /** The backend is confirming a decision: both actions wait and the pressed one spins. */
  busy?: boolean;
  /** A settled request keeps only its title, the outcome and the command. */
  outcome?: ApprovalCardOutcome;
  primaryAction: ApprovalCardAction;
  secondaryAction: ApprovalCardAction;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

type ActionSlot = 'primary' | 'secondary';
type ApprovalCardStyles = ReturnType<typeof createStyles>;

const OUTCOME_ICONS = { allowed: Check, denied: X, expired: Clock3 } as const;
const COMMAND_PREVIEW_LINES = 3;
// `monospace` is a family only Android resolves; iOS falls back to the system face without Menlo.
const COMMAND_FONT = Platform.select({ ios: 'Menlo', default: 'monospace' });

export function ApprovalCard({
  title,
  icon: Icon,
  command,
  detail,
  error,
  busy = false,
  outcome,
  primaryAction,
  secondaryAction,
  style,
  testID,
}: ApprovalCardProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const [pressedSlot, setPressedSlot] = useState<ActionSlot | null>(null);

  // Forget the pressed capsule once the backend answers, so a retried or recycled card never spins the wrong one.
  useEffect(() => {
    if (!busy) setPressedSlot(null);
  }, [busy]);

  const settled = outcome !== undefined;
  const OutcomeIcon = outcome ? OUTCOME_ICONS[outcome.kind] : null;
  const spinningSlot = busy ? pressedSlot : null;

  return (
    <View
      testID={testID}
      accessibilityState={{ disabled: settled }}
      style={[styles.card, style]}
    >
      <View style={styles.header}>
        {Icon ? <Icon size={IconSize.sm} color={theme.colors.inkSecondary} strokeWidth={1.75} /> : null}
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {outcome && OutcomeIcon ? (
          <View testID={testID ? `${testID}-outcome` : undefined} style={styles.outcome}>
            <OutcomeIcon size={IconSize.sm} color={theme.colors.inkSecondary} strokeWidth={1.75} />
            <Text style={styles.outcomeLabel} numberOfLines={1}>{outcome.label}</Text>
          </View>
        ) : null}
      </View>
      {command ? <ApprovalCommand command={command} styles={styles} testID={testID} /> : null}
      {settled ? null : error ? (
        <View testID={testID ? `${testID}-error` : undefined} style={styles.errorRow}>
          <View style={styles.errorIcon}>
            <CircleAlert size={IconSize.sm} color={theme.colors.bad} strokeWidth={1.75} />
          </View>
          <Text style={[styles.detail, styles.error]}>{error}</Text>
        </View>
      ) : detail ? (
        <Text testID={testID ? `${testID}-detail` : undefined} style={styles.detail}>{detail}</Text>
      ) : null}
      {settled ? null : (
        <View style={styles.actions}>
          <ApprovalActionButton
            action={secondaryAction}
            disabled={busy || secondaryAction.disabled === true}
            spinning={spinningSlot === 'secondary'}
            onPressed={() => setPressedSlot('secondary')}
            appearance="secondary"
            styles={styles}
            testID={testID ? `${testID}-secondary` : undefined}
          />
          <ApprovalActionButton
            action={primaryAction}
            disabled={busy || primaryAction.disabled === true}
            spinning={spinningSlot === 'primary'}
            onPressed={() => setPressedSlot('primary')}
            appearance="primary"
            styles={styles}
            testID={testID ? `${testID}-primary` : undefined}
          />
        </View>
      )}
    </View>
  );
}

/** The exact command in a code well; a long one previews three lines and the whole well expands it. */
function ApprovalCommand({
  command,
  styles,
  testID,
}: {
  command: string;
  styles: ApprovalCardStyles;
  testID?: string;
}): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);
  const long = command.length > 120 || command.split('\n').length > COMMAND_PREVIEW_LINES;
  const commandTestID = testID ? `${testID}-command` : undefined;

  if (!long || expanded) {
    return (
      <View testID={testID ? `${testID}-well` : undefined} style={styles.well}>
        <Text testID={commandTestID} style={styles.command} selectable>{command}</Text>
      </View>
    );
  }

  return (
    <Pressable
      testID={testID ? `${testID}-show-more` : undefined}
      accessibilityRole="button"
      accessibilityLabel={command}
      accessibilityHint={t('Show more')}
      accessibilityState={{ expanded: false }}
      onPress={() => setExpanded(true)}
      style={({ pressed }) => [styles.well, pressed ? styles.wellPressed : null]}
    >
      <Text testID={commandTestID} style={styles.command} numberOfLines={COMMAND_PREVIEW_LINES}>
        {command}
      </Text>
      <View style={styles.more}>
        <Text style={styles.moreLabel}>{t('Show more')}</Text>
        <ChevronDown size={IconSize.sm} color={theme.colors.inkSecondary} strokeWidth={2} />
      </View>
    </Pressable>
  );
}

function ApprovalActionButton({
  action,
  disabled,
  spinning,
  onPressed,
  appearance,
  styles,
  testID,
}: {
  action: ApprovalCardAction;
  disabled: boolean;
  spinning: boolean;
  onPressed: () => void;
  appearance: ActionSlot;
  styles: ApprovalCardStyles;
  testID?: string;
}): React.JSX.Element {
  const { theme } = useAppTheme();
  const labelColor = appearance === 'primary' ? theme.colors.canvas : theme.colors.ink;
  const onLongPress = action.onLongPress;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={action.accessibilityLabel ?? action.label}
      accessibilityState={spinning ? { disabled: true, busy: true } : { disabled }}
      disabled={disabled}
      onPress={() => {
        onPressed();
        action.onPress();
      }}
      onLongPress={onLongPress ? () => {
        onPressed();
        onLongPress();
      } : undefined}
      style={({ pressed }) => [
        styles.action,
        appearance === 'primary' ? styles.primaryAction : styles.secondaryAction,
        pressed && !disabled ? styles.actionPressed : null,
        disabled && !spinning ? styles.actionDisabled : null,
      ]}
    >
      {spinning ? (
        <ActivityIndicator testID={testID ? `${testID}-spinner` : undefined} size="small" color={labelColor} />
      ) : (
        <Text style={[styles.actionLabel, { color: labelColor }]} numberOfLines={1}>
          {action.label}
        </Text>
      )}
    </Pressable>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    card: {
      gap: Space.md,
      padding: Space.lg,
      backgroundColor: colors.surface,
      borderRadius: Radius.card,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
    },
    title: {
      flex: 1,
      color: colors.ink,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.semibold,
    },
    outcome: {
      flexShrink: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
    },
    outcomeLabel: {
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
    },
    // The small-tile radius keeps a one-line well a rounded rectangle rather than a pill.
    well: {
      gap: Space.xs,
      paddingVertical: Space.sm,
      paddingHorizontal: Space.md,
      backgroundColor: colors.surfaceFloating,
      borderRadius: Radius.avatarSheet,
    },
    wellPressed: {
      opacity: 0.84,
    },
    command: {
      color: colors.ink,
      fontFamily: COMMAND_FONT,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
    },
    more: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
    },
    moreLabel: {
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.regular,
    },
    detail: {
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
    },
    errorRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Space.sm,
    },
    errorIcon: {
      height: LineHeight.secondary,
      justifyContent: 'center',
    },
    error: {
      flex: 1,
      color: colors.bad,
    },
    actions: {
      flexDirection: 'row',
      gap: Space.sm,
      marginTop: Space.xs,
    },
    action: {
      flex: 1,
      minHeight: ControlSize.floatingButton,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: Radius.full,
      paddingHorizontal: Space.lg,
    },
    primaryAction: {
      backgroundColor: colors.ink,
    },
    secondaryAction: {
      backgroundColor: colors.surfaceFloating,
    },
    actionPressed: {
      opacity: 0.84,
    },
    actionDisabled: {
      opacity: 0.55,
    },
    actionLabel: {
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.semibold,
    },
  });
}
