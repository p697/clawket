import React, { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, DynamicColorIOS, Keyboard, PanResponder, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions,
  type StyleProp, type TextInput, type TextInputProps, type ViewStyle,
} from 'react-native';
import { ArrowUp, ChevronDown, Maximize2, Minimize2, Mic, Plus, Square, X, type LucideIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import Animated, {
  FadeIn, LinearTransition, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useVoiceGesture } from '../../chat/useVoiceGesture';
import { VoiceWaveform } from './VoiceWaveform';
import { countDraftLines } from '../../chat/composerDraftLines';
import { shouldCaptureComposerKeyboardDismiss } from '../../chat/composerKeyboardDismiss';
import { useAppTheme } from '../../theme';
import { createChatGlassStyle } from '../../features/chat-appearance/resolver';
import { inputInkVariants } from '../../theme/theme';
import { ControlSize, FontSize, FontWeight, IconSize, LineHeight, Motion, Radius, Space } from '../../theme/tokens';
import { CompositionSafeTextInput } from './CompositionSafeTextInput';
import { PasteCapableTextInput, type PastedFile } from './PasteCapableTextInput';

export type ComposerHandle = { focus: () => void; blur: () => void; clear: () => void };
export type ComposerVoiceState = 'idle' | 'authorizing' | 'listening' | 'transcribing';
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
  onVoiceStart?: () => void;
  onVoiceStop?: (send: boolean) => void;
  onVoiceCancel?: () => void;
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
  voiceState = 'idle', voiceLevel,
  autoFocus = false, maxLength, expanded = false, onExpandedChange, appearance = 'surface', onFocus, onBlur, style, testID,
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
  const glassChrome = useMemo(() => (appearance === 'glass' ? createChatGlassStyle(theme) : null), [appearance, theme]);
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
  const voiceGesture = useVoiceGesture({ phase: voiceState, enabled: Boolean(onVoicePress) && !voiceDisabled && editable && voiceState !== 'transcribing',
    start: onVoiceStart ?? onVoicePress ?? (() => {}), stop: onVoiceStop ?? onVoicePress ?? (() => {}), cancel: onVoiceCancel ?? (() => {}),
    focus: () => inputRef.current?.focus() });
  const inputVoiceTarget = Boolean(onVoicePress) && !voiceDisabled && editable && !expanded && (!focused || !value) && !isRunning;
  const inputPlaceholder = inputVoiceTarget && !value ? t(voiceGesture.tooShort ? 'Hold longer to talk' : 'Type or hold to talk') : placeholder;
  const voiceHint = voiceState === 'transcribing' ? t('Transcribing…') : voiceState === 'authorizing' ? t('Preparing voice input…')
    : voiceGesture.holding ? t(voiceGesture.cancelling ? 'Release to cancel' : 'Release to send · Slide up to cancel') : t('Listening…');
  const inputProps: TextInputProps & { ref: React.Ref<TextInput>; value: string } = {
    ref: inputRef,
    testID: testID ? `${testID}-input` : undefined,
    accessibilityLabel: inputPlaceholder,
    value, onChangeText, placeholder: inputPlaceholder,
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
    <View testID={testID} style={[styles.composer, !expanded ? [styles.compact, glassChrome] : null, style, expanded ? styles.expanded : null]}
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
            // A trailing Return must grow the shell now, not on the next character.
            if (!expanded) setContentHeight(countDraftLines(nativeEvent.lines) * lineHeight + inputPadding);
          }}>{value || ' '}</Text>
        {voiceActive ? <View style={styles.voicePresentation}>
          {voiceState === 'listening' ? <VoiceWaveform level={voiceLevel} color={voiceGesture.cancelling ? theme.colors.inkSecondary : theme.colors.accent} /> : null}
          <Text accessibilityLiveRegion="polite" style={styles.voiceHint}>{voiceHint}</Text>
        </View> : null}
        <View style={[styles.inputHost, voiceActive ? styles.hiddenInput : null]} pointerEvents={voiceActive ? 'none' : 'auto'} accessibilityElementsHidden={voiceActive}>
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
      </Animated.View>
      <View style={styles.toolbar}>
        {voiceActive && onVoiceCancel ? <ComposerAction icon={X} label={t('Cancel', { ns: 'common' })} onPress={onVoiceCancel}
          testID={testID ? `${testID}-voice-cancel` : undefined} /> : onAddPress ? <ComposerAction icon={Plus} label={accessibilityLabels.add} onPress={onAddPress}
          tone="secondary" disabled={addDisabled || !editable} testID={testID ? `${testID}-add` : undefined} /> : null}
        {accessory}
        <View style={styles.spacer} />
        {(voiceActive || showVoice) ? <>
          {voiceActive && !voiceGesture.holding && voiceState === 'listening' ? <ComposerAction icon={Square}
            label={accessibilityLabels.stopVoice ?? accessibilityLabels.stop} onPress={() => (onVoiceStop ?? onVoicePress)?.(false)}
            testID={testID ? `${testID}-voice-stop` : undefined} /> : null}
          <Pressable {...voiceGesture.handlers} testID={testID ? `${testID}-voice` : undefined}
            accessibilityRole="button" accessibilityLabel={voiceActive ? accessibilityLabels.send : accessibilityLabels.voice}
            accessibilityHint={t('Tap to dictate. Hold and release to send.')}
            accessibilityState={{ busy: voiceState === 'authorizing' || voiceState === 'transcribing', disabled: voiceDisabled }}
            style={actionStyles.target}>
            <View pointerEvents="none" style={[actionStyles.surface, { backgroundColor: voiceActive ? theme.colors.ink : theme.colors.canvas }]}>
              {voiceState === 'authorizing' || voiceState === 'transcribing' ? <ActivityIndicator color={theme.colors.canvas} />
                : voiceActive ? <ArrowUp size={IconSize.md} color={theme.colors.canvas} /> : <Mic size={IconSize.md} color={theme.colors.ink} />}
            </View>
          </Pressable>
        </> : showQueueSend ? <>
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
    inputHost: { flex: 1, alignSelf: 'stretch' },
    hiddenInput: { opacity: 0 },
    voicePresentation: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: Space.xs },
    voiceHint: { color: colors.inkSecondary, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, textAlign: 'center' },
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
