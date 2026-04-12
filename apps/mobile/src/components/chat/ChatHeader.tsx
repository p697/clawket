import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Menu, RefreshCw, Users } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { ConnectionState } from "../../types";
import { useAppTheme } from "../../theme";
import { Radius, Shadow, Space } from "../../theme/tokens";
import { extractDisplayAgentEmoji } from "../../utils/agent-emoji";
import { IconButton } from "../ui";

type Props = {
  title: string;
  connectionState: ConnectionState;
  isTyping: boolean;
  agentName: string;
  activityLabel?: string | null;
  statusLabel?: string | null;
  agentEmoji?: string;
  onOpenSidebar: () => void;
  onRefresh: () => void;
  contextLabel?: string | null;
  modelLabel?: string | null;
  hasOtherAgentActivity?: boolean;
  onAgentActivity?: () => void;
  refreshDisabled: boolean;
  refreshing: boolean;
  topPadding: number;
  wallpaperActive?: boolean;
};

function TypingDots({ color }: { color: string }) {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, {
            toValue: 1,
            duration: 300,
            easing: Easing.ease,
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0,
            duration: 300,
            easing: Easing.ease,
            useNativeDriver: true,
          }),
          Animated.delay(600 - delay),
        ]),
      );
    const a1 = animate(dot1, 0);
    const a2 = animate(dot2, 200);
    const a3 = animate(dot3, 400);
    a1.start();
    a2.start();
    a3.start();
    return () => {
      a1.stop();
      a2.stop();
      a3.stop();
    };
  }, [dot1, dot2, dot3]);

  const dotStyle = (anim: Animated.Value) => ({
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: color,
    marginHorizontal: 1.5,
    opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
    transform: [
      {
        translateY: anim.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -2],
        }),
      },
    ],
  });

  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginLeft: 4 }}>
      <Animated.View style={dotStyle(dot1)} />
      <Animated.View style={dotStyle(dot2)} />
      <Animated.View style={dotStyle(dot3)} />
    </View>
  );
}

export function ChatHeader({
  title,
  connectionState,
  isTyping,
  agentName,
  activityLabel,
  statusLabel,
  agentEmoji,
  onOpenSidebar,
  onRefresh,
  contextLabel,
  modelLabel,
  hasOtherAgentActivity,
  onAgentActivity,
  refreshDisabled,
  refreshing,
  topPadding,
  wallpaperActive,
}: Props): React.JSX.Element {
  const { t } = useTranslation("chat");
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors, theme.scheme), [theme]);
  const { colors } = theme;
  const refreshSpin = useRef(new Animated.Value(0)).current;
  const headerActionIconSize = 20;
  const headerActionIconColor = colors.textMuted;
  const headerActionStrokeWidth = 2;
  const displayEmoji = extractDisplayAgentEmoji(agentEmoji);
  const refreshIconStyle = useMemo(
    () => ({
      transform: [
        {
          rotate: refreshSpin.interpolate({
            inputRange: [0, 1],
            outputRange: ["0deg", "360deg"],
          }),
        },
      ],
    }),
    [refreshSpin],
  );

  useEffect(() => {
    if (!refreshing) {
      refreshSpin.stopAnimation();
      refreshSpin.setValue(0);
      return;
    }

    refreshSpin.setValue(0);
    const spinLoop = Animated.loop(
      Animated.timing(refreshSpin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    spinLoop.start();

    return () => {
      spinLoop.stop();
      refreshSpin.stopAnimation();
      refreshSpin.setValue(0);
    };
  }, [refreshSpin, refreshing]);

  // --- Delayed typing display with fade transition ---
  const [showTyping, setShowTyping] = useState(isTyping);
  const [displayedActivity, setDisplayedActivity] = useState(activityLabel);
  const subtitleFade = useRef(new Animated.Value(1)).current;
  const typingDelayRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    clearTimeout(typingDelayRef.current);
    if (isTyping === showTyping) return;

    const performSwitch = () => {
      Animated.timing(subtitleFade, {
        toValue: 0,
        duration: 120,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) return;
        setShowTyping(isTyping);
        setDisplayedActivity(activityLabel);
        Animated.timing(subtitleFade, {
          toValue: 1,
          duration: 120,
          useNativeDriver: true,
        }).start();
      });
    };

    if (isTyping) {
      typingDelayRef.current = setTimeout(performSwitch, 300);
    } else {
      performSwitch();
    }

    return () => clearTimeout(typingDelayRef.current);
  }, [isTyping]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fade on activity label change while typing
  useEffect(() => {
    if (activityLabel === displayedActivity) return;
    if (!showTyping) {
      setDisplayedActivity(activityLabel);
      return;
    }
    Animated.timing(subtitleFade, {
      toValue: 0,
      duration: 100,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      setDisplayedActivity(activityLabel);
      Animated.timing(subtitleFade, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }).start();
    });
  }, [activityLabel]); // eslint-disable-line react-hooks/exhaustive-deps

  const headerContent = (
    <>
      <IconButton
        icon={
          <Menu
            size={headerActionIconSize}
            color={headerActionIconColor}
            strokeWidth={headerActionStrokeWidth}
          />
        }
        onPress={onOpenSidebar}
      />

      <View style={styles.titleBlock}>
        <Text style={[styles.headerTitle, wallpaperActive && styles.headerTitleWallpaper]} numberOfLines={1}>
          {displayEmoji ? `${displayEmoji} ${title}` : title}
        </Text>
        <Animated.View style={{ opacity: subtitleFade }}>
          {showTyping ? (
            <View style={styles.typingRow}>
              <Text style={styles.typingText}>
                {displayedActivity || t("Thinking")}
              </Text>
              <TypingDots color={colors.primary} />
            </View>
          ) : statusLabel ? (
            <Text style={styles.statusText} numberOfLines={1}>
              {statusLabel}
            </Text>
          ) : [modelLabel, contextLabel].filter(Boolean).join(" · ") ? (
            <Text style={styles.contextText} numberOfLines={1}>
              {[modelLabel, contextLabel].filter(Boolean).join(" · ")}
            </Text>
          ) : null}
        </Animated.View>
      </View>

      <View
        style={[
          styles.statusDot,
          connectionState === "ready"
            ? styles.dotGreen
            : connectionState === "pairing_pending"
              ? styles.dotOrange
              : styles.dotYellow,
        ]}
      />

      {onAgentActivity && (
        <View style={styles.activityButtonWrap}>
          <IconButton
            icon={
              <Users
                size={headerActionIconSize}
                color={headerActionIconColor}
                strokeWidth={headerActionStrokeWidth}
              />
            }
            onPress={onAgentActivity}
          />
          {hasOtherAgentActivity && <View style={styles.activityBadge} />}
        </View>
      )}

      <IconButton
        icon={
          <Animated.View style={refreshing ? refreshIconStyle : undefined}>
            <RefreshCw
              size={headerActionIconSize}
              color={headerActionIconColor}
              strokeWidth={headerActionStrokeWidth}
            />
          </Animated.View>
        }
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onRefresh();
        }}
        disabled={refreshDisabled}
      />
    </>
  );

  if (wallpaperActive) {
    return (
      <View style={[styles.headerWallpaperOuter, { paddingTop: topPadding }]}>
        <View style={styles.headerWallpaperPill}>
          {headerContent}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.header, { paddingTop: topPadding }]}>
      {headerContent}
    </View>
  );
}

