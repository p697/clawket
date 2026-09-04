import { analyticsEvents } from './events';
import { posthogClient } from './posthog';
import { syncAnalyticsSubscriptionContext } from './subscription-context';

jest.mock('./posthog', () => ({
  posthogClient: {
    capture: jest.fn(),
    register: jest.fn(() => Promise.resolve()),
    setPersonProperties: jest.fn(),
  },
}));

describe('analyticsEvents', () => {
  const mockedPostHogClient = posthogClient as jest.Mocked<NonNullable<typeof posthogClient>>;

  beforeEach(() => {
    jest.clearAllMocks();
    syncAnalyticsSubscriptionContext(null);
  });

  it('captures theme accent changes and updates person properties', () => {
    analyticsEvents.themeAccentChanged({
      selected_accent_id: 'rosePink',
      source: 'config_screen',
    });

    expect(mockedPostHogClient.capture).toHaveBeenCalledWith(
      'theme_accent_changed',
      {
        subscription_status: 'free',
        subscription_type: 'none',
        subscription_tenure_bucket: 'none',
        selected_accent_id: 'rosePink',
        source: 'config_screen',
      },
    );
    expect(mockedPostHogClient.setPersonProperties).toHaveBeenCalledWith(
      {
        theme_accent_id: 'rosePink',
      },
      undefined,
      false,
    );
    expect(mockedPostHogClient.register).toHaveBeenCalledWith({
      theme_accent_id: 'rosePink',
    });
  });

  it('captures chat reply notification events', () => {
    analyticsEvents.chatReplyNotificationShown({
      app_state: 'background',
      source: 'background',
      session_kind: 'main',
      has_preview_text: true,
    });
    analyticsEvents.chatReplyNotificationOpened({
      source: 'launch',
      session_kind: 'main',
      has_agent_id: true,
    });

    expect(mockedPostHogClient.capture).toHaveBeenNthCalledWith(
      1,
      'chat_reply_notification_shown',
      {
        subscription_status: 'free',
        subscription_type: 'none',
        subscription_tenure_bucket: 'none',
        app_state: 'background',
        source: 'background',
        session_kind: 'main',
        has_preview_text: true,
      },
    );
    expect(mockedPostHogClient.capture).toHaveBeenNthCalledWith(
      2,
      'chat_reply_notification_opened',
      {
        subscription_status: 'free',
        subscription_type: 'none',
        subscription_tenure_bucket: 'none',
        source: 'launch',
        session_kind: 'main',
        has_agent_id: true,
      },
    );
  });

  it('captures connection lifecycle events with low-cardinality properties', () => {
    analyticsEvents.connectAttempt({
      backend: 'hermes',
      transport: 'relay',
      reason: 'switch',
    });
    analyticsEvents.connectReady({
      backend: 'hermes',
      transport: 'relay',
      elapsed_ms: 321,
      attempt: 2,
    });
    analyticsEvents.connectFailed({
      backend: 'hermes',
      transport: 'relay',
      code: 'bridge_offline',
      stage: 'handshake',
      attempt: 3,
    });
    analyticsEvents.reconnect({
      backend: 'hermes',
      transport: 'relay',
      reason: 'probe_failed',
    });

    expect(mockedPostHogClient.capture).toHaveBeenNthCalledWith(
      1,
      'connect_attempt',
      expect.objectContaining({
        backend: 'hermes',
        transport: 'relay',
        reason: 'switch',
      }),
    );
    expect(mockedPostHogClient.capture).toHaveBeenNthCalledWith(
      2,
      'connect_ready',
      expect.objectContaining({ elapsed_ms: 321, attempt: 2 }),
    );
    expect(mockedPostHogClient.capture).toHaveBeenNthCalledWith(
      3,
      'connect_failed',
      expect.objectContaining({ code: 'bridge_offline', stage: 'handshake', attempt: 3 }),
    );
    expect(mockedPostHogClient.capture).toHaveBeenNthCalledWith(
      4,
      'reconnect',
      expect.objectContaining({ reason: 'probe_failed' }),
    );
  });

  it('captures model add events', () => {
    analyticsEvents.modelAddTapped({
      provider: 'openai',
      has_custom_name: true,
      source: 'models_list',
    });

    expect(mockedPostHogClient.capture).toHaveBeenCalledWith(
      'model_add_tapped',
      {
        subscription_status: 'free',
        subscription_type: 'none',
        subscription_tenure_bucket: 'none',
        provider: 'openai',
        has_custom_name: true,
        source: 'models_list',
      },
    );
  });

  it('captures model allowlist toggle events', () => {
    analyticsEvents.modelAllowlistToggled({
      provider: 'openai',
      enabled: false,
      source: 'models_list',
    });

    expect(mockedPostHogClient.capture).toHaveBeenCalledWith(
      'model_allowlist_toggled',
      {
        subscription_status: 'free',
        subscription_type: 'none',
        subscription_tenure_bucket: 'none',
        provider: 'openai',
        enabled: false,
        source: 'models_list',
      },
    );
  });

  it('captures model delete events', () => {
    analyticsEvents.modelDeleteTapped({
      provider: 'openai',
      blocked_reference_count: 0,
      source: 'models_list',
    });

    expect(mockedPostHogClient.capture).toHaveBeenCalledWith(
      'model_delete_tapped',
      {
        subscription_status: 'free',
        subscription_type: 'none',
        subscription_tenure_bucket: 'none',
        provider: 'openai',
        blocked_reference_count: 0,
        source: 'models_list',
      },
    );
  });

  it('captures gateway config management events', () => {
    analyticsEvents.gatewayConfigViewOpened({
      source: 'config_screen',
    });
    analyticsEvents.gatewayConfigBackupCreated({
      source: 'config_screen',
      backup_count: 3,
    });
    analyticsEvents.gatewayConfigRestoreTapped({
      source: 'config_backup_list',
      backup_count: 3,
    });

    expect(mockedPostHogClient.capture).toHaveBeenNthCalledWith(
      1,
      'gateway_config_view_opened',
      {
        subscription_status: 'free',
        subscription_type: 'none',
        subscription_tenure_bucket: 'none',
        source: 'config_screen',
      },
    );
    expect(mockedPostHogClient.capture).toHaveBeenNthCalledWith(
      2,
      'gateway_config_backup_created',
      {
        subscription_status: 'free',
        subscription_type: 'none',
        subscription_tenure_bucket: 'none',
        source: 'config_screen',
        backup_count: 3,
      },
    );
    expect(mockedPostHogClient.capture).toHaveBeenNthCalledWith(
      3,
      'gateway_config_restore_tapped',
      {
        subscription_status: 'free',
        subscription_type: 'none',
        subscription_tenure_bucket: 'none',
        source: 'config_backup_list',
        backup_count: 3,
      },
    );
  });

  it('captures chat appearance events', () => {
    analyticsEvents.chatAppearanceOpened({
      source: 'config_screen',
    });
    analyticsEvents.chatAppearanceSaved({
      source: 'chat_appearance_screen',
      has_background_image: true,
      bubble_style: 'glass',
      bubble_opacity: 0.9,
      blur: 12,
      show_agent_avatar: true,
      show_model_name: true,
      chat_font_size: 16,
    });

    expect(mockedPostHogClient.capture).toHaveBeenNthCalledWith(
      1,
      'chat_appearance_opened',
      {
        subscription_status: 'free',
        subscription_type: 'none',
        subscription_tenure_bucket: 'none',
        source: 'config_screen',
      },
    );
    expect(mockedPostHogClient.capture).toHaveBeenNthCalledWith(
      2,
      'chat_appearance_saved',
      {
        subscription_status: 'free',
        subscription_type: 'none',
        subscription_tenure_bucket: 'none',
        source: 'chat_appearance_screen',
        has_background_image: true,
        bubble_style: 'glass',
        bubble_opacity: 0.9,
        blur: 12,
        show_agent_avatar: true,
        show_model_name: true,
        chat_font_size: 16,
      },
    );
  });
});
