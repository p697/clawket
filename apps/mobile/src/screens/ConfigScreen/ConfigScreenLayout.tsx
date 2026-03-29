import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Application from 'expo-application';
import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as MediaLibrary from 'expo-media-library';
import * as StoreReview from 'expo-store-review';
import { MenuAction, MenuView } from '@react-native-menu/menu';
import {
  ActionSheetIOS,
  Alert,
  Image,
  Linking,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { ScrollView } from 'react-native-gesture-handler';
import { EdgeInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronLeft, ChevronRight, Cloud, Eye, Gamepad2, Github, HelpCircle, Mic, Palette, Share2, ShieldCheck, ImageUp, Link2, Mail, MessageCircleMore, Minus, Plus, ScanLine, Sparkles, Star } from 'lucide-react-native';
import { ConnectionHelpQuick, ConnectionHelpManual } from '../../components/config/ConnectionHelpSection';
import { SwipeableGatewayRow, SwipeableMethods } from '../../components/config/SwipeableGatewayRow';
import { IconButton, ModalSheet, SegmentedTabs, ThemedSwitch } from '../../components/ui';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import { analyticsEvents } from '../../services/analytics/events';
import { getPostHogDiagnostics, type PostHogDiagnostics } from '../../services/analytics/posthog';
import {
  collectRevenueCatDiagnostics,
  getRevenueCatRuntimeDiagnostics,
  type RevenueCatDiagnostics,
} from '../../services/pro-subscription';
import { AppTheme, builtInAccents, BuiltInAccentColorId } from '../../theme';
import { FontSize, FontWeight, Radius, Shadow, Space } from '../../theme/tokens';
import { GatewayMode, SpeechRecognitionLanguage, ThemeMode } from '../../types';
import { shouldShowWecomSupportEntry } from '../../utils/mainlandChina';
import { openExternalUrl } from '../../utils/openExternalUrl';
import { isMacCatalyst } from '../../utils/platform';
import { APP_PACKAGE_VERSION } from '../../constants/app-version';
import { CLAWKET_GITHUB_REPO_URL } from '../../config/app-links';
import { buildSupportEmailUrl, publicAppLinks } from '../../config/public';
import { useConfigScreenController } from './hooks/useConfigScreenController';
import type { ConfigStackParamList } from './ConfigTab';

type Colors = AppTheme['colors'];

type Props = {
  insets: EdgeInsets;
  tabBarHeight: number;
  controller: ReturnType<typeof useConfigScreenController> & {
    onScanQR: () => void;
    onUploadQR: () => void;
  };
};

const ACCENT_OPTIONS: Array<{ id: BuiltInAccentColorId; label: string }> = [
  { id: 'iceBlue', label: 'Blue' },
  { id: 'jadeGreen', label: 'Green' },
  { id: 'oceanTeal', label: 'Teal' },
  { id: 'sunsetOrange', label: 'Orange' },
  { id: 'rosePink', label: 'Pink' },
  { id: 'royalPurple', label: 'Purple' },
];

function getThemeOptions(t: (key: string) => string): Array<{ label: string; value: ThemeMode }> {
  return [
    { label: t('Follow System'), value: 'system' },
    { label: t('Light'), value: 'light' },
    { label: t('Dark'), value: 'dark' },
  ];
}

function getSpeechRecognitionLanguageOptions(
  t: (key: string) => string,
): Array<{ label: string; value: SpeechRecognitionLanguage }> {
  return [
    { label: t('Follow System'), value: 'system' },
    { label: t('English'), value: 'en' },
    { label: t('Simplified Chinese'), value: 'zh-Hans' },
    { label: t('Japanese'), value: 'ja' },
    { label: t('Korean'), value: 'ko' },
    { label: t('German'), value: 'de' },
    { label: t('Spanish'), value: 'es' },
  ];
}

function getModeLabels(t: (key: string) => string): Record<GatewayMode, string> {
  return {
    relay: t('Relay'),
    custom: t('common:Custom'),
    local: t('common:Custom'),
    tailscale: t('common:Custom'),
    cloudflare: t('common:Custom'),
  };
}

const MODE_PLACEHOLDERS: Record<GatewayMode, string> = {
  relay: 'wss://relay.example.com/ws',
  custom: 'wss://gateway.example.com or ws://192.168.x.x:18789',
  local: 'ws://192.168.1.x:18789',
  tailscale: 'ws://100.x.x.x:18789',
  cloudflare: 'wss://xxx.trycloudflare.com',
};
const CLAWKET_IOS_APP_STORE_URL = 'https://apps.apple.com/app/id6759597015';
const CLAWKET_ANDROID_PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.p697.clawket';

type RowIconProps = {
  backgroundColor: string;
  children: React.ReactNode;
  styles: ReturnType<typeof createStyles>;
};

function RowIcon({ backgroundColor, children, styles }: RowIconProps): React.JSX.Element {
  return (
    <View style={[styles.rowIconBadge, { backgroundColor }]}>
      {children}
    </View>
  );
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const WECHAT_QR_IMAGE = require('../../../assets/wechat-group-qr.jpg');
export function ConfigScreenLayout({ insets, tabBarHeight, controller }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation(['config', 'common']);
  const {
    debugOverrideEnabled,
    errorCode,
    isPro,
    isConfigured,
    paywallPackages,
    showPaywallPreview,
    snapshot,
  } = useProPaywall();
  const configNavigation = useNavigation<NativeStackNavigationProp<ConfigStackParamList>>();
  const { theme } = controller;
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const THEME_OPTIONS = useMemo(() => getThemeOptions(t), [t]);
  const SPEECH_RECOGNITION_LANGUAGE_OPTIONS = useMemo(() => getSpeechRecognitionLanguageOptions(t), [t]);
  const MODE_LABELS = useMemo(() => getModeLabels(t), [t]);
  const themeModeLabel = THEME_OPTIONS.find((o) => o.value === controller.mode)?.label ?? t('Follow System');
  const speechRecognitionLanguageLabel = SPEECH_RECOGNITION_LANGUAGE_OPTIONS.find(
    (option) => option.value === controller.speechRecognitionLanguage,
  )?.label ?? t('Follow System');
  const appVersion = Application.nativeApplicationVersion?.trim() || APP_PACKAGE_VERSION;
  const appBuildVersion = Application.nativeBuildVersion?.trim() || null;
  const appVersionLabel = appBuildVersion
    ? t('Clawket {{version}} (Build {{build}})', { version: appVersion, build: appBuildVersion })
    : t('Clawket {{version}}', { version: appVersion });
  const appUserId = snapshot?.originalAppUserId?.trim() || null;
  const [revenueCatDiagnostics, setRevenueCatDiagnostics] = useState<RevenueCatDiagnostics>(() => getRevenueCatRuntimeDiagnostics());
  const [postHogDiagnostics, setPostHogDiagnostics] = useState<PostHogDiagnostics | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const isMainlandChineseLocale = (i18n.resolvedLanguage ?? i18n.language) === 'zh-Hans';
  const showWecomSupportEntry = shouldShowWecomSupportEntry();
  const supportEmailUrl = buildSupportEmailUrl(publicAppLinks.supportEmail);
  const [wecomModalVisible, setWecomModalVisible] = useState(false);
  const themeMenuActions = useMemo<MenuAction[]>(() => THEME_OPTIONS.map((option) => ({
    id: option.value,
    title: option.label,
    state: controller.mode === option.value ? 'on' : 'off',
  })), [controller.mode, THEME_OPTIONS]);
  const speechRecognitionLanguageMenuActions = useMemo<MenuAction[]>(() => (
    SPEECH_RECOGNITION_LANGUAGE_OPTIONS.map((option) => ({
      id: option.value,
      title: option.label,
      state: controller.speechRecognitionLanguage === option.value ? 'on' : 'off',
    }))
  ), [SPEECH_RECOGNITION_LANGUAGE_OPTIONS, controller.speechRecognitionLanguage]);

  const sortedConfigs = useMemo(() => {
    return [...controller.configs].sort((a, b) => a.createdAt - b.createdAt);
  }, [controller.configs]);

  const openRowRef = useRef<SwipeableMethods | null>(null);
  const rowRefs = useRef<Map<string, SwipeableMethods>>(new Map());

  const refreshDiagnostics = useCallback(async () => {
    setDiagnosticsLoading(true);
    setDiagnosticsError(null);
    try {
      const [nextRevenueCat, nextPostHog] = await Promise.all([
        collectRevenueCatDiagnostics(),
        Promise.resolve(getPostHogDiagnostics()),
      ]);
      setRevenueCatDiagnostics(nextRevenueCat);
      setPostHogDiagnostics(nextPostHog);
    } catch (error) {
      setDiagnosticsError(error instanceof Error ? error.message : String(error));
    } finally {
      setDiagnosticsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!controller.debugMode) return;
    void refreshDiagnostics();
  }, [controller.debugMode, refreshDiagnostics]);

  useEffect(() => {
    if (!controller.debugMode) return;
    const interval = setInterval(() => {
      setRevenueCatDiagnostics(getRevenueCatRuntimeDiagnostics());
    }, 1000);
    return () => clearInterval(interval);
  }, [controller.debugMode]);

  const handleSwipeOpen = useCallback((id: string) => {
    if (openRowRef.current && openRowRef.current !== rowRefs.current.get(id)) {
      openRowRef.current.close();
    }
    openRowRef.current = rowRefs.current.get(id) ?? null;
  }, []);

  const handleQRPicker = useCallback(() => {
    if (isMacCatalyst) {
      controller.onUploadQR();
      return;
    }

    const options = [t('Scan QR Code'), t('Upload QR Image'), t('common:Cancel')];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: options.length - 1 },
        (index) => {
          if (index === 0) {
            analyticsEvents.gatewayScanQrTapped({ source: 'config_action_sheet' });
            controller.onScanQR();
          }
          else if (index === 1) controller.onUploadQR();
        },
      );
    } else {
      Alert.alert('QR Code', undefined, [
        {
          text: t('Scan QR Code'),
          onPress: () => {
            analyticsEvents.gatewayScanQrTapped({ source: 'config_action_sheet' });
            controller.onScanQR();
          },
        },
        { text: t('Upload QR Image'), onPress: () => controller.onUploadQR() },
        { text: t('common:Cancel'), style: 'cancel' as const },
      ]);
    }
  }, [controller, t]);

  const handleRateAppPress = useCallback(async () => {
    if (Platform.OS !== 'ios') return;

    const appStoreId = publicAppLinks.iosAppStoreId;
    const manualStoreReviewUrl = appStoreId
      ? `itms-apps://itunes.apple.com/app/id${appStoreId}?action=write-review`
      : null;
    const storeReviewUrl = manualStoreReviewUrl ?? StoreReview.storeUrl();

    try {
      if (await StoreReview.isAvailableAsync()) {
        await StoreReview.requestReview();
        analyticsEvents.appRatingTapped({ source: 'config_support', result: 'review_prompt' });
        return;
      }

      if (storeReviewUrl) {
        const canOpen = await Linking.canOpenURL(storeReviewUrl);
        if (canOpen) {
          await Linking.openURL(storeReviewUrl);
          analyticsEvents.appRatingTapped({ source: 'config_support', result: 'store_page' });
          return;
        }
      }

      analyticsEvents.appRatingTapped({ source: 'config_support', result: 'unavailable' });
      Alert.alert(
        t('Unable to open rating'),
        t('Rating is temporarily unavailable on this device. Please try again later.'),
      );
    } catch {
      analyticsEvents.appRatingTapped({ source: 'config_support', result: 'error' });
      Alert.alert(
        t('Unable to open rating'),
        t('Rating is temporarily unavailable on this device. Please try again later.'),
      );
    }
  }, [t]);

  const handleShareAppPress = useCallback(async () => {
    const shareUrl = Platform.OS === 'ios'
      ? CLAWKET_IOS_APP_STORE_URL
      : CLAWKET_ANDROID_PLAY_STORE_URL;

    try {
      await Share.share({
        title: t('Share Clawket'),
        message: t('Try Clawket: {{url}}', { url: shareUrl }),
        url: shareUrl,
      });
    } catch {
      Alert.alert(t('Unable to share'), t('Please try again later.'));
    }
  }, [t]);

  const handleDownloadWecomQr = useCallback(async () => {
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          t('Unable to save QR code'),
          t('Please allow photo library access and try again.'),
        );
        return;
      }

      const resolved = Image.resolveAssetSource(WECHAT_QR_IMAGE);
      const destination = new FileSystem.File(
        FileSystem.Paths.cache,
        `wechat-group-qr-${Date.now()}.jpg`,
      );
      const downloaded = await FileSystem.File.downloadFileAsync(resolved.uri, destination);
      await MediaLibrary.saveToLibraryAsync(downloaded.uri);
      Alert.alert(
        t('Saved'),
        t('QR code saved to your photo library.'),
      );
    } catch {
      Alert.alert(
        t('Unable to save QR code'),
        t('Please try again later.'),
      );
    }
  }, [t]);

  const handleReleaseNotesEntryPress = useCallback(() => {
    configNavigation.navigate('ReleaseNotesHistory');
  }, [configNavigation]);

  const handleOpenExternalUrl = useCallback(async (url: string) => {
    await openExternalUrl(url, () => {
      Alert.alert(t('Unable to open link', { ns: 'common' }), t('Please try again later.'));
    });
  }, [t]);

  const renderGatewayIcon = useCallback((mode: GatewayMode) => {
    const color = theme.colors.textMuted;
    if (mode === 'relay') return <Link2 size={16} color={color} strokeWidth={2} />;
    return <Cloud size={16} color={color} strokeWidth={2} />;
  }, [theme.colors.textMuted]);

  return (
    <>
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + Space.lg, paddingBottom: Space.xxxl + tabBarHeight },
        ]}
      >
        <View style={styles.pageTitleRow}>
          <Text style={styles.pageTitle}>{t('common:Settings')}</Text>
          <Pressable onPress={showPaywallPreview} style={({ pressed }) => [styles.membershipTag, isPro ? styles.membershipTagPro : styles.membershipTagFree, pressed && styles.membershipTagPressed]}>
            <ShieldCheck size={13} color={theme.colors.primary} strokeWidth={2.2} />
            <Text style={[styles.membershipTagText, isPro ? styles.membershipTagTextPro : styles.membershipTagTextFree]}>
              {isPro ? t('Pro') : t('Free')}
            </Text>
          </Pressable>
        </View>

        <Text style={styles.sectionHeader}>{t('OPENCLAW CONNECTION')}</Text>

        <View style={styles.card}>
          {sortedConfigs.length === 0 ? (
            <View style={styles.emptyGatewayWrap}>
              <Text style={styles.emptyGatewayTitle}>{t('No OpenClaw Connection Configured')}</Text>
              <Pressable
                onPress={() => {
                  controller.openCreateEditor();
                }}
                style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
              >
                <View style={styles.buttonContent}>
                  <Plus size={15} color={theme.colors.primaryText} strokeWidth={2} />
                  <Text style={styles.primaryButtonText}>{t('Add OpenClaw Connection')}</Text>
                </View>
              </Pressable>
            </View>
          ) : (
            sortedConfigs.map((item, index) => {
              const active = item.id === controller.activeConfigId;
              return (
                <React.Fragment key={item.id}>
                  <SwipeableGatewayRow
                    colors={theme.colors}
                    onEdit={() => controller.openEditEditor(item.id)}
                    onDelete={() => controller.deleteConfig(item.id)}
                    onRegisterRef={(ref: SwipeableMethods | null) => {
                      if (ref) rowRefs.current.set(item.id, ref);
                      else rowRefs.current.delete(item.id);
                    }}
                    onSwipeOpen={() => handleSwipeOpen(item.id)}
                  >
                    <Pressable
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); void controller.activateConfig(item.id); }}
                      style={({ pressed }) => [styles.gatewayRow, pressed && styles.gatewayRowPressed]}
                    >
                      <View style={styles.gatewayLeft}>
                        <View style={styles.gatewayModeBadge}>{renderGatewayIcon(item.mode)}</View>
                        <View style={styles.gatewayTextWrap}>
                          <Text style={styles.gatewayName} numberOfLines={1}>{item.name}</Text>
                          <Text style={styles.gatewayMeta} numberOfLines={1}>
                            {MODE_LABELS[item.mode]} · {item.url}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.gatewayRight}>
                        {active ? (
                          <View style={styles.activeChip}>
                            <Text style={styles.activeChipText}>{t('common:Active')}</Text>
                          </View>
                        ) : null}
                        <ChevronLeft size={16} color={theme.colors.textSubtle} strokeWidth={2} />
                      </View>
                    </Pressable>
                  </SwipeableGatewayRow>
                  {index < sortedConfigs.length - 1 ? <View style={styles.divider} /> : null}
                </React.Fragment>
              );
            })
          )}
        </View>

        {sortedConfigs.length > 0 && <View style={styles.createRow}>
          <Pressable
            onPress={() => {
              controller.openCreateEditor();
            }}
            style={({ pressed }) => [styles.primaryButton, styles.createButtonFlex, pressed && styles.primaryButtonPressed]}
          >
            <View style={styles.buttonContent}>
              <Plus size={15} color={theme.colors.primaryText} strokeWidth={2} />
              <Text style={styles.primaryButtonText}>{t('Add OpenClaw Connection')}</Text>
            </View>
          </Pressable>
          {/* <Pressable
            onPress={handleQRPicker}
            style={({ pressed }) => [styles.outlineButton, styles.qrButton, pressed && styles.outlineButtonPressed]}
          >
            <QrCode size={18} color={theme.colors.primary} strokeWidth={2} />
          </Pressable> */}
        </View>}

        <Text style={styles.sectionHeader}>{t('OPENCLAW CONFIG')}</Text>

        <View style={styles.card}>
          <Pressable
            onPress={() => configNavigation.navigate('OpenClawConfig')}
            style={({ pressed }) => [styles.row, styles.feedbackRow, pressed && styles.rowPressed]}
          >
            <RowIcon backgroundColor="#E7F0FF" styles={styles}>
              <Eye size={17} strokeWidth={2.2} color="#2F6BFF" />
            </RowIcon>
            <View style={styles.supportRowText}>
              <Text style={styles.rowLabel}>{t('OPENCLAW CONFIG')}</Text>
            </View>
            <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
          </Pressable>
        </View>

        <Text style={styles.sectionHeader}>{t('APPEARANCE')}</Text>

        <View style={styles.card}>
          <View style={[styles.row, styles.selectRow]}>
            <View style={styles.settingRowLead}>
              <RowIcon backgroundColor="#E9F4FF" styles={styles}>
                <Palette size={17} strokeWidth={2.2} color="#2A74D8" fill="#2A74D8" />
              </RowIcon>
              <View style={styles.supportRowText}>
                <Text style={styles.rowLabel}>{t('Theme')}</Text>
              </View>
            </View>
            <View style={styles.selectRowMenuWrap}>
              <MenuView
                actions={themeMenuActions}
                shouldOpenOnLongPress={false}
                hitSlop={{ top: 10, bottom: 10, left: 32, right: 12 }}
                onPressAction={({ nativeEvent }) => {
                  const selectedOption = THEME_OPTIONS.find((option) => option.value === nativeEvent.event);
                  if (!selectedOption) return;
                  Haptics.selectionAsync();
                  controller.setMode(selectedOption.value);
                }}
                title={t('Theme')}
                themeVariant={theme.scheme}
                style={styles.themeMenuTrigger}
              >
                <View style={styles.rowTrailing}>
                  <Text style={styles.rowValue}>{themeModeLabel}</Text>
                  <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
                </View>
              </MenuView>
            </View>
          </View>

          <View style={styles.divider} />

          <Pressable
            onPress={() => configNavigation.navigate('ChatAppearance')}
            style={({ pressed }) => [styles.row, styles.feedbackRow, pressed && styles.rowPressed]}
          >
            <RowIcon backgroundColor="#FFF0DB" styles={styles}>
              <Sparkles size={17} strokeWidth={2.2} color="#C97A00" fill="#C97A00" />
            </RowIcon>
            <View style={styles.supportRowText}>
              <Text style={styles.rowLabel}>{t('Chat Appearance')}</Text>
            </View>
            <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
          </Pressable>

          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.rowLabel}>{t('Accent Color')}</Text>
            <View style={styles.accentRow}>
              {ACCENT_OPTIONS.map((option) => {
                const active = controller.accentId === option.id;
                const swatchColor = builtInAccents[option.id].light.accent500;
                return (
                  <Pressable
                    key={option.id}
                    onPress={() => {
                      if (active) return;
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      analyticsEvents.themeAccentChanged({
                        selected_accent_id: option.id,
                        source: 'config_screen',
                      });
                      controller.setAccentId(option.id);
                    }}
                    style={styles.accentOption}
                  >
                    <View
                      style={[
                        styles.accentSwatch,
                        { backgroundColor: swatchColor },
                        active && styles.accentSwatchActive,
                      ]}
                    >
                      {active && <View style={styles.accentSwatchDot} />}
                    </View>
                    <Text style={[styles.accentLabel, active && styles.accentLabelActive]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        <Text style={styles.sectionHeader}>{t('VOICE INPUT')}</Text>

        <View style={styles.card}>
          <View style={[styles.row, styles.selectRow]}>
            <View style={styles.settingRowLead}>
              <RowIcon backgroundColor="#FFF1E5" styles={styles}>
                <Mic size={17} strokeWidth={2.2} color="#CC6C25" fill="#CC6C25" />
              </RowIcon>
              <View style={styles.supportRowText}>
                <Text style={styles.rowLabel}>{t('Speech Recognition Language')}</Text>
              </View>
            </View>
            <View style={styles.selectRowMenuWrap}>
              <MenuView
                actions={speechRecognitionLanguageMenuActions}
                shouldOpenOnLongPress={false}
                hitSlop={{ top: 10, bottom: 10, left: 32, right: 12 }}
                onPressAction={({ nativeEvent }) => {
                  const selectedOption = SPEECH_RECOGNITION_LANGUAGE_OPTIONS.find(
                    (option) => option.value === nativeEvent.event,
                  );
                  if (!selectedOption) return;
                  Haptics.selectionAsync();
                  controller.onSpeechRecognitionLanguageChange(selectedOption.value);
                }}
                title={t('Speech Recognition Language')}
                themeVariant={theme.scheme}
                style={styles.themeMenuTrigger}
              >
                <View style={styles.rowTrailing}>
                  <Text style={styles.rowValue}>{speechRecognitionLanguageLabel}</Text>
                  <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
                </View>
              </MenuView>
            </View>
          </View>
        </View>

        <Text style={styles.sectionHeader}>{t('COMMUNITY')}</Text>
        <View style={styles.card}>
          <Pressable
            onPress={() => {
              void handleShareAppPress();
            }}
            style={({ pressed }) => [styles.row, styles.feedbackRow, pressed && styles.rowPressed]}
          >
            <RowIcon backgroundColor="#EAF3FF" styles={styles}>
              <Share2 size={17} strokeWidth={2.2} color="#2F6BFF" />
            </RowIcon>
            <View style={styles.supportRowText}>
              <Text style={styles.rowLabel}>{t('Share Clawket with Friends')}</Text>
            </View>
            <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
          </Pressable>

          {(Platform.OS === 'ios' || publicAppLinks.discordInviteUrl || showWecomSupportEntry) ? (
            <View style={styles.divider} />
          ) : null}

          {Platform.OS === 'ios' ? (
            <>
              <Pressable
                onPress={() => {
                  void handleRateAppPress();
                }}
                style={({ pressed }) => [styles.row, styles.feedbackRow, pressed && styles.rowPressed]}
              >
                <RowIcon backgroundColor="#FFF4D6" styles={styles}>
                  <Star size={17} strokeWidth={2.1} color="#D79A00" fill="#D79A00" />
                </RowIcon>
                <View style={styles.supportRowText}>
                  <Text style={styles.rowLabel}>{t('Rate Clawket')}</Text>
                </View>
                <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
              </Pressable>

              <View style={styles.divider} />
            </>
          ) : null}

          {publicAppLinks.discordInviteUrl ? (
            <Pressable
              onPress={() => {
                void handleOpenExternalUrl(publicAppLinks.discordInviteUrl as string);
              }}
              style={({ pressed }) => [styles.row, styles.feedbackRow, pressed && styles.rowPressed]}
            >
              <RowIcon backgroundColor="#EEF1FF" styles={styles}>
                <Gamepad2 size={17} strokeWidth={2.2} color="#596AE8" fill="#596AE8" />
              </RowIcon>
              <View style={styles.supportRowText}>
                <Text style={styles.rowLabel}>{t('Join Discord')}</Text>
              </View>
              <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
            </Pressable>
          ) : null}

          {showWecomSupportEntry ? (
            <>
              {publicAppLinks.discordInviteUrl ? <View style={styles.divider} /> : null}

              <Pressable
                onPress={() => setWecomModalVisible(true)}
                style={({ pressed }) => [styles.row, styles.feedbackRow, pressed && styles.rowPressed]}
              >
                <RowIcon backgroundColor="#E7F7EC" styles={styles}>
                  <MessageCircleMore size={17} strokeWidth={2.2} color="#1C9A57" fill="#1C9A57" />
                </RowIcon>
                <View style={styles.supportRowText}>
                  <Text style={styles.rowLabel}>{t('Join WeCom Group')}</Text>
                </View>
              </Pressable>
            </>
          ) : null}
        </View>

        <Text style={styles.sectionHeader}>{t('OPEN SOURCE')}</Text>
        <View style={styles.card}>
          <Pressable
            onPress={() => {
              void handleOpenExternalUrl(CLAWKET_GITHUB_REPO_URL);
            }}
            style={({ pressed }) => [styles.row, styles.feedbackRow, pressed && styles.rowPressed]}
          >
            <RowIcon backgroundColor="#ECEEF2" styles={styles}>
              <Github size={17} strokeWidth={2.2} color="#1F2937" fill="#1F2937" />
            </RowIcon>
            <View style={styles.supportRowText}>
              <Text style={styles.rowLabel}>{t('View GitHub Repository')}</Text>
            </View>
            <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
          </Pressable>
        </View>

        <Text style={styles.sectionHeader}>{t('HELP')}</Text>
        <View style={styles.card}>
          <Pressable
            onPress={() => configNavigation.navigate('HelpCenter')}
            style={({ pressed }) => [styles.row, styles.feedbackRow, pressed && styles.rowPressed]}
          >
            <RowIcon backgroundColor="#E8F7F8" styles={styles}>
              <HelpCircle size={17} strokeWidth={2.2} color="#0B8C99" fill="#0B8C99" />
            </RowIcon>
            <View style={styles.supportRowText}>
              <Text style={styles.rowLabel}>{t('Help Center')}</Text>
            </View>
            <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
          </Pressable>

          <View style={styles.divider} />

          <Pressable
            onPress={handleReleaseNotesEntryPress}
            style={({ pressed }) => [styles.row, styles.feedbackRow, pressed && styles.rowPressed]}
          >
            <RowIcon backgroundColor="#F4EBFF" styles={styles}>
              <Sparkles size={17} strokeWidth={2.2} color="#8A4DCC" fill="#8A4DCC" />
            </RowIcon>
            <View style={styles.supportRowText}>
              <Text style={styles.rowLabel}>{t('Release Notes')}</Text>
            </View>
          </Pressable>

          {supportEmailUrl || publicAppLinks.privacyPolicyUrl || publicAppLinks.termsOfUseUrl ? <View style={styles.divider} /> : null}

          {supportEmailUrl ? (
            <Pressable
              onPress={() => {
                void handleOpenExternalUrl(supportEmailUrl);
              }}
              style={({ pressed }) => [styles.row, styles.feedbackRow, pressed && styles.rowPressed]}
            >
              <RowIcon backgroundColor="#FFECEE" styles={styles}>
                <Mail size={17} strokeWidth={2.2} color="#CC4D5F" fill="#CC4D5F" />
              </RowIcon>
              <View style={styles.supportRowText}>
                <Text style={styles.rowLabel}>{t('Send Feedback')}</Text>
              </View>
            </Pressable>
          ) : null}

          {supportEmailUrl && (publicAppLinks.privacyPolicyUrl || publicAppLinks.termsOfUseUrl) ? <View style={styles.divider} /> : null}

          {publicAppLinks.privacyPolicyUrl ? (
            <Pressable
              onPress={() => {
                void handleOpenExternalUrl(publicAppLinks.privacyPolicyUrl as string);
              }}
              style={({ pressed }) => [styles.row, styles.feedbackRow, pressed && styles.rowPressed]}
            >
              <RowIcon backgroundColor="#E8F3FF" styles={styles}>
                <ShieldCheck size={17} strokeWidth={2.2} color="#2469D9" fill="#2469D9" />
              </RowIcon>
              <View style={styles.supportRowText}>
                <Text style={styles.rowLabel}>{t('Privacy Policy', { ns: 'common' })}</Text>
              </View>
              <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
            </Pressable>
          ) : null}

          {publicAppLinks.privacyPolicyUrl && publicAppLinks.termsOfUseUrl ? <View style={styles.divider} /> : null}

          {publicAppLinks.termsOfUseUrl ? (
            <Pressable
              onPress={() => {
                void handleOpenExternalUrl(publicAppLinks.termsOfUseUrl as string);
              }}
              style={({ pressed }) => [styles.row, styles.feedbackRow, pressed && styles.rowPressed]}
            >
              <RowIcon backgroundColor="#F1F0FF" styles={styles}>
                <Link2 size={17} strokeWidth={2.25} color="#6B5CE7" />
              </RowIcon>
              <View style={styles.supportRowText}>
                <Text style={styles.rowLabel}>{t('Terms of Use', { ns: 'common' })}</Text>
              </View>
              <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
            </Pressable>
          ) : null}
        </View>

        <Text style={styles.sectionHeader}>{t('DEVELOPER')}</Text>

        <View style={styles.card}>
          {/* <View style={[styles.row, styles.toggleRow]}>
            <View style={styles.toggleLabels}>
              <Text style={styles.rowLabel}>Tool Approval</Text>
              <Text style={styles.rowMeta}>Review dangerous commands before execution</Text>
            </View>
            <ThemedSwitch
              value={controller.execApprovalEnabled}
              onValueChange={controller.onExecApprovalToggle}
              trackColor={{ false: theme.colors.borderStrong, true: theme.colors.primarySoft }}
              thumbColor={controller.execApprovalEnabled ? theme.colors.primary : theme.colors.surfaceMuted}
            />
          </View>

          <View style={styles.divider} /> */}

          {/* <View style={[styles.row, styles.toggleRow]}>
            <View style={styles.toggleLabels}>
              <Text style={styles.rowLabel}>Allow Canvas</Text>
              <Text style={styles.rowMeta}>Let agents open an embedded browser panel</Text>
            </View>
            <ThemedSwitch
              value={controller.canvasEnabled}
              onValueChange={controller.onCanvasToggle}
              trackColor={{ false: theme.colors.borderStrong, true: theme.colors.primarySoft }}
              thumbColor={controller.canvasEnabled ? theme.colors.primary : theme.colors.surfaceMuted}
            />
          </View> */}

          <View style={[styles.row, styles.toggleRow]}>
            <View style={styles.toggleLabels}>
              <Text style={styles.rowLabel}>{t('Debug Mode')}</Text>
            </View>
            <ThemedSwitch
              value={controller.debugMode}
              onValueChange={controller.onDebugToggle}
              trackColor={{ false: theme.colors.borderStrong, true: theme.colors.primarySoft }}
              thumbColor={controller.debugMode ? theme.colors.primary : theme.colors.surfaceMuted}
            />
          </View>
        </View>

        {controller.debugMode ? (
          <View style={[styles.card, styles.deviceCard]}>
            <View style={styles.row}>
              <Text style={styles.deviceLabel}>{t('Device Entity (Ed25519)')}</Text>
              <Text style={styles.deviceId} selectable>
                {controller.deviceId}
              </Text>
              {appUserId ? (
                <View style={styles.deviceMetaBlock}>
                  <Text style={styles.deviceLabel}>{t('RevenueCat App User ID')}</Text>
                  <Text style={styles.deviceId} selectable>
                    {appUserId}
                  </Text>
                </View>
              ) : null}
              <View style={styles.deviceMetaBlock}>
                <Text style={styles.deviceLabel}>RevenueCat Diagnostics</Text>
                <Text style={styles.deviceId}>
                  Build enabled: {revenueCatDiagnostics?.buildEnabled ? 'yes' : 'no'}
                </Text>
                <Text style={styles.deviceId}>
                  Paywall configured: {isConfigured ? 'yes' : 'no'}
                </Text>
                <Text style={styles.deviceId}>
                  iOS key: {revenueCatDiagnostics?.iosApiKeyMasked ?? 'missing'}
                </Text>
                <Text style={styles.deviceId}>
                  Runtime key: {revenueCatDiagnostics?.runtimeApiKeyMasked ?? 'missing'}
                </Text>
                <Text style={styles.deviceId}>
                  Entitlement: {revenueCatDiagnostics?.entitlementId ?? 'missing'}
                </Text>
                <Text style={styles.deviceId}>
                  Offering: {revenueCatDiagnostics?.offeringId ?? 'missing'}
                </Text>
                <Text style={styles.deviceId}>
                  `Purchases.isConfigured()`: {revenueCatDiagnostics?.purchasesIsConfigured == null ? 'unknown' : revenueCatDiagnostics.purchasesIsConfigured ? 'yes' : 'no'}
                </Text>
                <Text style={styles.deviceId}>
                  `ensureRevenueCatConfigured()`: {revenueCatDiagnostics?.ensureConfiguredStatus ?? 'unknown'}
                </Text>
                {revenueCatDiagnostics?.ensureConfiguredError ? (
                  <Text style={styles.deviceId}>
                    Ensure error: {revenueCatDiagnostics.ensureConfiguredError}
                  </Text>
                ) : null}
                <Text style={styles.deviceId}>
                  `getCustomerInfo()`: {revenueCatDiagnostics?.customerInfoStatus ?? 'unknown'}
                </Text>
                {revenueCatDiagnostics?.customerInfoError ? (
                  <Text style={styles.deviceId}>
                    Customer info error: {revenueCatDiagnostics.customerInfoError}
                  </Text>
                ) : null}
                <Text style={styles.deviceId}>
                  Customer App User ID: {revenueCatDiagnostics?.appUserId ?? 'missing'}
                </Text>
                <Text style={styles.deviceId}>
                  `getPaywallPackages()`: {revenueCatDiagnostics?.offeringsStatus ?? 'unknown'}
                </Text>
                <Text style={styles.deviceId}>
                  Packages: {revenueCatDiagnostics?.offeringsCount ?? 0}
                </Text>
                {revenueCatDiagnostics?.offeringsError ? (
                  <Text style={styles.deviceId}>
                    Offerings error: {revenueCatDiagnostics.offeringsError}
                  </Text>
                ) : null}
              </View>
              <View style={styles.deviceMetaBlock}>
                <Text style={styles.deviceLabel}>PostHog Diagnostics</Text>
                <Text style={styles.deviceId}>
                  Build enabled: {postHogDiagnostics?.enabled ? 'yes' : 'no'}
                </Text>
                <Text style={styles.deviceId}>
                  Client initialized: {postHogDiagnostics?.clientInitialized ? 'yes' : 'no'}
                </Text>
                <Text style={styles.deviceId}>
                  Host: {postHogDiagnostics?.host ?? 'missing'}
                </Text>
                <Text style={styles.deviceId}>
                  API key: {postHogDiagnostics?.apiKeyMasked ?? 'missing'}
                </Text>
              </View>
              {diagnosticsError ? (
                <View style={styles.deviceMetaBlock}>
                  <Text style={styles.deviceLabel}>Diagnostics error</Text>
                  <Text style={styles.deviceId}>{diagnosticsError}</Text>
                </View>
              ) : null}
              <Pressable
                onPress={() => {
                  void refreshDiagnostics();
                }}
                style={({ pressed }) => [
                  styles.debugRefreshButton,
                  pressed && styles.debugRefreshButtonPressed,
                ]}
              >
                <Text style={styles.debugRefreshButtonText}>
                  {diagnosticsLoading ? 'Refreshing…' : 'Refresh diagnostics'}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <Pressable
          onPress={controller.resetDevice}
          style={({ pressed }) => [styles.destructiveButton, pressed && styles.destructiveButtonPressed]}
        >
          <Text style={styles.destructiveButtonText}>{t('Reset Device')}</Text>
        </Pressable>
        <Text style={styles.resetHint}>{t('Clears identity, token, pairing, and all saved gateways.')}</Text>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {t('Gateway uptime: {{uptime}}', { uptime: controller.gatewayInfo ? formatUptime(controller.gatewayInfo.uptimeMs) : '--' })}
          </Text>
          <Text style={styles.footerText}>
            {t('OpenClaw {{version}}', { version: controller.gatewayInfo?.version || '--' })}
          </Text>
          <Text style={styles.footerText}>
            {appVersionLabel}
          </Text>
          {/* This ICP filing text must stay hardcoded in Chinese and must not be localized. */}
          {isMainlandChineseLocale ? (
            <Text style={styles.footerText}>陕ICP备2023004392号-3A</Text>
          ) : null}
          {controller.gatewayUpdateInfo ? (
            <Pressable
              onPress={() => configNavigation.navigate('OpenClawReleases')}
              style={({ pressed }) => [styles.footerUpdateLink, pressed && styles.footerUpdateLinkPressed]}
            >
              <Text style={styles.footerUpdateText}>
                {t('Update available: {{currentVersion}} → {{latestVersion}}', {
                  currentVersion: controller.gatewayUpdateInfo.currentVersion,
                  latestVersion: controller.gatewayUpdateInfo.latestVersion,
                })}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>

      <ModalSheet
        visible={wecomModalVisible}
        onClose={() => setWecomModalVisible(false)}
        title={t('WeCom Group QR Code')}
      >
        <View style={styles.wecomModalBody}>
          <Image
            source={WECHAT_QR_IMAGE}
            style={styles.wecomQrImage}
            resizeMode="contain"
          />
          <Text style={styles.wecomModalHint}>{t('Scan this QR code in WeCom to join the group chat.')}</Text>
          <Pressable
            onPress={() => {
              void handleDownloadWecomQr();
            }}
            style={({ pressed }) => [styles.wecomDownloadButton, pressed && styles.wecomDownloadButtonPressed]}
          >
            <Text style={styles.wecomDownloadButtonText}>{t('Download QR Code')}</Text>
          </Pressable>
        </View>
      </ModalSheet>

      <EditorModal controller={controller} theme={theme} styles={styles} />
    </>
  );
}

// ---- Editor Modal ----

type EditorTab = 'quick' | 'manual';
type AuthMethodTab = 'token' | 'password';

type EditorModalProps = {
  controller: Props['controller'];
  theme: AppTheme;
  styles: ReturnType<typeof createStyles>;
};

function EditorModal({ controller, theme, styles }: EditorModalProps): React.JSX.Element {
  const { t } = useTranslation('config');
  const isEditing = !!controller.editingConfigId;
  const isLockedRelayEditor = isEditing && controller.isRelayEditorLocked;
  const [editorTab, setEditorTab] = useState<EditorTab>(isEditing ? 'manual' : 'quick');
  const EDITOR_TABS = useMemo<{ key: EditorTab; label: string }[]>(() => [
    { key: 'quick', label: t('Quick Connect') },
    { key: 'manual', label: t('Custom Connect') },
  ], [t]);
  const AUTH_METHOD_TABS = useMemo<{ key: AuthMethodTab; label: string }[]>(() => [
    { key: 'token', label: t('Auth Token') },
    { key: 'password', label: t('Password') },
  ], [t]);
  const MODE_LABELS = useMemo(() => getModeLabels(t), [t]);
  const authInputLabel = controller.editorAuthMethod === 'token' ? t('Auth Token') : t('Password');
  const authInputPlaceholder = controller.editorAuthMethod === 'token'
    ? (isEditing ? t('Paste token here') : t('Paste OpenClaw Gateway Auth Token here'))
    : t('Paste OpenClaw Gateway Auth Password here');
  const authInputValue = controller.editorAuthMethod === 'token'
    ? controller.editorToken
    : controller.editorPassword;

  // Reset to Quick Connect tab when modal opens for a new connection
  const prevVisibleRef = useRef(controller.editorVisible);
  if (controller.editorVisible && !prevVisibleRef.current) {
    // Modal just opened — pick initial tab
    if (!isEditing && editorTab !== controller.editorPreferredTab) setEditorTab(controller.editorPreferredTab);
    if (isEditing && editorTab !== 'manual') setEditorTab('manual');
  }
  prevVisibleRef.current = controller.editorVisible;

  return (
    <ModalSheet
      visible={controller.editorVisible}
      onClose={controller.closeEditor}
      title={isEditing ? t('Edit Connection') : t('Add Connection')}
    >
      {!isEditing && (
        <SegmentedTabs tabs={EDITOR_TABS} active={editorTab} onSwitch={setEditorTab} />
      )}

      {editorTab === 'quick' && !isEditing ? (
        <ScrollView contentContainerStyle={styles.modalBody}>
          <Text style={styles.quickHint}>
            {t('Scan or upload a QR code from your Gateway to connect instantly.')}
          </Text>

          <Pressable
            onPress={() => {
              if (!isMacCatalyst) {
                analyticsEvents.gatewayScanQrTapped({ source: 'config_quick_connect' });
                controller.onScanQR();
                return;
              }
              controller.onUploadQR();
            }}
            style={({ pressed }) => [styles.primaryButton, styles.quickAction, pressed && styles.primaryButtonPressed]}
          >
            <View style={styles.buttonContent}>
              {isMacCatalyst
                ? <ImageUp size={15} color={theme.colors.primaryText} strokeWidth={2} />
                : <ScanLine size={15} color={theme.colors.primaryText} strokeWidth={2} />}
              <Text style={styles.primaryButtonText}>{t(isMacCatalyst ? 'Upload QR Image' : 'Scan QR Code')}</Text>
            </View>
          </Pressable>

          {!isMacCatalyst && (
            <Pressable
              onPress={controller.onUploadQR}
              style={({ pressed }) => [styles.outlineButton, styles.quickAction, pressed && styles.outlineButtonPressed]}
            >
              <View style={styles.buttonContent}>
                <ImageUp size={15} color={theme.colors.primary} strokeWidth={2} />
                <Text style={styles.outlineButtonText}>{t('Upload QR Image')}</Text>
              </View>
            </Pressable>
          )}

          <ConnectionHelpQuick />
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.modalBody}>
          {isEditing && !isLockedRelayEditor && (
            <View style={styles.fieldWrap}>
              <Text style={styles.inputLabel}>{t('Connection Mode')}</Text>
              <View style={styles.segmentedWrap}>
                {(['relay', 'custom'] as const).map((mode) => (
                  <Pressable
                    key={mode}
                    style={[styles.segment, controller.editorMode === mode && styles.segmentActive]}
                    onPress={() => controller.setEditorMode(mode)}
                  >
                    <Text style={[styles.segmentText, controller.editorMode === mode && styles.segmentTextActive]}>
                      {MODE_LABELS[mode]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {!isLockedRelayEditor && (
            <>
              <View style={styles.fieldWrap}>
                <Text style={styles.inputLabel}>{t('Gateway URL')}</Text>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={isEditing ? MODE_PLACEHOLDERS[controller.editorMode] : 'ws://192.168.x.x:18789'}
                  placeholderTextColor={theme.colors.textSubtle}
                  style={styles.input}
                  value={controller.editorUrl}
                  onChangeText={controller.setEditorUrl}
                />
              </View>

              <View style={styles.fieldWrap}>
                <Text style={styles.inputLabel}>{t('Auth Method')}</Text>
                <SegmentedTabs
                  tabs={AUTH_METHOD_TABS}
                  active={controller.editorAuthMethod}
                  onSwitch={controller.setEditorAuthMethod}
                  containerStyle={styles.authMethodTabs}
                />
              </View>

              <View style={styles.fieldWrap}>
                <Text style={styles.inputLabel}>{authInputLabel}</Text>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={authInputPlaceholder}
                  placeholderTextColor={theme.colors.textSubtle}
                  secureTextEntry
                  style={styles.input}
                  value={authInputValue}
                  onChangeText={controller.editorAuthMethod === 'token' ? controller.setEditorToken : controller.setEditorPassword}
                />
              </View>

              {controller.editorMode === 'relay' && (
                <>
                  <View style={styles.fieldWrap}>
                    <Text style={styles.inputLabel}>{t('Relay Pair Server URL')}</Text>
                    <TextInput
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder="https://registry.example.com"
                      placeholderTextColor={theme.colors.textSubtle}
                      style={styles.input}
                      value={controller.editorRelayServerUrl}
                      onChangeText={controller.setEditorRelayServerUrl}
                    />
                  </View>

                  <View style={styles.fieldWrap}>
                    <Text style={styles.inputLabel}>{t('Relay Gateway ID')}</Text>
                    <TextInput
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder={t('gateway_xxxxx')}
                      placeholderTextColor={theme.colors.textSubtle}
                      style={styles.input}
                      value={controller.editorRelayGatewayId}
                      onChangeText={controller.setEditorRelayGatewayId}
                    />
                    <Text style={styles.inputHelp}>
                      {t('Relay mode uses a paired Bridge connection. Scan the Bridge QR when possible.')}
                    </Text>
                  </View>
                </>
              )}
            </>
          )}

          <View style={styles.fieldWrap}>
            <Text style={styles.inputLabel}>{t('Connection Name')}</Text>
            <TextInput
              autoCapitalize="words"
              autoCorrect={false}
              placeholder={isEditing ? t('Home Gateway') : 'Lucy'}
              placeholderTextColor={theme.colors.textSubtle}
              style={styles.input}
              value={controller.editorName}
              onChangeText={controller.setEditorName}
            />
          </View>

          <Pressable
            onPress={() => { void controller.saveEditor(); }}
            style={({ pressed }) => [styles.primaryButton, styles.saveButton, pressed && styles.primaryButtonPressed]}
          >
            <Text style={styles.primaryButtonText}>
              {isEditing ? t('Save Changes') : t('Save and Activate')}
            </Text>
          </Pressable>

          {!isEditing && <ConnectionHelpManual activeMode="custom" />}
        </ScrollView>
      )}
    </ModalSheet>
  );
}

function formatUptime(ms: number): string {
  if (ms <= 0) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(' ');
}


function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: {
      paddingHorizontal: Space.lg,
      backgroundColor: colors.background,
    },
    pageTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.sm,
    },
    pageTitle: {
      color: colors.text,
      fontSize: FontSize.xl,
      fontWeight: FontWeight.bold,
    },
    sectionHeader: {
      color: colors.textSubtle,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
      letterSpacing: 0.7,
      textTransform: 'uppercase',
      marginTop: Space.xl,
      marginBottom: Space.sm,
      paddingHorizontal: Space.xs,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
      ...Shadow.sm,
    },
    membershipTag: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
      paddingHorizontal: Space.sm,
      paddingVertical: Space.xs,
      borderRadius: Radius.full,
    },
    membershipTagPro: {
      backgroundColor: colors.primarySoft,
    },
    membershipTagFree: {
      backgroundColor: colors.primarySoft,
    },
    membershipTagPressed: {
      opacity: 0.7,
    },
    membershipTagText: {
      fontSize: FontSize.md,
      fontWeight: FontWeight.semibold,
    },
    membershipTagTextPro: {
      color: colors.primary,
    },
    membershipTagTextFree: {
      color: colors.primary,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.borderStrong,
      marginLeft: Space.lg,
    },
    row: {
      paddingHorizontal: Space.lg,
      paddingVertical: 14,
      // minHeight: 52,
    },
    rowPressed: {
      backgroundColor: colors.surfaceMuted,
    },
    themeMenuTrigger: {
      flexShrink: 1,
    },
    selectRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    settingRowLead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
      flex: 1,
      minWidth: 0,
    },
    selectRowMenuWrap: {
      flexShrink: 1,
      marginLeft: Space.md,
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    feedbackRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
    },
    rowIconBadge: {
      width: 32,
      height: 32,
      borderRadius: Radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    supportRowText: {
      flex: 1,
      justifyContent: 'center',
    },
    wecomModalBody: {
      alignItems: 'center',
      paddingHorizontal: Space.lg,
      paddingTop: Space.sm,
      paddingBottom: Space.lg,
      gap: Space.md,
    },
    wecomQrImage: {
      width: 220,
      height: 220,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
    },
    wecomModalHint: {
      fontSize: FontSize.md,
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 19,
    },
    wecomDownloadButton: {
      width: '100%',
      borderRadius: Radius.md,
      backgroundColor: colors.primary,
      paddingVertical: 11,
      alignItems: 'center',
      justifyContent: 'center',
    },
    wecomDownloadButtonPressed: {
      opacity: 0.88,
    },
    wecomDownloadButtonText: {
      color: colors.primaryText,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    rowLabel: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.medium,
    },
    rowMeta: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      marginTop: 3,
    },
    rowTrailing: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
    },
    rowValue: {
      color: colors.textMuted,
      fontSize: FontSize.base,
    },
    rowPicker: {
      marginTop: Space.sm,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.md,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: Space.md,
      paddingVertical: 11,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.sm,
    },
    rowPickerText: {
      flex: 1,
      color: colors.text,
      fontSize: FontSize.base,
    },
    placeholderText: {
      color: colors.textSubtle,
    },
    toggleLabels: {
      flex: 1,
      marginRight: Space.md,
    },
    emptyGatewayWrap: {
      paddingHorizontal: Space.lg,
      paddingVertical: Space.lg,
    },
    emptyGatewayTitle: {
      color: colors.text,
      fontSize: FontSize.lg,
      fontWeight: FontWeight.semibold,
    },
    emptyGatewaySubtitle: {
      color: colors.textMuted,
      fontSize: FontSize.base,
    },
    gatewayRow: {
      paddingHorizontal: Space.lg,
      paddingVertical: Space.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    gatewayRowPressed: {
      backgroundColor: colors.surfaceMuted,
    },
    gatewayLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
      gap: Space.sm,
    },
    gatewayModeBadge: {
      width: 32,
      height: 32,
      borderRadius: Radius.full,
      backgroundColor: colors.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    gatewayTextWrap: {
      flex: 1,
      gap: 2,
    },
    gatewayName: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    gatewayMeta: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
    },
    gatewayRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
      marginLeft: Space.sm,
    },
    activeChip: {
      paddingHorizontal: Space.sm,
      paddingVertical: 4,
      borderRadius: Radius.full,
      backgroundColor: colors.primarySoft,
    },
    activeChipText: {
      color: colors.primary,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
    },
    buttonContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Space.sm,
    },
    primaryButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: Radius.md,
      paddingVertical: 11,
      marginTop: Space.md,
      ...Shadow.md,
    },
    primaryButtonPressed: {
      opacity: 0.88,
    },
    buttonDisabled: {
      opacity: 0.55,
    },
    primaryButtonText: {
      color: colors.primaryText,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    createRow: {
      flexDirection: 'row',
      gap: Space.sm,
      marginTop: Space.md,
    },
    createButtonFlex: {
      flex: 1,
      marginTop: 0,
    },
    restartGatewayButton: {
      marginTop: Space.sm,
    },
    qrButton: {
      marginTop: 0,
      justifyContent: 'center',
      aspectRatio: 1,
      paddingVertical: 0,
    },
    quickHint: {
      fontSize: FontSize.md,
      color: colors.textMuted,
      lineHeight: 20,
      marginBottom: Space.lg,
    },
    quickAction: {
      marginTop: 0,
      marginBottom: Space.sm,
    },
    saveButton: {
      marginTop: Space.xs,
    },
    outlineButton: {
      alignItems: 'center',
      borderRadius: Radius.md,
      marginTop: Space.md,
      paddingVertical: 11,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.surface,
    },
    outlineButtonPressed: {
      backgroundColor: colors.surfaceMuted,
    },
    outlineButtonText: {
      color: colors.primary,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    destructiveButton: {
      alignItems: 'center',
      borderRadius: Radius.md,
      marginTop: Space.xl,
      paddingVertical: 11,
      borderWidth: 1,
      borderColor: colors.error,
      backgroundColor: colors.surface,
    },
    destructiveButtonPressed: {
      backgroundColor: colors.surfaceMuted,
    },
    destructiveButtonText: {
      color: colors.error,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    resetHint: {
      color: colors.textSubtle,
      fontSize: FontSize.xs,
      textAlign: 'center',
      marginTop: Space.sm,
      marginBottom: Space.lg,
    },
    accentRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: Space.sm,
    },
    accentOption: {
      alignItems: 'center',
      gap: 5,
    },
    accentSwatch: {
      width: 30,
      height: 30,
      borderRadius: Radius.full,
      borderWidth: 2,
      borderColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    accentSwatchActive: {
      borderColor: colors.surface,
    },
    accentSwatchDot: {
      width: 12,
      height: 12,
      borderRadius: Radius.full,
      backgroundColor: '#FFFFFF',
    },
    accentLabel: {
      fontSize: FontSize.xs,
      color: colors.textMuted,
      fontWeight: FontWeight.medium,
    },
    accentLabelActive: {
      color: colors.primary,
      fontWeight: FontWeight.semibold,
    },
    fontSizeStepper: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Space.sm,
    },
    fontSizeValue: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      minWidth: 24,
      textAlign: 'center',
    },
    deviceCard: {
      marginTop: Space.xl,
    },
    deviceLabel: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
      marginBottom: 5,
    },
    deviceId: {
      color: colors.textSubtle,
      fontSize: FontSize.xs,
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
      lineHeight: 16,
    },
    deviceMetaBlock: {
      marginTop: Space.md,
    },
    debugRefreshButton: {
      marginTop: Space.md,
      alignSelf: 'flex-start',
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: Space.md,
      paddingVertical: Space.sm,
    },
    debugRefreshButtonPressed: {
      opacity: 0.8,
    },
    debugRefreshButtonText: {
      color: colors.text,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
    },
    modalBody: {
      paddingHorizontal: Space.lg,
      paddingBottom: Space.xl,
      paddingTop: Space.md,
    },
    fieldWrap: {
      marginBottom: Space.md,
    },
    inputLabel: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
      marginBottom: Space.xs,
    },
    input: {
      color: colors.text,
      fontSize: FontSize.base,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.md,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: Space.md,
      paddingVertical: 11,
    },
    inputHelp: {
      marginTop: Space.xs,
      color: colors.textSubtle,
      fontSize: FontSize.sm,
    },
    authMethodTabs: {
      marginHorizontal: 0,
      marginTop: 0,
      marginBottom: 0,
    },
    inlineInput: {
      marginTop: Space.sm,
    },
    activeHoursSummary: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      marginTop: Space.sm,
    },
    activeHoursRow: {
      marginTop: Space.sm,
      flexDirection: 'row',
      gap: Space.sm,
    },
    activeHoursPicker: {
      flex: 1,
      marginTop: 0,
    },
    gatewaySettingsErrorText: {
      color: colors.error,
      fontSize: FontSize.sm,
    },
    fallbackHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    addFallbackButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
      borderRadius: Radius.sm,
      paddingHorizontal: Space.sm,
      paddingVertical: Space.xs,
    },
    addFallbackText: {
      color: colors.primary,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
    emptyFallback: {
      marginTop: Space.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
      borderRadius: Radius.md,
      paddingHorizontal: Space.md,
      paddingVertical: Space.sm,
    },
    emptyFallbackText: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
    },
    fallbackList: {
      marginTop: Space.sm,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.md,
      backgroundColor: colors.surfaceMuted,
      overflow: 'hidden',
    },
    fallbackItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.sm,
      paddingLeft: Space.md,
      paddingRight: Space.xs,
      paddingVertical: Space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    fallbackName: {
      flex: 1,
      color: colors.text,
      fontSize: FontSize.base,
    },
    timePickerModalBody: {
      paddingHorizontal: Space.lg,
      paddingBottom: Space.lg,
      paddingTop: Space.sm,
      gap: Space.md,
    },
    timePickerActions: {
      flexDirection: 'row',
      gap: Space.sm,
    },
    timePickerActionButton: {
      flex: 1,
      marginTop: 0,
    },
    segmentedWrap: {
      flexDirection: 'row',
      backgroundColor: colors.surfaceMuted,
      borderRadius: Radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 2,
    },
    segment: {
      flex: 1,
      paddingVertical: 7,
      alignItems: 'center',
      borderRadius: Radius.sm - 2,
    },
    segmentActive: {
      backgroundColor: colors.surface,
      ...Shadow.sm,
    },
    segmentText: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
      color: colors.textMuted,
    },
    segmentTextActive: {
      color: colors.primary,
      fontWeight: FontWeight.semibold,
    },
    infoGrid: {
      paddingHorizontal: Space.lg,
      paddingVertical: Space.sm,
    },
    footer: {
      alignItems: 'center',
      marginTop: Space.xxl,
      gap: 2,
    },
    footerText: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.regular,
    },
    footerUpdateLink: {
      borderRadius: Radius.sm,
      alignSelf: 'center',
    },
    footerUpdateLinkPressed: {
      opacity: 0.72,
    },
    footerUpdateText: {
      color: colors.primary,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.regular,
    },
  });
}
