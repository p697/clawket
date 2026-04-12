import React, { useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputContentSizeChangeEvent,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import Animated, {
  FadeIn,
  FadeOut,
  ZoomIn,
  ZoomOut,
  cancelAnimation,
  Easing,
  withRepeat,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Brain, MessageSquareText, Mic, Orbit, Paperclip, TerminalSquare, Wrench } from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';
import { useAppContext } from '../../contexts/AppContext';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Shadow, Space } from '../../theme/tokens';
import type { ThinkingLevel } from '../../utils/gateway-settings';
import { isComposerInputEditable } from '../../screens/ChatScreen/hooks/composerInteractionPolicy';
import { CircleButton, IconButton } from '../ui';
import { AttachmentMenu } from './AttachmentMenu';
import { ThinkingLevelMenu } from './ThinkingLevelMenu';

export type ChatComposerHandle = {
  clear: () => void;
  blur: () => void;
};

type Props = {
  value: string;
  placeholder: string;
  /** When true, placeholder text is animated (fade transition on change). */
  animatedPlaceholder?: boolean;
  editable: boolean;
  canSend: boolean;
  onChangeText: (value: string) => void;
  onSend: () => void;
  onPickImage: () => void | Promise<void>;
  onTakePhoto: () => void | Promise<void>;
  onChooseFile: () => void | Promise<void>;
  onCommandPress: () => void;
  attachDisabled: boolean;
  commandDisabled?: boolean;
  thinkingLevel?: string | null;
  thinkingLevelOptions?: ThinkingLevel[];
  onSelectThinkingLevel?: (value: string) => void;
  modelLabel?: string | null;
  onModelPress?: () => void;
  onWebSearchPress?: () => void;
  onPromptPress?: () => void;
  isSending?: boolean;
  onAbort?: () => void;
  bottomPadding: number;
  bottomOffset: number;
  composerRef?: React.Ref<ChatComposerHandle>;
  onFocus?: () => void;
  onBlur?: () => void;
  onVoiceInputPress?: () => void;
  showVoiceInput?: boolean;
  voiceInputActive?: boolean;
  voiceInputDisabled?: boolean;
  voiceInputLevel?: number;
};

function StopGlyph({ color }: { color: string }): React.JSX.Element {
  return <View style={[sharedStyles.stopGlyph, { backgroundColor: color }]} />;
}

function SendArrowGlyph({ color }: { color: string }): React.JSX.Element {
  return (
    <View style={sharedStyles.sendArrowWrap}>
      <Svg width={22} height={22} viewBox="0 0 20 20" fill="none">
        <Path
          d="M10 16.75C9.31 16.75 8.75 16.19 8.75 15.5V9.02L6.28 11.49C5.79 11.98 5 11.98 4.51 11.49C4.02 11 4.02 10.21 4.51 9.72L9.11 5.12C9.6 4.63 10.4 4.63 10.89 5.12L15.49 9.72C15.98 10.21 15.98 11 15.49 11.49C15 11.98 14.21 11.98 13.72 11.49L11.25 9.02V15.5C11.25 16.19 10.69 16.75 10 16.75Z"
          fill={color}
        />
      </Svg>
    </View>
  );
}

