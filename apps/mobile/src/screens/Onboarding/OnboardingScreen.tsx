import { isIPad } from '../../utils/platform';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Check,
  ArrowUpRight,
  Copy,
  Palette,
  ScanLine,
  ChevronDown,
} from 'lucide-react-native';
import { CLAWKET_GITHUB_REPO_URL } from '../../config/app-links';
import { openExternalUrl } from '../../utils/openExternalUrl';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  LineHeight,
  Motion,
  Space,
} from '../../theme/tokens';
import { PlatformMark } from '../../components/ui/PlatformMark';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { FloatingButton } from '../../components/ui/FloatingButton';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { FlowHeader, PageIntro, ChoiceRow, FormStep, CommandBlock, MessagePreview } from '../../components/ui/SetupPrimitives';
import { Sheet } from '../../components/ui/Sheet';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
import { useKeyboardRevealScroll } from '../../components/ui/useKeyboardRevealScroll';
import { Skeleton } from '../../components/ui/Skeleton';
import { LoadingState } from '../../components/ui/LoadingState';
import {
  buildAgentPairingPrompt,
  buildBackendPairingCommand,
  createPairingSubmission,
  formatVerificationCode,
  getDefaultPairingMethod,
  isVerificationCodeComplete,
  normalizeVerificationCode,
  PAIRING_COMMAND,
  PAIRING_CHOOSE_COMMAND,
  resolveOnboardingError,
  type LocalModelEngine,
  type OnboardingStatus,
  type PairableBackendKind,
  type PairingSubmission,
  type PairingMethod,
} from './model';
import type { OnboardingWebsiteBackendKind } from './route-model';

type MaybePromise<T> = T | Promise<T>;

export type OnboardingScreenProps = Readonly<{
  initialBackend?: PairableBackendKind;
  status?: OnboardingStatus;
  environment?: 'production' | 'preview';
  pairingCommand?: string;
  onViewed?: () => void;
  onClose?: () => void;
  onOpenDesignSystem?: () => void;
  onCopyCommand?: (command: string) => MaybePromise<void>;
  onCopyAgentPrompt?: (prompt: string, backendKind: PairableBackendKind) => MaybePromise<void>;
  onPastePairingCode?: (backendKind: PairableBackendKind, isCurrent?: () => boolean) => MaybePromise<string | null>;
  onSubmitPairing: (submission: PairingSubmission) => MaybePromise<void>;
  /** Opens the scanner, which also reads a QR from a saved photo. */
  onScanQr: (expectedBackendKind: PairableBackendKind) => void;
  /** The scanned QR names its own backend. */
  onScanAnyQr?: () => void;
  onOpenWebsite: (backendKind: OnboardingWebsiteBackendKind) => void;
  onErrorAction?: (status: Extract<OnboardingStatus, { kind: 'error' }>['code']) => void;
  onRetry?: () => void;
  onOpenCustomConnection?: () => void;
}>;

/** How long a copy action shows its confirmation before the control returns to normal. */
const COPY_FEEDBACK_MS = 1500;

/** Space kept between the pairing field + Connect action and the top of the keyboard. */
const KEYBOARD_CLEARANCE = Space.lg;
const PLATFORM_PICKER_SNAP_POINTS = ['70%', '90%'];

/** True for a short window after `flash()`; the timer resets on repeat and clears on unmount. */
function useCopiedFlash(): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const flash = useCallback(() => {
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { timerRef.current = null; setCopied(false); }, COPY_FEEDBACK_MS);
  }, []);
  return [copied, flash];
}

const BACKEND_OPTIONS: ReadonlyArray<{
  kind: PairableBackendKind;
}> = [
  { kind: 'openclaw' },
  { kind: 'hermes' },
  { kind: 'local-model' },
  { kind: 'pi' },
];

const PAIRING_INPUT_PRESENTATION: Readonly<Record<PairableBackendKind, {
  keyboardType: 'number-pad' | 'ascii-capable';
}>> = {
  openclaw: { keyboardType: 'number-pad' },
  hermes: { keyboardType: 'ascii-capable' },
  'local-model': { keyboardType: 'number-pad' },
  pi: { keyboardType: 'number-pad' },
  codex: { keyboardType: 'number-pad' },
  'claude-code': { keyboardType: 'number-pad' },
};

