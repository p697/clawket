import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ImagePlus, Minus, Plus, Trash2 } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { ChatAppearancePreviewCard } from '../../components/chat/ChatAppearancePreviewCard';
import {
  Card,
  HeaderTextAction,
  IconButton,
  SegmentedTabs,
  ThemedSwitch,
  createCardContentStyle,
} from '../../components/ui';
import { useAppContext } from '../../contexts/AppContext';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import { analyticsEvents } from '../../services/analytics/events';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import { DEFAULT_CHAT_APPEARANCE } from '../../features/chat-appearance/defaults';
import {
  deletePersistedChatBackgroundImage,
  persistChatBackgroundImage,
  pickChatBackgroundImage,
} from '../../features/chat-appearance/image-store';
import type {
  ChatAppearanceSettings,
  ChatBubbleStyle,
} from '../../types/chat-appearance';
import type { ConfigStackParamList } from './ConfigTab';

type Navigation = NativeStackNavigationProp<ConfigStackParamList, 'ChatAppearance'>;
type AppearanceDraftSnapshot = {
  appearance: ChatAppearanceSettings;
  showAgentAvatar: boolean;
  showModelUsage: boolean;
  chatFontSize: number;
};

const BUBBLE_STYLE_TABS: { key: ChatBubbleStyle; labelKey: string }[] = [
  { key: 'solid', labelKey: 'Solid' },
  { key: 'soft', labelKey: 'Soft' },
  { key: 'glass', labelKey: 'Glass' },
];

const BLUR_STEPS = [0, 4, 8, 12, 16, 20, 24] as const;
const OPACITY_STEPS = [0.78, 0.84, 0.9, 0.96, 1] as const;

function stepValue(current: number, values: readonly number[], direction: -1 | 1): number {
  const currentIndex = values.reduce((bestIndex, value, index) => {
    const currentDistance = Math.abs(value - current);
    const bestDistance = Math.abs(values[bestIndex] - current);
    return currentDistance < bestDistance ? index : bestIndex;
  }, 0);
  const nextIndex = Math.min(values.length - 1, Math.max(0, currentIndex + direction));
  return values[nextIndex];
}

function serializeDraft(snapshot: AppearanceDraftSnapshot): string {
  return JSON.stringify(snapshot);
}

function buildDefaultDraftSnapshot(): AppearanceDraftSnapshot {
  return {
    appearance: DEFAULT_CHAT_APPEARANCE,
    showAgentAvatar: true,
    showModelUsage: true,
    chatFontSize: 16,
  };
}

function DiscreteControl({
  title,
  description,
  valueLabel,
  canDecrease,
  canIncrease,
  onDecrease,
  onIncrease,
  disabled = false,
}: {
  title: string;
  description: string;
  valueLabel: string;
  canDecrease: boolean;
  canIncrease: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
  disabled?: boolean;
}): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);

  return (
    <View style={[styles.controlRow, disabled && styles.controlRowDisabled]}>
      <View style={styles.controlLabelWrap}>
        <Text style={styles.controlTitle}>{title}</Text>
        <Text style={styles.controlDescription}>{description}</Text>
      </View>
      <View style={styles.stepper}>
        <IconButton
          icon={<Minus size={16} color={canDecrease && !disabled ? theme.colors.textMuted : theme.colors.textSubtle} strokeWidth={2} />}
          onPress={onDecrease}
          disabled={!canDecrease || disabled}
        />
        <Text style={[styles.stepperValue, disabled && styles.stepperValueDisabled]}>{valueLabel}</Text>
        <IconButton
          icon={<Plus size={16} color={canIncrease && !disabled ? theme.colors.textMuted : theme.colors.textSubtle} strokeWidth={2} />}
          onPress={onIncrease}
          disabled={!canIncrease || disabled}
        />
      </View>
    </View>
  );
}

