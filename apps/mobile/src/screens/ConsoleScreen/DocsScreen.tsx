import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import WebView, { type WebViewNavigation } from 'react-native-webview';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../components/ui';
import { useAppContext } from '../../contexts/AppContext';
import { resolveGatewayDocumentationDescriptor } from '../../services/gateway-doc-links';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Space } from '../../theme/tokens';
import type { ConsoleStackParamList } from './ConsoleTab';

type DocsNavigation = NativeStackNavigationProp<ConsoleStackParamList, 'Docs'>;
type DocsRoute = RouteProp<ConsoleStackParamList, 'Docs'>;

export function DocsScreen(): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('console');
  const { config } = useAppContext();
  const { colors } = theme;
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<DocsNavigation>();
  const route = useRoute<DocsRoute>();
  const docsDescriptor = useMemo(() => resolveGatewayDocumentationDescriptor(config), [config]);
  const initialUrl = route.params?.url ?? docsDescriptor.url;
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
            <Text style={styles.title} numberOfLines={1}>{t('Docs')}</Text>
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
      {initialUrl ? (
        <WebView
          ref={webViewRef}
          source={{ uri: initialUrl }}
          style={styles.webview}
          onNavigationStateChange={handleNavigationStateChange}
        />
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>{t('Docs')}</Text>
          <Text style={styles.emptyDescription}>
            {t('Documentation is not configured for this backend in this build.')}
          </Text>
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
      fontSize: FontSize.lg,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    emptyDescription: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
      textAlign: 'center',
    },
  });
}
