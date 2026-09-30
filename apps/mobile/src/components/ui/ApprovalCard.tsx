import React, { useEffect, useMemo, useState } from 'react';
import {
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
import { useChatSurfaces, useConversationTheme } from '../chat/ChatPresentation';
import { InlineKeyboard } from '../chat/InlineKeyboard';
import {
  ControlSize,
  FontSize,
  FontWeight,
  IconSize,
  LineHeight,
  Radius,
  Space,
} from '../../theme/tokens';
import { Bubble } from './Bubble';

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
/** The category glyph's round well, the header avatar's size. */
const GLYPH_WELL = ControlSize.pill - Space.md;

/**
 * An approval request in the conversation (A+ chat design, owner decision
 * 2026-09-30): the Agent's bubble asks — category glyph in an amber well,
 * the question, the exact command in a code well, the Agent's reason — and
 * Telegram-style buttons hang under it, Reject beside the solid Allow. A long
 * press on Allow offers "always". Settled, the bubble keeps the question,
 * the outcome and the command, and the buttons go away.
 */
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
  const theme = useConversationTheme();
  const surfaces = useChatSurfaces();
  const styles = useMemo(() => createStyles(theme.colors, surfaces.well), [surfaces.well, theme.colors]);
  const [pressedSlot, setPressedSlot] = useState<ActionSlot | null>(null);

  // Forget the pressed button once the backend answers, so a retried or recycled request never spins the wrong one.
  useEffect(() => {
    if (!busy) setPressedSlot(null);
  }, [busy]);

  const settled = outcome !== undefined;
  const OutcomeIcon = outcome ? OUTCOME_ICONS[outcome.kind] : null;
  const spinningSlot = busy ? pressedSlot : null;
  const button = (slot: ActionSlot, action: ApprovalCardAction) => ({
    key: slot,
    label: action.label,
    tone: slot === 'primary' ? 'primary' as const : 'default' as const,
    busy: spinningSlot === slot,
    disabled: (busy && spinningSlot !== slot) || action.disabled === true,
    accessibilityLabel: action.accessibilityLabel ?? action.label,
    testID: testID ? `${testID}-${slot}` : undefined,
    onPress: () => {
      setPressedSlot(slot);
      action.onPress();
    },
    onLongPress: action.onLongPress ? () => {
      setPressedSlot(slot);
      action.onLongPress?.();
    } : undefined,
  });

  return (
    <View
      testID={testID}
      accessibilityState={{ disabled: settled }}
      style={[styles.message, style]}
    >
      <Bubble testID={testID ? `${testID}-bubble` : undefined} role="assistant" style={styles.bubble}>
        <View style={styles.header}>
          {Icon ? (
            <View testID={testID ? `${testID}-glyph` : undefined} style={[styles.glyph, settled ? styles.glyphSettled : null]}>
              <Icon size={IconSize.sm} color={settled ? theme.colors.inkSecondary : theme.colors.warn} strokeWidth={1.75} />
            </View>
          ) : null}
          <Text style={styles.title} numberOfLines={2}>{title}</Text>
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
      </Bubble>
      {settled ? null : (
        <InlineKeyboard
          testID={testID ? `${testID}-actions` : undefined}
          buttons={[button('secondary', secondaryAction), button('primary', primaryAction)]}
        />
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
  const theme = useConversationTheme();
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

function createStyles(colors: ReturnType<typeof useConversationTheme>['colors'], well: string) {
  return StyleSheet.create({
    // A fixed share of the row, so the two buttons under it never squeeze.
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
      gap: Space.sm,
    },
    glyph: {
      width: GLYPH_WELL,
      height: GLYPH_WELL,
      borderRadius: Radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.warnSoft,
    },
    glyphSettled: {
      backgroundColor: well,
    },
    title: {
      flex: 1,
      color: colors.ink,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.semibold,
    },
    outcome: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
      flexShrink: 0,
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
      backgroundColor: well,
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
  });
}
