import { isIPad } from '../../utils/platform';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Reanimated from 'react-native-reanimated';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Check,
  ArrowUpRight,
  CheckCircle2,
  Circle,
  Copy,
  ImagePlus,
  MessageSquareText,
  Palette,
  QrCode,
  Terminal,
  WifiOff,
} from 'lucide-react-native';
import { YOUMIND_SPRITE_ENTRY_VISIBLE } from '../../config/features';
import { CLAWKET_GITHUB_REPO_URL } from '../../config/app-links';
import { openExternalUrl } from '../../utils/openExternalUrl';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  IconSize,
  LineHeight,
  Space,
} from '../../theme/tokens';
import { PlatformMark } from '../../components/ui/PlatformMark';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { FloatingButton } from '../../components/ui/FloatingButton';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { FlowHeader, PageIntro, ChoiceRow, FormStep, CommandBlock, MessagePreview } from '../../components/ui/SetupPrimitives';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
import { useKeyboardRevealScroll } from '../../components/ui/useKeyboardRevealScroll';
import { Skeleton } from '../../components/ui/Skeleton';
import {
  buildAgentPairingPrompt,
  buildLocalModelPairingCommand,
  createPairingSubmission,
  formatVerificationCode,
  isVerificationCodeComplete,
  normalizeVerificationCode,
  PAIRING_COMMAND,
  resolveOnboardingError,
  type LocalModelEngine,
  type OnboardingStatus,
  type PairableBackendKind,
  type PairingSubmission,
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
  onPastePairingCode?: (backendKind: PairableBackendKind) => MaybePromise<string | null>;
  onSubmitPairing: (submission: PairingSubmission) => MaybePromise<void>;
  onScanQr: (expectedBackendKind: PairableBackendKind) => void;
  onImportQr?: (expectedBackendKind: PairableBackendKind) => void;
  onOpenYouMind: () => void;
  onOpenWebsite: (backendKind: OnboardingWebsiteBackendKind) => void;
  onErrorAction?: (status: Extract<OnboardingStatus, { kind: 'error' }>['code']) => void;
  onRetry?: () => void;
}>;

/** How long a copy action shows its confirmation before the control returns to normal. */
const COPY_FEEDBACK_MS = 1500;

/** Space kept between the pairing field + Connect action and the top of the keyboard. */
const KEYBOARD_CLEARANCE = Space.lg;

type PairingMethod = 'agent' | 'terminal';

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
];

