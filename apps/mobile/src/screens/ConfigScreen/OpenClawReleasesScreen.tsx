import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import WebView, { type WebViewNavigation } from 'react-native-webview';
import { IconButton } from '../../components/ui';
import { publicAppLinks } from '../../config/public';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Space } from '../../theme/tokens';
import type { ConfigStackParamList } from './ConfigTab';

type OpenClawReleasesNavigation = NativeStackNavigationProp<ConfigStackParamList, 'OpenClawReleases'>;

export function OpenClawReleasesScreen(): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('config');
  const { colors } = theme;
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<OpenClawReleasesNavigation>();
  const webViewRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const styles = useMemo(() => createStyles(colors), [theme]);

  const handleNavigationStateChange = useCallback((navState: WebViewNavigation) => {
    setCanGoBack(navState.canGoBack);
  }, []);

  const handleBackPress = useCallback(() => {
    if (canGoBack) {
      webViewRef.current?.goBack();
    } else {
      navigation.goBack();
    }
  }, [canGoBack, navigation]);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <View style={styles.headerRow}>
          <View style={styles.titleLayer} pointerEvents="none">
            <Text style={styles.title} numberOfLines={1}>{t('OpenClaw Releases')}</Text>
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
          <View style={styles.rightSlot} />
        </View>
      </View>
      {publicAppLinks.openClawReleasesUrl ? (
        <WebView
          ref={webViewRef}
          source={{ uri: publicAppLinks.openClawReleasesUrl }}
          style={styles.webview}
          onNavigationStateChange={handleNavigationStateChange}
        />
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle} numberOfLines={1}>{t('OpenClaw Releases')}</Text>
          <Text style={styles.emptyDescription}>{t('Release links are not configured in this build.')}</Text>
        </View>
      )}
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
    },
    webview: {
      flex: 1,
    },
    emptyState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Space.lg,
      gap: Space.xs,
    },
    emptyTitle: {
      textAlign: 'center',
      fontSize: FontSize.lg,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    emptyDescription: {
      textAlign: 'center',
      fontSize: FontSize.sm,
      color: colors.textMuted,
    },
  });
}
