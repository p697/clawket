import React from 'react';
import { Platform, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { X } from 'lucide-react-native';
import { ChevronLeft } from './DirectionalIcon';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import { ControlSize, FontSize, FontWeight, HitSize, LineHeight, Space } from '../../theme/tokens';
import { FloatingButton, type FloatingButtonAppearance } from './FloatingButton';

type Props = {
  title: string;
  topInset: number;
  onBack?: () => void;
  dismissStyle?: 'back' | 'close';
  subtitle?: string;
  /** Connection state; the title yields its slot so the header never grows. */
  status?: React.ReactNode;
  topInsetBehavior?: 'auto' | 'safe' | 'compact' | 'none';
  leftContent?: React.ReactNode;
  rightContent?: React.ReactNode;
  showBorder?: boolean;
  /** Long translated titles may take a second line instead of truncating. */
  titleNumberOfLines?: number;
  /** Chrome of the dismiss control: the white floating circle by default, `glass` over a chat wallpaper. */
  dismissAppearance?: Extract<FloatingButtonAppearance, 'surface' | 'glass'>;
  backAccessibilityLabel?: string;
  style?: ViewStyle;
  leftSlotStyle?: ViewStyle;
  rightSlotStyle?: ViewStyle;
  testID?: string;
  /** Defaults derive from `testID`: `-back`, `-title`, `-status`. */
  backTestID?: string;
  titleTestID?: string;
  statusTestID?: string;
};

/**
 * The one page header. Every content-owned screen top is this geometry: the
 * safe-area inset plus 8 points, one 44-point control row inset 16 points
 * from the screen edge, and 8 points below it. The dismiss control is a
 * white 44-point floating circle (owner decision 2026-09-19); the title (or the connection status that replaces
 * it) is centered on the screen, not between the slots; page content starts
 * a further 16 points down, so a control sits 24 points above the content.
 */
export function ScreenHeader({
  title,
  topInset,
  onBack,
  dismissStyle = 'back',
  subtitle,
  status,
  topInsetBehavior = 'auto',
  leftContent,
  rightContent,
  showBorder,
  titleNumberOfLines = 1,
  dismissAppearance = 'surface',
  backAccessibilityLabel,
  style,
  leftSlotStyle,
  rightSlotStyle,
  testID,
  backTestID,
  titleTestID,
  statusTestID,
}: Props): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('common');
  const { colors } = theme;
  const resolvedTopInsetBehavior =
    topInsetBehavior === 'auto'
      ? (dismissStyle === 'close' ? 'compact' : 'safe')
      : topInsetBehavior;
  const resolvedTopPadding =
    resolvedTopInsetBehavior === 'none'
      ? 0
      : resolvedTopInsetBehavior === 'compact'
        // On Android, close-style content headers need the full safe-area
        // inset or they can slide under the system status bar.
        ? Platform.OS === 'android'
          ? topInset
          : Math.min(topInset, Space.lg)
        : topInset + Space.sm;
  const resolvedShowBorder = showBorder ?? false;

  return (
    <View
      testID={testID}
      collapsable={false}
      style={[
        styles.headerOuter,
        {
          paddingTop: resolvedTopPadding,
          backgroundColor: colors.canvas,
          borderBottomColor: colors.line,
          borderBottomWidth: resolvedShowBorder ? StyleSheet.hairlineWidth : 0,
        },
        style,
      ]}
    >
      <View style={styles.headerRow}>
        <View style={styles.titleLayer} pointerEvents={status ? 'box-none' : 'none'}>
          {status ? (
            <View testID={statusTestID ?? (testID ? `${testID}-status` : undefined)} style={styles.status}>{status}</View>
          ) : (
            <>
              <Text
                testID={titleTestID ?? (testID ? `${testID}-title` : undefined)}
                style={[styles.title, { color: colors.ink }]}
                numberOfLines={titleNumberOfLines}
              >
                {title}
              </Text>
              {subtitle ? (
                <Text style={[styles.subtitle, { color: colors.inkSecondary }]} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </>
          )}
        </View>
        <View style={[styles.leftSlot, leftSlotStyle]}>
          {leftContent ?? (onBack ? (
            <FloatingButton
              testID={backTestID ?? (testID ? `${testID}-back` : undefined)}
              icon={dismissStyle === 'close' ? X : ChevronLeft}
              appearance={dismissAppearance}
              onPress={onBack}
              accessibilityLabel={backAccessibilityLabel ?? t(dismissStyle === 'close' ? 'Close' : 'Back')}
            />
          ) : null)}
        </View>
        <View style={styles.spacer} />
        <View style={[styles.rightSlot, rightSlotStyle]}>
          {rightContent ?? null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerOuter: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: ControlSize.floatingButton,
  },
  // Centered on the screen; the side padding keeps it clear of both slots.
  titleLayer: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: HitSize.lg,
  },
  status: {
    maxWidth: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  leftSlot: {
    minWidth: ControlSize.floatingButton,
    alignItems: 'flex-start',
  },
  spacer: {
    flex: 1,
  },
  title: {
    textAlign: 'center',
    fontSize: FontSize.title,
    lineHeight: LineHeight.title,
    fontWeight: FontWeight.semibold,
  },
  subtitle: {
    marginTop: 2,
    textAlign: 'center',
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
    fontWeight: FontWeight.semibold,
  },
  rightSlot: {
    minWidth: ControlSize.floatingButton,
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Space.xs,
  },
});
