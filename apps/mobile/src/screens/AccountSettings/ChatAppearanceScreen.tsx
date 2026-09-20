import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Check,
  Blend,
  Droplets,
  SunDim,
  Type,
  UserRound,
  ImagePlus,
  RotateCcw,
  Trash2,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatColorPicker } from '../../components/chat/ChatColorPicker';
import { defaultAccentId } from '../../theme/accents';
import type { AccentColorId } from '../../types';
import { ChatAppearancePreviewCard, type ChatAppearancePreviewAgent } from '../../components/chat/ChatAppearancePreviewCard';
import { Button } from '../../components/ui/Button';
import { HeaderTextAction } from '../../components/ui/HeaderTextAction';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
import {
  SettingsDivider,
  SettingsGroup,
  SettingsRow,
} from '../../components/ui/SettingsGroup';
import { Sheet } from '../../components/ui/Sheet';
import { ThemedSwitch } from '../../components/ui/ThemedSwitch';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useConnections } from '../../connection';
import { useAppContext } from '../../contexts/AppContext';
import { resolveAgentDisplayName } from '../../services/agent-display-name';
import { DEFAULT_CHAT_APPEARANCE, DEFAULT_CHAT_FONT_SIZE, MAX_CHAT_BACKGROUND_DIM } from '../../features/chat-appearance/defaults';
import {
  deletePersistedChatBackgroundImage,
  persistChatBackgroundImage,
  pickChatBackgroundImage,
} from '../../features/chat-appearance/image-store';
import { analyticsEvents } from '../../services/analytics/events';
import { SettingsIcon } from '../../components/ui/SettingsIcon';
import { useAppTheme } from '../../theme';
import {
  FontSize,
  FontWeight,
  IconSize,
  LineHeight,
  Space,
} from '../../theme/tokens';
import type {
  ChatAppearanceSettings,
  ChatBubbleStyle,
} from '../../types/chat-appearance';

export type ChatAppearanceScreenProps = Readonly<{
  onBack: () => void;
}>;

type AppearanceDraftSnapshot = Readonly<{
  appearance: ChatAppearanceSettings;
  showAgentAvatar: boolean;
  chatFontSize: number;
  accentId: AccentColorId;
}>;

type ValueSheetKind = 'blur' | 'dim' | 'opacity' | 'font-size';
type ErrorKind = 'photo' | 'save';

const BLUR_STEPS = [0, 4, 8, 12, 16, 20, 24] as const;
const DIM_STEPS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, MAX_CHAT_BACKGROUND_DIM] as const;
const OPACITY_STEPS = [0.78, 0.84, 0.9, 0.96, 1] as const;
const FONT_SIZE_STEPS = [12, 13, 14, 15, 16, 17, 18, 19, 20] as const;
// Seven or more comfortable rows outgrow a phone screen, so those value lists
// scroll inside fixed snap points through the Gorhom-integrated scroll view;
// the five-step opacity list keeps the sheet's dynamic height.
const SCROLLING_VALUE_SHEET_KINDS: ReadonlySet<ValueSheetKind> = new Set(['blur', 'dim', 'font-size']);
const VALUE_SHEET_SNAP_POINTS: string[] = ['62%', '92%'];

function serializeDraft(snapshot: AppearanceDraftSnapshot): string {
  return JSON.stringify(snapshot);
}

function buildDefaultDraftSnapshot(): AppearanceDraftSnapshot {
  return {
    appearance: DEFAULT_CHAT_APPEARANCE,
    showAgentAvatar: false,
    chatFontSize: DEFAULT_CHAT_FONT_SIZE,
    accentId: defaultAccentId,
  };
}

function SettingsSection({
  title,
  children,
  testID,
}: Readonly<{
  title: string;
  children: React.ReactNode;
  testID?: string;
}>): React.JSX.Element {
  const { theme } = useAppTheme();
  return (
    <View testID={testID} style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.colors.inkSecondary }]}>{title}</Text>
      {children}
    </View>
  );
}

