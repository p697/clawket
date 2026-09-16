import React, { Fragment, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ArrowUp, Bell, Check, MoreHorizontal, Search, Trash2, WifiOff } from 'lucide-react-native';
import { ChevronLeft } from '../../components/ui/DirectionalIcon';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FlowHeader, PageIntro, FormStep } from '../../components/ui/SetupPrimitives';
import { OnboardingScreen } from '../Onboarding/OnboardingScreen';
import { Companion, type CompanionPose } from '../../components/ui/Companion';
import { LoadingState } from '../../components/ui/LoadingState';
import { Bubble } from '../../components/ui/Bubble';
import { AgentAvatar } from '../../components/ui/AgentAvatar';
import { RosterRow } from '../../components/ui/RosterRow';
import { ReplyFailureSheet } from '../../components/chat/ReplyFailureSheet';
import { Banner } from '../../components/ui/Banner';
import { ConnectionStatusPill } from '../../components/ui/ConnectionStatusPill';
import { Button } from '../../components/ui/Button';
import { FloatingButton } from '../../components/ui/FloatingButton';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { SearchInput } from '../../components/ui/SearchInput';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
import {
  SettingsDivider,
  SettingsGroup,
  SettingsRow,
} from '../../components/ui/SettingsGroup';
import { Sheet } from '../../components/ui/Sheet';
import { ThemedSwitch } from '../../components/ui/ThemedSwitch';
import {
  builtInAccents,
  type BuiltInAccentColorId,
  useAppTheme,
} from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  IconSize,
  LineHeight,
  Radius,
  Space,
} from '../../theme/tokens';
import type { ThemeMode } from '../../types';


type GalleryTab = 'theme' | 'tokens' | 'components' | 'brand';
type CanonicalColorToken =
  | 'canvas'
  | 'canvasGrouped'
  | 'surface'
  | 'surfaceFloating'
  | 'ink'
  | 'inkSecondary'
  | 'inkTertiary'
  | 'line'
  | 'accent'
  | 'accentSoft'
  | 'good'
  | 'warn'
  | 'bad';

export type DesignSystemScreenProps = Readonly<{
  onBack: () => void;
}>;

function translateAccentLabel(
  id: BuiltInAccentColorId,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (id === 'iceBlue') return t('Ice Blue');
  if (id === 'jadeGreen') return t('Jade Green');
  if (id === 'oceanTeal') return t('Ocean Teal');
  if (id === 'sunsetOrange') return t('Sunset Orange');
  if (id === 'rosePink') return t('Rose Pink');
  return t('Royal Purple');
}

const COLOR_TOKENS: ReadonlyArray<CanonicalColorToken> = [
  'canvas',
  'canvasGrouped',
  'surface',
  'surfaceFloating',
  'ink',
  'inkSecondary',
  'inkTertiary',
  'line',
  'accent',
  'accentSoft',
  'good',
  'warn',
  'bad',
];