export function OnboardingScreen({
  initialBackend,
  status = { kind: 'idle' },
  environment = 'production',
  pairingCommand = PAIRING_COMMAND,
  onViewed,
  onClose,
  onOpenDesignSystem,
  onCopyCommand,
  onCopyAgentPrompt,
  onPastePairingCode,
  onSubmitPairing,
  onScanQr,
  onScanAnyQr,
  onOpenWebsite,
  onErrorAction,
  onRetry,
  onOpenCustomConnection,
}: OnboardingScreenProps): React.JSX.Element {
  const { t } = useTranslation('config');
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  // Phones: the padding KeyboardAvoidingView shrinks the viewport with the keyboard's real frame;
  // the reveal scroll moves only the measured shortfall, in step with the keyboard, so a
  // third-party keyboard changing height afterwards adds an increment instead of a re-scroll.
  // Android too: KeyboardProvider draws edge to edge, so adjustResize no longer lifts the Connect
  // button above the keyboard (Samsung A56 / Android 16, 2026-09-27).
  const keyboardReveal = useKeyboardRevealScroll({ clearance: KEYBOARD_CLEARANCE, enabled: !isIPad });
  const [backendKind, setBackendKind] = useState<PairableBackendKind>(initialBackend ?? 'openclaw');
  const [pairingCode, setPairingCode] = useState('');
  // Route pairing progress echoes the selected backend; that echo must not replace the form.
  const selectedBackendRef = useRef<PairableBackendKind | undefined>(initialBackend);
  const [choosing, setChoosing] = useState(!initialBackend);
  const [copied, flashCopied] = useCopiedFlash();
  const [agentPromptCopied, flashAgentPromptCopied] = useCopiedFlash();
  const [pairingMethod, setPairingMethod] = useState<PairingMethod>(() => getDefaultPairingMethod(initialBackend ?? 'openclaw'));
  const [agentPromptExpanded, setAgentPromptExpanded] = useState(false);
  const homePairingRef = useRef(!initialBackend);
  const [platformPickerOpen, setPlatformPickerOpen] = useState(false);
  const [codeExpanded, setCodeExpanded] = useState(false);
  // A human code does not identify its Registry; require a backend before accepting it.
  const [codeBackendSelected, setCodeBackendSelected] = useState(false);
  const [localModelEngine, setLocalModelEngine] = useState<LocalModelEngine>('llamacpp');
  const [localError, setLocalError] = useState(false);
  const [docsExpanded, setDocsExpanded] = useState(false);
  const viewedRef = useRef(false);
  const submitInFlightRef = useRef(false);
  const formRevisionRef = useRef(0);
  useEffect(() => () => { formRevisionRef.current += 1; }, []);
  const effectiveCommand = choosing ? PAIRING_CHOOSE_COMMAND : buildBackendPairingCommand(backendKind, pairingCommand, localModelEngine);
  const agentPrompt = useMemo(() => buildAgentPairingPrompt(t, effectiveCommand), [effectiveCommand, t]);
  // The tab row doubles as the list of supported model servers; each hint names
  // the precondition the CLI cannot check for the user before it runs.
  const localModelEngines = useMemo((): Array<{ key: LocalModelEngine; label: string; hint: string }> => [
    { key: 'llamacpp', label: t('llama.cpp'), hint: t('Start llama-server first (default port 8080), then run this in Terminal.') },
    { key: 'ollama', label: t('Ollama'), hint: t('Make sure Ollama is running, then run this in Terminal.') },
    { key: 'openai-compatible', label: t('Other'), hint: t('Point --base-url at any OpenAI-compatible server, like LM Studio or vLLM, then run this in Terminal.') },
  ], [t]);
  const localModelHint = backendKind === 'local-model' ? localModelEngines.find((engine) => engine.key === localModelEngine)?.hint : undefined;
  // Pi pairs the folder the command runs in (`--project` defaults to the working directory), so run from
  // a home-directory terminal would authorize the whole home folder. Other backends add no hint: the step
  // title already says where to run the command (owner decision 2026-10-06).
  const commandHint = localModelHint ?? (backendKind === 'pi'
    ? t('Open Terminal in your project folder and run this command.')
    : undefined);
  const backendOptions = useMemo(() => [
    { ...BACKEND_OPTIONS[0], label: t('OpenClaw') },
    { ...BACKEND_OPTIONS[1], label: t('Hermes') },
    { ...BACKEND_OPTIONS[2], label: t('Local model') },
    { ...BACKEND_OPTIONS[3], label: 'Pi' },
    { kind: 'codex' as const, label: 'Codex' },
    { kind: 'claude-code' as const, label: 'Claude Code' },
  ] as const, [t]);
  // Chooser order (owner decision 2026-09-26): OpenClaw, Hermes, Codex, Claude Code, Pi,
  // then the model server the user already runs (2026-09-19: installable products first).
  const chooserRows = useMemo((): ReadonlyArray<{ kind: PairableBackendKind; label: string }> => [
    backendOptions[0],
    backendOptions[1],
    backendOptions[4],
    backendOptions[5],
    backendOptions[3],
    backendOptions[2],
  ], [backendOptions, t]);
  // "No agent yet?" links follow the chooser order.
  const websiteOptions = useMemo((): ReadonlyArray<{ kind: OnboardingWebsiteBackendKind; label: string }> => [
    ...chooserRows.flatMap((row) => row.kind === 'local-model' ? [] : [{ kind: row.kind, label: row.label }]),
  ], [chooserRows]);
  const styles = useMemo(
    () => createStyles(theme.colors),
    [theme.colors],
  );

  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    onViewed?.();
  }, [onViewed]);

  useEffect(() => {
    if (initialBackend) {
      const keepForm = selectedBackendRef.current === initialBackend;
      selectedBackendRef.current = initialBackend;
      setBackendKind(initialBackend); setChoosing(homePairingRef.current);
      if (!keepForm) {
        formRevisionRef.current += 1;
        setPairingMethod(getDefaultPairingMethod(initialBackend));
        setPairingCode(''); setCodeExpanded(false); setCodeBackendSelected(false);
      }
    }
  }, [initialBackend]);

  const environmentRef = useRef(environment);
  useEffect(() => {
    if (environmentRef.current === environment) return;
    environmentRef.current = environment;
    formRevisionRef.current += 1;
    setPairingCode(''); setCodeExpanded(false); setCodeBackendSelected(false);
    setPlatformPickerOpen(false); Keyboard.dismiss();
  }, [environment]);

  const connecting = status.kind === 'connecting';
  // A submitted pairing (code, QR or link) owns the page until its outcome, including a paired
  // connection that is reconnecting: its code is spent, so nothing on the form can help any more.
  const pairingInFlight = connecting || status.kind === 'offline';
  useEffect(() => {
    if (!connecting) submitInFlightRef.current = false;
  }, [connecting]);
  useEffect(() => {
    // A link or QR can start a pairing while the code field still has focus.
    if (pairingInFlight) Keyboard.dismiss();
  }, [pairingInFlight]);
  // The last failure keeps its place while the next attempt connects and changes only with that
  // attempt's outcome: removing it at Connect moved the form, and the button under the finger, up
  // and back down on every failed retry (owner rule 2026-09-29).
  const heldErrorRef = useRef<Extract<OnboardingStatus, { kind: 'error' }> | null>(null);
  if (status.kind === 'error') heldErrorRef.current = status;
  else if (!pairingInFlight) heldErrorRef.current = null;
  const shownError = status.kind === 'error' ? status : heldErrorRef.current;

  if (status.kind === 'loading') {
    return (
      <OnboardingSkeleton
        topInset={insets.top}
        bottomInset={insets.bottom}
        onClose={onClose}
      />
    );
  }

  const pairingReady = isVerificationCodeComplete(pairingCode, backendKind) && !pairingInFlight && (!choosing || codeBackendSelected);
  // iPadOS 26 numberPad uses an unstable floating popover. Keep pairing on
  // the full ASCII keyboard; normalization below still enforces the code alphabet.
  const pairingInput: { keyboardType: 'number-pad' | 'ascii-capable' | 'visible-password' } = isIPad
    ? { keyboardType: 'ascii-capable' }
    : Platform.OS === 'android' && PAIRING_INPUT_PRESENTATION[backendKind].keyboardType === 'ascii-capable'
      // `ascii-capable` is iOS-only: Android fell back to the system IME, often a Chinese 9-key pad,
      // for a Latin code. `visible-password` opens a plain Latin keyboard without suggestions.
      ? { keyboardType: 'visible-password' }
      : PAIRING_INPUT_PRESENTATION[backendKind];
  const pairingPlaceholder: Readonly<Record<PairableBackendKind, string>> = {
    openclaw: t('123 456'),
    hermes: t('ABC 234'),
    'local-model': t('123 456'),
    pi: t('123 456'),
    codex: t('123 456'),
    'claude-code': t('123 456'),
  };

  const submitPairing = () => {
    if (!pairingReady || submitInFlightRef.current) return;
    const submission = createPairingSubmission(backendKind, pairingCode);
    if (!submission) return;
    Keyboard.dismiss();
    submitInFlightRef.current = true;
    try {
      const pending = onSubmitPairing(submission);
      void Promise.resolve(pending).then(
        () => { submitInFlightRef.current = false; },
        () => { submitInFlightRef.current = false; },
      );
    } catch (error) {
      submitInFlightRef.current = false;
      throw error;
    }
  };

  const pastePairingCode = async () => {
    const revision = formRevisionRef.current;
    const pasted = await onPastePairingCode?.(backendKind, () => revision === formRevisionRef.current);
    if (revision !== formRevisionRef.current) return;
    if (pasted !== null && pasted !== undefined) {
      setPairingCode(normalizeVerificationCode(pasted, backendKind));
    }
  };

  const resetPairingStep = () => {
    formRevisionRef.current += 1;
    setPairingCode(''); setLocalError(false); setAgentPromptExpanded(false);
    setCodeExpanded(false); setCodeBackendSelected(false); setPlatformPickerOpen(false); Keyboard.dismiss();
  };
  const goBack = () => {
    if (!choosing && !pairingInFlight) { homePairingRef.current = true; selectedBackendRef.current = undefined; setChoosing(true); resetPairingStep(); }
    else onClose?.();
  };
  const chooseBackend = (kind: PairableBackendKind) => {
    homePairingRef.current = false; selectedBackendRef.current = kind;
    setBackendKind(kind); setChoosing(false);
    setPairingMethod(getDefaultPairingMethod(kind)); resetPairingStep();
  };
  const copyAgentPrompt = () => {
    if (!onCopyAgentPrompt) return;
    void Promise.resolve(onCopyAgentPrompt(agentPrompt, backendKind)).then(() => { flashAgentPromptCopied(); }, () => setLocalError(true));
  };
  const backendLabel = backendKind === 'local-model' ? t('Local model') : backendKind === 'openclaw' ? 'OpenClaw' : backendKind === 'claude-code' ? 'Claude Code' : backendKind === 'codex' ? 'Codex' : backendKind === 'pi' ? 'Pi' : 'Hermes';
  const agentMethodAvailable = !choosing && backendKind !== 'local-model' && Boolean(onCopyAgentPrompt);
  const agentMethod = agentMethodAvailable && pairingMethod === 'agent';
  const codeVisible = agentMethod || codeExpanded;
  const scan = choosing ? onScanAnyQr : () => onScanQr(backendKind);
  const methodAction = agentMethodAvailable ? (agentMethod
    ? <Button testID="onboarding-pairing-method-terminal" label={t('Run it myself')} variant="text" size="sm" multiline style={styles.methodSwitch} onPress={() => { Keyboard.dismiss(); setPairingMethod('terminal'); }} />
    : <Button testID="onboarding-pairing-method-agent" label={t('Send to my agent')} variant="text" size="sm" multiline style={styles.methodSwitch} onPress={() => setPairingMethod('agent')} />) : undefined;
  const pairingControls = <>
    {!codeVisible ? <Button testID={choosing ? 'onboarding-scan-any-qr' : 'onboarding-scan-qr'} label={t('Scan to connect')}
      icon={ScanLine} variant="neutral" size="lg" multiline haptic disabled={!scan} onPress={scan} /> : null}
    {choosing && codeExpanded ? <Button testID="onboarding-change-code-backend"
      label={codeBackendSelected ? backendLabel : t('Select platform')} variant="card" size="lg" multiline
      icon={ChevronDown} disabled={pairingInFlight} onPress={() => { formRevisionRef.current += 1; Keyboard.dismiss(); setPlatformPickerOpen(true); }} /> : null}
    {codeVisible && (!choosing || codeBackendSelected) ? <View ref={keyboardReveal.anchorRef} testID="onboarding-keyboard-anchor" style={styles.keyboardAnchor} onLayout={keyboardReveal.measureAnchor}>
      <FormTextInput testID="onboarding-pairing-code" accessibilityLabel={t('Pairing code')} surface="quiet"
        trailing={choosing && onPastePairingCode ? <Button testID="onboarding-paste-code" label={t('Paste')} variant="text" disabled={pairingInFlight} onPress={() => { void pastePairingCode().catch(() => setLocalError(true)); }} /> : undefined}
        autoComplete="one-time-code" autoCapitalize="characters" autoCorrect={false} editable={!pairingInFlight}
        keyboardType={pairingInput.keyboardType} maxLength={backendKind === 'openclaw' ? 14 : 7}
        onChangeText={(value) => { formRevisionRef.current += 1; setPairingCode(normalizeVerificationCode(value, backendKind)); }}
        onFocus={keyboardReveal.measureAnchor} onSubmitEditing={submitPairing} placeholder={pairingPlaceholder[backendKind]}
        // A number pad has no return key; React Native would add an accessory toolbar for it,
        // which changes the keyboard frame again. The Connect button below stays visible instead.
        returnKeyType={pairingInput.keyboardType === 'number-pad' ? undefined : 'go'}
        value={formatVerificationCode(pairingCode, backendKind)} minHeight={ControlSize.settingsRow} inputStyle={styles.codeInputText} />
      {/* The spinner answers the press during the stage's grace period; a quick failure never shows the stage. */}
      <Button testID="onboarding-connect" label={t('Connect')} variant="neutral" size="lg" loading={pairingInFlight} disabled={!pairingReady} onPress={submitPairing} />
    </View> : null}
    <View style={styles.alternatives}>
      {codeVisible
        ? <Button testID={choosing ? 'onboarding-hide-code' : 'onboarding-scan-qr'} label={choosing ? t('Back to scanning') : t('Scan to connect')} icon={ScanLine} variant="text"
            onPress={choosing ? () => { formRevisionRef.current += 1; Keyboard.dismiss(); setCodeExpanded(false); } : scan} />
        : <Button testID="onboarding-show-code" label={t('Enter pairing code')} variant="text" onPress={() => setCodeExpanded(true)} />}
    </View>
  </>;
  return (
    <View testID="onboarding-screen" style={[styles.screen, { paddingTop: insets.top }]}>
      <FlowHeader onBack={pairingInFlight ? onClose : onClose || !choosing ? goBack : undefined} testID="onboarding-close"
        title={environment === 'preview' ? t('Preview') : undefined}
        right={onOpenDesignSystem ? <FloatingButton icon={Palette} appearance="plain" accessibilityLabel={t('Design language')} onPress={onOpenDesignSystem} /> : undefined} />
      <View style={styles.body}>
      {/* The form stays mounted under the connecting stage, so a failed pairing returns to it unchanged. */}
      <KeyboardAvoidingView testID="onboarding-keyboard-avoiding" enabled={!isIPad} style={styles.screen} behavior="padding"
        accessibilityElementsHidden={pairingInFlight} importantForAccessibility={pairingInFlight ? 'no-hide-descendants' : 'auto'}>
      <Reanimated.ScrollView ref={keyboardReveal.scrollRef} testID="onboarding-scroll"
        // On iPad use the native keyboard frame and focused-field reveal. Do not also
        // resize/scroll through keyboard-controller (which can miss a foreground frame).
        automaticallyAdjustKeyboardInsets={isIPad}
        automaticallyAdjustContentInsets={false} keyboardDismissMode={isIPad ? 'on-drag' : 'interactive'}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Space.xl }]}
        keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <PageIntro title={choosing ? t('Connect your agent') : t('Connect {{backend}}', { backend: backendLabel })} />
        {shownError ? <ErrorBanner code={shownError.code} pairingReason={shownError.pairingReason} backendKind={backendKind}
          // Its action stays drawn during the attempt, so the banner keeps its size, but never starts a second one.
          onAction={onErrorAction ? (code) => { if (!pairingInFlight) onErrorAction(code); } : undefined} /> : null}
        {localError ? <Banner tone="bad" message={t('Please try again later.', { ns: 'common' })} /> : null}
        {choosing ? <>
          <View testID="onboarding-chooser" style={styles.chooser}>
            <View testID="onboarding-backends" style={styles.platformGrid}>
              {chooserRows.map((row) => {
                const kind = row.kind;
                return <View key={kind} style={styles.platformCell}><ChoiceRow compact testID={`onboarding-backend-${kind}`} leading={<PlatformMark platform={kind} balanced size={Space.xxl} />} title={row.label} onPress={() => chooseBackend(kind)} /></View>;
              })}
            </View>
            <View style={styles.chooserActions}>
              {/* An alternative to the platforms above, not a next step: one heading, the command and where
                  to run it (owner decision 2026-10-06); the terminal itself asks which Agent to pair. */}
              {environment === 'production' ? <View testID="onboarding-auto-detect" style={styles.autoDetect}>
                <Text accessibilityRole="header" style={styles.autoDetectTitle}>{t('Or detect automatically')}</Text>
                <CommandBlock stacked command={PAIRING_CHOOSE_COMMAND} footer={t('Run in your computer’s terminal')} copied={copied}
                  onCopy={onCopyCommand ? () => { void Promise.resolve(onCopyCommand(PAIRING_CHOOSE_COMMAND)).then(flashCopied, () => setLocalError(true)); } : undefined} />
              </View> : null}
              {pairingControls}
            </View>
            <View style={styles.secondaryActions}>
              <Button testID="onboarding-docs-toggle" label={t('No agent yet?')} variant="text" onPress={() => setDocsExpanded((expanded) => !expanded)} />
              {docsExpanded ? <View testID="onboarding-doc-options" style={styles.docsList}>{websiteOptions.map((backend) => <Button key={backend.kind} testID={`onboarding-doc-${backend.kind}`} label={backend.label} variant="text" onPress={() => onOpenWebsite(backend.kind)} />)}</View> : null}
            </View>
          </View>
          <View testID="onboarding-open-source" style={styles.openSource}>
            <Text style={styles.openSourceTitle}>{t('This project is open source.')}</Text>
            <Text style={styles.openSourceCopy}>{t('Clawket will not store your data on its servers.')}</Text>
            <Button testID="onboarding-github" label={CLAWKET_GITHUB_REPO_URL.replace('https://', '')}
              variant="text" size="sm" icon={ArrowUpRight} accessibilityRole="link" multiline
              onPress={() => { setLocalError(false); void openExternalUrl(CLAWKET_GITHUB_REPO_URL, () => setLocalError(true)); }} />
          </View>
        </> : <>
          {agentMethod ? <FormStep number="01" title={t('Send this message to your agent')} action={methodAction}>
            <MessagePreview testID="onboarding-agent-prompt" message={agentPrompt} expanded={agentPromptExpanded}
              onToggle={() => setAgentPromptExpanded((expanded) => !expanded)} accessibilityLabel={t('Message for your agent')} />
            <Button testID="onboarding-copy-agent-prompt" label={agentPromptCopied ? t('Copied') : t('Copy this message')} icon={agentPromptCopied ? Check : Copy}
              variant="neutral" haptic accessibilityLabel={t('Copy this message')} onPress={copyAgentPrompt} />
          </FormStep> : <FormStep number="01" title={t('Run in your computer’s terminal')} action={methodAction}>
            {backendKind === 'local-model'
              ? <SegmentedTabs testID="onboarding-local-model-engine" size="sm" tabs={localModelEngines} active={localModelEngine} onSwitch={setLocalModelEngine} />
              : null}
            {commandHint ? <Text testID="onboarding-command-hint" style={styles.subtitle}>{commandHint}</Text> : null}
            <CommandBlock stacked command={effectiveCommand} copied={copied} onCopy={onCopyCommand ? () => {
              void Promise.resolve(onCopyCommand(effectiveCommand)).then(flashCopied, () => setLocalError(true));
            } : undefined} />
          </FormStep>}
          <FormStep number="02" style={styles.secondStep} title={agentMethod ? t('Enter the code it replies with') : codeExpanded ? t('Enter the pairing code') : t('Scan the QR code in your terminal')}
            action={codeVisible && onPastePairingCode ? <Button testID="onboarding-paste-code" label={t('Paste')} variant="text" disabled={pairingInFlight} onPress={() => { void pastePairingCode().catch(() => setLocalError(true)); }} /> : undefined}>
            {pairingControls}
          </FormStep>
          {backendKind === 'openclaw' && onOpenCustomConnection ? <Button testID="onboarding-custom-connection" label={t('Local or custom connection')} variant="text" disabled={pairingInFlight} onPress={onOpenCustomConnection} /> : null}
          <Button testID="onboarding-change-platform" label={t('Change platform')} variant="text" onPress={goBack} />
        </>}
      </Reanimated.ScrollView>
      </KeyboardAvoidingView>
      <Sheet testID="onboarding-platform-picker" visible={platformPickerOpen && !pairingInFlight} onClose={() => setPlatformPickerOpen(false)}
        closeAccessibilityLabel={t('Close', { ns: 'common' })} title={t('Select platform')} snapPoints={PLATFORM_PICKER_SNAP_POINTS}>
        <BottomSheetScrollView contentContainerStyle={styles.platformPickerContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.subtitle}>{t('Choose the platform that printed your code.')}</Text>
          {chooserRows.filter((row) => row.kind !== 'local-model').map((row) => <ChoiceRow key={row.kind}
            testID={`onboarding-code-backend-${row.kind}`} leading={<PlatformMark platform={row.kind} balanced />} title={row.label}
            onPress={() => { formRevisionRef.current += 1; selectedBackendRef.current = row.kind; setBackendKind(row.kind); setCodeBackendSelected(true); setPairingCode(''); setPlatformPickerOpen(false); }} />)}
        </BottomSheetScrollView>
      </Sheet>
      <ConnectingStage status={status} onRetry={onRetry} />
      </View>
    </View>
  );
}

