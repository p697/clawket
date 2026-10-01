import React, { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, DynamicColorIOS, Keyboard, PanResponder, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions,
  type StyleProp, type TextInput, type TextInputProps, type ViewStyle,
} from 'react-native';
import { ArrowUp, ChevronDown, Maximize2, Minimize2, Mic, Plus, Square, X, type LucideIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import Animated, {
  Easing, FadeIn, LinearTransition, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming,
  type EntryExitAnimationFunction, type SharedValue,
} from 'react-native-reanimated';
import { useVoiceGesture } from '../../chat/useVoiceGesture';
import { VoiceWaveform } from './VoiceWaveform';
import { SwapEntrance } from './SwapEntrance';
import { editorIncludeFontPadding, editorTextRaise } from '../../chat/textCentering';
import { countDraftLines } from '../../chat/composerDraftLines';
import { shouldCaptureComposerKeyboardDismiss } from '../../chat/composerKeyboardDismiss';
import { useAppTheme } from '../../theme';
import { createChatGlassStyle } from '../../features/chat-appearance/resolver';
import { useChatSurfaces } from '../chat/ChatPresentation';
import { inputInkVariants } from '../../theme/theme';
import { ControlSize, FontSize, FontWeight, IconSize, LineHeight, Motion, Radius, Space } from '../../theme/tokens';
import { CompositionSafeTextInput } from './CompositionSafeTextInput';
import { PasteCapableTextInput, type PastedFile } from './PasteCapableTextInput';

export type ComposerHandle = { focus: () => void; blur: () => void; clear: () => void };
export type ComposerVoiceState = 'idle' | 'listening' | 'transcribing';
export type ComposerAccessibilityLabels = {
  add: string; voice: string; stopVoice?: string; send: string; stop: string;
  /** Send while the Agent is still replying; falls back to `send`. */
  queue?: string;
};
/** What the capsule's trailing control may take: `room` is the width left beside the whole placeholder. */
export type ComposerAccessorySpace = Readonly<{ drafting: boolean; room: number | null }>;
export type ComposerProps = {
  /** The capsule's trailing control (the model chip); a function sizes itself to the room beside the placeholder. */
  accessory?: React.ReactNode | ((space: ComposerAccessorySpace) => React.ReactNode);
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
  onVoiceStart?: () => void;
  onVoiceStop?: (send: boolean) => void;
  onVoiceCancel?: () => void;
  onVoiceRecover?: () => void;
  voiceRecoveryCount?: number;
  voiceRecordingSaved?: boolean;
  onPasteFiles?: (files: readonly PastedFile[]) => void;
  onPasteFailed?: () => void;
  editable?: boolean;
  canSend?: boolean;
  hasAttachments?: boolean;
  isRunning?: boolean;
  addDisabled?: boolean;
  voiceDisabled?: boolean;
  /** Capture/finalization lifecycle; the model toolbar remains mounted throughout. */
  voiceState?: ComposerVoiceState;
  /** Normalized microphone level; only the waveform updates at audio cadence. */
  voiceLevel?: SharedValue<number>;
  autoFocus?: boolean;
  maxLength?: number;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /**
   * Keeps a cleared draft at the height it was sent with until the thread has
   * laid out the row it sent, so the list never sees the composer shrink a
   * frame before that row lands (device check 2026-10-01: the rows above
   * dropped 52 points for a frame, then jumped up).
   */
  holdHeight?: boolean;
  /** `glass` floats the compact card over a chat wallpaper on translucent chrome; full-screen editing always uses the canvas. */
  appearance?: 'surface' | 'glass';
  onFocus?: TextInputProps['onFocus'];
  onBlur?: TextInputProps['onBlur'];
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** One native input survives compact/expanded editing, including marked text and selection. */
export const Composer = React.forwardRef<ComposerHandle, ComposerProps>(function Composer({
  accessory, attachments, notice, value, placeholder, accessibilityLabels, onChangeText, onSend, onStop,
  onAddPress, onVoicePress, onVoiceStart, onVoiceStop, onVoiceCancel, onPasteFiles, onPasteFailed, editable = true, canSend = true,
  hasAttachments = false, isRunning = false, addDisabled = false, voiceDisabled = false,
  voiceState = 'idle', voiceLevel, onVoiceRecover, voiceRecoveryCount = 0, voiceRecordingSaved = false,
  autoFocus = false, maxLength, expanded = false, onExpandedChange, holdHeight = false, appearance = 'surface', onFocus, onBlur, style, testID,
}, forwardedRef): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('chat');
  const { fontScale, height: windowHeight } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  // The slot's first control is part of the screen; only a later swap pops in.
  const [slotReady, setSlotReady] = useState(false);
  useEffect(() => { setSlotReady(true); }, []);
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
  const glassChrome = useMemo(() => (appearance === 'glass' ? createChatGlassStyle(theme) : null), [appearance, theme]);
  // Over the canvas the capsule and circles take the neutral surface; over a wallpaper, glass.
  const capsuleSurface = useMemo(() => ({ backgroundColor: theme.colors.surface }), [theme.colors.surface]);
  const chromeSurface = capsuleSurface;
  const [accessoryWidth, setAccessoryWidth] = useState(0);
  const [shellWidth, setShellWidth] = useState(0);
  const [placeholderWidth, setPlaceholderWidth] = useState(0);
  const inputInk = useMemo(() => Platform.OS === 'ios' ? DynamicColorIOS(inputInkVariants) : theme.colors.ink, [theme.colors.ink]);
  const [contentHeight, setContentHeight] = useState(ControlSize.pill as number);
  const [focused, setFocused] = useState(false);
  const lineHeight = LineHeight.body * fontScale;
  const inputPadding = Space.sm * 2;
  const maxHeight = Math.max(ControlSize.pill, Math.min(lineHeight * 5 + inputPadding, windowHeight * 0.3));
  const targetHeight = voiceState !== 'idle' ? (voiceState === 'listening' ? Space.xxl + LineHeight.secondary * fontScale * 2 + Space.xs : Math.max(ControlSize.pill, LineHeight.secondary * fontScale + Space.sm)) : value.length === 0 ? Math.max(ControlSize.pill, lineHeight + inputPadding)
    : Math.max(ControlSize.pill, Math.min(contentHeight, maxHeight));
  const animatedHeight = useSharedValue(targetHeight);
  useEffect(() => {
    animatedHeight.value = reducedMotion || value.length === 0 ? targetHeight : withTiming(targetHeight, { duration: Motion.duration.fast });
  }, [animatedHeight, targetHeight, reducedMotion, value.length]);
  const inputSizeStyle = useAnimatedStyle(() => expanded
    ? { height: undefined, flexGrow: 1, flexShrink: 1, flexBasis: 0 }
    : { height: value.length === 0 ? targetHeight : animatedHeight.value, flexGrow: 0, flexShrink: 0, flexBasis: 'auto' }, [expanded, value.length, targetHeight]);
  // The last draft's height, which `holdHeight` keeps while the sent row lands.
  const draftHeightRef = useRef(targetHeight);
  if (!expanded && voiceState === 'idle' && value.length > 0) draftHeightRef.current = targetHeight;
  // A late UI-thread height can outlive a cleared draft. Native layout bounds
  // collapse the empty editor without remounting it or disturbing selection.
  const emptyInputHeight = !expanded && voiceState === 'idle' && value.length === 0
    ? (holdHeight ? Math.max(targetHeight, draftHeightRef.current) : targetHeight)
    : undefined;
  // Below the shell's visible height the native editor keeps one more line of
  // room. A newly wrapped line lands there, so Android never scrolls the
  // editor to its caret and hides the first line while the shell catches up
  // (device report 2026-10-01); the shell then reveals the new line as it grows.
  const inputFrameHeight = !expanded && voiceState === 'idle' && contentHeight <= maxHeight
    ? Math.min(maxHeight, targetHeight + lineHeight) : undefined;
  // Only the toolbar owns drag-to-dismiss. Capturing above the native editor
  // would also steal downward cursor/selection-handle drags.
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
  // The chip shares the draft's line: the measured text wraps where the input does.
  const hasAccessory = Boolean(accessory) && !expanded && !voiceActive;
  const inputEndInset = hasAccessory ? 0 : ControlSize.floatingButton;
  // Beside the chip the shell keeps no end padding: the chip then sits as far
  // from the capsule's end as from its top and bottom, a pill inside a pill
  // (owner report 2026-10-01: 13 points at the end against 5 above looked off).
  const shellEndPadding = hasAccessory ? 0 : Space.sm;
  const measurementInset = shellEndPadding + (hasAccessory ? accessoryWidth : inputEndInset);
  const primaryDisabled = isRunning && !hasContent ? !onStop : !editable || !canSend || !hasContent;
  const voiceGesture = useVoiceGesture({ phase: voiceState, enabled: Boolean(onVoicePress) && !voiceDisabled && editable && voiceState !== 'transcribing',
    start: onVoiceStart ?? onVoicePress ?? (() => {}), stop: onVoiceStop ?? onVoicePress ?? (() => {}), cancel: onVoiceCancel ?? (() => {}),
    focus: () => inputRef.current?.focus() });
  const inputVoiceTarget = Boolean(onVoicePress) && !voiceDisabled && editable && !expanded && !focused && !value && !isRunning;
  const inputPlaceholder = inputVoiceTarget && !value ? t(voiceGesture.tooShort ? 'Hold longer to talk' : 'Type or hold to talk') : placeholder;
  // The placeholder is never clipped by the chip: it gets what the whole hint leaves on the line
  // (the accessory brings its own leading gap).
  const accessoryRoom = shellWidth > 0 && placeholderWidth > 0
    ? Math.max(0, shellWidth - Space.sm - shellEndPadding - placeholderWidth) : null;
  const compactAccessory = typeof accessory === 'function' ? accessory({ drafting: value.length > 0, room: accessoryRoom }) : accessory;
  const toolbarAccessory = typeof accessory === 'function' ? accessory({ drafting: false, room: null }) : accessory;
  const voiceHint = voiceState === 'transcribing' ? t('Transcribing…')
    : voiceRecordingSaved ? t('Recording saved locally · Transcription paused') : voiceGesture.holding ? t(voiceGesture.cancelling ? 'Release to cancel' : 'Release to send · Slide up to cancel') : t('Listening…');
  // The native editor leaves its line off-center (`chat/textCentering`): its
  // text, caret and placeholder rise together, and on Android under a Latin
  // placeholder font padding lowers the placeholder and an empty caret.
  const editorRaise = editorTextRaise(inputPlaceholder, FontSize.body, LineHeight.body) * fontScale;
  const editorFontPadding = editorIncludeFontPadding(inputPlaceholder);
  const inputProps: TextInputProps & { ref: React.Ref<TextInput>; value: string } = {
    ref: inputRef,
    testID: testID ? `${testID}-input` : undefined,
    accessibilityLabel: inputPlaceholder,
    value, onChangeText, placeholder: inputPlaceholder,
    placeholderTextColor: theme.colors.inkTertiary,
    // A bounded native Text measurement sizes the shell without changing the
    // native-owned input or relying on delayed Fabric content-size events.
    style: [styles.input, { color: inputInk }, editorFontPadding ? styles.inputFontPadding : null,
      editorRaise ? { transform: [{ translateY: -editorRaise }] } : null,
      expanded ? styles.expandedInput : { minHeight: ControlSize.pill, maxHeight, paddingRight: inputEndInset }],
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

  const leadingAction = voiceActive && onVoiceCancel ? <ComposerAction icon={X} label={t('Cancel', { ns: 'common' })} onPress={onVoiceCancel}
    tone={expanded ? 'plain' : 'chrome'} chrome={glassChrome} testID={testID ? `${testID}-voice-cancel` : undefined} />
    : onAddPress ? <ComposerAction icon={Plus} label={accessibilityLabels.add} onPress={onAddPress}
      tone={expanded ? 'secondary' : 'chrome'} chrome={glassChrome} disabled={addDisabled || !editable} testID={testID ? `${testID}-add` : undefined} /> : null;
  const trailingActions = (voiceActive || showVoice) ? <>
    {voiceActive && !voiceGesture.holding && !voiceGesture.pressing && voiceState === 'listening' ? <SlotMorph slot="voice-stop" ready={slotReady}>
      <ComposerAction icon={Square}
      label={accessibilityLabels.stopVoice ?? accessibilityLabels.stop} onPress={() => (onVoiceStop ?? onVoicePress)?.(false)}
      tone={expanded ? 'plain' : 'chrome'} chrome={glassChrome} testID={testID ? `${testID}-voice-stop` : undefined} />
    </SlotMorph> : null}
    <Pressable {...voiceGesture.handlers} testID={testID ? `${testID}-voice` : undefined}
      accessibilityRole="button" accessibilityLabel={voiceActive ? accessibilityLabels.send : accessibilityLabels.voice}
      accessibilityHint={t('Tap to dictate. Hold and release to send.')}
      accessibilityState={{ busy: voiceState === 'transcribing', disabled: voiceDisabled }}
      style={actionStyles.target}>
      {/* The press that starts dictation is still down when the mic turns into send:
          only the surface morphs, the touch target stays mounted. */}
      <SlotMorph slot={voiceActive ? 'voice-send' : 'mic'} ready={slotReady} inert>
        <View style={[actionStyles.surface, voiceActive ? { backgroundColor: theme.colors.ink }
          : expanded ? { backgroundColor: theme.colors.canvas } : [chromeSurface, glassChrome]]}>
          {voiceState === 'transcribing' ? <ActivityIndicator color={theme.colors.canvas} />
            : voiceActive ? <ArrowUp size={IconSize.md} color={theme.colors.canvas} /> : <Mic size={IconSize.md} color={theme.colors.ink} strokeWidth={1.75} />}
        </View>
      </SlotMorph>
    </Pressable>
  </> : showQueueSend ? <>
    {onStop ? <Animated.View layout={reducedMotion ? undefined : LinearTransition.duration(Motion.duration.fast)}>
      <ComposerAction icon={Square} label={accessibilityLabels.stop} onPress={onStop} tone={expanded ? 'secondary' : 'chrome'} chrome={glassChrome}
        testID={testID ? `${testID}-stop` : undefined} />
    </Animated.View> : null}
    <SlotMorph slot="queue-send" ready={slotReady}>
      <ComposerAction icon={ArrowUp} label={accessibilityLabels.queue ?? accessibilityLabels.send} onPress={onSend}
        tone="send" disabled={primaryDisabled} testID={testID ? `${testID}-primary` : undefined} />
    </SlotMorph>
  </>
    : <SlotMorph slot={isRunning ? 'stop' : 'send'} ready={slotReady}>
      <ComposerAction icon={isRunning ? Square : ArrowUp} label={isRunning ? accessibilityLabels.stop : accessibilityLabels.send}
        onPress={isRunning ? (onStop ?? (() => undefined)) : onSend} tone={isRunning ? 'primary' : 'send'}
        disabled={primaryDisabled} testID={testID ? `${testID}-primary` : undefined} />
    </SlotMorph>;
  const dismissHandlers = expanded ? null : keyboardDismissResponder.panHandlers;

  // One row (A+ chat design, owner decision 2026-09-30): the add circle, the
  // capsule holding the draft and the model chip, and the send / voice / stop
  // circle. Full-screen editing keeps its editor and bottom toolbar. Both
  // layouts share one parent chain for the native input, so switching between
  // them never remounts it (marked text and selection survive).
  return (
    <View testID={testID} style={[styles.composer, style, expanded ? styles.expanded : null]}>
      {expanded ? <View testID={testID ? `${testID}-editor-header` : undefined} style={styles.editorHeader}>
        <ComposerAction icon={Minimize2} label={t('Collapse editor')} onPress={() => onExpandedChange?.(false)}
          testID={testID ? `${testID}-collapse` : undefined} />
        <Text style={styles.editorTitle} numberOfLines={1}>{t('Draft message')}</Text>
        <ComposerAction icon={ChevronDown} label={t('Hide keyboard')} onPress={Keyboard.dismiss} disabled={!focused}
          testID={testID ? `${testID}-hide-keyboard` : undefined} />
      </View> : null}
      {voiceRecoveryCount > 0 && !voiceActive && onVoiceRecover ? <Pressable
        testID={testID ? `${testID}-voice-recover` : undefined} accessibilityRole="button"
        onPress={onVoiceRecover} style={styles.voiceRecovery}>
        <Text style={styles.voiceHint}>{t('Saved recording · Tap to recover')}</Text>
      </Pressable> : null}
      {notice}
      <View testID={testID ? `${testID}-row` : undefined} style={expanded ? styles.editorBody : styles.row}>
        {expanded ? null : <View testID={testID ? `${testID}-leading` : undefined} style={styles.side} {...dismissHandlers}>{leadingAction}</View>}
        <View testID={testID ? `${testID}-capsule` : undefined}
          style={expanded ? styles.editorCapsule : [styles.capsule, capsuleSurface, glassChrome, attachments ? styles.capsuleWithTray : null]}>
          {attachments}
          <Animated.View testID={testID ? `${testID}-input-shell` : undefined}
            collapsable={false}
            onLayout={({ nativeEvent }) => {
              setShellWidth(nativeEvent.layout.width);
              if (!focusAfterLayoutRef.current) return;
              focusAfterLayoutRef.current = false;
              inputRef.current?.focus();
            }}
            style={[styles.inputShell, { paddingRight: shellEndPadding }, inputSizeStyle,
              { minHeight: emptyInputHeight ?? ControlSize.pill, maxHeight: emptyInputHeight },
              !editable ? styles.disabled : null]}>
            <Text testID={testID ? `${testID}-measurement` : undefined} accessible={false}
              accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none"
              numberOfLines={6} style={[styles.measurement, { height: lineHeight * 6, right: measurementInset }]}
              onTextLayout={({ nativeEvent }) => {
                // A trailing Return must grow the shell now, not on the next character.
                if (!expanded) setContentHeight(countDraftLines(nativeEvent.lines) * lineHeight + inputPadding);
              }}>{value || ' '}</Text>
            {hasAccessory && typeof accessory === 'function' ? <Text testID={testID ? `${testID}-placeholder-measurement` : undefined}
              accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none"
              numberOfLines={1} style={styles.placeholderMeasurement}
              onTextLayout={({ nativeEvent }) => setPlaceholderWidth(Math.ceil(nativeEvent.lines[0]?.width ?? 0))}>{inputPlaceholder}</Text> : null}
            {voiceActive ? <View style={styles.voicePresentation}>
              {voiceState === 'listening' ? <VoiceWaveform level={voiceLevel} color={theme.colors.accent} cancelling={voiceGesture.cancelling}
                testID={testID ? `${testID}-voice-waveform` : undefined} /> : null}
              <Text accessibilityLiveRegion="polite" style={styles.voiceHint}>{voiceHint}</Text>
            </View> : null}
            <View testID={testID ? `${testID}-input-host` : undefined}
              style={[styles.inputHost, inputFrameHeight !== undefined ? { alignSelf: 'flex-start', height: inputFrameHeight } : null,
                voiceActive ? styles.hiddenInput : null]}
              pointerEvents={voiceActive ? 'none' : 'auto'} accessibilityElementsHidden={voiceActive}>
            {onPasteFiles ? <PasteCapableTextInput {...inputProps} onPasteFiles={onPasteFiles} onPasteFailed={onPasteFailed} />
              : <CompositionSafeTextInput {...inputProps} />}
            </View>
            {/* Stable sibling: the native editor stays mounted; an ordinary tap focuses it.
                Once editing, native cursor placement, selection and paste own the touches. */}
            <Pressable {...voiceGesture.inputHandlers}
              testID={testID ? `${testID}-voice-input-target` : undefined}
              accessible={false} pointerEvents={inputVoiceTarget || voiceActive ? 'auto' : 'none'}
              style={StyleSheet.absoluteFill} />
            {!expanded && !voiceActive && showExpand ? <View style={styles.expandAction}>
              <ComposerAction icon={Maximize2} label={t('Expand editor')} onPress={() => onExpandedChange?.(true)}
                testID={testID ? `${testID}-expand` : undefined} />
            </View> : null}
            {!expanded && accessory && !voiceActive ? <View testID={testID ? `${testID}-accessory` : undefined}
              onLayout={({ nativeEvent }) => setAccessoryWidth(nativeEvent.layout.width)}
              style={[styles.accessory, showExpand ? styles.accessoryUnderExpand : null]}>{compactAccessory}</View> : null}
          </Animated.View>
        </View>
        {expanded ? null : <View testID={testID ? `${testID}-trailing` : undefined} style={styles.side} {...dismissHandlers}>{trailingActions}</View>}
      </View>
      {expanded ? <View testID={testID ? `${testID}-toolbar` : undefined} style={styles.toolbar}>
        {leadingAction}
        {toolbarAccessory}
        <View style={styles.spacer} />
        {trailingActions}
      </View> : null}
    </View>
  );
});

const MORPH_DURATION = Motion.morph.duration;
const MORPH_START_SCALE = Motion.morph.startScale;
/** A control replacing another in its slot pops in: 60% to full size with a fade (A+ motion, 150 ms). */
const slotPopIn: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scale: MORPH_START_SCALE }] },
    animations: {
      opacity: withTiming(1, { duration: MORPH_DURATION, easing: Easing.out(Easing.cubic) }),
      transform: [{ scale: withTiming(1, { duration: MORPH_DURATION, easing: Easing.out(Easing.cubic) }) }],
    },
  };
};
const slotFadeIn = FadeIn.duration(MORPH_DURATION);

