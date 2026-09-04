import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Bot,
  CheckCircle2,
  Circle,
  CircleHelp,
  ClipboardPaste,
  Copy,
  Feather,
  QrCode,
  Sparkles,
  X,
} from 'lucide-react-native';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  IconSize,
  LineHeight,
  Radius,
  Space,
} from '../../theme/tokens';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { FloatingButton } from '../../components/ui/FloatingButton';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { Skeleton } from '../../components/ui/Skeleton';
import {
  createPairingSubmission,
  formatVerificationCode,
  isVerificationCodeComplete,
  normalizeVerificationCode,
  PAIRING_COMMAND,
  resolveOnboardingError,
  type OnboardingStatus,
  type PairableBackendKind,
  type PairingSubmission,
} from './model';

type MaybePromise<T> = T | Promise<T>;

export type OnboardingScreenProps = Readonly<{
  initialBackend?: PairableBackendKind;
  status?: OnboardingStatus;
  environment?: 'production' | 'preview';
  onViewed?: () => void;
  onClose?: () => void;
  onCopyCommand?: (command: string) => MaybePromise<void>;
  onPastePairingCode?: (backendKind: PairableBackendKind) => MaybePromise<string | null>;
  onSubmitPairing: (submission: PairingSubmission) => void;
  onScanQr: (expectedBackendKind: PairableBackendKind) => void;
  onOpenPairingHelp?: (backendKind: PairableBackendKind) => void;
  onOpenYouMind: () => void;
  onOpenDocs: (backendKind: PairableBackendKind) => void;
  onErrorAction?: (status: Extract<OnboardingStatus, { kind: 'error' }>['code']) => void;
  onRetry?: () => void;
}>;

const BACKEND_OPTIONS: ReadonlyArray<{
  kind: PairableBackendKind;
  icon: typeof Bot;
}> = [
  { kind: 'openclaw', icon: Bot },
  { kind: 'hermes', icon: Feather },
];

