import React, { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  DynamicColorIOS, Keyboard, PanResponder, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions,
  type StyleProp, type TextInput, type TextInputProps, type ViewStyle,
} from 'react-native';
import { ArrowUp, ChevronDown, Maximize2, Minimize2, Mic, Plus, Square, type LucideIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import Animated, {
  FadeIn, LinearTransition, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { shouldCaptureComposerKeyboardDismiss } from '../../chat/composerKeyboardDismiss';
import { triggerLightImpact } from '../../services/haptics';
import { useAppTheme } from '../../theme';
import { inputInkVariants } from '../../theme/theme';
import { ControlSize, FontSize, FontWeight, IconSize, LineHeight, Motion, Radius, Space } from '../../theme/tokens';
import { useConversationTheme } from '../chat/ChatPresentation';
import { CompositionSafeTextInput } from './CompositionSafeTextInput';
import { PasteCapableTextInput, type PastedFile } from './PasteCapableTextInput';

export type ComposerHandle = { focus: () => void; blur: () => void; clear: () => void };
export type ComposerVoiceState = 'idle' | 'authorizing' | 'listening';
export type ComposerAccessibilityLabels = {
  add: string; voice: string; stopVoice?: string; send: string; stop: string;
  /** Send while the Agent is still replying; falls back to `send`. */
  queue?: string;
};
export type ComposerProps = {
  accessory?: React.ReactNode;
  attachments?: React.ReactNode;
  notice?: React.ReactNode;
  value: string;
  placeholder: string;
  accessibilityLabels: ComposerAccessibilityLabels;
  onChangeText: (value: string) => void;
  onSend: () => void;
  onStop?: () => void;
  onAddPress?: () => void;
  onVoicePress?: () => void;
  onPasteFiles?: (files: readonly PastedFile[]) => void;
  onPasteFailed?: () => void;
  editable?: boolean;
  canSend?: boolean;
  hasAttachments?: boolean;
  isRunning?: boolean;
  addDisabled?: boolean;
  voiceDisabled?: boolean;
  /** Dictation lifecycle; anything but `idle` turns the trailing slot into a stop-dictation control. */
  voiceState?: ComposerVoiceState;
  /** Normalized 0–1 microphone level, driven on the UI thread so the halo never re-renders the thread. */
  voiceLevel?: SharedValue<number>;
  autoFocus?: boolean;
  maxLength?: number;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onFocus?: TextInputProps['onFocus'];
  onBlur?: TextInputProps['onBlur'];
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** One native input survives compact/expanded editing, including marked text and selection. */
export const Composer = React.forwardRef<ComposerHandle, ComposerProps>(function Composer({
  accessory, attachments, notice, value, placeholder, accessibilityLabels, onChangeText, onSend, onStop,
  onAddPress, onVoicePress, onPasteFiles, onPasteFailed, editable = true, canSend = true,
  hasAttachments = false, isRunning = false, addDisabled = false, voiceDisabled = false,
  voiceState = 'idle', voiceLevel,
  autoFocus = false, maxLength, expanded = false, onExpandedChange, onFocus, onBlur, style, testID,
}, forwardedRef): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('chat');
  const { fontScale, height: windowHeight } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const inputRef = useRef<TextInput>(null);
  const previousExpandedRef = useRef(expanded);
  const focusAfterLayoutRef = useRef(false);
  useLayoutEffect(() => {
    if (previousExpandedRef.current === expanded) return;
    previousExpandedRef.current = expanded;
    focusAfterLayoutRef.current = true;
    inputRef.current?.focus();
  }, [expanded]);
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const inputInk = useMemo(() => Platform.OS === 'ios' ? DynamicColorIOS(inputInkVariants) : theme.colors.ink, [theme.colors.ink]);
  const [contentHeight, setContentHeight] = useState(ControlSize.pill as number);
  const [focused, setFocused] = useState(false);
  const lineHeight = LineHeight.body * fontScale;
  const inputPadding = Space.sm * 2;
  const maxHeight = Math.max(ControlSize.pill, Math.min(lineHeight * 5 + inputPadding, windowHeight * 0.3));
  const targetHeight = value.length === 0 ? Math.max(ControlSize.pill, lineHeight + inputPadding)
    : Math.max(ControlSize.pill, Math.min(contentHeight, maxHeight));
  const animatedHeight = useSharedValue(targetHeight);
  useEffect(() => {
    animatedHeight.value = reducedMotion ? targetHeight : withTiming(targetHeight, { duration: Motion.duration.fast });
  }, [animatedHeight, targetHeight, reducedMotion]);
  const inputSizeStyle = useAnimatedStyle(() => expanded
    ? { height: undefined, flexGrow: 1, flexShrink: 1, flexBasis: 0 }
    : { height: animatedHeight.value, flexGrow: 0, flexShrink: 0, flexBasis: 'auto' }, [expanded]);
  // A downward drag on the compact composer puts the keyboard away, the way a
  // drag on the timeline does; the responder reads live focus/scroll state so
  // it is created once and never steals a scroll from a tall draft.
  const inputScrollable = !expanded && contentHeight > maxHeight;
  const gestureStateRef = useRef({ focused, inputScrollable });
  gestureStateRef.current = { focused, inputScrollable };
  const keyboardDismissResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_event, gesture) => shouldCaptureComposerKeyboardDismiss({
      dx: gesture.dx,
      dy: gesture.dy,
      inputFocused: gestureStateRef.current.focused,
      inputScrollable: gestureStateRef.current.inputScrollable,
      numberActiveTouches: gesture.numberActiveTouches,
    }),
    onPanResponderGrant: () => {
      inputRef.current?.blur();
      Keyboard.dismiss();
    },
  }), []);
  const showExpand = Boolean(onExpandedChange) && value.length > 0
    && (contentHeight > lineHeight * 2 + inputPadding + 1 || value.split('\n').length >= 3);
  const hasContent = value.trim().length > 0 || hasAttachments;
  // Dictation owns the trailing slot for its whole lifetime so the stop control
  // never disappears once the first transcript lands in the draft.
  const voiceActive = voiceState !== 'idle' && Boolean(onVoicePress);
  const showVoice = !voiceActive && !isRunning && !hasContent && Boolean(onVoicePress);
  // A draft written during a reply keeps Stop reachable and adds Send beside
  // it, so the message can join the queue without waiting for the turn to end.
  const showQueueSend = isRunning && hasContent;
  const primaryDisabled = isRunning && !hasContent ? !onStop : !editable || !canSend || !hasContent;
  const handleVoicePress = () => { triggerLightImpact(); onVoicePress?.(); };
  const inputProps: TextInputProps & { ref: React.Ref<TextInput>; value: string } = {
    ref: inputRef,
    testID: testID ? `${testID}-input` : undefined,
    accessibilityLabel: placeholder,
    value, onChangeText, placeholder,
    placeholderTextColor: theme.colors.inkTertiary,
    // A bounded native Text measurement sizes the shell without changing the
    // native-owned input or relying on delayed Fabric content-size events.
    style: [styles.input, { color: inputInk }, expanded ? styles.expandedInput : { minHeight: ControlSize.pill, maxHeight }],
    // Manual edits during dictation would be overwritten by the next transcript.
    editable: editable && !voiceActive, autoFocus, maxLength,
    multiline: true,
    scrollEnabled: expanded || contentHeight > maxHeight,
    textAlignVertical: 'top',
    returnKeyType: 'default',
    submitBehavior: 'newline',
    onFocus: (event) => { setFocused(true); onFocus?.(event); },
    onBlur: (event) => { setFocused(false); onBlur?.(event); },
  };
  useImperativeHandle(forwardedRef, () => ({
    focus: () => inputRef.current?.focus(),
    blur: () => inputRef.current?.blur(),
    clear: () => { inputRef.current?.clear(); onChangeText(''); },
  }), [onChangeText]);

  return (
    <View testID={testID} style={[styles.composer, !expanded ? styles.compact : null, style, expanded ? styles.expanded : null]}
      {...(expanded ? null : keyboardDismissResponder.panHandlers)}>
      {expanded ? <View testID={testID ? `${testID}-editor-header` : undefined} style={styles.editorHeader}>
        <ComposerAction icon={Minimize2} label={t('Collapse editor')} onPress={() => onExpandedChange?.(false)}
          testID={testID ? `${testID}-collapse` : undefined} />
        <Text style={styles.editorTitle} numberOfLines={1}>{t('Draft message')}</Text>
        <ComposerAction icon={ChevronDown} label={t('Hide keyboard')} onPress={Keyboard.dismiss} disabled={!focused}
          testID={testID ? `${testID}-hide-keyboard` : undefined} />
      </View> : null}
      {notice}
      {attachments}
      <Animated.View testID={testID ? `${testID}-input-shell` : undefined}
        collapsable={false}
        onLayout={() => {
          if (!focusAfterLayoutRef.current) return;
          focusAfterLayoutRef.current = false;
          inputRef.current?.focus();
        }}
        style={[styles.inputShell, inputSizeStyle, !editable ? styles.disabled : null]}>
        <Text testID={testID ? `${testID}-measurement` : undefined} accessible={false}
          accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none"
          numberOfLines={6} style={[styles.measurement, { height: lineHeight * 6 }]}
          onTextLayout={({ nativeEvent }) => {
            if (!expanded) setContentHeight(Math.max(1, nativeEvent.lines.length) * lineHeight + inputPadding);
          }}>{value || ' '}</Text>
        {onPasteFiles ? <PasteCapableTextInput {...inputProps} onPasteFiles={onPasteFiles} onPasteFailed={onPasteFailed} />
          : <CompositionSafeTextInput {...inputProps} />}
        {!expanded && showExpand ? <View style={styles.expandAction}>
          <ComposerAction icon={Maximize2} label={t('Expand editor')} onPress={() => onExpandedChange?.(true)}
            testID={testID ? `${testID}-expand` : undefined} />
        </View> : null}
      </Animated.View>
      <View style={styles.toolbar}>
        {onAddPress ? <ComposerAction icon={Plus} label={accessibilityLabels.add} onPress={onAddPress}
          tone="secondary" disabled={addDisabled || !editable} testID={testID ? `${testID}-add` : undefined} /> : null}
        {accessory}
        <View style={styles.spacer} />
        {voiceActive ? <VoiceStopAction label={accessibilityLabels.stopVoice ?? accessibilityLabels.stop}
          onPress={handleVoicePress} busy={voiceState === 'authorizing'} level={voiceLevel}
          testID={testID ? `${testID}-voice-stop` : undefined} />
          : showVoice ? <ComposerAction icon={Mic} label={accessibilityLabels.voice} onPress={handleVoicePress}
            tone="secondary" disabled={voiceDisabled || !editable} testID={testID ? `${testID}-voice` : undefined} />
            : showQueueSend ? <>
              {onStop ? <Animated.View layout={reducedMotion ? undefined : LinearTransition.duration(Motion.duration.fast)}>
                <ComposerAction icon={Square} label={accessibilityLabels.stop} onPress={onStop} tone="secondary"
                  testID={testID ? `${testID}-stop` : undefined} />
              </Animated.View> : null}
              <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(Motion.duration.fast)}>
                <ComposerAction icon={ArrowUp} label={accessibilityLabels.queue ?? accessibilityLabels.send} onPress={onSend}
                  tone="primary" disabled={primaryDisabled} testID={testID ? `${testID}-primary` : undefined} />
              </Animated.View>
            </>
              : <ComposerAction icon={isRunning ? Square : ArrowUp} label={isRunning ? accessibilityLabels.stop : accessibilityLabels.send}
                onPress={isRunning ? (onStop ?? (() => undefined)) : onSend} tone="primary"
                disabled={primaryDisabled} testID={testID ? `${testID}-primary` : undefined} />}
      </View>
    </View>
  );
});