function ValuePickerSheet({
  kind,
  current,
  onSelect,
  onClose,
}: Readonly<{
  kind: ValueSheetKind;
  current: number;
  onSelect: (value: number) => void;
  onClose: () => void;
}>): React.JSX.Element {
  const { t } = useTranslation(['config', 'common']);
  const { theme } = useAppTheme();
  const title = kind === 'blur'
    ? t('Blur')
    : kind === 'dim'
      ? t('Dim')
      : kind === 'opacity'
        ? t('Bubble Opacity')
        : t('Chat Font Size');
  const values: readonly number[] = kind === 'blur'
    ? BLUR_STEPS
    : kind === 'dim'
      ? DIM_STEPS
      : kind === 'opacity'
        ? OPACITY_STEPS
        : FONT_SIZE_STEPS;
  const formatValue = (value: number) => {
    if (kind === 'blur') return t('{{value}} px', { value });
    if (kind === 'dim' || kind === 'opacity') return t('{{value}}%', { value: Math.round(value * 100) });
    return String(value);
  };

  const scrolls = SCROLLING_VALUE_SHEET_KINDS.has(kind);
  const Body = scrolls ? BottomSheetScrollView : View;
  return (
    <Sheet
      visible
      testID={`chat-appearance-${kind}-sheet`}
      title={title}
      closeAccessibilityLabel={t('common:Close')}
      snapPoints={scrolls ? VALUE_SHEET_SNAP_POINTS : undefined}
      onClose={onClose}
    >
      <Body
        testID={`chat-appearance-${kind}-sheet-body`}
        style={scrolls ? styles.sheetScroll : styles.sheetContent}
        contentContainerStyle={scrolls ? styles.sheetContent : undefined}
        showsVerticalScrollIndicator={false}
      >
        <SettingsGroup density="comfortable">
          {values.map((value, index) => (
            <Fragment key={value}>
              {index > 0 ? <SettingsDivider inset="content" /> : null}
              <SettingsRow
                testID={`chat-appearance-${kind}-${value}`}
                title={formatValue(value)}
                selected={value === current}
                onPress={() => {
                  onSelect(value);
                  onClose();
                }}
                trailing={value === current ? (
                  <Check size={IconSize.sm} color={theme.colors.accent} />
                ) : undefined}
              />
            </Fragment>
          ))}
        </SettingsGroup>
      </Body>
    </Sheet>
  );
}

