import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import WebView, { type WebViewNavigation } from 'react-native-webview';
import type { ShouldStartLoadRequest, WebViewOpenWindowEvent } from 'react-native-webview/lib/WebViewTypes';
import { usePreventRemove } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react-native';
import type { AgentAdapter, BackendKind } from '@clawket/agent-protocol';
import type { RootStackParamList } from '../../navigation/root-stack';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { ConnectionStatusPill } from '../../components/ui/ConnectionStatusPill';
import { FloatingButton } from '../../components/ui/FloatingButton';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Skeleton } from '../../components/ui/Skeleton';
import { analyticsEvents } from '../../services/analytics/events';
import { useAppTheme } from '../../theme';
import { BorderWidth, FontSize, LineHeight, Space } from '../../theme/tokens';
import { openExternalUrl } from '../../utils/openExternalUrl';
import {
  CLAWHUB_SKILLS_URL,
  buildClawHubInstallPrompt,
  clawHubSkillHandle,
  parseClawHubSkillUrl,
  resolveClawHubNavigation,
  type ClawHubSkillRef,
} from './skill-discover-model';

export type SkillDiscoverScreenProps = Readonly<{
  adapter: AgentAdapter;
  backend: BackendKind;
  online: boolean;
  /** The runtime's foreground grace window is open: show quiet reconnecting instead of offline. */
  reconnecting?: boolean;
  navigation: Pick<NativeStackNavigationProp<RootStackParamList, 'AgentSettingsSection'>, 'goBack'>;
  /** Opens the Agent's main chat with reviewable input after releasing the route hold. */
  onInstallRequested: (text: string) => void;
}>;

/**
 * Skill discovery is ClawHub's own web catalog inside the app (owner decision
 * 2026-09-19). The page stays on clawhub.ai — other sites and mail/phone links
 * open in the system browser — and a skill detail page grows an install footer
 * that asks the selected Agent to install the skill through chat.
 */