/**
 * Dictation glow. Two translucent discs sit behind the stop control: a quick
 * inner layer that snaps to each syllable and a lazier outer layer that swells
 * behind it, so speech reads as a soft ripple rather than a flicker. Values are
 * scale/opacity pairs from rest (silence) to peak (loudest recent speech).
 */
const VOICE_INNER_HALO = { rest: { scale: 1.04, opacity: 0.22 }, peak: { scale: 1.32, opacity: 0.38 } };
const VOICE_OUTER_HALO = { rest: { scale: 1.08, opacity: 0.1 }, peak: { scale: 1.5, opacity: 0.2 } };
const VOICE_SURFACE_PEAK_SCALE = 1.05;
const VOICE_INNER_SPRING = { damping: 14, stiffness: 260, mass: 0.6 };
const VOICE_OUTER_SPRING = { damping: 20, stiffness: 120, mass: 1 };

function mix(from: number, to: number, amount: number): number {
  'worklet';
  return from + (to - from) * amount;
}

/**
 * Stop-dictation control in the shared 40/44-point recipe, tinted with the
 * conversation accent so dictation reads as the user's own voice rather than
 * an alert. The glow behind it follows the processed microphone level on the
 * UI thread, so it is data-driven rather than a loop.
 */
function VoiceStopAction({ label, onPress, busy, level, testID }: {
  label: string; onPress: () => void; busy: boolean; level?: SharedValue<number>; testID?: string;
}): React.JSX.Element {
  const { colors } = useConversationTheme();
  const reducedMotion = useReducedMotion();
  const live = !reducedMotion && Boolean(level);
  const innerStyle = useAnimatedStyle(() => {
    if (!live || !level) {
      return { opacity: VOICE_INNER_HALO.rest.opacity, transform: [{ scale: VOICE_INNER_HALO.rest.scale }] };
    }
    const amount = Math.min(1, Math.max(0, level.value));
    return {
      opacity: withSpring(mix(VOICE_INNER_HALO.rest.opacity, VOICE_INNER_HALO.peak.opacity, amount), VOICE_INNER_SPRING),
      transform: [{ scale: withSpring(mix(VOICE_INNER_HALO.rest.scale, VOICE_INNER_HALO.peak.scale, amount), VOICE_INNER_SPRING) }],
    };
  }, [level, live]);
  const outerStyle = useAnimatedStyle(() => {
    if (!live || !level) {
      return { opacity: VOICE_OUTER_HALO.rest.opacity, transform: [{ scale: VOICE_OUTER_HALO.rest.scale }] };
    }
    const amount = Math.min(1, Math.max(0, level.value));
    return {
      opacity: withSpring(mix(VOICE_OUTER_HALO.rest.opacity, VOICE_OUTER_HALO.peak.opacity, amount), VOICE_OUTER_SPRING),
      transform: [{ scale: withSpring(mix(VOICE_OUTER_HALO.rest.scale, VOICE_OUTER_HALO.peak.scale, amount), VOICE_OUTER_SPRING) }],
    };
  }, [level, live]);
  const surfaceStyle = useAnimatedStyle(() => {
    if (!live || !level) return { transform: [{ scale: 1 }] };
    const amount = Math.min(1, Math.max(0, level.value));
    return { transform: [{ scale: withSpring(mix(1, VOICE_SURFACE_PEAK_SCALE, amount), VOICE_INNER_SPRING) }] };
  }, [level, live]);
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ busy }} onPress={onPress}
    style={({ pressed }) => [actionStyles.target, actionStyles.haloHost, { opacity: pressed ? 0.7 : 1,
      transform: [{ scale: pressed && !reducedMotion ? Motion.pressedScale : 1 }] }]}>
    <Animated.View testID={testID ? `${testID}-halo-outer` : undefined} pointerEvents="none"
      style={[actionStyles.halo, { backgroundColor: colors.accent }, outerStyle]} />
    <Animated.View testID={testID ? `${testID}-halo` : undefined} pointerEvents="none"
      style={[actionStyles.halo, { backgroundColor: colors.accent }, innerStyle]} />
    <Animated.View testID={testID ? `${testID}-surface` : undefined}
      style={[actionStyles.surface, { backgroundColor: colors.accent }, surfaceStyle]}>
      <Square size={IconSize.md} color={colors.onAccent} strokeWidth={1.75} fill={colors.onAccent} />
    </Animated.View>
  </Pressable>;
}

