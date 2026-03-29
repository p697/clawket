import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView, { type WebViewNavigation } from 'react-native-webview';
import { AlertTriangle, ExternalLink, Maximize2, Minimize2, X } from 'lucide-react-native';
import ViewShot, { captureRef } from 'react-native-view-shot';
import { IconButton } from '../ui';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';

export type CanvasSheetHandle = {
  navigate: (url: string) => void;
  evalJS: (code: string) => void;
  captureSnapshot: (format?: 'png' | 'jpeg') => Promise<string | null>;
};

type Props = {
  visible: boolean;
  url: string | null;
  title?: string;
  onClose: () => void;
};

export const CanvasSheet = forwardRef<CanvasSheetHandle, Props>(function CanvasSheet(
  { visible, url, title, onClose },
  ref,
) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);

  const webViewRef = useRef<WebView>(null);
  const viewShotRef = useRef<ViewShot>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [currentTitle, setCurrentTitle] = useState<string | undefined>(title);

  // Update title from prop when it changes
  React.useEffect(() => {
    if (title) setCurrentTitle(title);
  }, [title]);

  useImperativeHandle(ref, () => ({
    navigate: (navUrl: string) => {
      webViewRef.current?.injectJavaScript(`window.location.href = ${JSON.stringify(navUrl)}; true;`);
    },
    evalJS: (code: string) => {
      webViewRef.current?.injectJavaScript(`${code}; true;`);
    },
    captureSnapshot: async (format?: 'png' | 'jpeg') => {
      try {
        const uri = await captureRef(viewShotRef, {
          format: format === 'jpeg' ? 'jpg' : 'png',
          quality: 0.9,
          result: 'base64',
        });
        return uri ?? null;
      } catch {
        return null;
      }
    },
  }));

  const handleLoadStart = useCallback(() => {
    setLoading(true);
    setError(null);
  }, []);

  const handleLoadEnd = useCallback(() => {
    setLoading(false);
  }, []);

  const handleError = useCallback(() => {
    setLoading(false);
    setError('Failed to load page');
  }, []);

  const handleNavigationStateChange = useCallback((navState: WebViewNavigation) => {
    if (navState.title && navState.title !== 'about:blank') {
      setCurrentTitle(navState.title);
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    setFullscreen((prev) => !prev);
  }, []);

  const displayTitle = currentTitle || title || 'Canvas';
  const headerPaddingTop = fullscreen ? insets.top : insets.top || Space.md;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[styles.root, fullscreen && styles.rootFullscreen]}>
        <View style={[styles.header, { paddingTop: headerPaddingTop }]}>
          <View style={styles.headerLeft}>
            <IconButton
              icon={<X size={20} color={theme.colors.textMuted} strokeWidth={2} />}
              onPress={onClose}
            />
          </View>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {displayTitle}
            </Text>
          </View>
          <View style={styles.headerRight}>
            <IconButton
              icon={
                fullscreen
                  ? <Minimize2 size={18} color={theme.colors.textMuted} strokeWidth={2} />
                  : <Maximize2 size={18} color={theme.colors.textMuted} strokeWidth={2} />
              }
              onPress={toggleFullscreen}
            />
          </View>
        </View>

        <ViewShot ref={viewShotRef} style={styles.webViewContainer}>
          {url ? (
            <WebView
              ref={webViewRef}
              source={{ uri: url }}
              style={styles.webView}
              onLoadStart={handleLoadStart}
              onLoadEnd={handleLoadEnd}
              onError={handleError}
              onNavigationStateChange={handleNavigationStateChange}
              javaScriptEnabled
              domStorageEnabled
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              startInLoadingState={false}
            />
          ) : (
            <View style={styles.emptyState}>
              <ExternalLink size={32} color={theme.colors.textSubtle} strokeWidth={1.5} />
              <Text style={styles.emptyText}>No URL provided</Text>
            </View>
          )}

          {loading && url && (
            <View style={styles.loadingOverlay} pointerEvents="none">
              <ActivityIndicator size="large" color={theme.colors.primary} />
            </View>
          )}

          {error && (
            <View style={styles.errorOverlay}>
              <AlertTriangle size={28} color={theme.colors.error} strokeWidth={2} />
              <Text style={styles.errorText}>{error}</Text>
              <Pressable
                style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
                onPress={() => {
                  setError(null);
                  setLoading(true);
                  webViewRef.current?.reload();
                }}
              >
                <Text style={styles.retryButtonText}>Retry</Text>
              </Pressable>
            </View>
          )}
        </ViewShot>

        {!fullscreen && <View style={{ height: insets.bottom }} />}
      </View>
    </Modal>
  );
});

type Colors = ReturnType<typeof useAppTheme>['theme']['colors'];

function createStyles(colors: Colors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    rootFullscreen: {
      // No padding changes needed — just removes bottom safe area
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: Space.xs,
      paddingBottom: Space.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    headerLeft: {
      width: 44,
      alignItems: 'flex-start',
    },
    headerCenter: {
      flex: 1,
      alignItems: 'center',
    },
    headerTitle: {
      color: colors.text,
      fontSize: FontSize.lg,
      fontWeight: FontWeight.semibold,
    },
    headerRight: {
      width: 44,
      alignItems: 'flex-end',
    },
    webViewContainer: {
      flex: 1,
    },
    webView: {
      flex: 1,
      backgroundColor: colors.background,
    },
    loadingOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
    },
    errorOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
      gap: Space.md,
      padding: Space.xl,
    },
    errorText: {
      color: colors.error,
      fontSize: FontSize.base,
      fontWeight: FontWeight.medium,
      textAlign: 'center',
    },
    retryButton: {
      paddingHorizontal: Space.lg,
      paddingVertical: Space.sm,
      borderRadius: Radius.md,
      backgroundColor: colors.primary,
      marginTop: Space.sm,
    },
    retryButtonPressed: {
      opacity: 0.88,
    },
    retryButtonText: {
      color: colors.primaryText,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    emptyState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Space.md,
    },
    emptyText: {
      color: colors.textSubtle,
      fontSize: FontSize.base,
    },
  });
}
