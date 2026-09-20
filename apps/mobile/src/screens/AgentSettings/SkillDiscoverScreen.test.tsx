import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { CAPABILITY_MATRIX, type AgentAdapter, type AgentDescriptor } from '@clawket/agent-protocol';
import { SkillDiscoverScreen } from './SkillDiscoverScreen';

const mockPreventRemove = jest.fn();
const mockOpenURL = jest.fn(async (_url: string) => undefined);
const mockAnalytics = { skillDiscoverDetailViewed: jest.fn(), skillInstallTapped: jest.fn() };
const mockWebViewRef = { goBack: jest.fn(), reload: jest.fn(), injectJavaScript: jest.fn() };

jest.mock('@react-navigation/native', () => ({ usePreventRemove: (...args: unknown[]) => mockPreventRemove(...args) }));
jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => ReactRuntime.forwardRef(({ children, style, ...props }: Record<string, unknown>, ref: unknown) =>
    ReactRuntime.createElement(name, { ...props, ref, style: typeof style === 'function' ? style({ pressed: false }) : style }, children));
  return {
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
    Pressable: host('Pressable'), View: host('View'), Text: host('Text'), ActivityIndicator: host('ActivityIndicator'),
    Linking: { openURL: (url: string) => mockOpenURL(url) },
    StyleSheet: { create: <T,>(styles: T) => styles, flatten: (style: unknown) => style, hairlineWidth: 1, absoluteFill: {} },
  };
});
jest.mock('react-native-webview', () => {
  const ReactRuntime = require('react');
  const WebView = ReactRuntime.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    ReactRuntime.useImperativeHandle(ref, () => mockWebViewRef);
    return ReactRuntime.createElement('WebView', props);
  });
  return { __esModule: true, default: WebView };
});
jest.mock('lucide-react-native', () => new Proxy({}, {
  get: (_target, key) => key === '__esModule' ? true : (props: unknown) => require('react').createElement('Icon', props),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, values?: Record<string, unknown>) => key.replace(/{{(.*?)}}/g, (_, name) => String(values?.[name] ?? name)),
  i18n: { resolvedLanguage: 'en' },
}) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }) }));
jest.mock('../../theme', () => ({ useAppTheme: () => ({ theme: require('../../theme/theme').buildInterfaceTheme('light', 'light', require('../../theme/accents').builtInAccents.iceBlue) }) }));
jest.mock('../../services/analytics/events', () => ({ get analyticsEvents() { return mockAnalytics; } }));
jest.mock('../../components/ui/ScreenHeader', () => ({ ScreenHeader: ({ title, status, onBack, rightContent }: Record<string, unknown>) => {
  const R = require('react');
  return R.createElement('View', null,
    R.createElement('Text', { testID: 'skill-discover-title' }, title),
    status ?? null,
    R.createElement('Pressable', { testID: 'skill-discover-back', onPress: onBack }),
    rightContent ?? null,
  );
} }));
jest.mock('../../components/ui/ConnectionStatusPill', () => ({ ConnectionStatusPill: (props: unknown) => require('react').createElement('StatusPill', props) }));
jest.mock('../../components/ui/FloatingButton', () => ({ FloatingButton: ({ onPress, testID }: Record<string, unknown>) => require('react').createElement('Pressable', { testID, onPress }) }));
jest.mock('../../components/ui/Button', () => ({ Button: ({ onPress, testID, disabled, loading, label }: Record<string, unknown>) =>
  require('react').createElement('Pressable', { testID, onPress: disabled ? undefined : onPress, disabled, loading, accessibilityLabel: label }) }));
jest.mock('../../components/ui/Banner', () => ({ Banner: ({ testID, message, onAction }: Record<string, unknown>) => {
  const R = require('react');
  return R.createElement('View', { testID, message }, onAction ? R.createElement('Pressable', { testID: `${testID}-action`, onPress: onAction }) : null);
} }));
jest.mock('../../components/ui/Skeleton', () => ({ Skeleton: (props: unknown) => require('react').createElement('View', props) }));