export function ChatAppearanceScreen({
  onBack,
}: ChatAppearanceScreenProps): React.JSX.Element {
  const { t } = useTranslation(['config', 'common']);
  const { theme, accentId, setAccentId } = useAppTheme();
  const insets = useSafeAreaInsets();
  const {
    agents,
    currentAgentId,
    chatAppearance,
    onChatAppearanceChange,
    showAgentAvatar,
    onShowAgentAvatarToggle,
    showModelUsage,
    chatFontSize,
    onChatFontSizeChange,
  } = useAppContext();
  const connections = useConnections();
  // Preview the Agent the person is actually chatting with; the roster carries its local avatar.
  const previewAgent = useMemo<ChatAppearancePreviewAgent | null>(() => {
    const rosterAgent = connections.roster
      .find((group) => group.connection.id === connections.activeConnectionId)
      ?.agents.find((candidate) => candidate.agent.agentId === currentAgentId)
      ?.agent;
    if (rosterAgent) {
      return { agentId: rosterAgent.agentId, name: rosterAgent.name, emoji: rosterAgent.emoji, avatarUrl: rosterAgent.avatarUrl };
    }
    const agent = agents.find((candidate) => candidate.id === currentAgentId);
    const name = resolveAgentDisplayName(agent);
    if (!agent || !name) return null;
    return { agentId: agent.id, name, emoji: agent.identity?.emoji, avatarUrl: agent.identity?.avatarUrl };
  }, [agents, connections.activeConnectionId, connections.roster, currentAgentId]);

  const initialSnapshotRef = useRef<AppearanceDraftSnapshot>({
    appearance: chatAppearance,
    showAgentAvatar,
    chatFontSize,
    accentId,
  });
  const initialSerializedRef = useRef(serializeDraft(initialSnapshotRef.current));
  const initialBackgroundPathRef = useRef(chatAppearance.background.imagePath);
  const [draftAccentId, setDraftAccentId] = useState(accentId);
  const [draftAppearance, setDraftAppearance] = useState(chatAppearance);
  const [draftShowAgentAvatar, setDraftShowAgentAvatar] = useState(showAgentAvatar);
  const [draftChatFontSize, setDraftChatFontSize] = useState(chatFontSize);
  const [pickedBackgroundUri, setPickedBackgroundUri] = useState<string | null>(null);
  const [valueSheet, setValueSheet] = useState<ValueSheetKind | null>(null);
  const [discardVisible, setDiscardVisible] = useState(false);
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null);
  const [saving, setSaving] = useState(false);

  const hasBackgroundImage = Boolean(
    pickedBackgroundUri
      || (draftAppearance.background.enabled && draftAppearance.background.imagePath),
  );
  const previewBackgroundUri = hasBackgroundImage
    ? pickedBackgroundUri ?? draftAppearance.background.imagePath ?? null
    : null;
  const draftSnapshot = useMemo<AppearanceDraftSnapshot>(() => ({
    appearance: {
      ...draftAppearance,
      background: {
        ...draftAppearance.background,
        enabled: hasBackgroundImage && draftAppearance.background.enabled,
        imagePath: hasBackgroundImage ? previewBackgroundUri ?? undefined : undefined,
      },
    },
    showAgentAvatar: draftShowAgentAvatar,
    chatFontSize: draftChatFontSize,
    accentId: draftAccentId,
  }), [
    draftAppearance,
    draftAccentId,
    draftChatFontSize,
    draftShowAgentAvatar,
    hasBackgroundImage,
    previewBackgroundUri,
  ]);
  const isDirty = serializeDraft(draftSnapshot) !== initialSerializedRef.current;
  const bubbleStyleTabs = useMemo(
    (): Array<{ key: ChatBubbleStyle; label: string }> => [
      { key: 'solid', label: t('Solid') },
      { key: 'soft', label: t('Soft') },
      { key: 'glass', label: t('Glass') },
    ],
    [t],
  );
  const contentInsets = useMemo(
    () => ({ paddingBottom: insets.bottom + Space.xl }),
    [insets.bottom],
  );

  useEffect(() => {
    analyticsEvents.chatAppearanceOpened({ source: 'account_settings' });
  }, []);

  const handlePickBackground = useCallback(async () => {
    try {
      const uri = await pickChatBackgroundImage();
      if (!uri) return;
      setPickedBackgroundUri(uri);
      setDraftAppearance((previous) => ({
        ...previous,
        background: { ...previous.background, enabled: true },
      }));
    } catch {
      setErrorKind('photo');
    }
  }, []);

  const handleRemoveBackground = useCallback(() => {
    setPickedBackgroundUri(null);
    setDraftAppearance((previous) => ({
      ...previous,
      background: {
        ...previous.background,
        enabled: false,
        imagePath: undefined,
      },
    }));
  }, []);

  const handleReset = useCallback(() => {
    const defaults = buildDefaultDraftSnapshot();
    setDraftAppearance(defaults.appearance);
    setDraftAccentId(defaults.accentId);
    setDraftShowAgentAvatar(defaults.showAgentAvatar);
    setDraftChatFontSize(defaults.chatFontSize);
    setPickedBackgroundUri(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!isDirty || saving) return;
    setSaving(true);
    let stagedImagePath: string | undefined;
    let appearanceCommitted = false;
    try {
      const previousImagePath = initialBackgroundPathRef.current;
      let nextImagePath = draftAppearance.background.enabled
        ? draftAppearance.background.imagePath
        : undefined;
      if (draftAppearance.background.enabled && pickedBackgroundUri) {
        nextImagePath = await persistChatBackgroundImage(pickedBackgroundUri);
        stagedImagePath = nextImagePath;
      }
      if (!draftAppearance.background.enabled) nextImagePath = undefined;

      const nextAppearance: ChatAppearanceSettings = {
        ...draftAppearance,
        background: {
          ...draftAppearance.background,
          enabled: Boolean(nextImagePath) && draftAppearance.background.enabled,
          imagePath: nextImagePath,
          fillMode: 'cover',
        },
      };
      await onChatAppearanceChange(nextAppearance);
      appearanceCommitted = true;
      if (previousImagePath && previousImagePath !== nextImagePath) {
        await deletePersistedChatBackgroundImage(previousImagePath);
      }
      if (draftAccentId !== accentId) setAccentId(draftAccentId);
      if (draftShowAgentAvatar !== showAgentAvatar) {
        onShowAgentAvatarToggle(draftShowAgentAvatar);
      }
      if (draftChatFontSize !== chatFontSize) {
        onChatFontSizeChange(draftChatFontSize);
      }
      analyticsEvents.chatAppearanceSaved({
        source: 'chat_appearance_screen',
        has_background_image: Boolean(nextImagePath),
        bubble_style: nextAppearance.bubbles.style,
        bubble_opacity: nextAppearance.bubbles.opacity,
        blur: nextAppearance.background.blur,
        dim: nextAppearance.background.dim,
        show_agent_avatar: draftShowAgentAvatar,
        // Per-message model labels were removed from the timeline; the stored
        // preference is reported unchanged until the key is retired.
        show_model_name: showModelUsage,
        chat_font_size: draftChatFontSize,
      });
      onBack();
    } catch {
      if (stagedImagePath && !appearanceCommitted) {
        await deletePersistedChatBackgroundImage(stagedImagePath);
      }
      setErrorKind('save');
    } finally {
      setSaving(false);
    }
  }, [
    accentId,
    draftAccentId,
    setAccentId,
    chatFontSize,
    draftAppearance,
    draftChatFontSize,
    draftShowAgentAvatar,
    isDirty,
    onBack,
    onChatAppearanceChange,
    onChatFontSizeChange,
    onShowAgentAvatarToggle,
    pickedBackgroundUri,
    saving,
    showAgentAvatar,
    showModelUsage,
  ]);

  const requestBack = useCallback(() => {
    if (isDirty && !saving) {
      setDiscardVisible(true);
      return;
    }
    onBack();
  }, [isDirty, onBack, saving]);

  const selectSheetValue = useCallback((value: number) => {
    if (valueSheet === 'blur') {
      setDraftAppearance((previous) => ({
        ...previous,
        background: { ...previous.background, blur: value },
      }));
    } else if (valueSheet === 'dim') {
      setDraftAppearance((previous) => ({
        ...previous,
        background: { ...previous.background, dim: value },
      }));
    } else if (valueSheet === 'opacity') {
      setDraftAppearance((previous) => ({
        ...previous,
        bubbles: { ...previous.bubbles, opacity: value },
      }));
    } else if (valueSheet === 'font-size') {
      setDraftChatFontSize(value);
    }
  }, [valueSheet]);

  const selectedSheetValue = valueSheet === 'blur'
    ? draftAppearance.background.blur
    : valueSheet === 'dim'
      ? draftAppearance.background.dim
      : valueSheet === 'opacity'
        ? draftAppearance.bubbles.opacity
        : draftChatFontSize;

  return (
    <View
      testID="chat-appearance-screen"
      style={[styles.screen, { backgroundColor: theme.colors.canvasGrouped }]}
    >
      <ScreenHeader
        testID="chat-appearance"
        title={t('Chat theme')}
        topInset={insets.top}
        onBack={requestBack}
        backAccessibilityLabel={t('common:Back')}
        rightContent={(
          <HeaderTextAction
            label={saving ? t('common:Saving...') : t('common:Save')}
            onPress={() => { void handleSave(); }}
            disabled={!isDirty || saving}
          />
        )}
        style={{ backgroundColor: theme.colors.canvasGrouped }}
      />

      <ScrollView
        automaticallyAdjustContentInsets={false}
        contentContainerStyle={[styles.content, contentInsets]}
        showsVerticalScrollIndicator={false}
      >
        <SettingsSection title={t('Preview')} testID="chat-appearance-preview">
          <ChatAppearancePreviewCard
            accentId={draftAccentId}
            agent={previewAgent}
            appearance={draftSnapshot.appearance}
            backgroundImageUri={previewBackgroundUri}
            chatFontSize={draftChatFontSize}
            showAgentAvatar={draftShowAgentAvatar}
          />
        </SettingsSection>

        <SettingsSection title={t('Color')}>
          <ChatColorPicker value={draftAccentId} onChange={setDraftAccentId} />
        </SettingsSection>

        <SettingsSection title={t('Wallpaper')}>
          <SettingsGroup density="comfortable">
            <SettingsRow
              testID="chat-appearance-background"
              title={t('Background Image')}
              value={hasBackgroundImage ? t('Change Photo') : t('Choose Photo')}
              leading={<SettingsIcon icon={ImagePlus} tone="neutral" size={20} strokeWidth={1.75} />}
              showChevron
              onPress={() => { void handlePickBackground(); }}
            />
            {hasBackgroundImage ? (
              <>
                <SettingsDivider inset="content" />
                <SettingsRow
                  testID="chat-appearance-remove-background"
                  title={t('Remove Photo')}
                  destructive
                  leading={<SettingsIcon icon={Trash2} tone="neutral" size={20} strokeWidth={1.75} />}
                  onPress={handleRemoveBackground}
                />
              </>
            ) : null}
            <SettingsDivider inset="content" />
            <SettingsRow
              testID="chat-appearance-blur"
              leading={<SettingsIcon icon={Droplets} tone="neutral" size={20} strokeWidth={1.75} />}
              title={t('Blur')}
              value={t('{{value}} px', { value: Math.round(draftAppearance.background.blur) })}
              showChevron
              disabled={!hasBackgroundImage}
              onPress={() => setValueSheet('blur')}
            />
            <SettingsDivider inset="content" />
            <SettingsRow
              testID="chat-appearance-dim"
              leading={<SettingsIcon icon={SunDim} tone="neutral" size={20} strokeWidth={1.75} />}
              title={t('Dim')}
              value={t('{{value}}%', { value: Math.round(draftAppearance.background.dim * 100) })}
              showChevron
              disabled={!hasBackgroundImage}
              onPress={() => setValueSheet('dim')}
            />
          </SettingsGroup>
        </SettingsSection>

        <SettingsSection title={t('Bubbles')}>
          <SettingsGroup density="comfortable">
            <SettingsRow layout="column">
              <Text style={[styles.rowTitle, { color: theme.colors.ink }]}>{t('Bubble Style')}</Text>
              <SegmentedTabs
                testID="chat-appearance-bubble-style"
                tabs={[...bubbleStyleTabs]}
                active={draftAppearance.bubbles.style}
                onSwitch={(style) => {
                  setDraftAppearance((previous) => ({
                    ...previous,
                    bubbles: { ...previous.bubbles, style },
                  }));
                }}
                size="sm"
              />
            </SettingsRow>
            <SettingsDivider inset="content" />
            <SettingsRow
              testID="chat-appearance-opacity"
              leading={<SettingsIcon icon={Blend} tone="neutral" size={20} strokeWidth={1.75} />}
              title={t('Bubble Opacity')}
              value={t('{{value}}%', {
                value: Math.round(draftAppearance.bubbles.opacity * 100),
              })}
              showChevron
              onPress={() => setValueSheet('opacity')}
            />
          </SettingsGroup>
        </SettingsSection>

        <SettingsSection title={t('Chat Details')}>
          <SettingsGroup density="comfortable">
            <SettingsRow
              title={t('Show Agent Avatar')}
              leading={<SettingsIcon icon={UserRound} tone="neutral" size={20} strokeWidth={1.75} />}
              trailing={(
                <ThemedSwitch
                  testID="chat-appearance-agent-avatar"
                  accessibilityLabel={t('Show Agent Avatar')}
                  value={draftShowAgentAvatar}
                  onValueChange={setDraftShowAgentAvatar}
                />
              )}
            />
            <SettingsDivider inset="content" />
            <SettingsRow
              testID="chat-appearance-font-size"
              leading={<SettingsIcon icon={Type} tone="neutral" size={20} strokeWidth={1.75} />}
              title={t('Chat Font Size')}
              value={String(draftChatFontSize)}
              showChevron
              onPress={() => setValueSheet('font-size')}
            />
          </SettingsGroup>
        </SettingsSection>

        <SettingsGroup density="comfortable">
          <SettingsRow
            testID="chat-appearance-reset"
            title={t('Reset to Default')}
            leading={<SettingsIcon icon={RotateCcw} tone="neutral" size={20} strokeWidth={1.75} />}
            onPress={handleReset}
          />
        </SettingsGroup>
      </ScrollView>

      {valueSheet ? (
        <ValuePickerSheet
          kind={valueSheet}
          current={selectedSheetValue}
          onSelect={selectSheetValue}
          onClose={() => setValueSheet(null)}
        />
      ) : null}
      {discardVisible ? (
        <Sheet
          visible
          testID="chat-appearance-discard-sheet"
          title={t('Discard changes?')}
          closeAccessibilityLabel={t('common:Close')}
          dismissOnBackdropPress={false}
          onClose={() => setDiscardVisible(false)}
        >
          <View style={styles.sheetActions}>
            <Button
              label={t('Keep Editing')}
              variant="secondary"
              onPress={() => setDiscardVisible(false)}
              style={styles.sheetAction}
            />
            <Button
              label={t('Discard')}
              variant="destructive"
              onPress={onBack}
              style={styles.sheetAction}
            />
          </View>
        </Sheet>
      ) : null}
      {errorKind ? (
        <Sheet
          visible
          testID="chat-appearance-error-sheet"
          title={errorKind === 'photo'
            ? t('Unable to open photo library')
            : t('Unable to save chat appearance')}
          closeAccessibilityLabel={t('common:Close')}
          onClose={() => setErrorKind(null)}
        >
          <View style={styles.errorAction}>
            <Button
              label={t('common:Done')}
              onPress={() => setErrorKind(null)}
            />
          </View>
        </Sheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: Space.lg,
    paddingTop: Space.lg,
    gap: Space.xl,
  },
  section: { gap: Space.sm },
  sectionTitle: {
    paddingHorizontal: Space.lg,
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.regular,
  },
  rowTitle: {
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
    fontWeight: FontWeight.regular,
  },
  sheetScroll: { flex: 1, minHeight: 0 },
  sheetContent: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.xxl,
  },
  sheetActions: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.xxl,
    flexDirection: 'row',
    gap: Space.sm,
  },
  sheetAction: { flex: 1 },
  errorAction: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.xxl,
  },
});