function ErrorBanner({
  code,
  pairingReason,
  backendKind,
  onAction,
}: Readonly<{
  code: Extract<OnboardingStatus, { kind: 'error' }>['code'];
  pairingReason?: Extract<OnboardingStatus, { kind: 'error' }>['pairingReason'];
  backendKind: PairableBackendKind;
  onAction?: OnboardingScreenProps['onErrorAction'];
}>): React.JSX.Element {
  const { t } = useTranslation('config');
  const error = resolveOnboardingError(code, backendKind, pairingReason);
  return (
    <Banner
      testID="onboarding-error"
      tone="bad"
      message={translateErrorMessage(t, error.messageKey)}
      actionLabel={error.actionKey && onAction ? translateErrorAction(t, error.actionKey) : undefined}
      onAction={onAction ? () => onAction(code) : undefined}
    />
  );
}

/**
 * A submitted pairing owns the page until its outcome (owner request 2026-09-30: under a waiting cat the
 * steps above still offered a copy button, a spent code and a live-looking Connect). The stage fades in
 * over the form with its Companion after `Motion.loadingGrace`, so a quick failure only ever shows the
 * Connect spinner; a failure fades it back out to the unchanged form and its held error, and success plays
 * the cat's exit while the app moves on to the new Agent.
 */
