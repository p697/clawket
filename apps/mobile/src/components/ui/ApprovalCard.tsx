import React, { useMemo } from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { useAppTheme } from '../../theme';
import {
  BorderWidth,
  ControlSize,
  FontSize,
  FontWeight,
  LineHeight,
  Radius,
  Space,
} from '../../theme/tokens';
import type { RunCardTone } from './RunCard';

export type ApprovalCardAction = {
  label: string;
  onPress: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
};

export type ApprovalCardProps = {
  title: string;
  command?: string;
  detail?: string;
  primaryAction: ApprovalCardAction;
  secondaryAction: ApprovalCardAction;
  tone?: RunCardTone;
  expired?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function ApprovalCard({
  title,
  command,
  detail,
  primaryAction,
  secondaryAction,
  tone = 'warn',
  expired = false,
  style,
  testID,
}: ApprovalCardProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);

  return (
    <View
      testID={testID}
      accessibilityState={{ disabled: expired }}
      style={[styles.card, expired ? styles.expired : null, style]}
    >
      <View
        testID={testID ? `${testID}-status` : undefined}
        style={[styles.status, { backgroundColor: theme.colors[tone] }]}
      />
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {command ? (
          <Text
            testID={testID ? `${testID}-command` : undefined}
            style={styles.command}
            selectable
            numberOfLines={3}
          >
            {command}
          </Text>
        ) : null}
        {detail ? <Text style={styles.detail} numberOfLines={1}>{detail}</Text> : null}
        <View style={styles.actions}>
          <ApprovalActionButton
            action={secondaryAction}
            disabled={expired || secondaryAction.disabled === true}
            appearance="secondary"
            testID={testID ? `${testID}-secondary` : undefined}
          />
          <ApprovalActionButton
            action={primaryAction}
            disabled={expired || primaryAction.disabled === true}
            appearance="primary"
            testID={testID ? `${testID}-primary` : undefined}
          />
        </View>
      </View>
    </View>
  );
}

function ApprovalActionButton({
  action,
  disabled,
  appearance,
  testID,
}: {
  action: ApprovalCardAction;
  disabled: boolean;
  appearance: 'primary' | 'secondary';
  testID?: string;
}): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={action.accessibilityLabel ?? action.label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={action.onPress}
      onLongPress={action.onLongPress}
      style={({ pressed }) => [
        styles.action,
        appearance === 'primary' ? styles.primaryAction : styles.secondaryAction,
        pressed && !disabled ? styles.actionPressed : null,
        disabled ? styles.actionDisabled : null,
      ]}
    >
      <Text
        style={[
          styles.actionLabel,
          appearance === 'primary' ? styles.primaryLabel : styles.secondaryLabel,
        ]}
        numberOfLines={1}
      >
        {action.label}
      </Text>
    </Pressable>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    card: {
      flexDirection: 'row',
      overflow: 'hidden',
      backgroundColor: colors.surface,
      borderRadius: Radius.card,
    },
    status: {
      width: BorderWidth.emphasis,
      borderRadius: Radius.full,
    },
    content: {
      flex: 1,
      gap: Space.sm,
      padding: Space.md,
    },
    title: {
      color: colors.ink,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.semibold,
    },
    command: {
      color: colors.ink,
      fontFamily: 'monospace',
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.regular,
    },
    detail: {
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.regular,
    },
    actions: {
      flexDirection: 'row',
      gap: Space.sm,
      marginTop: Space.xs,
    },
    action: {
      flex: 1,
      minHeight: ControlSize.pill,
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
    primaryLabel: {
      color: colors.canvas,
    },
    secondaryLabel: {
      color: colors.ink,
    },
    expired: {
      opacity: 0.6,
    },
  });
}