const agent = { connectionId: 'studio', agentId: 'main', name: 'Main', mainSessionKey: 'agent:main:main', isMain: true } as unknown as AgentDescriptor;
const SKILL_URL = 'https://clawhub.ai/spclaudehome/skills/skill-vetter';

function adapterWith(patch: Partial<AgentAdapter> = {}): AgentAdapter {
  return {
    connection: { id: 'studio', backendKind: 'openclaw' },
    capabilities: { ...CAPABILITY_MATRIX.openclaw },
    prompt: jest.fn(async () => ({ runId: 'run' })),
    ...patch,
  } as unknown as AgentAdapter;
}

function renderPage(patch: Partial<React.ComponentProps<typeof SkillDiscoverScreen>> = {}) {
  const props: React.ComponentProps<typeof SkillDiscoverScreen> = {
    adapter: adapterWith(),
    agent,
    backend: 'openclaw',
    online: true,
    navigation: { goBack: jest.fn() },
    onInstallRequested: jest.fn(),
    ...patch,
  };
  const view = render(<SkillDiscoverScreen {...props} />);
  const web = () => view.UNSAFE_getByType('WebView' as never);
  const navigateTo = (url: string, canGoBack = true) => act(() => {
    (web().props as { onNavigationStateChange: (state: unknown) => void }).onNavigationStateChange({ url, canGoBack, loading: false });
  });
  return { view, props, web, navigateTo };
}

