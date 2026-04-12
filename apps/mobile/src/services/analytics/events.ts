import { posthogClient } from './posthog';
import { getAnalyticsSubscriptionProperties } from './subscription-context';
import { AccentColorId } from '../../types';

type AnalyticsValue = boolean | number | string | null | undefined;
type AnalyticsProperties = Record<string, AnalyticsValue>;

type PaywallPackageSummary = {
  packageIdentifier?: string;
  packageType?: string;
  priceString?: string;
} | null | undefined;

function compactProperties(properties: AnalyticsProperties): Record<string, boolean | number | string> {
  return Object.entries(properties).reduce<Record<string, boolean | number | string>>((acc, [key, value]) => {
    if (value === null || value === undefined) return acc;
    acc[key] = value;
    return acc;
  }, {});
}

function captureAnalyticsEvent(event: string, properties: AnalyticsProperties = {}): void {
  posthogClient?.capture(event, compactProperties({
    ...getAnalyticsSubscriptionProperties(),
    ...properties,
  }));
}

function buildPaywallPackageProperties(pkg: PaywallPackageSummary): AnalyticsProperties {
  return {
    package_id: pkg?.packageIdentifier ?? null,
    package_type: pkg?.packageType ?? null,
    price_string: pkg?.priceString ?? null,
  };
}

