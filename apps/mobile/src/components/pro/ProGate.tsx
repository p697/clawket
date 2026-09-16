import React, { useId, useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { LockKeyhole } from 'lucide-react-native';

import { Button } from '../ui/Button';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  IconSize,
  LineHeight,
  Space,
} from '../../theme/tokens';

/**
 * Last-step Pro gate. Real content renders beneath a veil that dissolves into
 * the page surface, so the user can see that the data exists without reading
 * it. The teaser is decorative: it never receives touches or accessibility
 * focus, and it holds real values rather than fabricated placeholders.
 *
 * A native blur is intentionally not used: the app has no blur dependency and
 * the design system keeps live blur out of product chrome. The veil is an SVG
 * gradient over dimmed content, which reads the same in light and dark themes.
 */
const TEASER_OPACITY = 0.62;
const TEASER_CLEAR_STOP = 0.32;
const TEASER_SOLID_STOP = 0.72;
const VEIL_MID_OPACITY = 0.6;
const VEIL_SOLID_OPACITY = 0.97;
export const PRO_GATE_TEASER_HEIGHT = ControlSize.settingsRow * 4;

export type ProGateProps = Readonly<{
  title: string;
  detail?: string;
  actionLabel: string;
  onUnlock: () => void;
  /** Real content shown beneath the veil. Omit for a plain notice. */
  children?: React.ReactNode;
  teaserHeight?: number;
  /** Surface the veil dissolves into; defaults to the grouped canvas. */
  surfaceColor?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

export function ProGate({
  title,
  detail,
  actionLabel,
  onUnlock,
  children,
  teaserHeight = PRO_GATE_TEASER_HEIGHT,
  surfaceColor,
  style,
  testID = 'pro-gate',
}: ProGateProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const gradientId = `proGateVeil${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const surface = surfaceColor ?? theme.colors.canvasGrouped;
  const hasTeaser = children !== undefined && children !== null && children !== false;

  return (
    <View
      testID={testID}
      style={[styles.root, hasTeaser ? { minHeight: teaserHeight } : null, style]}
    >
      {hasTeaser ? (
        <>
          <View
            testID={`${testID}-teaser`}
            pointerEvents="none"
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.teaser, { height: teaserHeight, opacity: TEASER_OPACITY }]}
          >
            {children}
          </View>
          <View pointerEvents="none" style={[styles.veil, { height: teaserHeight }]}>
            <Svg width="100%" height="100%" preserveAspectRatio="none">
              <Defs>
                <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <Stop offset={0} stopColor={surface} stopOpacity={0} />
                  <Stop offset={TEASER_CLEAR_STOP} stopColor={surface} stopOpacity={VEIL_MID_OPACITY} />
                  <Stop offset={TEASER_SOLID_STOP} stopColor={surface} stopOpacity={VEIL_SOLID_OPACITY} />
                  <Stop offset={1} stopColor={surface} stopOpacity={1} />
                </LinearGradient>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
            </Svg>
          </View>
        </>
      ) : null}
      <View
        testID={`${testID}-notice`}
        style={[styles.notice, hasTeaser ? { paddingTop: teaserHeight / 2 } : null]}
      >
        <LockKeyhole size={IconSize.md} color={theme.colors.inkSecondary} strokeWidth={1.75} />
        <Text style={styles.title}>{title}</Text>
        {detail ? <Text style={styles.detail}>{detail}</Text> : null}
        <Button
          testID={`${testID}-action`}
          label={actionLabel}
          multiline
          onPress={onUnlock}
          style={styles.action}
        />
      </View>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: {
      width: '100%',
    },
    teaser: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      overflow: 'hidden',
    },
    veil: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
    },
    notice: {
      flexGrow: 1,
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: Space.md,
      paddingHorizontal: Space.xl,
      paddingBottom: Space.sm,
    },
    title: {
      color: colors.ink,
      fontSize: FontSize.body,
      lineHeight: LineHeight.body,
      fontWeight: FontWeight.semibold,
      textAlign: 'center',
    },
    detail: {
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      textAlign: 'center',
    },
    action: {
      alignSelf: 'stretch',
      marginTop: Space.xs,
    },
  });
}