const PAIRING_INPUT_PRESENTATION: Readonly<Record<PairableBackendKind, {
  keyboardType: 'number-pad' | 'ascii-capable';
}>> = {
  openclaw: { keyboardType: 'number-pad' },
  hermes: { keyboardType: 'ascii-capable' },
  'local-model': { keyboardType: 'number-pad' },
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
  onImportQr,
  onOpenYouMind,
  onOpenWebsite,
  onErrorAction,
  onRetry,
}: OnboardingScreenProps): React.JSX.Element {
  const { t } = useTranslation('config');
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  // iOS: the padding KeyboardAvoidingView shrinks the viewport with the keyboard's real frame;
  // the reveal scroll moves only the measured shortfall, in step with the keyboard, so a
  // third-party keyboard changing height afterwards adds an increment instead of a re-scroll.
  const keyboardReveal = useKeyboardRevealScroll({ clearance: KEYBOARD_CLEARANCE, enabled: Platform.OS === 'ios' && !isIPad });
  const [backendKind, setBackendKind] = useState<PairableBackendKind>(initialBackend ?? 'openclaw');
  const [pairingCode, setPairingCode] = useState('');
  const [choosing, setChoosing] = useState(!initialBackend);
  const [copied, flashCopied] = useCopiedFlash();
  const [agentPromptCopied, flashAgentPromptCopied] = useCopiedFlash();
  const [pairingMethod, setPairingMethod] = useState<PairingMethod>('agent');
  const [agentPromptExpanded, setAgentPromptExpanded] = useState(false);
  // Stays on once the message left the phone: the step reads as done while the user waits for the reply.
  const [agentPromptSent, setAgentPromptSent] = useState(false);
  const [localModelEngine, setLocalModelEngine] = useState<LocalModelEngine>('llamacpp');
  const [localError, setLocalError] = useState(false);
  const [docsExpanded, setDocsExpanded] = useState(false);
  const viewedRef = useRef(false);
  const submitInFlightRef = useRef(false);
  const effectiveCommand = backendKind === 'local-model'
    ? buildLocalModelPairingCommand(localModelEngine)
    : pairingCommand;
  const agentPrompt = useMemo(() => buildAgentPairingPrompt(t, effectiveCommand), [effectiveCommand, t]);
  // The tab row doubles as the list of supported model servers; each hint names
  // the precondition the CLI cannot check for the user before it runs.
  const localModelEngines = useMemo((): Array<{ key: LocalModelEngine; label: string; hint: string }> => [
    { key: 'llamacpp', label: t('llama.cpp'), hint: t('Start llama-server first (default port 8080), then run this in Terminal.') },
    { key: 'ollama', label: t('Ollama'), hint: t('Make sure Ollama is running, then run this in Terminal.') },
    { key: 'openai-compatible', label: t('Other'), hint: t('Point --base-url at any OpenAI-compatible server, like LM Studio or vLLM, then run this in Terminal.') },
  ], [t]);
  const localModelHint = backendKind === 'local-model' ? localModelEngines.find((engine) => engine.key === localModelEngine)?.hint : undefined;
  const backendOptions = useMemo(() => [
    { ...BACKEND_OPTIONS[0], label: t('OpenClaw') },
    { ...BACKEND_OPTIONS[1], label: t('Hermes') },
    { ...BACKEND_OPTIONS[2], label: t('Local model') },
  ] as const, [t]);
  // Chooser order (owner decision 2026-09-19): the installable products first,
  // then the model server the user already runs.
  const chooserRows = useMemo((): ReadonlyArray<{ kind: PairableBackendKind | 'youmind'; label: string }> => [
    backendOptions[0],
    backendOptions[1],
    ...(YOUMIND_SPRITE_ENTRY_VISIBLE ? [{ kind: 'youmind' as const, label: t('YouMind Sprite') }] : []),
    backendOptions[2],
  ], [backendOptions, t]);
  const websiteOptions = useMemo((): ReadonlyArray<{ kind: OnboardingWebsiteBackendKind; label: string }> => [
    ...backendOptions.flatMap((backend) => backend.kind === 'local-model' ? [] : [{ kind: backend.kind, label: backend.label }]),
    ...(YOUMIND_SPRITE_ENTRY_VISIBLE ? [{ kind: 'youmind' as const, label: t('YouMind') }] : []),
  ], [backendOptions, t]);
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
    if (initialBackend) { setBackendKind(initialBackend); setChoosing(false); }
  }, [initialBackend]);

  const connecting = status.kind === 'connecting';
  useEffect(() => {
    if (!connecting) submitInFlightRef.current = false;
  }, [connecting]);

  if (status.kind === 'loading') {
    return (
      <OnboardingSkeleton
        topInset={insets.top}
        bottomInset={insets.bottom}
        onClose={onClose}
      />
    );
  }

  const pairingReady = isVerificationCodeComplete(pairingCode, backendKind) && !connecting;
  // iPadOS 26 numberPad uses an unstable floating popover. Keep pairing on
  // the full ASCII keyboard; normalization below still enforces the code alphabet.
  const pairingInput = isIPad
    ? { keyboardType: 'ascii-capable' as const }
    : PAIRING_INPUT_PRESENTATION[backendKind];
  const pairingPlaceholder: Readonly<Record<PairableBackendKind, string>> = {
    openclaw: t('123 456'),
    hermes: t('ABC 234'),
    'local-model': t('123 456'),
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
    const pasted = await onPastePairingCode?.(backendKind);
    if (pasted !== null && pasted !== undefined) {
      setPairingCode(normalizeVerificationCode(pasted, backendKind));
    }
  };

  const resetPairingStep = () => {
    setPairingCode(''); setLocalError(false); setAgentPromptSent(false); setAgentPromptExpanded(false);
  };
  const goBack = () => {
    if (!choosing && !connecting) { setChoosing(true); resetPairingStep(); }
    else onClose?.();
  };
  const chooseBackend = (kind: PairableBackendKind) => {
    setBackendKind(kind); setChoosing(false); resetPairingStep();
  };
  const copyAgentPrompt = () => {
    if (!onCopyAgentPrompt) return;
    void Promise.resolve(onCopyAgentPrompt(agentPrompt, backendKind)).then(() => { flashAgentPromptCopied(); setAgentPromptSent(true); }, () => setLocalError(true));
  };
  const backendLabel = backendKind === 'local-model' ? t('Local model') : backendKind === 'openclaw' ? 'OpenClaw' : 'Hermes';
  const agentMethodAvailable = backendKind !== 'local-model' && Boolean(onCopyAgentPrompt);
  const agentMethod = agentMethodAvailable && pairingMethod === 'agent';
  return (
    <View testID="onboarding-screen" style={[styles.screen, { paddingTop: insets.top }]}>
      <FlowHeader onBack={connecting ? onClose : onClose || !choosing ? goBack : undefined} testID="onboarding-close"
        title={environment === 'preview' ? t('Preview') : undefined}
        right={onOpenDesignSystem ? <FloatingButton icon={Palette} appearance="plain" accessibilityLabel={t('Design language')} onPress={onOpenDesignSystem} /> : undefined} />
      <KeyboardAvoidingView testID="onboarding-keyboard-avoiding" enabled={!isIPad} style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Reanimated.ScrollView ref={keyboardReveal.scrollRef} testID="onboarding-scroll"
        // On iPad use the native keyboard frame and focused-field reveal. Do not also
        // resize/scroll through keyboard-controller (which can miss a foreground frame).
        automaticallyAdjustKeyboardInsets={isIPad}
        automaticallyAdjustContentInsets={false} keyboardDismissMode={isIPad ? 'on-drag' : 'interactive'}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Space.xl }]}
        keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <PageIntro title={choosing ? t('Connect your agent') : t('Connect {{backend}}', { backend: backendLabel })} />
        {status.kind === 'offline' ? <Banner tone="neutral" icon={WifiOff} testID="onboarding-offline" message={t('Offline · reconnecting', { ns: 'common' })} actionLabel={onRetry ? t('Reconnect', { ns: 'common' }) : undefined} onAction={onRetry} /> : null}
        {status.kind === 'error' ? <ErrorBanner code={status.code} backendKind={backendKind} onAction={onErrorAction} /> : null}
        {localError ? <Banner tone="bad" message={t('Please try again later.', { ns: 'common' })} /> : null}
        {choosing ? <>
          <View testID="onboarding-backends" style={styles.backendList}>
            {chooserRows.map((row) => {
              if (row.kind === 'youmind') return <ChoiceRow key={row.kind} testID="onboarding-youmind" leading={<PlatformMark platform="youmind" />} title={row.label} onPress={onOpenYouMind} />;
              const kind = row.kind;
              return <ChoiceRow key={kind} testID={`onboarding-backend-${kind}`} leading={<PlatformMark platform={kind} />} title={row.label} onPress={() => chooseBackend(kind)} />;
            })}
          </View>
          <View style={styles.secondaryActions}>
            <Button testID="onboarding-docs-toggle" label={t('No agent yet?')} variant="text" onPress={() => setDocsExpanded((expanded) => !expanded)} />
            {docsExpanded ? <View testID="onboarding-doc-options" style={styles.docsList}>{websiteOptions.map((backend) => <Button key={backend.kind} testID={`onboarding-doc-${backend.kind}`} label={backend.label} variant="text" onPress={() => onOpenWebsite(backend.kind)} />)}</View> : null}
          </View>
          <View testID="onboarding-open-source" style={styles.openSource}>
            <Text style={styles.openSourceTitle}>{t('This project is open source.')}</Text>
            <Text style={styles.openSourceCopy}>{t('Clawket will not store your data on its servers.')}</Text>
            <Button testID="onboarding-github" label={CLAWKET_GITHUB_REPO_URL.replace('https://', '')}
              variant="text" size="sm" icon={ArrowUpRight} accessibilityRole="link" multiline
              onPress={() => { setLocalError(false); void openExternalUrl(CLAWKET_GITHUB_REPO_URL, () => setLocalError(true)); }} />
          </View>
        </> : <>
          {agentMethod ? <FormStep number="01" title={t('Send this message to your agent')}
            action={agentPromptSent ? <Check testID="onboarding-agent-prompt-sent" size={IconSize.sm} color={theme.colors.inkSecondary} strokeWidth={2} accessibilityLabel={t('Copied')} /> : undefined}>
            <Text style={styles.subtitle}>{t('Paste it to the agent you already chat with, like {{backend}} in Telegram. It will reply with the pairing code.', { backend: backendLabel })}</Text>
            <MessagePreview testID="onboarding-agent-prompt" message={agentPrompt} expanded={agentPromptExpanded}
              onToggle={() => setAgentPromptExpanded((expanded) => !expanded)} accessibilityLabel={t('Message for your agent')} />
            <Button testID="onboarding-copy-agent-prompt" label={agentPromptCopied ? t('Copied') : t('Copy this message')} icon={agentPromptCopied ? Check : Copy}
              variant="neutral" haptic accessibilityLabel={t('Copy this message')} onPress={copyAgentPrompt} />
          </FormStep> : <FormStep number="01" title={t('Get a pairing code')}>
            {backendKind === 'local-model'
              ? <SegmentedTabs testID="onboarding-local-model-engine" size="sm" tabs={localModelEngines} active={localModelEngine} onSwitch={setLocalModelEngine} />
              : null}
            <Text testID="onboarding-command-hint" style={styles.subtitle}>{localModelHint ?? t('Open Terminal and run this command.')}</Text>
            <CommandBlock command={effectiveCommand} copied={copied} onCopy={onCopyCommand ? () => {
              void Promise.resolve(onCopyCommand(effectiveCommand)).then(flashCopied, () => setLocalError(true));
            } : undefined} />
          </FormStep>}
          <FormStep number="02" title={agentMethod ? t('Enter the code it replies with') : t('Enter the pairing code')}
            action={onPastePairingCode ? <Button testID="onboarding-paste-code" label={t('Paste')} variant="text" disabled={connecting} onPress={() => { void pastePairingCode().catch(() => setLocalError(true)); }} /> : undefined}>
            <View ref={keyboardReveal.anchorRef} testID="onboarding-keyboard-anchor" style={styles.keyboardAnchor} onLayout={keyboardReveal.measureAnchor}>
              <FormTextInput testID="onboarding-pairing-code" accessibilityLabel={t('Pairing code')} surface="quiet"
                autoComplete="one-time-code" autoCapitalize="characters" autoCorrect={false} editable={!connecting}
                keyboardType={pairingInput.keyboardType} maxLength={backendKind === 'openclaw' ? 14 : 7}
                onChangeText={(value) => setPairingCode(normalizeVerificationCode(value, backendKind))}
                onFocus={keyboardReveal.measureAnchor} onSubmitEditing={submitPairing} placeholder={pairingPlaceholder[backendKind]}
                // A number pad has no return key; React Native would add an accessory toolbar for it,
                // which changes the keyboard frame again. The Connect button below stays visible instead.
                returnKeyType={pairingInput.keyboardType === 'number-pad' ? undefined : 'go'}
                value={formatVerificationCode(pairingCode, backendKind)} minHeight={ControlSize.settingsRow} inputStyle={styles.codeInputText} />
              <Button testID="onboarding-connect" label={t('Connect')} variant="neutral" size="lg" loading={connecting} disabled={!pairingReady} onPress={submitPairing} />
            </View>
          </FormStep>
          {connecting ? <ConnectionProgress phase={status.phase} /> : <View style={styles.alternatives}>
            {agentMethodAvailable ? (pairingMethod === 'agent'
              ? <Button testID="onboarding-pairing-method-terminal" label={t('Run it myself')} icon={Terminal} variant="text" onPress={() => setPairingMethod('terminal')} />
              : <Button testID="onboarding-pairing-method-agent" label={t('Send to my agent')} icon={MessageSquareText} variant="text" onPress={() => setPairingMethod('agent')} />) : null}
            <Button testID="onboarding-scan-qr" label={t('Scan to connect')} icon={QrCode} variant="text" onPress={() => onScanQr(backendKind)} />
            {onImportQr ? <Button testID="onboarding-import-qr" label={t('Choose from photos')} icon={ImagePlus} variant="text" onPress={() => onImportQr(backendKind)} /> : null}
          </View>}
        </>}
      </Reanimated.ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function ErrorBanner({
  code,
  backendKind,
  onAction,
}: Readonly<{
  code: Extract<OnboardingStatus, { kind: 'error' }>['code'];
  backendKind: PairableBackendKind;
  onAction?: OnboardingScreenProps['onErrorAction'];
}>): React.JSX.Element {
  const { t } = useTranslation('config');
  const error = resolveOnboardingError(code, backendKind);
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

function ConnectionProgress({
  phase,
}: Readonly<{
  phase: Extract<OnboardingStatus, { kind: 'connecting' }>['phase'];
}>): React.JSX.Element {
  const { t } = useTranslation('config');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const connectionPhases = useMemo(() => [
    { key: 'relay_connected', label: t('Relay connected') },
    { key: 'waiting_bridge', label: t('Waiting for Bridge') },
    { key: 'ready', label: t('Ready') },
  ] as const, [t]);
  const activeIndex = connectionPhases.findIndex((item) => item.key === phase);
  return (
    <View testID="onboarding-progress" style={styles.progress}>
      {connectionPhases.map((item, index) => {
        const complete = index <= activeIndex;
        const ProgressIcon = complete ? CheckCircle2 : Circle;
        return (
          <View key={item.key} style={styles.progressItem}>
            <ProgressIcon
              size={IconSize.sm}
              color={complete ? theme.colors.good : theme.colors.inkTertiary}
            />
            <Text style={[styles.progressLabel, complete ? styles.progressLabelActive : null]}>
              {item.label}
            </Text>
          </View>
        );
      })}
    </View>
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
    content: { flexGrow: 1, paddingHorizontal: Space.xl, gap: Space.xl },
    subtitle: { color: colors.inkSecondary, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, fontWeight: FontWeight.regular },
    backendList: { gap: Space.sm },
    keyboardAnchor: { gap: Space.md },
    codeInputText: { fontSize: FontSize.title, lineHeight: LineHeight.title, fontVariant: ['tabular-nums'], letterSpacing: Space.xs, textAlign: 'center' },
    secondaryActions: { marginTop: Space.xl, gap: Space.sm },
    openSource: { marginTop: 'auto', paddingTop: Space.xxl, paddingBottom: Space.lg, alignItems: 'center', gap: Space.xs },
    openSourceTitle: { color: colors.inkSecondary, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, fontWeight: FontWeight.semibold, textAlign: 'center' },
    openSourceCopy: { color: colors.inkSecondary, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, fontWeight: FontWeight.regular, textAlign: 'center' },
    docsList: { flexDirection: 'row', justifyContent: 'center' },
    alternatives: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Space.xs },
    progress: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: Space.sm,
    },
    progressItem: {
      flex: 1,
      alignItems: 'center',
      gap: Space.xs,
    },
    progressLabel: {
      color: colors.inkTertiary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
      textAlign: 'center',
    },
    progressLabelActive: {
      color: colors.inkSecondary,
    },
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