export function DesignSystemScreen({
  onBack,
}: DesignSystemScreenProps): React.JSX.Element {
  const { t } = useTranslation(['config', 'common']);
  const { theme, mode, accentId, setMode, setAccentId } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [galleryTab, setGalleryTab] = useState<GalleryTab>('components');
  const [pagePreview, setPagePreview] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [search, setSearch] = useState('');
  const [brandPose, setBrandPose] = useState<CompanionPose>('connecting');
  const [field, setField] = useState('Clawket');
  const [enabled, setEnabled] = useState(true);
  const [replyFailureVisible, setReplyFailureVisible] = useState(false);
  const [sheetVisible, setSheetVisible] = useState(false);

  const galleryTabs = useMemo(() => [
    { key: 'brand' as const, label: t('Clawket', { ns: 'config' }) },
    { key: 'theme' as const, label: t('Theme') },
    { key: 'tokens' as const, label: t('Foundations') },
    { key: 'components' as const, label: t('Components') },
  ], [t]);
  const themeTabs = useMemo<Array<{ key: ThemeMode; label: string }>>(() => [
    { key: 'system', label: t('System') },
    { key: 'light', label: t('Light') },
    { key: 'dark', label: t('Dark') },
  ], [t]);

  if (pagePreview) return <OnboardingScreen onClose={() => { setPagePreview(false); setPreviewError(false); }} environment="preview"
    status={previewError ? { kind: 'error', code: 'pairing_expired' } : { kind: 'idle' }}
    onSubmitPairing={() => setPreviewError(true)} onScanQr={() => setPreviewError(true)} onImportQr={() => setPreviewError(true)}
    onOpenYouMind={() => setPagePreview(false)} onOpenWebsite={() => setPagePreview(false)}
    onErrorAction={() => setPreviewError(false)} onPastePairingCode={() => '123456'} onCopyCommand={() => {}} onCopyAgentPrompt={() => {}} />;

  return (
    <View
      testID="design-system-screen"
      style={[styles.screen, { backgroundColor: theme.colors.canvas, paddingTop: insets.top }]}
    >
      <FlowHeader testID="design-system-back" title={t('Preview')} onBack={onBack} />
      <ScrollView
        automaticallyAdjustContentInsets={false}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + Space.xl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <PageIntro title={t('Design language')} description={t('One language. Every detail.')} />
        <Button testID="design-system-page-preview" label={t('Explore the connection flow')} variant="neutral" size="lg" onPress={() => setPagePreview(true)} />
        <Text style={[styles.secondarySample, { color: theme.colors.inkSecondary }]}>{t('Interactive examples. No connection is made.')}</Text>
        <SegmentedTabs
          testID="design-system-tabs"
          tabs={galleryTabs}
          active={galleryTab}
          onSwitch={setGalleryTab}
        />

        {galleryTab === 'brand' ? (
          <View style={styles.stack}>
            <SegmentedTabs testID="design-companion-poses" tabs={[
              { key: 'connecting', label: t('Connecting', { ns: 'common' }) },
              { key: 'loading', label: t('Loading...', { ns: 'common' }) },
              { key: 'error', label: t('Offline', { ns: 'common' }) },
            ]} active={brandPose} onSwitch={key => setBrandPose(key as CompanionPose)} />
            <View style={{ height: 280, justifyContent: 'center', alignItems: 'center' }}>
              {brandPose === 'error' ? <Companion pose="error" /> : <LoadingState pose={brandPose} message={brandPose === 'connecting' ? t('Connecting', { ns: 'common' }) : t('Loading history', { ns: 'chat' })} />}
            </View>
          </View>
        ) : galleryTab === 'theme' ? (
          <View style={styles.stack}>
            <SegmentedTabs
              testID="design-system-theme"
              tabs={themeTabs}
              active={mode}
              onSwitch={setMode}
              size="sm"
            />
            <SettingsGroup testID="design-system-accents">
              {(Object.keys(builtInAccents) as BuiltInAccentColorId[]).map((id, index) => {
                const selected = accentId === id;
                const swatch = builtInAccents[id][theme.scheme].accent500;
                return (
                  <Fragment key={id}>
                    {index > 0 ? <SettingsDivider inset="content" /> : null}
                    <SettingsRow
                      testID={`design-system-accent-${id}`}
                      title={translateAccentLabel(id, t)}
                      leading={(
                        <View
                          style={[styles.swatch, { backgroundColor: swatch }]}
                        />
                      )}
                      trailing={selected ? (
                        <Check
                          testID={`design-system-accent-${id}-selected`}
                          size={IconSize.sm}
                          color={theme.colors.accent}
                          strokeWidth={2}
                        />
                      ) : undefined}
                      onPress={() => setAccentId(id)}
                    />
                  </Fragment>
                );
              })}
            </SettingsGroup>
          </View>
        ) : galleryTab === 'tokens' ? (
          <View style={styles.stack}>
            <View testID="design-system-color-tokens" style={styles.tokenGrid}>
              {COLOR_TOKENS.map((token) => <View key={token} testID={`design-system-token-${token}`} style={[styles.tokenCard, { backgroundColor: theme.colors.canvasGrouped }]}>
                <View style={[styles.tokenPaint, { backgroundColor: theme.colors[token] }]} />
                <Text style={[styles.secondarySample, { color: theme.colors.inkSecondary }]}>{token}</Text>
              </View>)}
            </View>
            <SettingsGroup testID="design-system-type-tokens">
              <View style={styles.typeSamples}>
                <Text style={[styles.titleSample, { color: theme.colors.ink }]}>
                  title · 20/26
                </Text>
                <Text style={[styles.bodySample, { color: theme.colors.ink }]}>
                  body · 17/24
                </Text>
                <Text
                  style={[
                    styles.secondarySample,
                    { color: theme.colors.inkSecondary },
                  ]}
                >
                  secondary · 15/20
                </Text>
              </View>
            </SettingsGroup>
          </View>
        ) : (
          <View style={styles.stack}>
            <FormStep number="01" title={t('Lists and navigation')}>
            <RosterRow
              testID="design-system-working-agent"
              agentId="main"
              name={t('Working', { ns: 'common' })}
              preview={t('Unread messages', { ns: 'common' })}
              avatarStatus="working"
              unreadCount={1}
              unreadIndicator="dot"
              onPress={() => setSheetVisible(true)}
            />
            <View style={styles.actionRow}>
              {(['header', 'settings', 'sheet'] as const).map((variant) => (
                <AgentAvatar key={variant} agentId="main" name="A" variant={variant} status="working" />
              ))}
            </View>
            <SettingsGroup testID="design-system-settings-group">
              <SettingsRow
                title={t('Unified setting row')}
                trailing={(
                  <ThemedSwitch
                    tone="neutral"
                    testID="design-system-switch"
                    accessibilityLabel={t('Unified setting row')}
                    value={enabled}
                    onValueChange={setEnabled}
                  />
                )}
              />
              <SettingsDivider inset="content" />
              <SettingsRow
                testID="design-system-interactive-row"
                title={t('Interactive row')}
                showChevron
                onPress={() => setSheetVisible(true)}
              />
            </SettingsGroup>
            </FormStep>
            <FormStep number="02" title={t('Actions')}>
              <Button label={t('Continue', { ns: 'common' })} variant="neutral" size="lg" onPress={() => setSheetVisible(true)} />
              <Button label={t('Disabled action')} variant="neutral" size="lg" disabled />
              <Button label={t('Connecting', { ns: 'common' })} variant="neutral" size="lg" loading />
            </FormStep>
            <FormStep number="03" title={t('Input and feedback')}>
            <SearchInput
              testID="design-system-search"
              value={search}
              onChangeText={setSearch}
              placeholder={t('Search components')}
            />
            <FormTextInput
              testID="design-system-field"
              value={field}
              onChangeText={setField}
              placeholder={t('Pairing code')}
              surface="quiet"
            />
            <FormTextInput
              testID="design-system-invalid-field"
              value={t('Needs attention')}
              onChangeText={() => {}}
              surface="quiet"
              errorMessage={t('Please check this value.')}
              invalid
            />
            <Banner tone="neutral" icon={WifiOff} message={t('No network')} actionLabel={t('Retry', { ns: 'common' })} onAction={() => setSheetVisible(true)} />
            <ConnectionStatusPill placement="inline" status="reconnecting" message={t('Reconnecting…', { ns: 'common' })} />
            <ConnectionStatusPill placement="inline" status="offline" message={t('Offline · reconnecting', { ns: 'common' })}
              actionLabel={t('Reconnect', { ns: 'common' })} onAction={() => setSheetVisible(true)} />
            <Banner tone="bad" message={t('Model authentication failed. Sign in again on your computer.', { ns: 'chat' })}
              actionLabel={t('Details', { ns: 'chat' })} onAction={() => setReplyFailureVisible(true)} testID="design-reply-failure" />
            </FormStep>
            <FormStep number="04" title={t('Conversation')}>
              <Bubble role="user">{t('A little more room to think.')}</Bubble>
              <Bubble role="assistant">{t('Clear words. Calm surfaces. Familiar controls.')}</Bubble>
            </FormStep>
            <FormStep number="05" title={t('Secondary actions')}>

            <Button label={t('Secondary action')} variant="ghost" onPress={() => setSheetVisible(true)} />
            <Button label={t('Text action')} variant="text" onPress={() => setSheetVisible(true)} />
            <Button
              label={t('Destructive action')}
              variant="destructive"
              icon={Trash2}
              onPress={() => setSheetVisible(true)}
            />

            <Button
              testID="design-system-sheet-preview"
              label={t('Preview')}
              variant="secondary"
              onPress={() => setSheetVisible(true)}
            />
            </FormStep>
            <FormStep number="06" title={t('Icon actions')}>
              <Text style={[styles.secondarySample, { color: theme.colors.inkSecondary }]}>{t('Navigation · plain icons')}</Text>
              <View style={styles.actionRow}>
                <FloatingButton icon={ChevronLeft} appearance="plain" accessibilityLabel={t('Back', { ns: 'common' })} onPress={() => setSheetVisible(true)} />
                <FloatingButton icon={Search} appearance="plain" accessibilityLabel={t('Search', { ns: 'common' })} onPress={() => setSheetVisible(true)} />
                <FloatingButton icon={MoreHorizontal} appearance="plain" accessibilityLabel={t('More actions')} onPress={() => setSheetVisible(true)} />
              </View>
              <Text style={[styles.secondarySample, { color: theme.colors.inkSecondary }]}>{t('Standalone actions · quiet circles')}</Text>
              <View style={styles.actionRow}>
                <FloatingButton testID="design-system-bell" icon={Bell} appearance="quiet" accessibilityLabel={t('Notification')} onPress={() => setSheetVisible(true)} />
                <FloatingButton icon={ArrowUp} appearance="ink" accessibilityLabel={t('Send', { ns: 'chat' })} onPress={() => setSheetVisible(true)} />
                <FloatingButton icon={Trash2} appearance="destructive" accessibilityLabel={t('Delete')} onPress={() => setSheetVisible(true)} />
                <FloatingButton testID="design-system-more-disabled" icon={MoreHorizontal} appearance="quiet" accessibilityLabel={t('More, disabled')} disabled onPress={() => {}} />
              </View>
              <Text style={[styles.secondarySample, { color: theme.colors.inkSecondary }]}>{t('Strong contrast is reserved for the main action. All icon targets are 44 pt.')}</Text>
            </FormStep>
          </View>
        )}
      </ScrollView>

      <ReplyFailureSheet visible={replyFailureVisible} onClose={() => setReplyFailureVisible(false)} onDismiss={() => setReplyFailureVisible(false)}
        summary={t('Model authentication failed. Sign in again on your computer.', { ns: 'chat' })}
        details="Model login expired on the gateway for claude-cli. Re-auth with `claude auth login && openclaw models auth login --agent main --provider anthropic --method cli` in a terminal, then try again." />
      <Sheet
        visible={sheetVisible}
        testID="design-system-sheet"
        title={t('Preview')}
        closeAccessibilityLabel={t('common:Close')}
        onClose={() => setSheetVisible(false)}
      >
        <View style={styles.sheetContent}>
          <SettingsGroup>
            <SettingsRow
              title={t('Selected')}
              trailing={(
                <Check
                  size={IconSize.sm}
                  color={theme.colors.accent}
                  strokeWidth={2}
                />
              )}
            />
          </SettingsGroup>
          <Button
            label={t('common:Done')}
            variant="neutral"
            size="lg"
            onPress={() => setSheetVisible(false)}
          />
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: Space.xl,
    gap: Space.lg,
  },
  stack: { gap: Space.xxl },
  tokenGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  tokenCard: { width: '47%', flexGrow: 1, padding: Space.md, borderRadius: Radius.card, gap: Space.sm },
  tokenPaint: { height: ControlSize.floatingButton, borderRadius: Radius.settingsGroup },
  swatch: {
    width: IconSize.md,
    height: IconSize.md,
    borderRadius: Radius.full,
  },
  typeSamples: {
    minHeight: ControlSize.settingsRow,
    padding: Space.lg,
    gap: Space.sm,
  },
  titleSample: {
    fontSize: FontSize.title,
    lineHeight: LineHeight.title,
    fontWeight: FontWeight.semibold,
  },
  bodySample: {
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
    fontWeight: FontWeight.regular,
  },
  secondarySample: {
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.regular,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetContent: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.xxl,
    gap: Space.lg,
  },
});
