import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import WebView, { type WebViewNavigation } from 'react-native-webview';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Download, X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../components/ui';
import { useAppContext } from '../../contexts/AppContext';
import { analyticsEvents } from '../../services/analytics/events';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Space } from '../../theme/tokens';
import type { ConsoleStackParamList } from './ConsoleTab';

const CLAWHUB_URL = 'https://clawhub.ai/skills';

/** Matches skill detail pages like https://clawhub.ai/author/skill-name */
const SKILL_DETAIL_RE = /^https:\/\/clawhub\.ai\/([^/?#]+)\/([^/?#]+)\/?$/;

type ClawHubNavigation = NativeStackNavigationProp<ConsoleStackParamList, 'ClawHub'>;

export function ClawHubScreen(): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('console');
  const { colors } = theme;
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<ClawHubNavigation>();
  const { requestChatWithInput } = useAppContext();
  const webViewRef = useRef<WebView>(null);
  const lastTrackedTemplateRef = useRef<string | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(CLAWHUB_URL);
  const styles = useMemo(() => createStyles(colors), [theme]);

  const skillMatch = SKILL_DETAIL_RE.exec(currentUrl);
  const skillSlug = skillMatch ? skillMatch[2] : null;

  const handleNavigationStateChange = useCallback((navState: WebViewNavigation) => {
    setCanGoBack(navState.canGoBack);
    if (navState.url) {
      setCurrentUrl(navState.url);
      const match = SKILL_DETAIL_RE.exec(navState.url);
      if (match) {
        const templateKey = `${match[1]}/${match[2]}`;
        if (lastTrackedTemplateRef.current !== templateKey) {
          lastTrackedTemplateRef.current = templateKey;
          analyticsEvents.clawHubTemplateTapped({
            author_slug: match[1],
            template_slug: match[2],
            source: 'clawhub_webview',
          });
        }
      }
    }
  }, []);

  const handleBackPress = useCallback(() => {
    if (canGoBack) {
      webViewRef.current?.goBack();
    } else {
      navigation.goBack();
    }
  }, [canGoBack, navigation]);

  const handleInstall = useCallback(() => {
    if (!skillSlug) return;
    analyticsEvents.clawHubInstallTapped({
      skill_slug: skillSlug,
      source: 'clawhub_screen',
    });
    navigation.popToTop();
    setTimeout(() => requestChatWithInput(`Install ClawHub skill: ${skillSlug}`), 50);
  }, [skillSlug, navigation, requestChatWithInput]);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <View style={styles.headerRow}>
          <View style={styles.titleLayer} pointerEvents="none">
            <Text style={styles.title} numberOfLines={1}>{t('ClawHub')}</Text>
          </View>
          <View style={styles.leftSlot}>
            {canGoBack && (
              <IconButton
                icon={<X size={18} color={colors.textMuted} strokeWidth={2} />}
                onPress={() => navigation.goBack()}
              />
            )}
            <IconButton
              icon={<ChevronLeft size={22} color={colors.textMuted} strokeWidth={2} />}
              onPress={handleBackPress}
            />
          </View>
          <View style={styles.spacer} />
          <View style={styles.rightSlot}>
            {skillSlug && (
              <IconButton
                icon={<Download size={20} color={colors.primary} strokeWidth={2} />}
                onPress={handleInstall}
              />
            )}
          </View>
        </View>
      </View>
      <WebView
        ref={webViewRef}
        source={{ uri: CLAWHUB_URL }}
        style={styles.webview}
        onNavigationStateChange={handleNavigationStateChange}
      />
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.surface,
    },
    header: {
      paddingHorizontal: Space.xs,
      paddingBottom: 2,
      borderBottomWidth: 1,
      backgroundColor: colors.surface,
      borderBottomColor: colors.border,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 44,
    },
    titleLayer: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 48,
    },
    leftSlot: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    spacer: {
      flex: 1,
    },
    title: {
      textAlign: 'center',
      fontSize: FontSize.lg,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    rightSlot: {
      minWidth: 44,
      alignItems: 'flex-end',
    },
    webview: {
      flex: 1,
    },
  });
}
