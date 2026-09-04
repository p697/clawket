import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Application from 'expo-application';
import * as Haptics from 'expo-haptics';
import * as StoreReview from 'expo-store-review';
import { MenuAction, MenuView } from '@react-native-menu/menu';
import {
  ActivityIndicator,
  ActionSheetIOS,
  Alert,
  Image,
  Linking,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { ScrollView } from 'react-native-gesture-handler';
import { EdgeInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppWindow, ChevronLeft, ChevronRight, Cloud, Eye, Gamepad2, Github, HelpCircle, Mic, Palette, Share2, ShieldCheck, Link2, Mail, MessageCircleMore, Minus, Plus, Sparkles, Star } from 'lucide-react-native';
import { ConnectionHelpManual } from '../../components/config/ConnectionHelpSection';
import { QuickConnectionPanel } from '../../components/config/QuickConnectionPanel';
import { PairingCodeCard } from '../../components/config/PairingCodeCard';
import { SwipeableGatewayRow, SwipeableMethods } from '../../components/config/SwipeableGatewayRow';
import { YouMindSignInPanel } from '../../components/youmind/YouMindSignInPanel';
import { Button, FormTextInput, IconButton, ModalSheet, SegmentedTabs, SettingsDivider, SettingsGroup, SettingsIcon, SettingsRow, ThemedSwitch } from '../../components/ui';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import { analyticsEvents } from '../../services/analytics/events';
import { getPostHogDiagnostics, type PostHogDiagnostics } from '../../services/analytics/posthog';
import {
  collectRevenueCatDiagnostics,
  getRevenueCatRuntimeDiagnostics,
  shouldShowLifetimeUpgradeAnnouncementForSnapshot,
  type RevenueCatDiagnostics,
} from '../../services/pro-subscription';
import { StorageService } from '../../services/storage';
import { YouMindSpriteApiClient } from '../../connection/adapters/youmind-sprite-api';
import { AppTheme, builtInAccents, BuiltInAccentColorId } from '../../theme';
import { BorderWidth, FontSize, FontWeight, LineHeight, Radius, Space, createSurfaceStyle } from '../../theme/tokens';
import { GatewayBackendKind, GatewayMode, GatewayTransportKind, SpeechRecognitionLanguage, ThemeMode } from '../../types';
import { shouldShowWecomSupportEntry } from '../../utils/mainlandChina';
import { openExternalUrl } from '../../utils/openExternalUrl';
import { isMacCatalyst } from '../../utils/platform';
import { APP_PACKAGE_VERSION } from '../../constants/app-version';
import { CLAWKET_GITHUB_REPO_URL } from '../../config/app-links';
import { buildSupportEmailUrl, publicAppLinks } from '../../config/public';
import { AppIconVariant, getCurrentAppIconAsync, isAppIconChangeSupportedAsync, setCurrentAppIconAsync } from '../../services/app-icon';
import { getGatewayBackendCapabilities, getGatewayModeLabel, resolveGatewayBackendKind } from '@clawket/agent-protocol';
import { saveBundledImageToPhotoLibrary } from '../../services/photo-library';
import { getOfficialRelayRegistryUrl, getRelayPairCommand, resolveOfficialRelayEnvironment } from '../../services/relay-environment';
import { useConfigScreenController } from './hooks/useConfigScreenController';
import type { ConfigStackParamList } from './ConfigTab';

type Colors = AppTheme['colors'];

type Props = {
  insets: EdgeInsets;
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

function getBackendLabels(t: (key: string) => string): Record<GatewayBackendKind, string> {
  return {
    openclaw: t('OpenClaw'),
    hermes: t('Hermes'),
    youmind: t('YouMind'),
  };
}

function getUrlPlaceholder(input: {
  backendKind: GatewayBackendKind;
  transportKind: GatewayTransportKind;
}): string {
  if (input.backendKind === 'youmind') {
    return 'https://youmind.com';
  }
  if (input.backendKind === 'hermes') {
    switch (input.transportKind) {
      case 'local':
        return 'ws://192.168.x.x:4319/v1/hermes/ws?token=...';
      case 'tailscale':
        return 'ws://100.x.x.x:4319/v1/hermes/ws?token=...';
      case 'cloudflare':
        return 'wss://xxx.trycloudflare.com/v1/hermes/ws?token=...';
      case 'custom':
      default:
        return 'wss://gateway.example.com/v1/hermes/ws?token=...';
    }
  }
  switch (input.transportKind) {
    case 'relay':
      return 'wss://relay.example.com/ws';
    case 'local':
      return 'ws://192.168.1.x:18789';
    case 'tailscale':
      return 'ws://100.x.x.x:18789';
    case 'cloudflare':
      return 'wss://xxx.trycloudflare.com';
    case 'custom':
    default:
      return 'wss://gateway.example.com or ws://192.168.x.x:18789';
  }
}
const CLAWKET_IOS_APP_STORE_URL = 'https://apps.apple.com/app/id6759597015';
const CLAWKET_ANDROID_PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.p697.clawket';
const APP_ICON_OPTIONS: Array<{ value: AppIconVariant; labelKey: 'Light' | 'Dark'; source: number }> = [
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  { value: 'default', labelKey: 'Light', source: require('../../../assets/icon.png') },
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  { value: 'black', labelKey: 'Dark', source: require('../../../assets/app-icons/black/app-icon-black-1024.png') },
];

// eslint-disable-next-line @typescript-eslint/no-require-imports
const WECHAT_QR_IMAGE = require('../../../assets/wechat-group-qr.jpg');
export function ConfigScreenLayout({ insets, controller }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation(['config', 'common']);
  const {
    debugOverrideEnabled,
    errorCode,
    isPro,
    isConfigured,
    paywallPackages,
    showPaywall,
    showPaywallPreview,
    snapshot,
    refreshSubscription,
  } = useProPaywall();
  const configNavigation = useNavigation<NativeStackNavigationProp<ConfigStackParamList>>();
  const isFocused = useIsFocused();
  const { theme } = controller;
  const styles = useMemo(
    () => createStyles(theme.colors, theme.scheme),
    [theme.colors, theme.scheme],
  );
  const THEME_OPTIONS = useMemo(() => getThemeOptions(t), [t]);
  const SPEECH_RECOGNITION_LANGUAGE_OPTIONS = useMemo(() => getSpeechRecognitionLanguageOptions(t), [t]);
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
  const [appIconModalVisible, setAppIconModalVisible] = useState(false);
  const [lifetimeUpgradeAnnouncementVisible, setLifetimeUpgradeAnnouncementVisible] = useState(false);
  const [lifetimeUpgradeAnnouncementHandled, setLifetimeUpgradeAnnouncementHandled] = useState(false);
  const [appIconSupported, setAppIconSupported] = useState(false);
  const [appIconLoading, setAppIconLoading] = useState(true);
  const [appIconPending, setAppIconPending] = useState(false);
  const [currentAppIcon, setCurrentAppIcon] = useState<AppIconVariant>('default');
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
  const activeBackendCapabilities = useMemo(
    () => getGatewayBackendCapabilities(controller.activeConfig ?? undefined),
    [controller.activeConfig],
  );

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

  useFocusEffect(
    useCallback(() => {
      if (debugOverrideEnabled) return undefined;
      void refreshSubscription().catch(() => {});
      return undefined;
    }, [debugOverrideEnabled, refreshSubscription]),
  );

  useEffect(() => {
    if (isFocused) return;
    setLifetimeUpgradeAnnouncementVisible(false);
  }, [isFocused]);

  useEffect(() => {
    if (debugOverrideEnabled) return;
    if (!isFocused || lifetimeUpgradeAnnouncementHandled || lifetimeUpgradeAnnouncementVisible) return;
    if (!shouldShowLifetimeUpgradeAnnouncementForSnapshot(snapshot)) return;

    let cancelled = false;

    const maybeShowLifetimeUpgradeAnnouncement = async () => {
      const shown = await StorageService.hasLifetimeUpgradeAnnouncementBeenShown();
      if (cancelled) return;
      if (shown) {
        setLifetimeUpgradeAnnouncementHandled(true);
        return;
      }
      analyticsEvents.lifetimeUpgradeAnnouncementShown({ source: 'config_tab' });
      setLifetimeUpgradeAnnouncementVisible(true);
    };

    void maybeShowLifetimeUpgradeAnnouncement();

    return () => {
      cancelled = true;
    };
  }, [
    debugOverrideEnabled,
    isFocused,
    lifetimeUpgradeAnnouncementHandled,
    lifetimeUpgradeAnnouncementVisible,
    snapshot,
  ]);

  const handleLifetimeUpgradeAnnouncementClose = useCallback(() => {
    setLifetimeUpgradeAnnouncementVisible(false);
    setLifetimeUpgradeAnnouncementHandled(true);
    analyticsEvents.lifetimeUpgradeAnnouncementDismissed({ source: 'config_tab' });
    void StorageService.markLifetimeUpgradeAnnouncementShown();
  }, []);

  const handleClearLifetimeUpgradeAnnouncementCache = useCallback(() => {
    Alert.alert(
      t('Clear Cache'),
      t('This will clear the lifetime upgrade announcement cache so the popup can be shown again. Continue?'),
      [
        { text: t('Cancel', { ns: 'common' }), style: 'cancel' },
        {
          text: t('Clear Cache'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await StorageService.clearLifetimeUpgradeAnnouncementShown();
              setLifetimeUpgradeAnnouncementHandled(false);
              setLifetimeUpgradeAnnouncementVisible(false);
              Alert.alert(t('Done', { ns: 'common' }), t('Lifetime upgrade announcement cache cleared.'));
            })();
          },
        },
      ],
    );
  }, [t]);

  useEffect(() => {
    let cancelled = false;

    const loadAppIconState = async () => {
      try {
        const supported = await isAppIconChangeSupportedAsync();
        if (cancelled) return;
        setAppIconSupported(supported);
        if (!supported) {
          return;
        }

        const currentIcon = await getCurrentAppIconAsync();
        if (cancelled) return;
        setCurrentAppIcon(currentIcon);
      } catch {
        if (cancelled) return;
        setAppIconSupported(false);
      } finally {
        if (!cancelled) {
          setAppIconLoading(false);
        }
      }
    };

    void loadAppIconState();

    return () => {
      cancelled = true;
    };
  }, []);

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
      const result = await saveBundledImageToPhotoLibrary(WECHAT_QR_IMAGE, 'wechat-group-qr');
      if (result === 'permission_denied') {
        Alert.alert(
          t('Unable to save QR code'),
          t('Please allow photo library access and try again.'),
        );
        return;
      }
      Alert.alert(
        t('Saved'),
        t('QR code saved to your photo library.'),
      );
    } catch (error) {
      console.warn('[WeComQr] Failed to save QR code:', error);
      Alert.alert(
        t('Unable to save QR code'),
        t('Please try again later.'),
      );
    }
  }, [t]);

  const handleReleaseNotesEntryPress = useCallback(() => {
    configNavigation.navigate('ReleaseNotesHistory');
  }, [configNavigation]);

  const handleAppIconEntryPress = useCallback(() => {
    if (!appIconSupported) {
      return;
    }
    if (!isPro) {
      showPaywall('appIcons');
      return;
    }
    setAppIconModalVisible(true);
  }, [appIconSupported, isPro, showPaywall]);

  const handleAppIconSelect = useCallback(async (nextIcon: AppIconVariant) => {
    if (appIconPending) {
      return;
    }
    if (nextIcon === currentAppIcon) {
      setAppIconModalVisible(false);
      return;
    }

    setAppIconPending(true);
    try {
      await setCurrentAppIconAsync(nextIcon);
      setCurrentAppIcon(nextIcon);
      analyticsEvents.appIconChanged({
        selected_icon_id: nextIcon,
        source: 'config_screen',
      });
      void Haptics.selectionAsync();
      setAppIconModalVisible(false);
    } catch {
      Alert.alert(t('Unable to change app icon'), t('Please try again later.', { ns: 'common' }));
    } finally {
      setAppIconPending(false);
    }
  }, [appIconPending, currentAppIcon, t]);

  const handleOpenExternalUrl = useCallback(async (url: string) => {
    await openExternalUrl(url, () => {
      Alert.alert(t('Unable to open link', { ns: 'common' }), t('Please try again later.'));
    });
  }, [t]);

  const renderGatewayIcon = useCallback((mode: GatewayMode) => {
    const color = theme.colors.textMuted;
    if (mode === 'relay') return <Link2 size={16} color={color} strokeWidth={2} />;
    if (mode === 'hermes') return <Link2 size={16} color={color} strokeWidth={2} />;
    return <Cloud size={16} color={color} strokeWidth={2} />;
  }, [theme.colors.textMuted]);

  return (
    <>
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + Space.lg, paddingBottom: Space.xxxl },
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

        <Text style={styles.sectionHeader}>{t('CONNECTIONS')}</Text>

        <SettingsGroup>
          {sortedConfigs.length === 0 ? (
            <View style={styles.emptyGatewayWrap}>
              <Text style={styles.emptyGatewayTitle}>{t('No Connection Configured')}</Text>
              <Button
                label={t('Add Connection')}
                icon={Plus}
                onPress={() => {
                  controller.openCreateEditor();
                }}
              />
            </View>
          ) : (
            sortedConfigs.map((item, index) => {
              const active = item.id === controller.activeConfigId;
              const isPreviewRelay = resolveOfficialRelayEnvironment(item.relay?.serverUrl) === 'preview';
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
                            {getGatewayModeLabel(item)} · {item.url}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.gatewayRight}>
                        {isPreviewRelay ? (
                          <View style={styles.previewChip}>
                            <Text style={styles.previewChipText}>{t('Preview')}</Text>
                          </View>
                        ) : null}
                        {active ? (
                          <View style={styles.activeChip}>
                            <Text style={styles.activeChipText}>{t('common:Active')}</Text>
                          </View>
                        ) : null}
                        <ChevronLeft size={16} color={theme.colors.textSubtle} strokeWidth={2} />
                      </View>
                    </Pressable>
                  </SwipeableGatewayRow>
                  {index < sortedConfigs.length - 1 ? <SettingsDivider inset="content" /> : null}
                </React.Fragment>
              );
            })
          )}
        </SettingsGroup>

        {sortedConfigs.length > 0 && <View style={styles.createRow}>
          <Button
            label={t('Add Connection')}
            icon={Plus}
            onPress={() => {
              controller.openCreateEditor();
            }}
            style={styles.createButtonFlex}
          />
        </View>}

        {activeBackendCapabilities.openClawConfigScreens ? (
          <>
            <Text style={styles.sectionHeader}>{t('OPENCLAW CONFIG')}</Text>

            <SettingsGroup>
              <SettingsRow
                onPress={() => configNavigation.navigate('OpenClawConfig')}
                style={styles.feedbackRow}
              >
                <SettingsIcon icon={Eye} tone="info" />
                <View style={styles.supportRowText}>
                  <Text style={styles.rowLabel}>{t('OPENCLAW CONFIG')}</Text>
                </View>
                <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
              </SettingsRow>
            </SettingsGroup>
          </>
        ) : null}

        <Text style={styles.sectionHeader}>{t('APPEARANCE')}</Text>

        <SettingsGroup>
          <SettingsRow style={styles.selectRow}>
            <View style={styles.settingRowLead}>
              <SettingsIcon icon={Palette} tone="accent" />
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
          </SettingsRow>

          <SettingsDivider inset="content" />

          <SettingsRow
            onPress={() => configNavigation.navigate('ChatAppearance')}
            style={styles.feedbackRow}
          >
            <SettingsIcon icon={Sparkles} tone="warning" />
            <View style={styles.supportRowText}>
              <Text style={styles.rowLabel}>{t('Chat Appearance')}</Text>
            </View>
            <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
          </SettingsRow>

          {appIconSupported ? <SettingsDivider inset="content" /> : null}

          {appIconSupported ? (
            <>
              <SettingsRow
                onPress={() => {
                  handleAppIconEntryPress();
                }}
                style={styles.feedbackRow}
              >
                <SettingsIcon icon={AppWindow} tone="accent" />
                <View style={styles.supportRowText}>
                  <Text style={styles.rowLabel}>{t('App Icon')}</Text>
                </View>
                <View style={styles.rowTrailing}>
                  {appIconLoading ? (
                    <ActivityIndicator size="small" color={theme.colors.primary} />
                  ) : (
                    <Text style={styles.rowValue}>{t(currentAppIcon === 'black' ? 'Dark' : 'Light')}</Text>
                  )}
                  <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
                </View>
              </SettingsRow>

              <SettingsDivider inset="content" />
            </>
          ) : null}

          <SettingsRow layout="column">
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
          </SettingsRow>
        </SettingsGroup>

        <Text style={styles.sectionHeader}>{t('VOICE INPUT')}</Text>

        <SettingsGroup>
          <SettingsRow style={styles.selectRow}>
            <View style={styles.settingRowLead}>
              <SettingsIcon icon={Mic} tone="warning" />
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
          </SettingsRow>
        </SettingsGroup>

        <Text style={styles.sectionHeader}>{t('COMMUNITY')}</Text>
        <SettingsGroup>
          <SettingsRow
            onPress={() => {
              void handleShareAppPress();
            }}
            style={styles.feedbackRow}
          >
            <SettingsIcon icon={Share2} tone="info" />
            <View style={styles.supportRowText}>
              <Text style={styles.rowLabel}>{t('Share Clawket with Friends')}</Text>
            </View>
            <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
          </SettingsRow>

          {(Platform.OS === 'ios' || publicAppLinks.discordInviteUrl || showWecomSupportEntry) ? (
            <SettingsDivider inset="content" />
          ) : null}

          {Platform.OS === 'ios' ? (
            <>
              <SettingsRow
                onPress={() => {
                  void handleRateAppPress();
                }}
                style={styles.feedbackRow}
              >
                <SettingsIcon icon={Star} tone="warning" strokeWidth={2.1} />
                <View style={styles.supportRowText}>
                  <Text style={styles.rowLabel}>{t('Rate Clawket')}</Text>
                </View>
                <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
              </SettingsRow>

              <SettingsDivider inset="content" />
            </>
          ) : null}

          {publicAppLinks.discordInviteUrl ? (
            <SettingsRow
              onPress={() => {
                void handleOpenExternalUrl(publicAppLinks.discordInviteUrl as string);
              }}
              style={styles.feedbackRow}
            >
              <SettingsIcon icon={Gamepad2} tone="info" />
              <View style={styles.supportRowText}>
                <Text style={styles.rowLabel}>{t('Join Discord')}</Text>
              </View>
              <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
            </SettingsRow>
          ) : null}

          {showWecomSupportEntry ? (
            <>
              {publicAppLinks.discordInviteUrl ? <SettingsDivider inset="content" /> : null}

              <SettingsRow
                onPress={() => setWecomModalVisible(true)}
                style={styles.feedbackRow}
              >
                <SettingsIcon icon={MessageCircleMore} tone="success" />
                <View style={styles.supportRowText}>
                  <Text style={styles.rowLabel}>{t('Join WeCom Group')}</Text>
                </View>
              </SettingsRow>
            </>
          ) : null}
        </SettingsGroup>

        <Text style={styles.sectionHeader}>{t('OPEN SOURCE')}</Text>
        <SettingsGroup>
          <SettingsRow
            onPress={() => {
              void handleOpenExternalUrl(CLAWKET_GITHUB_REPO_URL);
            }}
            style={styles.feedbackRow}
          >
            <SettingsIcon icon={Github} tone="neutral" fill />
            <View style={styles.supportRowText}>
              <Text style={styles.rowLabel}>{t('View GitHub Repository')}</Text>
            </View>
            <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
          </SettingsRow>
        </SettingsGroup>

        <Text style={styles.sectionHeader}>{t('HELP')}</Text>
        <SettingsGroup>
          <SettingsRow
            onPress={() => configNavigation.navigate('HelpCenter')}
            style={styles.feedbackRow}
          >
            <SettingsIcon icon={HelpCircle} tone="info" />
            <View style={styles.supportRowText}>
              <Text style={styles.rowLabel}>{t('Help Center')}</Text>
            </View>
            <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
          </SettingsRow>

          <SettingsDivider inset="content" />

          <SettingsRow
            onPress={handleReleaseNotesEntryPress}
            style={styles.feedbackRow}
          >
            <SettingsIcon icon={Sparkles} tone="accent" />
            <View style={styles.supportRowText}>
              <Text style={styles.rowLabel}>{t('Release Notes')}</Text>
            </View>
          </SettingsRow>

          {supportEmailUrl || publicAppLinks.privacyPolicyUrl || publicAppLinks.termsOfUseUrl ? <SettingsDivider inset="content" /> : null}

          {supportEmailUrl ? (
            <SettingsRow
              onPress={() => {
                void handleOpenExternalUrl(supportEmailUrl);
              }}
              style={styles.feedbackRow}
            >
              <SettingsIcon icon={Mail} tone="danger" />
              <View style={styles.supportRowText}>
                <Text style={styles.rowLabel}>{t('Send Feedback')}</Text>
              </View>
            </SettingsRow>
          ) : null}

          {supportEmailUrl && (publicAppLinks.privacyPolicyUrl || publicAppLinks.termsOfUseUrl) ? <SettingsDivider inset="content" /> : null}

          {publicAppLinks.privacyPolicyUrl ? (
            <SettingsRow
              onPress={() => {
                void handleOpenExternalUrl(publicAppLinks.privacyPolicyUrl as string);
              }}
              style={styles.feedbackRow}
            >
              <SettingsIcon icon={ShieldCheck} tone="info" />
              <View style={styles.supportRowText}>
                <Text style={styles.rowLabel}>{t('Privacy Policy', { ns: 'common' })}</Text>
              </View>
              <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
            </SettingsRow>
          ) : null}

          {publicAppLinks.privacyPolicyUrl && publicAppLinks.termsOfUseUrl ? <SettingsDivider inset="content" /> : null}

          {publicAppLinks.termsOfUseUrl ? (
            <SettingsRow
              onPress={() => {
                void handleOpenExternalUrl(publicAppLinks.termsOfUseUrl as string);
              }}
              style={styles.feedbackRow}
            >
              <SettingsIcon icon={Link2} tone="accent" strokeWidth={2.25} />
              <View style={styles.supportRowText}>
                <Text style={styles.rowLabel}>{t('Terms of Use', { ns: 'common' })}</Text>
              </View>
              <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
            </SettingsRow>
          ) : null}
        </SettingsGroup>

        <Text style={styles.sectionHeader}>{t('DEVELOPER')}</Text>

        <SettingsGroup>
          <SettingsRow style={styles.toggleRow}>
            <View style={styles.toggleLabels}>
              <Text style={styles.rowLabel}>{t('Debug Mode')}</Text>
            </View>
            <ThemedSwitch
              value={controller.debugMode}
              onValueChange={controller.onDebugToggle}
            />
          </SettingsRow>

          {controller.debugMode ? (
            <>
              <SettingsDivider inset="content" />

              <SettingsRow
                onPress={() => configNavigation.navigate('DesignSystem')}
                style={styles.feedbackRow}
              >
                <View style={styles.supportRowText}>
                  <Text style={styles.rowLabel}>{t('Design System')}</Text>
                  <Text style={styles.rowMeta}>{t('Review shared components, themes, and interaction states.')}</Text>
                </View>
                <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
              </SettingsRow>

              <SettingsDivider inset="content" />

              <SettingsRow
                onPress={handleClearLifetimeUpgradeAnnouncementCache}
                style={styles.feedbackRow}
              >
                <View style={styles.supportRowText}>
                  <Text style={styles.rowLabel}>{t('Clear Cache')}</Text>
                  <Text style={styles.rowMeta}>{t('Clear the one-time lifetime upgrade popup cache.')}</Text>
                </View>
              </SettingsRow>
            </>
          ) : null}
        </SettingsGroup>

        {controller.debugMode ? (
          <SettingsGroup style={styles.deviceCard}>
            <SettingsRow layout="column">
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
                  Snapshot product: {revenueCatDiagnostics?.snapshotProductIdentifier ?? 'missing'}
                </Text>
                <Text style={styles.deviceId}>
                  Snapshot plan: {revenueCatDiagnostics?.snapshotProductPlanIdentifier ?? 'missing'}
                </Text>
                <Text style={styles.deviceId}>
                  Active subscriptions: {revenueCatDiagnostics?.activeSubscriptionProductIdentifiers?.join(', ') || 'none'}
                </Text>
                <Text style={styles.deviceId}>
                  Purchased products: {revenueCatDiagnostics?.purchasedProductIdentifiers?.join(', ') || 'none'}
                </Text>
                <Text style={styles.deviceId}>
                  Non-subscription purchases: {revenueCatDiagnostics?.nonSubscriptionProductIdentifiers?.join(', ') || 'none'}
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
              <Button
                label={diagnosticsLoading ? 'Refreshing…' : 'Refresh diagnostics'}
                variant="secondary"
                size="sm"
                loading={diagnosticsLoading}
                onPress={() => {
                  void refreshDiagnostics();
                }}
                style={styles.debugRefreshButton}
              />
            </SettingsRow>
          </SettingsGroup>
        ) : null}

        <Button
          label={t('Reset Device')}
          variant="destructive"
          onPress={controller.resetDevice}
          style={styles.destructiveButton}
        />
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
        visible={lifetimeUpgradeAnnouncementVisible}
        onClose={handleLifetimeUpgradeAnnouncementClose}
        title={t("You're Lifetime Pro Now")}
        maxHeight={300}
      >
        <View style={styles.lifetimeUpgradeAnnouncementBody}>
          <Text style={styles.lifetimeUpgradeAnnouncementText}>
            {t('Thanks for supporting Clawket. To thank our early supporters, everyone who purchased an annual membership before April 18 has been automatically upgraded to lifetime membership.')}
          </Text>
          <Button
            label={t('Got it')}
            onPress={handleLifetimeUpgradeAnnouncementClose}
          />
        </View>
      </ModalSheet>

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
          <Button
            label={t('Download QR Code')}
            onPress={() => {
              void handleDownloadWecomQr();
            }}
          />
        </View>
      </ModalSheet>

      <ModalSheet
        visible={appIconModalVisible}
        onClose={() => {
          if (appIconPending) return;
          setAppIconModalVisible(false);
        }}
        title={t('App Icon')}
      >
        <View style={styles.appIconModalBody}>
          {APP_ICON_OPTIONS.map((option) => {
            const active = currentAppIcon === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => {
                  void handleAppIconSelect(option.value);
                }}
                disabled={appIconPending}
                style={({ pressed }) => [
                  styles.appIconCard,
                  active && styles.appIconCardActive,
                  pressed && !appIconPending && styles.appIconCardPressed,
                ]}
              >
                <Image source={option.source} style={styles.appIconPreview} resizeMode="cover" />
                <View style={styles.appIconTextWrap}>
                  <Text style={styles.appIconTitle}>{t(option.labelKey)}</Text>
                </View>
                {appIconPending && active ? (
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                ) : (
                  <View style={[styles.appIconSelectionDot, active && styles.appIconSelectionDotActive]} />
                )}
              </Pressable>
            );
          })}
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