function createStyles(
  colors: ReturnType<typeof useAppTheme>["theme"]["colors"],
  scheme: 'light' | 'dark',
) {
  const wallpaperPillBg = scheme === 'dark'
    ? 'rgba(11,18,32,0.55)'
    : 'rgba(255,255,255,0.65)';

  return StyleSheet.create({
    header: {
      backgroundColor: colors.surface,
      borderBottomColor: colors.border,
      borderBottomWidth: 1,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 4,
      paddingBottom: 2,
    },
    headerWallpaperOuter: {
      paddingHorizontal: Space.sm,
      paddingBottom: Space.xs,
    },
    headerWallpaperPill: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: wallpaperPillBg,
      borderRadius: Radius.lg,
      paddingHorizontal: 2,
      paddingVertical: 2,
      ...Shadow.sm,
    },
    titleBlock: {
      flex: 1,
      marginHorizontal: 10,
    },
    headerTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.text,
    },
    headerTitleWallpaper: {
      textShadowColor: scheme === 'dark' ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.1)',
      textShadowOffset: { width: 0, height: 0.5 },
      textShadowRadius: 2,
    },
    typingRow: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: 3,
    },
    typingText: {
      fontSize: 12,
      color: colors.primary,
      fontWeight: "500",
      marginTop: -1,
    },
    statusText: {
      marginTop: 2,
      fontSize: 12,
      color: colors.textMuted,
      fontWeight: "500",
    },
    contextText: {
      fontSize: 12,
      color: colors.textMuted,
      fontWeight: "500",
      marginTop: 2,
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      marginLeft: 12,
      marginRight: 12,
    },
    dotGreen: { backgroundColor: colors.success },
    dotYellow: { backgroundColor: colors.warning },
    dotOrange: { backgroundColor: colors.warning },
    activityButtonWrap: {
      position: "relative" as const,
    },
    activityBadge: {
      position: "absolute" as const,
      top: 8,
      right: 8,
      width: 8,
      height: 8,
      borderRadius: 99,
      backgroundColor: colors.primary,
      borderWidth: 1.5,
      borderColor: colors.surface,
    },
  });
}