/** Shared toolbar geometry: 40pt visual inside a 44pt hit target, no floating shadow. */
function ComposerAction({ icon: Icon, label, onPress, disabled = false, tone = 'plain', testID }: {
  icon: LucideIcon; label: string; onPress: () => void; disabled?: boolean;
  tone?: 'plain' | 'secondary' | 'primary'; testID?: string;
}): React.JSX.Element {
  const { theme } = useAppTheme();
  const reducedMotion = useReducedMotion();
  const backgroundColor = tone === 'primary' ? disabled ? theme.colors.line : theme.colors.ink
    : tone === 'secondary' ? theme.colors.canvas : 'transparent';
  const color = disabled ? theme.colors.inkTertiary : tone === 'primary' ? theme.colors.canvas : theme.colors.ink;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [actionStyles.target, { opacity: pressed ? 0.7 : 1,
      transform: [{ scale: pressed && !reducedMotion ? Motion.pressedScale : 1 }] }]}>
    <View testID={testID ? `${testID}-surface` : undefined} style={[actionStyles.surface, { backgroundColor }]}>
      <Icon size={IconSize.md} color={color} strokeWidth={1.75} />
    </View>
  </Pressable>;
}
const actionStyles = StyleSheet.create({
  target: { width: ControlSize.floatingButton, height: ControlSize.floatingButton, alignItems: 'center', justifyContent: 'center' },
  surface: { width: ControlSize.pill, height: ControlSize.pill, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  haloHost: { overflow: 'visible' },
  halo: { position: 'absolute', width: ControlSize.pill, height: ControlSize.pill, borderRadius: Radius.full },
});
function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    composer: { gap: Space.xs, padding: Space.sm },
    compact: { borderRadius: Radius.bubble, backgroundColor: colors.surface },
    expanded: { flex: 1, minHeight: 0, marginHorizontal: 0, paddingHorizontal: Space.lg, backgroundColor: colors.canvas },
    inputShell: { minHeight: ControlSize.pill, flexDirection: 'row', paddingHorizontal: Space.sm, overflow: 'hidden' },
    input: { flex: 1, alignSelf: 'stretch', color: colors.ink, fontSize: FontSize.body, lineHeight: LineHeight.body, includeFontPadding: false,
      fontWeight: FontWeight.regular, paddingLeft: 0, paddingRight: ControlSize.floatingButton, paddingVertical: Space.sm },
    expandedInput: { alignSelf: 'stretch', paddingRight: 0 },
    measurement: { position: 'absolute', left: Space.sm, right: Space.sm + ControlSize.floatingButton,
      opacity: 0, fontSize: FontSize.body, lineHeight: LineHeight.body, fontWeight: FontWeight.regular, includeFontPadding: false },
    expandAction: { position: 'absolute', right: 0, top: 0 },
    toolbar: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
    editorHeader: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingBottom: Space.md },
    editorTitle: { flex: 1, textAlign: 'center', color: colors.ink, fontSize: FontSize.body, fontWeight: FontWeight.semibold },
    spacer: { flex: 1 },
    disabled: { opacity: 0.6 },
  });
}