export function SkillDiscoverScreen({
  adapter,
  backend,
  online,
  reconnecting = false,
  navigation,
  onInstallRequested,
}: SkillDiscoverScreenProps): React.JSX.Element {
  const { t } = useTranslation(['common', 'settings']);
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const webView = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [skill, setSkill] = useState<ClawHubSkillRef | null>(null);
  const [failed, setFailed] = useState(false);
  // Route removal is held while the web history can still go back; leaving on
  // purpose (Close, install) releases the hold and then performs the navigation.
  const [leave, setLeave] = useState<(() => void) | null>(null);
  const viewedSkill = useRef<string | null>(null);

  usePreventRemove(canGoBack && leave === null, () => {
    webView.current?.goBack();
  });
  useEffect(() => { leave?.(); }, [leave]);

  const canInstall = adapter.capabilities.skillInstall;

  const trackPage = useCallback((url: string) => {
    const next = parseClawHubSkillUrl(url);
    setSkill(next);
    if (next && viewedSkill.current !== next.url) {
      viewedSkill.current = next.url;
      analyticsEvents.skillDiscoverDetailViewed({ source: 'clawhub_web', backend });
    }
  }, [backend]);

  const onNavigationStateChange = useCallback((state: WebViewNavigation) => {
    setCanGoBack(state.canGoBack);
    if (state.url) trackPage(state.url);
  }, [trackPage]);

  const onShouldStartLoadWithRequest = useCallback((request: ShouldStartLoadRequest): boolean => {
    // Only the page itself is kept on ClawHub; embedded frames load as they are.
    if (request.isTopFrame === false) return true;
    const decision = resolveClawHubNavigation(request.url);
    if (decision === 'external') void openExternalUrl(request.url, () => {});
    return decision === 'allow';
  }, []);

  // `target="_blank"` links: ClawHub pages stay in this page, everything else leaves the app.
  const onOpenWindow = useCallback((event: WebViewOpenWindowEvent) => {
    const url = event.nativeEvent.targetUrl;
    const decision = resolveClawHubNavigation(url);
    if (decision === 'allow') webView.current?.injectJavaScript(`window.location.href = ${JSON.stringify(url)}; true;`);
    else if (decision === 'external') void openExternalUrl(url, () => {});
  }, []);

  const back = useCallback(() => {
    if (canGoBack) webView.current?.goBack();
    else navigation.goBack();
  }, [canGoBack, navigation]);

  const close = useCallback(() => {
    setLeave(() => () => navigation.goBack());
  }, [navigation]);

  const install = useCallback(() => {
    if (!skill || !canInstall || leave) return;
    analyticsEvents.skillInstallTapped({ source: 'clawhub_web', backend });
    const text = buildClawHubInstallPrompt(backend, skill);
    setLeave(() => () => onInstallRequested(text));
  }, [backend, canInstall, leave, onInstallRequested, skill]);

  const status = !online && reconnecting
    ? <ConnectionStatusPill placement="inline" status="reconnecting" message={t('Reconnecting…', { ns: 'common' })} />
    : !online
      ? <ConnectionStatusPill testID="skill-discover-offline" placement="inline" status="offline" message={t('Offline · reconnecting', { ns: 'common' })} />
      : undefined;

  return (
    <View testID="skill-discover-screen" style={styles.screen}>
      <ScreenHeader
        testID="skill-discover-header"
        title={t('Discover', { ns: 'common' })}
        topInset={insets.top}
        status={status}
        onBack={back}
        backAccessibilityLabel={t('Back', { ns: 'common' })}
        rightContent={canGoBack ? (
          <FloatingButton
            testID="skill-discover-close"
            icon={X}
            appearance="quiet"
            accessibilityLabel={t('Close', { ns: 'common' })}
            onPress={close}
          />
        ) : undefined}
      />
      <View style={styles.body}>
        <WebView
          ref={webView}
          testID="skill-discover-web"
          source={{ uri: CLAWHUB_SKILLS_URL }}
          style={styles.web}
          onNavigationStateChange={onNavigationStateChange}
          onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
          onOpenWindow={onOpenWindow}
          onLoadStart={() => setFailed(false)}
          onError={() => setFailed(true)}
          setSupportMultipleWindows={false}
          allowsBackForwardNavigationGestures
          startInLoadingState
          renderLoading={() => <DiscoverSkeleton />}
          // Android Fabric forwards this straight to a Double-only delegate.
          // 0.998 preserves the iOS wrapper's normal scrolling rate.
          decelerationRate={0.998}
        />
        {failed ? (
          <View style={styles.notice}>
            <Banner
              testID="skill-discover-error"
              tone="bad"
              message={t('Failed to load ClawHub', { ns: 'settings' })}
              actionLabel={t('Retry', { ns: 'common' })}
              onAction={() => { setFailed(false); webView.current?.reload(); }}
            />
          </View>
        ) : null}
      </View>
      {skill && canInstall ? (
        <View testID="skill-discover-footer" style={[styles.footer, { paddingBottom: insets.bottom + Space.md }]}>
          <Text testID="skill-discover-handle" style={styles.handle} numberOfLines={1}>{clawHubSkillHandle(skill)}</Text>
          <Button
            testID="skill-discover-install"
            label={t('Install via Chat', { ns: 'common' })}
            size="lg"
            disabled={leave !== null}
            onPress={install}
          />
        </View>
      ) : null}
    </View>
  );
}

function DiscoverSkeleton(): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  return (
    <View testID="skill-discover-loading" style={styles.skeleton}>
      {SKELETON_LINES.map((width, index) => (
        <Skeleton key={index} style={[staticStyles.skeletonLine, { width }]} />
      ))}
    </View>
  );
}

const SKELETON_LINES: ReadonlyArray<`${number}%`> = ['44%', '92%', '84%', '38%', '90%', '76%'];

const staticStyles = StyleSheet.create({
  skeletonLine: { height: LineHeight.body - Space.sm },
});

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.canvas },
    body: { flex: 1 },
    web: { flex: 1, backgroundColor: colors.canvas },
    notice: {
      position: 'absolute',
      top: Space.lg,
      left: Space.lg,
      right: Space.lg,
    },
    skeleton: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: colors.canvas,
      paddingHorizontal: Space.lg,
      paddingTop: Space.lg,
      gap: Space.md,
    },
    footer: {
      paddingHorizontal: Space.lg,
      paddingTop: Space.md,
      gap: Space.sm,
      backgroundColor: colors.canvas,
      borderTopWidth: BorderWidth.hairline,
      borderTopColor: colors.line,
    },
    handle: {
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
    },
  });
}