export function OnboardingScreen({
  initialBackend = 'openclaw',
  status = { kind: 'idle' },
  environment = 'production',
  onViewed,
  onClose,
  onCopyCommand,
  onPastePairingCode,
  onSubmitPairing,
  onScanQr,
  onOpenPairingHelp,
  onOpenYouMind,
  onOpenDocs,
  onErrorAction,
  onRetry,
}: OnboardingScreenProps): React.JSX.Element {
  const { t } = useTranslation('config');
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [backendKind, setBackendKind] = useState<PairableBackendKind>(initialBackend);
  const [pairingCode, setPairingCode] = useState('');
  const [docsExpanded, setDocsExpanded] = useState(false);
  const viewedRef = useRef(false);
  const backendOptions = useMemo(() => [
    { ...BACKEND_OPTIONS[0], label: t('OpenClaw') },
    { ...BACKEND_OPTIONS[1], label: t('Hermes') },
  ] as const, [t]);
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
    setBackendKind(initialBackend);
  }, [initialBackend]);

  if (status.kind === 'loading') {
    return (
      <OnboardingSkeleton
        topInset={insets.top}
        bottomInset={insets.bottom}
        onClose={onClose}
      />
    );
  }

  const connecting = status.kind === 'connecting';
  const pairingReady = isVerificationCodeComplete(pairingCode) && !connecting;

  const submitPairing = () => {
    const submission = createPairingSubmission(backendKind, pairingCode);
    if (submission) onSubmitPairing(submission);
  };

  const pastePairingCode = async () => {
    const pasted = await onPastePairingCode?.(backendKind);
    if (pasted !== null && pasted !== undefined) {
      setPairingCode(normalizeVerificationCode(pasted));
    }
  };

  return (
    <View
      testID="onboarding-screen"
      style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
    >
      <ScrollView
        automaticallyAdjustContentInsets={false}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topRow}>
          {environment === 'preview' ? (
            <View testID="onboarding-preview" style={styles.previewBadge}>
              <Text style={styles.previewText}>{t('Preview')}</Text>
            </View>
          ) : <View />}
          {onClose ? (
            <FloatingButton
              testID="onboarding-close"
              icon={X}
              appearance="surface"
              accessibilityLabel={t('Close', { ns: 'common' })}
              onPress={onClose}
            />
          ) : null}
        </View>

        <View style={styles.intro}>
          <Text testID="onboarding-title" style={styles.title}>
            {t('Connect Clawket to your agent')}
          </Text>
          <Text testID="onboarding-subtitle" style={styles.subtitle}>
            {connecting
              ? t('Connecting through Relay…')
              : t('You need a computer running OpenClaw or Hermes')}
          </Text>
        </View>

        {status.kind === 'offline' ? (
          <Banner
            testID="onboarding-offline"
            message={t('No network')}
            actionLabel={onRetry ? t('Retry', { ns: 'common' }) : undefined}
            onAction={onRetry}
          />
        ) : null}

        {status.kind === 'error' ? (
          <ErrorBanner
            code={status.code}
            backendKind={backendKind}
            onAction={onErrorAction}
          />
        ) : null}

        <View testID="onboarding-backends" style={styles.backendList}>
          {backendOptions.map((backend) => (
            <View key={backend.kind}>
              <BackendChoiceRow
                testID={`onboarding-backend-${backend.kind}`}
                icon={backend.icon}
                label={backend.label}
                selected={Object.is(backendKind, backend.kind)}
                onPress={() => setBackendKind(backend.kind)}
              />
              {Object.is(backendKind, backend.kind) ? (
                <View testID="onboarding-command" style={styles.commandRow}>
                  <Text
                    accessibilityLabel={t('Pairing command')}
                    numberOfLines={1}
                    selectable
                    style={styles.command}
                  >
                    {PAIRING_COMMAND}
                  </Text>
                  {onOpenPairingHelp ? (
                    <FloatingButton
                      icon={CircleHelp}
                      appearance="quiet"
                      accessibilityLabel={t('Pairing help')}
                      onPress={() => onOpenPairingHelp(backendKind)}
                    />
                  ) : null}
                  {onCopyCommand ? (
                    <FloatingButton
                      testID="onboarding-copy-command"
                      icon={Copy}
                      appearance="quiet"
                      accessibilityLabel={t('Copy command')}
                      onPress={() => { void onCopyCommand(PAIRING_COMMAND); }}
                    />
                  ) : null}
                </View>
              ) : null}
            </View>
          ))}
        </View>

        <View style={styles.codeSection}>
          <View style={styles.codeRow}>
            <FormTextInput
              testID="onboarding-pairing-code"
              accessibilityLabel={t('Pairing code')}
              autoComplete="one-time-code"
              autoCorrect={false}
              keyboardType="number-pad"
              maxLength={7}
              onChangeText={(value) => setPairingCode(normalizeVerificationCode(value))}
              onSubmitEditing={submitPairing}
              placeholder={t('123 456')}
              returnKeyType="go"
              value={formatVerificationCode(pairingCode)}
              containerStyle={styles.codeInput}
              inputStyle={styles.codeInputText}
            />
            {onPastePairingCode ? (
              <FloatingButton
                testID="onboarding-paste-code"
                icon={ClipboardPaste}
                appearance="surface"
                accessibilityLabel={t('Paste pairing code')}
                onPress={() => { void pastePairingCode(); }}
              />
            ) : null}
          </View>
          <Button
            testID="onboarding-connect"
            label={t('Connect')}
            loading={connecting}
            disabled={!pairingReady}
            onPress={submitPairing}
          />
          <Button
            testID="onboarding-scan-qr"
            label={t('Scan QR Code')}
            icon={QrCode}
            variant="ghost"
            disabled={connecting}
            onPress={() => onScanQr(backendKind)}
          />
        </View>

        {connecting ? (
          <ConnectionProgress phase={status.phase} />
        ) : null}

        <View style={styles.secondaryActions}>
          <BackendChoiceRow
            testID="onboarding-youmind"
            icon={Sparkles}
            label={t('YouMind Sprite')}
            selected={false}
            onPress={onOpenYouMind}
          />
          <Button
            testID="onboarding-docs-toggle"
            label={t('No agent yet?')}
            variant="ghost"
            onPress={() => setDocsExpanded((expanded) => !expanded)}
          />
          {docsExpanded ? (
            <View testID="onboarding-doc-options" style={styles.docsList}>
              {backendOptions.map((backend) => (
                <BackendChoiceRow
                  key={backend.kind}
                  testID={`onboarding-doc-${backend.kind}`}
                  icon={backend.icon}
                  label={backend.label}
                  selected={false}
                  onPress={() => onOpenDocs(backend.kind)}
                />
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

type BackendChoiceRowProps = Readonly<{
  testID: string;
  icon: typeof Bot;
  label: string;
  selected: boolean;
  onPress: () => void;
}>;

function BackendChoiceRow({
  testID,
  icon: Icon,
  label,
  selected,
  onPress,
}: BackendChoiceRowProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choiceRow,
        { backgroundColor: selected ? theme.colors.accentSoft : theme.colors.surface },
        pressed ? styles.pressed : null,
      ]}
    >
      <Icon size={IconSize.md} color={theme.colors.ink} strokeWidth={1.75} />
      <Text style={styles.choiceLabel}>{label}</Text>
      {selected ? <CheckCircle2 size={IconSize.sm} color={theme.colors.accent} /> : null}
    </Pressable>
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
      {onClose ? (
        <View style={styles.skeletonClose}>
          <FloatingButton
            icon={X}
            appearance="surface"
            accessibilityLabel={t('Close', { ns: 'common' })}
            onPress={onClose}
          />
        </View>
      ) : null}
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
    content: {
      flexGrow: 1,
      paddingHorizontal: Space.lg,
      paddingBottom: Space.xl,
      gap: Space.xl,
    },
    topRow: {
      minHeight: ControlSize.floatingButton,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: Space.sm,
    },
    previewBadge: {
      minHeight: Space.xxl,
      borderRadius: Radius.full,
      backgroundColor: colors.warnSoft,
      paddingHorizontal: Space.md,
      justifyContent: 'center',
    },
    previewText: {
      color: colors.warn,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.semibold,
    },
    intro: {
      gap: Space.sm,
    },
    title: {
      color: colors.ink,
      fontSize: FontSize.display,
      lineHeight: LineHeight.display,
      fontWeight: FontWeight.semibold,
    },
    subtitle: {
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
    },
    backendList: {
      gap: Space.sm,
    },
    choiceRow: {
      minHeight: ControlSize.settingsRow,
      borderRadius: Radius.card,
      paddingHorizontal: Space.lg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
    },
    pressed: {
      opacity: 0.72,
    },
    choiceLabel: {
      flex: 1,
      color: colors.ink,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.semibold,
    },
    commandRow: {
      minHeight: ControlSize.settingsRow,
      marginTop: Space.xs,
      marginHorizontal: Space.sm,
      borderRadius: Radius.card,
      backgroundColor: colors.surface,
      paddingLeft: Space.md,
      paddingRight: Space.xs,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
    },
    command: {
      flex: 1,
      color: colors.ink,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
      fontFamily: 'monospace',
    },
    codeSection: {
      gap: Space.sm,
    },
    codeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
    },
    codeInput: {
      flex: 1,
    },
    codeInputText: {
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontVariant: ['tabular-nums'],
      letterSpacing: Space.xs,
    },
    secondaryActions: {
      marginTop: 'auto',
      gap: Space.sm,
    },
    docsList: {
      gap: Space.sm,
    },
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