export function ChatComposer({ value, placeholder, animatedPlaceholder = false, editable, canSend, onChangeText, onSend, onPickImage, onTakePhoto, onChooseFile, onCommandPress, attachDisabled, commandDisabled = false, thinkingLevel, thinkingLevelOptions, onSelectThinkingLevel, modelLabel, onModelPress, onWebSearchPress, onPromptPress, isSending = false, onAbort, bottomPadding, bottomOffset, composerRef, onFocus, onBlur, onVoiceInputPress, showVoiceInput = false, voiceInputActive = false, voiceInputDisabled = false, voiceInputLevel = 0 }: Props): React.JSX.Element {
  const inputRef = useRef<TextInput>(null);
  const inputContentHeightRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const voiceLevelRingScale = useSharedValue(1);
  const voiceLevelRingOpacity = useSharedValue(0);

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!voiceInputActive) {
      cancelAnimation(voiceLevelRingScale);
      cancelAnimation(voiceLevelRingOpacity);
      voiceLevelRingScale.value = withSpring(1, { damping: 18, stiffness: 220, mass: 0.8 });
      voiceLevelRingOpacity.value = withSpring(0, { damping: 18, stiffness: 220, mass: 0.8 });
      return;
    }

    voiceLevelRingScale.value = withRepeat(
      withSequence(
        withTiming(1.05, { duration: 650, easing: Easing.out(Easing.quad) }),
        withTiming(1.01, { duration: 950, easing: Easing.inOut(Easing.quad) })
      ),
      -1,
      false
    );
    voiceLevelRingOpacity.value = withRepeat(
      withSequence(
        withTiming(0.08, { duration: 650, easing: Easing.out(Easing.quad) }),
        withTiming(0.03, { duration: 950, easing: Easing.inOut(Easing.quad) })
      ),
      -1,
      false
    );

    const clampedLevel = Math.max(0, Math.min(voiceInputLevel, 1));
    if (clampedLevel > 0.015) {
      cancelAnimation(voiceLevelRingScale);
      cancelAnimation(voiceLevelRingOpacity);
      voiceLevelRingScale.value = withSpring(1.04 + clampedLevel * 0.34, {
        damping: 16,
        stiffness: 210,
        mass: 0.82,
      });
      voiceLevelRingOpacity.value = withSpring(0.06 + clampedLevel * 0.22, {
        damping: 18,
        stiffness: 200,
        mass: 0.86,
      });
    }
  }, [voiceInputActive, voiceInputLevel, voiceLevelRingOpacity, voiceLevelRingScale]);

  const voiceButtonRingAnimatedStyle = useAnimatedStyle(() => ({
    opacity: voiceLevelRingOpacity.value,
    transform: [{ scale: voiceLevelRingScale.value }],
  }));

  const scrollComposerToEnd = () => {
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current);
    }
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const input = inputRef.current as (TextInput & {
        scrollToEnd?: (options?: { animated?: boolean }) => void;
      }) | null;
      input?.scrollToEnd?.({ animated: false });
    });
  };

  const handleInputContentSizeChange = (event: TextInputContentSizeChangeEvent) => {
    const nextHeight = event.nativeEvent.contentSize.height;
    const previousHeight = inputContentHeightRef.current;
    inputContentHeightRef.current = nextHeight;

    if (voiceInputActive && nextHeight > previousHeight) {
      scrollComposerToEnd();
    }
  };

  useImperativeHandle(composerRef, () => ({
    clear: () => {
      // Clear the native input without remounting (preserves keyboard)
      inputRef.current?.clear();
    },
    blur: () => {
      inputRef.current?.blur();
    },
  }), []);
  const { t } = useTranslation('chat');
  const { chatAppearance } = useAppContext();
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors, theme.scheme), [theme]);
  const { colors } = theme;
  const badgeTextColor = colors.textMuted;
  const wallpaperActive = chatAppearance.background.enabled && !!chatAppearance.background.imagePath;

  const showThinkBadge = !!thinkingLevel && thinkingLevel !== 'off' && !!onSelectThinkingLevel;
  const showModelBadge = !!modelLabel && !!onModelPress;
  const showWebSearchBadge = !!onWebSearchPress;
  const showPromptBadge = !!onPromptPress;
  const showAbortButton = isSending && !!onAbort;
  const inputEditable = isComposerInputEditable({
    editable,
    voiceInputActive,
  });
  const sendButtonDisabled = showAbortButton ? false : !canSend;
  const sendButtonColor = showAbortButton ? colors.textMuted : colors.primary;
  const sendButtonIcon = showAbortButton
    ? <StopGlyph color={colors.iconOnColor} />
    : <SendArrowGlyph color={colors.primaryText} />;
  const handlePrimaryAction = () => {
    if (showAbortButton) {
      onAbort?.();
      return;
    }
    onSend();
  };

  const blurTint = theme.scheme === 'dark' ? 'dark' : 'light' as const;
  const blurIntensity = Platform.OS === 'ios' ? 24 : 0;

  const badgeBg = wallpaperActive ? 'transparent' : colors.inputBackground;
  const badgeBgPressed = wallpaperActive ? 'transparent' : colors.surfaceMuted;
  const badgeBorder = wallpaperActive ? 'transparent' : colors.border;

  const renderBlurBadge = (content: React.ReactNode, onPress?: () => void, extraStyle?: object) => {
    if (!wallpaperActive) return null;
    return (
      <Pressable
        onPress={onPress ? () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); } : undefined}
        style={[styles.blurBadgeClip, extraStyle]}
      >
        <BlurView tint={blurTint} intensity={blurIntensity} style={StyleSheet.absoluteFill}>
          <View style={styles.blurBadgeTint} />
        </BlurView>
        {content}
      </Pressable>
    );
  };

  const badgeBar = (showThinkBadge || showModelBadge || showWebSearchBadge || showPromptBadge) ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.badgeScroll} contentContainerStyle={styles.badgeRow}>
      {showModelBadge && (
        wallpaperActive ? renderBlurBadge(
          <>
            <Orbit size={12} color={colors.badgeModel} strokeWidth={2} />
            <Text style={[styles.badgeText, styles.badgeModelText, { color: badgeTextColor }]} numberOfLines={1}>{modelLabel}</Text>
          </>,
          onModelPress,
          styles.badgeModelWrap,
        ) : (
          <Pressable
            style={({ pressed }) => [styles.badge, styles.badgeModelWrap, { backgroundColor: pressed ? badgeBgPressed : badgeBg, borderColor: badgeBorder }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onModelPress(); }}
          >
            <Orbit size={12} color={colors.badgeModel} strokeWidth={2} />
            <Text style={[styles.badgeText, styles.badgeModelText, { color: badgeTextColor }]} numberOfLines={1}>{modelLabel}</Text>
          </Pressable>
        )
      )}
      {showThinkBadge && (
        <ThinkingLevelMenu
          current={thinkingLevel ?? ''}
          onSelect={onSelectThinkingLevel!}
          title={t('Thinking Level')}
          options={thinkingLevelOptions}
        >
          {wallpaperActive ? (
            <View style={styles.blurBadgeClip}>
              <BlurView tint={blurTint} intensity={blurIntensity} style={StyleSheet.absoluteFill}>
                <View style={styles.blurBadgeTint} />
              </BlurView>
              <Brain size={12} color={colors.badgeThinking} strokeWidth={2} />
              <Text style={[styles.badgeText, { color: badgeTextColor }]}>{t(`thinking_${thinkingLevel}`)}</Text>
            </View>
          ) : (
            <View style={[styles.badge, { backgroundColor: badgeBg, borderColor: badgeBorder }]}>
              <Brain size={12} color={colors.badgeThinking} strokeWidth={2} />
              <Text style={[styles.badgeText, { color: badgeTextColor }]}>{t(`thinking_${thinkingLevel}`)}</Text>
            </View>
          )}
        </ThinkingLevelMenu>
      )}
      {showWebSearchBadge && (
        wallpaperActive ? renderBlurBadge(
          <>
            <Wrench size={12} color={colors.badgeTools} strokeWidth={2} />
            <Text style={[styles.badgeText, { color: badgeTextColor }]}>{t('Tools')}</Text>
          </>,
          onWebSearchPress!,
        ) : (
          <Pressable
            style={({ pressed }) => [styles.badge, { backgroundColor: pressed ? badgeBgPressed : badgeBg, borderColor: badgeBorder }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onWebSearchPress!(); }}
          >
            <Wrench size={12} color={colors.badgeTools} strokeWidth={2} />
            <Text style={[styles.badgeText, { color: badgeTextColor }]}>{t('Tools')}</Text>
          </Pressable>
        )
      )}
      {showPromptBadge && (
        wallpaperActive ? renderBlurBadge(
          <>
            <MessageSquareText size={12} color={colors.badgePrompts} strokeWidth={2} />
            <Text style={[styles.badgeText, { color: badgeTextColor }]}>{t('Prompts')}</Text>
          </>,
          onPromptPress!,
        ) : (
          <Pressable
            style={({ pressed }) => [styles.badge, { backgroundColor: pressed ? badgeBgPressed : badgeBg, borderColor: badgeBorder }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPromptPress!(); }}
          >
            <MessageSquareText size={12} color={colors.badgePrompts} strokeWidth={2} />
            <Text style={[styles.badgeText, { color: badgeTextColor }]}>{t('Prompts')}</Text>
          </Pressable>
        )
      )}
    </ScrollView>
  ) : null;

  const attachButton = (
    <AttachmentMenu
      disabled={attachDisabled || !inputEditable}
      onPickImage={onPickImage}
      onTakePhoto={onTakePhoto}
      onChooseFile={onChooseFile}
    >
      {wallpaperActive ? (
        <View style={styles.blurButtonClip}>
          <BlurView tint={blurTint} intensity={blurIntensity} style={styles.blurButtonFill}>
            <View style={styles.blurButtonTint} />
          </BlurView>
          <View style={styles.blurButtonIcon}>
            <Paperclip size={20} color={attachDisabled ? colors.textSubtle : colors.text} strokeWidth={1.8} />
          </View>
        </View>
      ) : (
        <View style={styles.attachButtonTrigger}>
          <Paperclip size={20} color={attachDisabled ? colors.textSubtle : colors.text} strokeWidth={1.8} />
        </View>
      )}
    </AttachmentMenu>
  );

  const inputField = (
    <View style={[styles.inputWrap, wallpaperActive && styles.inputWrapWallpaper]}>
      {wallpaperActive && (
        <BlurView tint={blurTint} intensity={blurIntensity} style={styles.inputBlurFill}>
          <View style={styles.inputBlurTint} />
        </BlurView>
      )}
      <TextInput
        ref={inputRef}
        style={[styles.input, wallpaperActive && styles.inputWallpaper]}
        value={value}
        placeholder={animatedPlaceholder && !value ? undefined : placeholder}
        placeholderTextColor={theme.colors.textSubtle}
        onChangeText={onChangeText}
        onFocus={onFocus}
        onBlur={onBlur}
        onContentSizeChange={handleInputContentSizeChange}
        editable={inputEditable}
        multiline
      />
      {animatedPlaceholder && !value && (
        <Animated.Text
          key={placeholder}
          entering={FadeIn.duration(320)}
          exiting={FadeOut.duration(220)}
          style={[styles.animatedPlaceholder, { color: theme.colors.textMuted }]}
          pointerEvents="none"
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {placeholder}
        </Animated.Text>
      )}
    </View>
  );

  const voiceButton = showVoiceInput ? (
    voiceInputActive ? (
      <Animated.View
        entering={ZoomIn.springify().damping(14).stiffness(260).mass(0.7)}
        exiting={ZoomOut.springify().damping(16).stiffness(240).mass(0.75)}
        style={styles.voiceInputButtonWrap}
      >
        <Animated.View style={[styles.voiceInputRing, { backgroundColor: colors.error }, voiceButtonRingAnimatedStyle]} />
        <CircleButton
          icon={<StopGlyph color={colors.iconOnColor} />}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onVoiceInputPress?.(); }}
          disabled={voiceInputDisabled}
          size={36}
          color={colors.error}
          disabledColor={colors.borderStrong}
          shadow
        />
      </Animated.View>
    ) : (
      <Animated.View
        entering={ZoomIn.springify().damping(16).stiffness(240).mass(0.75)}
        exiting={ZoomOut.springify().damping(14).stiffness(260).mass(0.7)}
        style={styles.voiceInputButtonWrap}
      >
        {wallpaperActive ? (
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onVoiceInputPress?.(); }}
            disabled={voiceInputDisabled}
            style={styles.blurButtonClip}
          >
            <BlurView tint={blurTint} intensity={blurIntensity} style={styles.blurButtonFill}>
              <View style={styles.blurButtonTint} />
            </BlurView>
            <View style={styles.blurButtonIcon}>
              <Mic size={20} color={voiceInputDisabled ? colors.textSubtle : colors.textMuted} strokeWidth={2} />
            </View>
          </Pressable>
        ) : (
          <IconButton
            icon={<Mic size={20} color={voiceInputDisabled ? colors.textSubtle : colors.textMuted} strokeWidth={2} />}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onVoiceInputPress?.(); }}
            disabled={voiceInputDisabled}
            size={36}
          />
        )}
      </Animated.View>
    )
  ) : null;

  const inputRowContent = (
    <View style={styles.inputRow}>
      {attachButton}
      {inputField}
      {voiceButton}
      <CircleButton
        icon={sendButtonIcon}
        onPress={handlePrimaryAction}
        disabled={sendButtonDisabled}
        size={36}
        color={sendButtonColor}
        disabledColor={colors.borderStrong}
      />
    </View>
  );

  return (
    <View
      style={[
        styles.composer,
        !wallpaperActive && styles.composerSurface,
        { paddingBottom: bottomPadding + bottomOffset },
      ]}
    >
      {badgeBar}
      {inputRowContent}
    </View>
  );
}