function ConnectingStage({
  status,
  onRetry,
}: Readonly<{
  status: OnboardingStatus;
  onRetry?: () => void;
}>): React.JSX.Element | null {
  const { t } = useTranslation('config');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const inFlight = status.kind === 'connecting' || status.kind === 'offline';
  const ready = status.kind === 'connecting' && status.phase === 'ready';
  // Once the paired connection has gone offline, its automatic retries keep that label and the Reconnect
  // action until the pairing ends, as in the Roster and Thread, so they do not flicker with every attempt.
  // A stage that is fading out keeps what it showed.
  const offlineRef = useRef(status.kind === 'offline');
  const wasInFlightRef = useRef(inFlight);
  if (inFlight && !wasInFlightRef.current) offlineRef.current = false;
  if (status.kind === 'offline') offlineRef.current = true;
  wasInFlightRef.current = inFlight;
  const offline = offlineRef.current;

  const [mounted, setMounted] = useState(inFlight);
  // Mirrors `mounted` for the effect: true from an attempt's start until its stage has faded out.
  const shownRef = useRef(inFlight);
  // A page opened for a pairing (a link) starts on the stage rather than flashing the form.
  const opacity = useSharedValue(inFlight ? 1 : 0);
  useEffect(() => {
    if (inFlight) {
      setMounted(true);
      // A stage still fading out comes straight back; a new one waits out the grace period with its cat.
      opacity.value = shownRef.current
        ? withTiming(1, { duration: Motion.duration.normal })
        : withDelay(Motion.loadingGrace, withTiming(1, { duration: Motion.duration.normal }));
      shownRef.current = true;
      return undefined;
    }
    opacity.value = withTiming(0, { duration: Motion.duration.normal });
    const timer = setTimeout(() => { shownRef.current = false; setMounted(false); }, Motion.duration.normal);
    return () => clearTimeout(timer);
  }, [inFlight, opacity]);
  const appear = useAnimatedStyle(() => ({ opacity: opacity.value }));
  if (!mounted && !inFlight) return null;
  return (
    <Reanimated.View testID="onboarding-progress" pointerEvents={inFlight ? 'auto' : 'none'} style={[styles.stage, appear]}>
      <LoadingState testID="onboarding-connecting-cat" pose="connecting" headline phase={ready ? 'ready' : 'wait'}
        message={offline ? t('Offline · reconnecting', { ns: 'common' }) : t('common:Connecting')}
        action={offline && onRetry ? { label: t('Reconnect', { ns: 'common' }), onPress: onRetry } : undefined} />
    </Reanimated.View>
  );
}