describe('SkillDiscoverScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('opens the ClawHub catalog and grows an install footer only on a skill page', async () => {
    const { view, props, web, navigateTo } = renderPage();
    expect(web().props.source).toEqual({ uri: 'https://clawhub.ai/skills' });
    expect(view.getByTestId('skill-discover-title').props.children).toBe('Discover');
    expect(view.queryByTestId('skill-discover-footer')).toBeNull();
    expect(view.queryByTestId('skill-discover-close')).toBeNull();

    navigateTo(SKILL_URL);
    expect(view.getByTestId('skill-discover-handle').props.children).toBe('@spclaudehome/skill-vetter');
    expect(mockAnalytics.skillDiscoverDetailViewed).toHaveBeenCalledWith({ source: 'clawhub_web', backend: 'openclaw' });
    navigateTo(`${SKILL_URL}?tab=files`);
    expect(mockAnalytics.skillDiscoverDetailViewed).toHaveBeenCalledTimes(1);

    fireEvent.press(view.getByTestId('skill-discover-install'));
    await waitFor(() => expect(props.onInstallRequested).toHaveBeenCalledTimes(1));
    expect(mockAnalytics.skillInstallTapped).toHaveBeenCalledWith({ source: 'clawhub_web', backend: 'openclaw' });
    expect(props.adapter.prompt).toHaveBeenCalledWith(agent.mainSessionKey, expect.objectContaining({
      text: expect.stringContaining('Command: openclaw skills install @spclaudehome/skill-vetter'),
      idempotencyKey: expect.stringMatching(/^skill-install:\d+:spclaudehome\/skill-vetter$/),
    }));
    // The route hold is released before the chat navigation runs.
    expect(mockPreventRemove.mock.calls.at(-1)?.[0]).toBe(false);

    navigateTo('https://clawhub.ai/skills?tab=trending');
    expect(view.queryByTestId('skill-discover-footer')).toBeNull();
  });

  it('asks Hermes through its own skills hub command', async () => {
    const adapter = adapterWith({ capabilities: { ...CAPABILITY_MATRIX.hermes } });
    const { view, navigateTo } = renderPage({ adapter, backend: 'hermes' });
    navigateTo(SKILL_URL);
    fireEvent.press(view.getByTestId('skill-discover-install'));
    await waitFor(() => expect(adapter.prompt).toHaveBeenCalledWith(agent.mainSessionKey, expect.objectContaining({
      text: expect.stringContaining('Command: hermes skills install skill-vetter'),
    })));
  });

  it('keeps the page on ClawHub and opens other sites in the system browser', () => {
    const { web } = renderPage();
    const decide = (url: string, isTopFrame = true) =>
      (web().props as { onShouldStartLoadWithRequest: (request: unknown) => boolean }).onShouldStartLoadWithRequest({ url, isTopFrame });
    expect(decide('https://clawhub.ai/owner/skills/tool')).toBe(true);
    expect(decide('https://github.com/owner/repo')).toBe(false);
    expect(mockOpenURL).toHaveBeenCalledWith('https://github.com/owner/repo');
    expect(decide('https://ads.example.com/frame', false)).toBe(true);
    expect(decide('javascript:alert(1)')).toBe(false);
    expect(mockOpenURL).toHaveBeenCalledTimes(1);

    (web().props as { onOpenWindow: (event: unknown) => void }).onOpenWindow({ nativeEvent: { targetUrl: 'https://clawhub.ai/official' } });
    expect(mockWebViewRef.injectJavaScript).toHaveBeenCalledWith(expect.stringContaining('"https://clawhub.ai/official"'));
    (web().props as { onOpenWindow: (event: unknown) => void }).onOpenWindow({ nativeEvent: { targetUrl: 'https://docs.openclaw.ai' } });
    expect(mockOpenURL).toHaveBeenLastCalledWith('https://docs.openclaw.ai');
  });

  it('walks the web history back before leaving and offers Close to leave at once', () => {
    const { view, props, navigateTo } = renderPage();
    fireEvent.press(view.getByTestId('skill-discover-back'));
    expect(props.navigation.goBack).toHaveBeenCalledTimes(1);
    expect(mockPreventRemove.mock.calls.at(-1)?.[0]).toBe(false);

    navigateTo(SKILL_URL);
    expect(mockPreventRemove.mock.calls.at(-1)?.[0]).toBe(true);
    fireEvent.press(view.getByTestId('skill-discover-back'));
    expect(mockWebViewRef.goBack).toHaveBeenCalledTimes(1);
    expect(props.navigation.goBack).toHaveBeenCalledTimes(1);
    // A hardware back / swipe while history remains also steps the page back.
    act(() => { (mockPreventRemove.mock.calls.at(-1)?.[1] as () => void)(); });
    expect(mockWebViewRef.goBack).toHaveBeenCalledTimes(2);

    fireEvent.press(view.getByTestId('skill-discover-close'));
    expect(props.navigation.goBack).toHaveBeenCalledTimes(2);
    expect(mockPreventRemove.mock.calls.at(-1)?.[0]).toBe(false);
  });

  it('hides installation without the capability and disables it while the Agent is offline', () => {
    const readOnly = renderPage({ adapter: adapterWith({ capabilities: { ...CAPABILITY_MATRIX.openclaw, skillInstall: false } }) });
    readOnly.navigateTo(SKILL_URL);
    expect(readOnly.view.queryByTestId('skill-discover-footer')).toBeNull();
    readOnly.view.unmount();

    const offline = renderPage({ online: false });
    offline.navigateTo(SKILL_URL);
    expect(offline.view.getByTestId('skill-discover-offline')).toBeTruthy();
    expect(offline.view.getByTestId('skill-discover-install').props.disabled).toBe(true);
    fireEvent.press(offline.view.getByTestId('skill-discover-install'));
    expect(offline.props.adapter.prompt).not.toHaveBeenCalled();
  });

  it('shows a load failure with retry and keeps a rejected install on the page', async () => {
    const adapter = adapterWith({ prompt: jest.fn(async () => { throw new Error('Gateway refused'); }) });
    const { view, props, web, navigateTo } = renderPage({ adapter });
    act(() => { (web().props as { onError: () => void }).onError(); });
    fireEvent.press(view.getByTestId('skill-discover-error-action'));
    expect(mockWebViewRef.reload).toHaveBeenCalledTimes(1);
    expect(view.queryByTestId('skill-discover-error')).toBeNull();

    navigateTo(SKILL_URL);
    fireEvent.press(view.getByTestId('skill-discover-install'));
    await waitFor(() => expect(view.getByTestId('skill-discover-install-error').props.message).toBe('Gateway refused'));
    expect(props.onInstallRequested).not.toHaveBeenCalled();
    expect(view.getByTestId('skill-discover-install').props.disabled).toBe(false);
  });
});