/** One composer slot: send, stop and mic take one another's place. `inert` leaves touches to the parent. */
function SlotMorph({ slot, ready, inert = false, children }: Readonly<{
  slot: string; ready: boolean; inert?: boolean; children: React.ReactNode;
}>): React.JSX.Element {
  return (
    <SwapEntrance swapKey={slot} ready={ready} entering={slotPopIn} reducedEntering={slotFadeIn}
      pointerEvents={inert ? 'none' : 'box-none'} testID={`composer-slot-${slot}`}>
      {children}
    </SwapEntrance>
  );
}

/**
 * Composer circles, all 44 points (A+): `chrome` floats beside the capsule on
 * the same glass or neutral surface, `send` is the conversation's solid accent
 * (the user's own bubble color), `primary` is the ink stop, `secondary` sits on
 * the full-screen editor's canvas, and `plain` is a bare icon.
 */
function ComposerAction({ icon: Icon, label, onPress, disabled = false, tone = 'plain', chrome = null, testID }: {
  icon: LucideIcon; label: string; onPress: () => void; disabled?: boolean;
  tone?: 'plain' | 'secondary' | 'primary' | 'chrome' | 'send'; chrome?: ViewStyle | null; testID?: string;
}): React.JSX.Element {
  const { theme } = useAppTheme();
  const { outgoing } = useChatSurfaces();
  const reducedMotion = useReducedMotion();
  const filled = tone === 'primary' || tone === 'send';
  // A stop that is not available yet (the message is still leaving) keeps its
  // ink, dimmed, so it does not flash grey before the reply starts; it fades
  // to full ink when the run begins.
  const dimmedStop = disabled && tone === 'primary';
  const surfaceOpacity = useSharedValue(dimmedStop ? DIMMED_STOP_OPACITY : 1);
  useEffect(() => {
    const target = dimmedStop ? DIMMED_STOP_OPACITY : 1;
    surfaceOpacity.value = reducedMotion ? target : withTiming(target, { duration: Motion.morph.duration });
  }, [dimmedStop, reducedMotion, surfaceOpacity]);
  const surfaceFade = useAnimatedStyle(() => ({ opacity: surfaceOpacity.value }));
  const backgroundColor = filled ? disabled && !dimmedStop ? theme.colors.line : tone === 'send' ? outgoing.backgroundColor : theme.colors.ink
    : tone === 'secondary' ? theme.colors.canvas : tone === 'chrome' ? theme.colors.surface : 'transparent';
  const color = disabled && !dimmedStop ? theme.colors.inkTertiary : tone === 'send' ? outgoing.textColor : tone === 'primary' ? theme.colors.canvas : theme.colors.ink;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [actionStyles.target, { opacity: pressed ? 0.7 : 1,
      transform: [{ scale: pressed && !reducedMotion ? Motion.pressedScale : 1 }] }]}>
    <Animated.View testID={testID ? `${testID}-surface` : undefined} style={[actionStyles.surface, { backgroundColor }, tone === 'chrome' ? chrome : null,
      surfaceFade]}>
      <Icon size={IconSize.md} color={color} strokeWidth={filled ? 2 : 1.75} />
    </Animated.View>
  </Pressable>;
}
const DIMMED_STOP_OPACITY = 0.4;
const actionStyles = StyleSheet.create({
  target: { width: ControlSize.floatingButton, height: ControlSize.floatingButton, alignItems: 'center', justifyContent: 'center' },
  surface: { width: ControlSize.floatingButton, height: ControlSize.floatingButton, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  haloHost: { overflow: 'visible' },
  halo: { position: 'absolute', width: ControlSize.pill, height: ControlSize.pill, borderRadius: Radius.full },
});
function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    composer: { gap: Space.xs, paddingVertical: Space.xs },
    expanded: { flex: 1, minHeight: 0, marginHorizontal: 0, padding: Space.sm, paddingHorizontal: Space.lg, backgroundColor: colors.canvas },
    // Circles and capsule share the bottom line, so a growing draft rises above them.
    row: { flexDirection: 'row', alignItems: 'flex-end', gap: Space.sm },
    side: { flexDirection: 'row', alignItems: 'flex-end', gap: Space.xs },
    capsule: { flex: 1, minWidth: 0, minHeight: ControlSize.floatingButton, borderRadius: Radius.xl, paddingVertical: 2, paddingLeft: Space.sm, paddingRight: Space.xs, justifyContent: 'center', overflow: 'hidden' },
    // Photos waiting to send ride inside the capsule, above the draft.
    capsuleWithTray: { paddingTop: Space.sm - 2, gap: Space.xs },
    editorBody: { flex: 1, minHeight: 0 },
    editorCapsule: { flex: 1, minHeight: 0, gap: Space.xs },
    inputShell: { minHeight: ControlSize.pill, flexDirection: 'row', paddingHorizontal: Space.sm, overflow: 'hidden' },
    inputHost: { flex: 1, alignSelf: 'stretch' },
    hiddenInput: { opacity: 0 },
    voiceRecovery: { minHeight: ControlSize.pill, padding: Space.sm, justifyContent: 'center' },
    voicePresentation: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: Space.xs },
    voiceHint: { color: colors.inkSecondary, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, textAlign: 'center' },
    input: { flex: 1, alignSelf: 'stretch', color: colors.ink, fontSize: FontSize.body, lineHeight: LineHeight.body, includeFontPadding: false,
      fontWeight: FontWeight.regular, paddingLeft: 0, paddingRight: 0, paddingVertical: Space.sm },
    inputFontPadding: { includeFontPadding: true },
    expandedInput: { alignSelf: 'stretch', paddingRight: 0 },
    measurement: { position: 'absolute', left: Space.sm,
      opacity: 0, fontSize: FontSize.body, lineHeight: LineHeight.body, fontWeight: FontWeight.regular, includeFontPadding: false },
    placeholderMeasurement: { position: 'absolute', left: Space.sm, top: 0,
      opacity: 0, fontSize: FontSize.body, lineHeight: LineHeight.body, fontWeight: FontWeight.regular, includeFontPadding: false },
    expandAction: { position: 'absolute', right: 0, top: 0 },
    // The model chip sits at the end of the draft's last line.
    accessory: { alignSelf: 'flex-end', minHeight: ControlSize.pill, justifyContent: 'center' },
    // Under the expand control the chip shares its column, centered beneath it.
    accessoryUnderExpand: { minWidth: ControlSize.floatingButton, alignItems: 'center' },
    toolbar: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
    editorHeader: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingBottom: Space.md },
    editorTitle: { flex: 1, textAlign: 'center', color: colors.ink, fontSize: FontSize.body, fontWeight: FontWeight.semibold },
    spacer: { flex: 1 },
    disabled: { opacity: 0.6 },
  });
}