function OnboardingSkeleton({
  topInset,
  bottomInset,
  onClose,
}: Readonly<{
  topInset: number;
  bottomInset: number;
  onClose?: () => void;
}>): React.JSX.Element {
  const { t } = useTranslation('config');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  return (
    <View
      testID="onboarding-loading"
      style={[styles.screen, styles.skeletonScreen, { paddingTop: topInset, paddingBottom: bottomInset }]}
    >
      <FlowHeader onBack={onClose} />
      <Skeleton testID="onboarding-skeleton-title" accessibilityLabel={t('Loading...', { ns: 'common' })} style={styles.skeletonTitle} />
      <Skeleton style={styles.skeletonSubtitle} />
      <View style={styles.skeletonRows}>
        <Skeleton style={styles.skeletonRow} />
        <Skeleton style={styles.skeletonRow} />
        <Skeleton style={styles.skeletonCommand} />
        <Skeleton style={styles.skeletonInput} />
        <Skeleton style={styles.skeletonButton} />
      </View>
    </View>
  );
}

function translateErrorMessage(
  t: ReturnType<typeof useTranslation>['t'],
  key: string,
): string {
  switch (key) {
    case 'Bridge is not running on your computer':
      return t('Bridge is not running on your computer');
    case 'Hermes is not responding':
      return t('Hermes is not responding');
    case 'OpenClaw is not responding':
      return t('OpenClaw is not responding');
    case 'Pairing expired, pair again':
      return t('Pairing expired, pair again');
    case 'Sign-in expired':
      return t('Sign-in expired');
    case 'No network':
      return t('No network');
    case 'Connection timed out':
      return t('Connection timed out');
    case 'Too many requests, try again later':
      return t('Too many requests, try again later');
    case 'Message too large to send':
      return t('Message too large to send');
    case 'Not supported by this backend':
      return t('Not supported by this backend');
    case 'This QR code belongs to another backend. Scan the QR code for this backend.':
      return t('This QR code belongs to another backend. Scan the QR code for this backend.');
    case 'Pairing environment does not match. Use the command shown on this page.':
      return t('Pairing environment does not match. Use the command shown on this page.');
    case 'This QR code does not contain valid connection info.':
      return t('This QR code does not contain valid connection info.');
    case 'Enable Debug Mode before pairing with the Preview environment.':
      return t('Enable Debug Mode before pairing with the Preview environment.');
    case 'Could not save this connection. Try again.':
      return t('Could not save this connection. Try again.');
    case 'Server error':
      return t('Server error');
    default:
      return key;
  }
}