export const analyticsEvents = {
  gatewayConnectSaved(properties: {
    is_editing: boolean;
    mode: string;
    has_password: boolean;
    has_token: boolean;
    source: string;
  }): void {
    captureAnalyticsEvent('gateway_connect_saved', properties);
  },

  gatewayScanQrTapped(properties: {
    source: string;
  }): void {
    captureAnalyticsEvent('gateway_scan_qr_tapped', properties);
  },

  appRatingTapped(properties: {
    source: string;
    result: 'review_prompt' | 'store_page' | 'unavailable' | 'error';
  }): void {
    captureAnalyticsEvent('app_rating_tapped', properties);
  },

  chatSendTapped(properties: {
    has_text: boolean;
    text_length: number;
    attachment_count: number;
    image_count: number;
    file_count: number;
    attachment_formats?: string;
    is_command: boolean;
    slash_command?: string;
    session_key_present: boolean;
  }): void {
    captureAnalyticsEvent('chat_send_tapped', properties);
  },

  messageFavoriteToggled(properties: {
    action: 'favorite' | 'unfavorite';
    role: string;
    source: string;
  }): void {
    captureAnalyticsEvent('message_favorite_toggled', properties);
  },

  chatVoiceInputTapped(properties: {
    action: 'start' | 'stop';
    has_existing_text: boolean;
    locale: string;
    source: string;
  }): void {
    captureAnalyticsEvent('chat_voice_input_tapped', properties);
  },

  chatVoiceInputFailed(properties: {
    code: string;
    stage: 'availability' | 'permissions' | 'start' | 'recognition';
  }): void {
    captureAnalyticsEvent('chat_voice_input_failed', properties);
  },

  chatModelSelected(properties: {
    provider_model: string;
    model_id: string;
    model_name: string;
    provider: string;
    source: string;
    session_key_present: boolean;
  }): void {
    captureAnalyticsEvent('chat_model_selected', properties);
  },

  chatSlashCommandTriggered(properties: {
    command_key: string;
    command: string;
    action: 'send' | 'fill' | 'custom';
    source: string;
    session_key_present: boolean;
  }): void {
    captureAnalyticsEvent('chat_slash_command_triggered', properties);
  },

  chatExecApprovalResolved(properties: {
    decision: 'allow-once' | 'allow-always' | 'deny';
    source: string;
  }): void {
    captureAnalyticsEvent('chat_exec_approval_resolved', properties);
  },

  themeAccentChanged(properties: {
    selected_accent_id: AccentColorId;
    source: string;
  }): void {
    captureAnalyticsEvent('theme_accent_changed', properties);
    posthogClient?.setPersonProperties(
      {
        theme_accent_id: properties.selected_accent_id,
      },
      undefined,
      false,
    );
    void posthogClient?.register({
      theme_accent_id: properties.selected_accent_id,
    })?.catch(() => {});
  },

  appIconChanged(properties: {
    selected_icon_id: 'default' | 'black';
    source: string;
  }): void {
    captureAnalyticsEvent('app_icon_changed', properties);
  },

  clawHubCreateTapped(properties: {
    source: string;
  }): void {
    captureAnalyticsEvent('clawhub_create_tapped', properties);
  },

  clawHubTemplateTapped(properties: {
    author_slug: string;
    template_slug: string;
    source: string;
  }): void {
    captureAnalyticsEvent('clawhub_template_tapped', properties);
  },

  clawHubInstallTapped(properties: {
    skill_slug: string;
    source: string;
  }): void {
    captureAnalyticsEvent('clawhub_install_tapped', properties);
  },

  discoverSearchChanged(properties: {
    has_query: boolean;
  }): void {
    captureAnalyticsEvent('discover_search_changed', properties);
  },

  discoverSkillOpened(properties: {
    source: string;
    location: 'home' | 'search' | 'detail';
  }): void {
    captureAnalyticsEvent('discover_skill_opened', properties);
  },

  discoverInstallTapped(properties: {
    source: string;
    location: 'detail' | 'webview';
  }): void {
    captureAnalyticsEvent('discover_install_tapped', properties);
  },

  discoverExternalOpened(properties: {
    source: string;
  }): void {
    captureAnalyticsEvent('discover_external_opened', properties);
  },

  pairRequestResolved(properties: {
    target: 'device' | 'node';
    decision: 'approve' | 'reject';
    source: string;
  }): void {
    captureAnalyticsEvent('pair_request_resolved', properties);
  },

  cronSaveSucceeded(properties: {
    is_editing: boolean;
    payload_kind: 'agentTurn' | 'systemEvent' | 'hermes';
    schedule_kind: string;
    has_model_override: boolean;
    delivery_mode: string;
    source: string;
  }): void {
    captureAnalyticsEvent('cron_save_succeeded', properties);
  },

  chatSessionSelected(properties: {
    source: string;
    session_kind: string;
    session_key_prefix: string;
  }): void {
    captureAnalyticsEvent('chat_session_selected', properties);
  },

  chatAppearanceOpened(properties: {
    source: string;
  }): void {
    captureAnalyticsEvent('chat_appearance_opened', properties);
  },

  chatAppearanceSaved(properties: {
    source: string;
    has_background_image: boolean;
    bubble_style: string;
    bubble_opacity: number;
    blur: number;
    show_agent_avatar: boolean;
    show_model_name: boolean;
    chat_font_size: number;
  }): void {
    captureAnalyticsEvent('chat_appearance_saved', properties);
  },

  chatReplyNotificationShown(properties: {
    app_state: string;
    source: 'foreground_other_tab' | 'background';
    session_kind: string;
    has_preview_text: boolean;
  }): void {
    captureAnalyticsEvent('chat_reply_notification_shown', properties);
  },

  chatReplyNotificationOpened(properties: {
    source: 'listener' | 'launch';
    session_kind: string;
    has_agent_id: boolean;
  }): void {
    captureAnalyticsEvent('chat_reply_notification_opened', properties);
  },

  officeOpenChatFromCharacter(properties: {
    action: string;
    character_id: string;
    has_session_key: boolean;
  }): void {
    captureAnalyticsEvent('office_open_chat_from_character', properties);
  },

  consoleEntryTapped(properties: {
    destination: string;
    source: string;
  }): void {
    captureAnalyticsEvent('console_entry_tapped', properties);
  },

  cronCreateTapped(properties: {
    source: string;
  }): void {
    captureAnalyticsEvent('cron_create_tapped', properties);
  },

  agentCreateStarted(properties: {
    source: string;
  }): void {
    captureAnalyticsEvent('agent_create_started', properties);
  },

  agentSaveTapped(properties: {
    fallback_count: number;
    has_model: boolean;
    has_name: boolean;
  }): void {
    captureAnalyticsEvent('agent_save_tapped', properties);
  },

  toolsSaveTapped(properties: {
    changed_count: number;
    enabled_count: number;
    total_count: number;
  }): void {
    captureAnalyticsEvent('tools_save_tapped', properties);
  },

  modelsSaveTapped(properties: {
    fallback_count: number;
    has_primary_model: boolean;
    has_thinking_default: boolean;
  }): void {
    captureAnalyticsEvent('models_save_tapped', properties);
  },

  modelCostSaveTapped(properties: {
    provider: string;
    has_existing_override: boolean;
    changed_field_count: number;
    source: string;
  }): void {
    captureAnalyticsEvent('model_cost_save_tapped', properties);
  },

  modelAddTapped(properties: {
    provider: string;
    has_custom_name: boolean;
    source: string;
  }): void {
    captureAnalyticsEvent('model_add_tapped', properties);
  },

  modelAllowlistToggled(properties: {
    provider: string;
    enabled: boolean;
    source: string;
  }): void {
    captureAnalyticsEvent('model_allowlist_toggled', properties);
  },

  modelDeleteTapped(properties: {
    provider: string;
    blocked_reference_count: number;
    source: string;
  }): void {
    captureAnalyticsEvent('model_delete_tapped', properties);
  },

  gatewayConfigViewOpened(properties: {
    source: string;
  }): void {
    captureAnalyticsEvent('gateway_config_view_opened', properties);
  },

  gatewayConfigBackupCreated(properties: {
    source: string;
    backup_count: number;
  }): void {
    captureAnalyticsEvent('gateway_config_backup_created', properties);
  },

  gatewayConfigRestoreTapped(properties: {
    source: string;
    backup_count: number;
  }): void {
    captureAnalyticsEvent('gateway_config_restore_tapped', properties);
  },

  heartbeatSaveTapped(properties: {
    has_active_hours: boolean;
    has_model: boolean;
    has_prompt?: boolean;
    session_mode: string;
  }): void {
    captureAnalyticsEvent('heartbeat_save_tapped', properties);
  },

  paywallViewed(properties: {
    blocked_feature?: string | null;
    package_count: number;
    preview_only: boolean;
    selected_package_id?: string | null;
  }): void {
    captureAnalyticsEvent('paywall_viewed', properties);
  },

  paywallClosed(properties: {
    blocked_feature?: string | null;
    preview_only: boolean;
  }): void {
    captureAnalyticsEvent('paywall_closed', properties);
  },

  paywallPackageSelected(
    pkg: PaywallPackageSummary,
    properties: {
      blocked_feature?: string | null;
      preview_only: boolean;
    },
  ): void {
    captureAnalyticsEvent('paywall_package_selected', {
      ...buildPaywallPackageProperties(pkg),
      ...properties,
    });
  },

  paywallSubscribeTapped(
    pkg: PaywallPackageSummary,
    properties: {
      blocked_feature?: string | null;
      preview_only: boolean;
    },
  ): void {
    captureAnalyticsEvent('paywall_subscribe_tapped', {
      ...buildPaywallPackageProperties(pkg),
      ...properties,
    });
  },

  paywallPurchaseSucceeded(
    pkg: PaywallPackageSummary,
    properties: {
      blocked_feature?: string | null;
      preview_only: boolean;
    },
  ): void {
    captureAnalyticsEvent('paywall_purchase_succeeded', {
      ...buildPaywallPackageProperties(pkg),
      ...properties,
    });
  },

  paywallPurchaseFailed(
    pkg: PaywallPackageSummary,
    properties: {
      blocked_feature?: string | null;
      preview_only: boolean;
    },
  ): void {
    captureAnalyticsEvent('paywall_purchase_failed', {
      ...buildPaywallPackageProperties(pkg),
      ...properties,
    });
  },

  paywallRestoreTapped(properties: {
    blocked_feature?: string | null;
    preview_only: boolean;
  }): void {
    captureAnalyticsEvent('paywall_restore_tapped', properties);
  },

  paywallRestoreSucceeded(properties: {
    blocked_feature?: string | null;
    preview_only: boolean;
  }): void {
    captureAnalyticsEvent('paywall_restore_succeeded', properties);
  },

  paywallRestoreFailed(properties: {
    blocked_feature?: string | null;
    preview_only: boolean;
  }): void {
    captureAnalyticsEvent('paywall_restore_failed', properties);
  },
};