function buildYouMindConnectionDisplayName(user: { email?: string | null; name?: string | null } | null | undefined): string {
  const email = user?.email?.trim();
  if (email) return `YouMind (${email})`;
  const name = user?.name?.trim();
  if (name) return `YouMind (${name})`;
  return 'YouMind';
}

function EditorModal({ controller, theme, styles }: EditorModalProps): React.JSX.Element {
  const { t } = useTranslation(['config', 'chat', 'common']);
  const isEditing = !!controller.editingConfigId;
  const isLockedRelayEditor = isEditing && controller.isRelayEditorLocked;
  const [editorTab, setEditorTab] = useState<EditorTab>(isEditing ? 'manual' : 'quick');
  const [quickPage, setQuickPage] = useState<'quick' | 'localQuickConnect' | 'youmindSignIn'>('quick');
  const [draftYouMindConfigId, setDraftYouMindConfigId] = useState<string | null>(null);
  const EDITOR_TABS = useMemo<{ key: EditorTab; label: string }[]>(() => [
    { key: 'quick', label: t('Quick Connect') },
    { key: 'manual', label: t('Custom Connect') },
  ], [t]);
  const AUTH_METHOD_TABS = useMemo<{ key: AuthMethodTab; label: string }[]>(() => [
    { key: 'token', label: t('Auth Token') },
    { key: 'password', label: t('Password') },
  ], [t]);
  const relayEnvironmentTabs = useMemo(() => [
    { key: 'production' as const, label: t('Production') },
    { key: 'preview' as const, label: t('Preview') },
  ], [t]);
  const BACKEND_LABELS = useMemo(() => getBackendLabels(t), [t]);
  const manualBackendOptions = useMemo(
    () => ((isEditing && controller.editorBackendKind === 'youmind')
      ? (['youmind'] as const)
      : (['openclaw', 'hermes'] as const)),
    [controller.editorBackendKind, isEditing],
  );
  const authInputLabel = controller.editorAuthMethod === 'token' ? t('Auth Token') : t('Password');
  const authInputPlaceholder = controller.editorAuthMethod === 'token'
    ? (isEditing ? t('Paste token here') : t('Paste connection auth token here'))
    : t('Paste connection auth password here');
  const authInputValue = controller.editorAuthMethod === 'token'
    ? controller.editorToken
    : controller.editorPassword;
  const activeYouMindScopeKey = draftYouMindConfigId;
  const activeYouMindClient = useMemo(
    () => activeYouMindScopeKey
      ? new YouMindSpriteApiClient('https://youmind.com', activeYouMindScopeKey)
      : null,
    [activeYouMindScopeKey],
  );

  const resetYouMindAuthFlow = useCallback(() => {
    setDraftYouMindConfigId(null);
  }, []);

  const closeEditorModal = useCallback((options?: { preserveDraftScope?: boolean }) => {
    const pendingDraftId = options?.preserveDraftScope ? null : draftYouMindConfigId;
    resetYouMindAuthFlow();
    setQuickPage('quick');
    controller.closeEditor();
    if (pendingDraftId && !controller.configs.some((item) => item.id === pendingDraftId)) {
      void StorageService.clearYouMindAuthSession('https://youmind.com', pendingDraftId);
      void StorageService.setYouMindLastOpenedBoardId('https://youmind.com', null, pendingDraftId);
    }
  }, [controller, draftYouMindConfigId, resetYouMindAuthFlow]);

  const beginYouMindSignIn = useCallback(() => {
    setDraftYouMindConfigId(`gateway_${Date.now()}`);
    setQuickPage('youmindSignIn');
  }, []);

  // Reset to Quick Connect tab when modal opens for a new connection
  const prevVisibleRef = useRef(controller.editorVisible);
    if (controller.editorVisible && !prevVisibleRef.current) {
      // Modal just opened — pick initial tab
      if (!isEditing && editorTab !== controller.editorPreferredTab) setEditorTab(controller.editorPreferredTab);
      if (isEditing && editorTab !== 'manual') setEditorTab('manual');
      if (!isEditing && controller.editorPreferredTab === 'quick') {
        resetYouMindAuthFlow();
        if (controller.editorQuickStart === 'youmind') {
          beginYouMindSignIn();
        } else if (controller.editorQuickStart === 'local') {
          setQuickPage('localQuickConnect');
        } else {
          setQuickPage('quick');
        }
      }
    }
  prevVisibleRef.current = controller.editorVisible;

  const finishYouMindSignIn = useCallback(async (user?: { email?: string | null; name?: string | null } | null) => {
    const resolvedName = buildYouMindConnectionDisplayName(user);
    if (draftYouMindConfigId) {
      await controller.createYouMindConfig({
        id: draftYouMindConfigId,
        name: resolvedName,
        activate: true,
        url: 'https://youmind.com',
      });
    }
    closeEditorModal({ preserveDraftScope: true });
  }, [closeEditorModal, controller, draftYouMindConfigId]);

  return (
    <ModalSheet
      visible={controller.editorVisible}
      onClose={closeEditorModal}
      title={isEditing
        ? t('Edit Connection')
        : quickPage === 'localQuickConnect'
            ? t('Quick Connect')
        : quickPage === 'youmindSignIn'
            ? t('Sign in to YouMind')
            : t('Add Connection')}
    >
      {!isEditing && quickPage === 'quick' && (
        <SegmentedTabs tabs={EDITOR_TABS} active={editorTab} onSwitch={setEditorTab} />
      )}

      {editorTab === 'quick' && !isEditing ? (
        quickPage === 'youmindSignIn' ? (
          <ScrollView contentContainerStyle={styles.modalBody}>
            {activeYouMindClient ? (
              <YouMindSignInPanel
                client={activeYouMindClient}
                source="modal"
                backButtonVariant="configInline"
                onBack={() => {
                  resetYouMindAuthFlow();
                  setQuickPage('quick');
                }}
                onSignedIn={async (session) => {
                  await finishYouMindSignIn(session.user);
                }}
              />
            ) : null}
          </ScrollView>
        ) : quickPage === 'localQuickConnect' ? (
          <ScrollView contentContainerStyle={styles.modalBody}>
            <Pressable
              onPress={() => {
                setQuickPage('quick');
              }}
              style={({ pressed }) => [styles.inlineBackButton, pressed && styles.inlineBackButtonPressed]}
            >
              <Text style={styles.inlineBackButtonText}>{t('Back', { ns: 'chat' })}</Text>
            </Pressable>

            {controller.debugMode ? (
              <View style={styles.environmentSection}>
                <Text style={styles.inputLabel}>{t('Server Environment')}</Text>
                <SegmentedTabs
                  tabs={relayEnvironmentTabs}
                  active={controller.relayEnvironment}
                  onSwitch={controller.setRelayEnvironment}
                  containerStyle={styles.authMethodTabs}
                />
                {controller.effectiveRelayEnvironment === 'preview' ? (
                  <View style={styles.previewEnvironmentNotice}>
                    <Text style={styles.previewEnvironmentNoticeText}>
                      {t('Preview uses isolated pre-release infrastructure and may be unstable. Do not rely on it for production work.')}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            <PairingCodeCard
              serverUrl={getOfficialRelayRegistryUrl(controller.effectiveRelayEnvironment)}
              pairCommand={getRelayPairCommand(controller.effectiveRelayEnvironment)}
              onScanQr={isMacCatalyst ? undefined : () => {
                analyticsEvents.gatewayScanQrTapped({ source: 'config_quick_connect' });
                controller.onScanQR();
              }}
              onUploadQr={controller.onUploadQR}
              onConnected={closeEditorModal}
            />
          </ScrollView>
        ) : (
        <ScrollView contentContainerStyle={styles.modalBody}>
          <QuickConnectionPanel
            onSelectTarget={(target) => {
              if (target === 'local') {
                setQuickPage('localQuickConnect');
                return;
              }
              beginYouMindSignIn();
            }}
          />
        </ScrollView>
        )
      ) : (
        <ScrollView contentContainerStyle={styles.modalBody}>
          {!isLockedRelayEditor && (
            <View style={styles.fieldWrap}>
              <Text style={styles.inputLabel}>{t('Backend')}</Text>
              <View style={styles.segmentedWrap}>
                {manualBackendOptions.map((backendKind) => (
                  <Pressable
                    key={backendKind}
                    style={[styles.segment, controller.editorBackendKind === backendKind && styles.segmentActive]}
                    onPress={() => controller.setEditorBackendKind(backendKind)}
                  >
                    <Text style={[styles.segmentText, controller.editorBackendKind === backendKind && styles.segmentTextActive]}>
                      {BACKEND_LABELS[backendKind]}
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
                <FormTextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={getUrlPlaceholder({
                    backendKind: controller.editorBackendKind,
                    transportKind: 'custom',
                  })}
                  surface="sunken"
                  value={controller.editorUrl}
                  onChangeText={controller.setEditorUrl}
                />
              </View>

              {controller.editorBackendKind === 'youmind' ? (
                <View style={styles.fieldWrap}>
                  <Text style={styles.inputHelp}>{t('YouMind sign-in happens inside Chat after you save this connection.')}</Text>
                </View>
              ) : null}

              {controller.editorRequiresDirectAuth ? (
                <>
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
                    <FormTextInput
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder={authInputPlaceholder}
                      surface="sunken"
                      secureTextEntry
                      value={authInputValue}
                      onChangeText={controller.editorAuthMethod === 'token' ? controller.setEditorToken : controller.setEditorPassword}
                    />
                  </View>
                </>
              ) : null}

              {controller.editorTransportKind === 'relay' ? (
                <>
                  <View style={styles.fieldWrap}>
                    <Text style={styles.inputLabel}>{t('Relay Pair Server URL')}</Text>
                    <FormTextInput
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder="https://registry.example.com"
                      surface="sunken"
                      value={controller.editorRelayServerUrl}
                      onChangeText={controller.setEditorRelayServerUrl}
                    />
                  </View>

                  <View style={styles.fieldWrap}>
                    <Text style={styles.inputLabel}>{t('Relay Gateway ID')}</Text>
                    <FormTextInput
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder={t('gateway_xxxxx')}
                      surface="sunken"
                      value={controller.editorRelayGatewayId}
                      onChangeText={controller.setEditorRelayGatewayId}
                    />
                    <Text style={styles.inputHelp}>
                      {t('Relay mode uses a paired Bridge connection. Scan the Bridge QR when possible.')}
                    </Text>
                  </View>
                </>
              ) : null}
            </>
          )}

          <View style={styles.fieldWrap}>
            <Text style={styles.inputLabel}>{t('Connection Name')}</Text>
            <FormTextInput
              autoCapitalize="words"
              autoCorrect={false}
              placeholder={isEditing ? t('Home Gateway') : 'Lucy'}
              surface="sunken"
              value={controller.editorName}
              onChangeText={controller.setEditorName}
            />
          </View>

          <Button
            label={isEditing ? t('Save Changes') : t('Save and Activate')}
            onPress={() => { void controller.saveEditor(); }}
            style={styles.saveButton}
          />

          {!isEditing && controller.editorBackendKind === 'openclaw' ? <ConnectionHelpManual activeMode="custom" /> : null}
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


function createStyles(colors: Colors, scheme: AppTheme['scheme']) {
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
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
    },
    wecomModalHint: {
      fontSize: FontSize.md,
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 19,
    },
    appIconModalBody: {
      gap: Space.md,
      paddingHorizontal: Space.lg,
      paddingTop: Space.sm,
      paddingBottom: Space.lg,
    },
    lifetimeUpgradeAnnouncementBody: {
      gap: Space.lg,
      paddingHorizontal: Space.lg,
      paddingVertical: Space.xl,
    },
    lifetimeUpgradeAnnouncementText: {
      color: colors.text,
      fontSize: FontSize.lg,
      lineHeight: 24,
      textAlign: 'center',
    },
    appIconCard: {
      alignItems: 'center',
      backgroundColor: colors.surfaceElevated,
      borderColor: colors.border,
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: Space.md,
      paddingHorizontal: Space.md,
      paddingVertical: Space.md,
    },
    appIconCardActive: {
      borderColor: colors.primary,
      shadowColor: colors.primary,
      shadowOpacity: 0.12,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
    },
    appIconCardPressed: {
      opacity: 0.88,
    },
    appIconPreview: {
      borderRadius: Radius.lg,
      height: 56,
      width: 56,
    },
    appIconTextWrap: {
      flex: 1,
    },
    appIconTitle: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    appIconSelectionDot: {
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.borderStrong,
      borderRadius: Radius.full,
      borderWidth: StyleSheet.hairlineWidth,
      height: 14,
      width: 14,
    },
    appIconSelectionDotActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
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
      borderWidth: StyleSheet.hairlineWidth,
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
    previewChip: {
      paddingHorizontal: Space.sm,
      paddingVertical: 4,
      borderRadius: Radius.full,
      backgroundColor: colors.warningSoft,
    },
    previewChipText: {
      color: colors.warning,
      fontSize: FontSize.xs,
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
    quickHint: {
      fontSize: FontSize.md,
      color: colors.textMuted,
      lineHeight: 20,
      marginBottom: Space.lg,
    },
    inlineBackButton: {
      alignSelf: 'flex-start',
      marginBottom: Space.xs,
      paddingVertical: Space.xs,
    },
    inlineBackButtonPressed: {
      opacity: 0.72,
    },
    inlineBackButtonText: {
      color: colors.primary,
      fontSize: FontSize.base,
      fontWeight: FontWeight.medium,
    },
    saveButton: {
      marginTop: Space.xs,
    },
    destructiveButton: {
      marginTop: Space.xl,
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
      borderWidth: BorderWidth.strong,
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
      backgroundColor: colors.iconOnColor,
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
    },
    modalBody: {
      paddingHorizontal: Space.lg,
      paddingBottom: Space.xl,
      paddingTop: Space.md,
    },
    environmentSection: {
      marginBottom: Space.md,
    },
    previewEnvironmentNotice: {
      marginTop: Space.sm,
      borderRadius: Radius.md,
      backgroundColor: colors.warningSoft,
      padding: Space.md,
    },
    previewEnvironmentNoticeText: {
      color: colors.text,
      fontSize: FontSize.sm,
      lineHeight: LineHeight.sm,
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
      borderWidth: StyleSheet.hairlineWidth,
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
      borderWidth: StyleSheet.hairlineWidth,
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
      padding: 2,
    },
    segment: {
      flex: 1,
      paddingVertical: 7,
      alignItems: 'center',
      borderRadius: Radius.sm - 2,
    },
    segmentActive: {
      ...createSurfaceStyle(colors, scheme, 'raised'),
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