export function ChatAppearanceScreen(): React.JSX.Element {
  const navigation = useNavigation<Navigation>();
  const { t } = useTranslation(['config', 'common']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const {
    chatAppearance,
    onChatAppearanceChange,
    showAgentAvatar,
    onShowAgentAvatarToggle,
    showModelUsage,
    onShowModelUsageToggle,
    chatFontSize,
    onChatFontSizeChange,
  } = useAppContext();

  const initialSnapshotRef = useRef<AppearanceDraftSnapshot>({
    appearance: chatAppearance,
    showAgentAvatar,
    showModelUsage,
    chatFontSize,
  });
  const initialSerializedRef = useRef(serializeDraft(initialSnapshotRef.current));
  const initialBackgroundPathRef = useRef(chatAppearance.background.imagePath);
  const allowDismissRef = useRef(false);

  const [draftAppearance, setDraftAppearance] = useState<ChatAppearanceSettings>(chatAppearance);
  const [draftShowAgentAvatar, setDraftShowAgentAvatar] = useState(showAgentAvatar);
  const [draftShowModelUsage, setDraftShowModelUsage] = useState(showModelUsage);
  const [draftChatFontSize, setDraftChatFontSize] = useState(chatFontSize);
  const [pickedBackgroundUri, setPickedBackgroundUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const hasBackgroundImage = Boolean(
    pickedBackgroundUri || (draftAppearance.background.enabled && draftAppearance.background.imagePath),
  );
  const previewBackgroundUri = hasBackgroundImage
    ? pickedBackgroundUri ?? draftAppearance.background.imagePath ?? null
    : null;

  const draftSnapshot = useMemo<AppearanceDraftSnapshot>(
    () => ({
      appearance: {
        ...draftAppearance,
        background: {
          ...draftAppearance.background,
          imagePath: hasBackgroundImage ? previewBackgroundUri ?? undefined : undefined,
          enabled: hasBackgroundImage && draftAppearance.background.enabled,
        },
      },
      showAgentAvatar: draftShowAgentAvatar,
      showModelUsage: draftShowModelUsage,
      chatFontSize: draftChatFontSize,
    }),
    [
      draftAppearance,
      draftChatFontSize,
      draftShowAgentAvatar,
      draftShowModelUsage,
      hasBackgroundImage,
      previewBackgroundUri,
    ],
  );
  const isDirty = serializeDraft(draftSnapshot) !== initialSerializedRef.current;

  const bubbleStyleTabs = useMemo(
    () => BUBBLE_STYLE_TABS.map((tab) => ({ key: tab.key, label: t(tab.labelKey) })),
    [t],
  );

  useEffect(() => {
    analyticsEvents.chatAppearanceOpened({ source: 'config_screen' });
  }, []);

  const handleReset = useCallback(() => {
    const defaults = buildDefaultDraftSnapshot();
    setDraftAppearance(defaults.appearance);
    setDraftShowAgentAvatar(defaults.showAgentAvatar);
    setDraftShowModelUsage(defaults.showModelUsage);
    setDraftChatFontSize(defaults.chatFontSize);
    setPickedBackgroundUri(null);
  }, []);

  const handlePickBackground = useCallback(async () => {
    try {
      const result = await pickChatBackgroundImage();
      if (!result) return;
      setPickedBackgroundUri(result);
      setDraftAppearance((prev) => ({
        ...prev,
        background: {
          ...prev.background,
          enabled: true,
        },
      }));
    } catch {
      Alert.alert(
        t('Unable to open photo library'),
        t('Please try again later.'),
      );
    }
  }, [t]);

  const handleRemoveBackground = useCallback(() => {
    setPickedBackgroundUri(null);
    setDraftAppearance((prev) => ({
      ...prev,
      background: {
        ...prev.background,
        enabled: false,
        imagePath: undefined,
      },
    }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!isDirty || saving) return;
    setSaving(true);
    try {
      const previousImagePath = initialBackgroundPathRef.current;
      let nextImagePath = draftAppearance.background.enabled
        ? draftAppearance.background.imagePath
        : undefined;

      if (draftAppearance.background.enabled && pickedBackgroundUri) {
        nextImagePath = await persistChatBackgroundImage(pickedBackgroundUri);
      }

      if (!draftAppearance.background.enabled) {
        nextImagePath = undefined;
      }

      if (previousImagePath && previousImagePath !== nextImagePath) {
        await deletePersistedChatBackgroundImage(previousImagePath);
      }

      const nextAppearance: ChatAppearanceSettings = {
        ...draftAppearance,
        background: {
          ...draftAppearance.background,
          enabled: Boolean(nextImagePath) && draftAppearance.background.enabled,
          imagePath: nextImagePath,
          dim: 0,
          fillMode: 'cover',
        },
      };

      onChatAppearanceChange(nextAppearance);
      if (draftShowAgentAvatar !== showAgentAvatar) {
        onShowAgentAvatarToggle(draftShowAgentAvatar);
      }
      if (draftShowModelUsage !== showModelUsage) {
        onShowModelUsageToggle(draftShowModelUsage);
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
        show_agent_avatar: draftShowAgentAvatar,
        show_model_name: draftShowModelUsage,
        chat_font_size: draftChatFontSize,
      });
      allowDismissRef.current = true;
      navigation.goBack();
    } catch {
      allowDismissRef.current = false;
      Alert.alert(
        t('Unable to save chat appearance'),
        t('Please try again later.'),
      );
    } finally {
      setSaving(false);
    }
  }, [
    chatFontSize,
    draftAppearance,
    draftChatFontSize,
    draftShowAgentAvatar,
    draftShowModelUsage,
    isDirty,
    navigation,
    onChatAppearanceChange,
    onChatFontSizeChange,
    onShowAgentAvatarToggle,
    onShowModelUsageToggle,
    pickedBackgroundUri,
    saving,
    showAgentAvatar,
    showModelUsage,
    t,
  ]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (allowDismissRef.current || !isDirty || saving) return;
      event.preventDefault();
      Alert.alert(
        t('Discard changes?'),
        t('Your chat appearance changes have not been saved.'),
        [
          {
            text: t('Keep Editing'),
            style: 'cancel',
          },
          {
            text: t('Discard'),
            style: 'destructive',
            onPress: () => {
              allowDismissRef.current = true;
              navigation.dispatch(event.data.action);
            },
          },
        ],
      );
    });

    return unsubscribe;
  }, [isDirty, navigation, saving, t]);

  useNativeStackModalHeader({
    navigation,
    title: t('Chat Appearance'),
    onClose: () => navigation.goBack(),
    rightContent: (
      <HeaderTextAction
        label={saving ? t('common:Saving...') : t('common:Save')}
        onPress={() => {
          void handleSave();
        }}
        disabled={!isDirty || saving}
      />
    ),
  });

  const canDecreaseBlur = draftAppearance.background.blur > BLUR_STEPS[0];
  const canIncreaseBlur = draftAppearance.background.blur < BLUR_STEPS[BLUR_STEPS.length - 1];
  const canDecreaseOpacity = draftAppearance.bubbles.opacity > OPACITY_STEPS[0];
  const canIncreaseOpacity = draftAppearance.bubbles.opacity < OPACITY_STEPS[OPACITY_STEPS.length - 1];

  return (
    <ScrollView contentContainerStyle={createCardContentStyle()}>
      <Text style={styles.sectionHeader}>{t('Preview')}</Text>
      <View style={styles.previewCard}>
        <ChatAppearancePreviewCard
          appearance={draftSnapshot.appearance}
          backgroundImageUri={previewBackgroundUri}
          chatFontSize={draftChatFontSize}
          showAgentAvatar={draftShowAgentAvatar}
          showModelUsage={draftShowModelUsage}
        />
      </View>

      <Text style={styles.sectionHeader}>{t('Wallpaper')}</Text>
      <Card style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>{t('Background Image')}</Text>
        <Text style={styles.sectionDescription}>
          {hasBackgroundImage
            ? t('Use your own photo as the chat wallpaper.')
            : t('Pick a photo to use as the chat wallpaper.')}
        </Text>

        <Pressable
          onPress={() => {
            void handlePickBackground();
          }}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
        >
          <View style={styles.buttonContent}>
            <ImagePlus size={15} color={theme.colors.primaryText} strokeWidth={2} />
            <Text style={styles.primaryButtonText}>
              {hasBackgroundImage ? t('Change Photo') : t('Choose Photo')}
            </Text>
          </View>
        </Pressable>

        {hasBackgroundImage ? (
          <Pressable
            onPress={handleRemoveBackground}
            style={({ pressed }) => [styles.outlineDangerButton, pressed && styles.outlineDangerButtonPressed]}
          >
            <View style={styles.buttonContent}>
              <Trash2 size={15} color={theme.colors.error} strokeWidth={2} />
              <Text style={styles.outlineDangerButtonText}>{t('Remove Photo')}</Text>
            </View>
          </Pressable>
        ) : null}
      </Card>

      <Text style={styles.sectionHeader}>{t('Effects')}</Text>
      <Card style={styles.sectionCard}>
        <DiscreteControl
          title={t('Blur')}
          description={t('Soften the wallpaper behind the chat content.')}
          valueLabel={t('{{value}} px', { value: Math.round(draftAppearance.background.blur) })}
          canDecrease={canDecreaseBlur}
          canIncrease={canIncreaseBlur}
          onDecrease={() => {
            setDraftAppearance((prev) => ({
              ...prev,
              background: {
                ...prev.background,
                blur: stepValue(prev.background.blur, BLUR_STEPS, -1),
              },
            }));
          }}
          onIncrease={() => {
            setDraftAppearance((prev) => ({
              ...prev,
              background: {
                ...prev.background,
                blur: stepValue(prev.background.blur, BLUR_STEPS, 1),
              },
            }));
          }}
          disabled={!hasBackgroundImage}
        />
      </Card>

      <Text style={styles.sectionHeader}>{t('Bubbles')}</Text>
      <Card style={styles.sectionCard}>
        <Text style={styles.controlTitle}>{t('Bubble Style')}</Text>
        <Text style={styles.controlDescription}>{t('Adjust how chat bubbles sit on top of your wallpaper.')}</Text>
        <SegmentedTabs
          tabs={bubbleStyleTabs}
          active={draftAppearance.bubbles.style}
          onSwitch={(nextStyle) => {
            setDraftAppearance((prev) => ({
              ...prev,
              bubbles: {
                ...prev.bubbles,
                style: nextStyle,
              },
            }));
          }}
          containerStyle={styles.segmentedInline}
        />

        <View style={styles.divider} />

        <DiscreteControl
          title={t('Bubble Opacity')}
          description={t('Balance immersion and readability for message bubbles.')}
          valueLabel={t('{{value}}%', { value: Math.round(draftAppearance.bubbles.opacity * 100) })}
          canDecrease={canDecreaseOpacity}
          canIncrease={canIncreaseOpacity}
          onDecrease={() => {
            setDraftAppearance((prev) => ({
              ...prev,
              bubbles: {
                ...prev.bubbles,
                opacity: stepValue(prev.bubbles.opacity, OPACITY_STEPS, -1),
              },
            }));
          }}
          onIncrease={() => {
            setDraftAppearance((prev) => ({
              ...prev,
              bubbles: {
                ...prev.bubbles,
                opacity: stepValue(prev.bubbles.opacity, OPACITY_STEPS, 1),
              },
            }));
          }}
        />
      </Card>

      <Text style={styles.sectionHeader}>{t('Chat Details')}</Text>
      <Card style={styles.sectionCard}>
        <View style={styles.switchRow}>
          <View style={styles.switchLabels}>
            <Text style={styles.controlTitle}>{t('Show Agent Avatar')}</Text>
            <Text style={styles.controlDescription}>{t('Display avatar beside agent messages')}</Text>
          </View>
          <ThemedSwitch
            value={draftShowAgentAvatar}
            onValueChange={setDraftShowAgentAvatar}
          />
        </View>

        <View style={styles.divider} />

        <View style={styles.switchRow}>
          <View style={styles.switchLabels}>
            <Text style={styles.controlTitle}>{t('Show Model Name')}</Text>
            <Text style={styles.controlDescription}>{t('Display model name on agent messages')}</Text>
          </View>
          <ThemedSwitch
            value={draftShowModelUsage}
            onValueChange={setDraftShowModelUsage}
          />
        </View>

        <View style={styles.divider} />

        <DiscreteControl
          title={t('Chat Font Size')}
          description={t('Text size in chat messages')}
          valueLabel={String(draftChatFontSize)}
          canDecrease={draftChatFontSize > 12}
          canIncrease={draftChatFontSize < 20}
          onDecrease={() => setDraftChatFontSize((prev) => Math.max(12, prev - 1))}
          onIncrease={() => setDraftChatFontSize((prev) => Math.min(20, prev + 1))}
        />
      </Card>

      <Pressable
        onPress={handleReset}
        style={({ pressed }) => [styles.resetButton, pressed && styles.resetButtonPressed]}
      >
        <Text style={styles.resetButtonText}>{t('Reset to Default')}</Text>
      </Pressable>
    </ScrollView>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    sectionHeader: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
      textTransform: 'uppercase',
      marginBottom: Space.sm,
    },
    sectionCard: {
      gap: Space.md,
      marginBottom: Space.lg,
    },
    previewCard: {
      marginBottom: Space.lg,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    sectionDescription: {
      color: colors.textMuted,
      fontSize: FontSize.md,
      lineHeight: 19,
    },
    primaryButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: Radius.md,
      paddingVertical: 11,
    },
    primaryButtonPressed: {
      opacity: 0.88,
    },
    outlineDangerButton: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.error,
      paddingVertical: 11,
    },
    outlineDangerButtonPressed: {
      backgroundColor: colors.surfaceMuted,
    },
    buttonContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Space.sm,
    },
    primaryButtonText: {
      color: colors.primaryText,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    outlineDangerButtonText: {
      color: colors.error,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
    },
    segmentedInline: {
      marginHorizontal: 0,
      marginTop: Space.xs,
      marginBottom: 0,
    },
    controlRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.md,
    },
    controlRowDisabled: {
      opacity: 0.55,
    },
    controlLabelWrap: {
      flex: 1,
      gap: Space.xs,
    },
    controlTitle: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    controlDescription: {
      color: colors.textMuted,
      fontSize: FontSize.md,
      lineHeight: 18,
    },
    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
    },
    stepperValue: {
      minWidth: 64,
      textAlign: 'center',
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    stepperValueDisabled: {
      color: colors.textSubtle,
    },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.md,
    },
    switchLabels: {
      flex: 1,
      gap: Space.xs,
    },
    resetButton: {
      alignItems: 'center',
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderStrong,
      backgroundColor: colors.surface,
      paddingVertical: 11,
    },
    resetButtonPressed: {
      backgroundColor: colors.surfaceMuted,
    },
    resetButtonText: {
      color: colors.textMuted,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
  });
}