function translateErrorAction(
  t: ReturnType<typeof useTranslation>['t'],
  key: string,
): string {
  switch (key) {
    case 'Retry':
      return t('Retry', { ns: 'common' });
    case 'See how to start it':
      return t('See how to start it');
    case 'Pair again':
      return t('Pair again');
    case 'Sign in again':
      return t('Sign in again');
    default:
      return key;
  }
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.canvas,
    },
    // Everything under the header: the form, and the connecting stage over it.
    body: { flex: 1 },
    stage: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.canvas },
    content: { flexGrow: 1, paddingHorizontal: Space.xl, gap: Space.xl },
    methodSwitch: { maxWidth: '45%', minHeight: ControlSize.floatingButton, flexShrink: 1 },
    subtitle: { color: colors.inkSecondary, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, fontWeight: FontWeight.regular },
    keyboardAnchor: { gap: Space.md },
    // Step 02 gets a touch more air than the page's uniform block gap so the two steps read as separate moves.
    secondStep: { marginTop: Space.sm },
    codeInputText: { fontSize: FontSize.title, lineHeight: LineHeight.title, fontVariant: ['tabular-nums'], letterSpacing: Space.xs, textAlign: 'center' },
    // "No agent yet?" sits under the choices it answers; the open-source note follows as its own block
    // rather than anchoring to the screen bottom (owner feedback 2026-09-27: the help floated between them).
    chooser: { gap: Space.sm },
    chooserActions: { gap: Space.lg, paddingTop: Space.lg },
    platformGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    platformCell: { width: '50%', paddingEnd: Space.sm },
    platformPickerContent: { paddingHorizontal: Space.xl, paddingBottom: Space.md, gap: Space.sm },
    autoDetect: { gap: Space.sm },
    autoDetectTitle: { color: colors.ink, fontSize: FontSize.body, lineHeight: LineHeight.body, fontWeight: FontWeight.semibold },
    secondaryActions: { gap: Space.sm },
    openSource: { paddingTop: Space.lg, paddingBottom: Space.lg, alignItems: 'center', gap: Space.xs },
    openSourceTitle: { color: colors.inkSecondary, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, fontWeight: FontWeight.semibold, textAlign: 'center' },
    openSourceCopy: { color: colors.inkSecondary, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, fontWeight: FontWeight.regular, textAlign: 'center' },
    // Five or more website links outgrow one line on a phone; wrap them rather than run off both edges.
    docsList: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
    alternatives: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Space.xs },
    skeletonScreen: {
      paddingHorizontal: Space.lg,
      paddingBottom: Space.xl,
    },
    skeletonClose: {
      minHeight: ControlSize.floatingButton,
      alignItems: 'flex-end',
      marginTop: Space.sm,
    },
    skeletonTitle: {
      width: '82%',
      height: LineHeight.display,
      marginTop: Space.xxl,
    },
    skeletonSubtitle: {
      width: '72%',
      height: LineHeight.secondary,
      marginTop: Space.sm,
    },
    skeletonRows: {
      marginTop: Space.xxl,
      gap: Space.sm,
    },
    skeletonRow: {
      height: ControlSize.settingsRow,
    },
    skeletonCommand: {
      height: ControlSize.settingsRow,
      marginHorizontal: Space.sm,
    },
    skeletonInput: {
      height: ControlSize.floatingButton,
      marginTop: Space.lg,
    },
    skeletonButton: {
      height: ControlSize.floatingButton,
    },
  });
}