function createStyles(
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
  scheme: 'light' | 'dark',
) {
  const tintOverlay = scheme === 'dark'
    ? 'rgba(11,18,32,0.68)'
    : 'rgba(255,255,255,0.82)';
  const blurOutline = scheme === 'dark'
    ? 'rgba(255,255,255,0.12)'
    : 'rgba(255,255,255,0.66)';

  return StyleSheet.create({
    composer: {
      paddingHorizontal: Space.sm,
      paddingTop: 6,
    },
    composerSurface: {
      backgroundColor: colors.background,
    },
    badgeScroll: {
      paddingBottom: 6,
    },
    badgeRow: {
      flexDirection: 'row',
      gap: Space.xs,
      paddingLeft: Space.xs,
      paddingRight: Space.xs,
    },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      paddingHorizontal: Space.sm,
      paddingVertical: 3,
      borderRadius: Radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    badgeText: {
      marginLeft: 2,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.medium as '500',
    },
    badgeModelWrap: {
      maxWidth: 220,
    },
    badgeModelText: {
      maxWidth: 188,
    },
    blurBadgeClip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      paddingHorizontal: Space.sm,
      paddingVertical: 3,
      borderRadius: Radius.sm,
      borderWidth: 1,
      borderColor: blurOutline,
      overflow: 'hidden',
    },
    blurBadgeTint: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: tintOverlay,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
    },
    inputWrap: {
      flex: 1,
      overflow: 'hidden',
    },
    inputWrapWallpaper: {
      borderRadius: 22,
      borderWidth: 1,
      borderColor: blurOutline,
      overflow: 'hidden',
    },
    input: {
      backgroundColor: colors.inputBackground,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 22,
      color: colors.text,
      fontSize: FontSize.base,
      maxHeight: 120,
      paddingHorizontal: Space.lg,
      paddingVertical: 10,
    },
    inputWallpaper: {
      backgroundColor: 'transparent',
      borderColor: 'transparent',
    },
    inputBlurFill: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: 22,
      overflow: 'hidden',
    },
    inputBlurTint: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: tintOverlay,
    },
    animatedPlaceholder: {
      position: 'absolute',
      left: Space.lg,
      right: Space.lg,
      top: 11,
      fontSize: FontSize.base,
    },
    attachButtonTrigger: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: Radius.full,
    },
    blurButtonClip: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: blurOutline,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
    },
    blurButtonFill: {
      ...StyleSheet.absoluteFillObject,
    },
    blurButtonTint: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: tintOverlay,
    },
    blurButtonIcon: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    voiceInputButtonWrap: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'visible',
    },
    voiceInputRing: {
      position: 'absolute',
      width: 42,
      height: 42,
      borderRadius: 21,
    },
  });
}

const sharedStyles = StyleSheet.create({
  sendArrowWrap: {
    transform: [{ translateY: -1 }],
  },
  stopGlyph: {
    width: 10,
    height: 10,
    borderRadius: 4,
  },
});
