import type { AccentColorId } from '../../types';
import type { BackendKind, SessionKind, TransportKind } from '@clawket/agent-protocol';
import { normalizeAnalyticsEventString } from './event-property-normalizers';
import { posthogClient, recordPostHogDiagnosticEvent } from './posthog';
import { getAnalyticsSubscriptionProperties } from './subscription-context';

type AnalyticsValue = boolean | number | string | null | undefined;
type AnalyticsProperties = Record<string, AnalyticsValue>;
type AnalyticsBackend = BackendKind;
/** Bounded Agent workspace document labels; never a raw file name or path. */
export type AnalyticsAgentDocument = 'agents' | 'soul' | 'identity' | 'user' | 'bootstrap' | 'memory' | 'other';
const ANALYTICS_AGENT_DOCUMENTS: Readonly<Record<string, AnalyticsAgentDocument>> = {
  'AGENTS.md': 'agents',
  'SOUL.md': 'soul',
  'IDENTITY.md': 'identity',
  'USER.md': 'user',
  'BOOTSTRAP.md': 'bootstrap',
  'MEMORY.md': 'memory',
};
export function analyticsAgentDocument(fileName: string): AnalyticsAgentDocument {
  return ANALYTICS_AGENT_DOCUMENTS[fileName] ?? 'other';
}
type AnalyticsTransport = TransportKind;
type ScreenArea = 'onboarding' | 'roster' | 'thread' | 'settings' | 'account' | 'search' | 'paywall';
/** `launch` is the once-per-update sheet; `debug_preview` is the Developer row. */
type AppUpdateAnnouncementSource = 'launch' | 'debug_preview';

type PaywallPackageSummary = {
  packageIdentifier?: string;
  packageType?: string;
  priceString?: string;
} | null | undefined;

type PaywallContext = {
  blocked_feature?: string | null;
  preview_only?: boolean;
  hero?: 'connections' | 'agents' | 'manage' | 'logsFiles' | 'search' | 'generic';
  variant?: string;
  trigger_screen?: ScreenArea;
  launch?: boolean;
};

export const ANALYTICS_GLOBAL_EVENT_PROPERTIES = Object.freeze([
  'subscription_status',
  'subscription_type',
  'subscription_tenure_bucket',
  'is_pro',
  'is_premium',
] as const);

/**
 * Runtime privacy boundary for every semantic event emitted by Mobile.
 * Unknown event names and properties fail closed instead of reaching PostHog.
 */
export const ANALYTICS_EVENT_PROPERTY_WHITELIST = Object.freeze({
  agent_file_activity: ['action', 'backend', 'document'],
  onboarding_viewed: ['source'],
  pairing_code_submitted: ['length_ok'],
  onboarding_docs_opened: ['backend'],
  onboarding_agent_prompt_copied: ['backend'],
  gateway_connect_saved: ['backend', 'transport', 'source'],
  gateway_scan_qr_tapped: ['source'],
  gateway_secure_pairing_finished: ['method', 'environment', 'connected'],
  connect_attempt: ['backend', 'transport', 'reason'],
  connect_phase: ['protocol', 'route', 'phase', 'elapsed_ms', 'phase_ms', 'attempt'],
  connect_ready: ['backend', 'transport', 'elapsed_ms', 'attempt'],
  connect_failed: ['backend', 'transport', 'code', 'stage', 'attempt'],
  reconnect: ['backend', 'transport', 'reason'],
  roster_viewed: ['connection_count', 'agent_count', 'pinned_count', 'unread_count', 'attention_count'],
  roster_row_opened: ['kind', 'unread', 'attention', 'locked', 'cached'],
  roster_pin_toggled: ['action', 'kind'],
  thread_opened: ['backend', 'kind', 'from'],
  thread_load_state: ['backend', 'phase', 'history_loaded', 'subscription_loading', 'target_session_ready', 'preview_only', 'elapsed_ms'],
  session_preview_viewed: ['backend', 'kind'],
  chat_send_tapped: [
    'backend',
    'has_text',
    'has_skill',
    'text_length',
    'attachment_count',
    'image_count',
    'file_count',
    'attachment_formats',
    'is_command',
    'session_key_present',
  ],
  chat_abort_tapped: ['backend'],
  chat_message_queued: ['backend', 'queue_length', 'has_attachments'],
  chat_queued_message_delivered: ['backend', 'wait_ms', 'remaining'],
  chat_queued_message_edited: ['backend'],
  chat_queued_message_removed: ['backend'],
  chat_queue_held: ['reason', 'queue_length'],
  chat_add_menu_opened: ['backend', 'photo_access'],
  chat_add_menu_action: ['backend', 'action', 'count'],
  run_card_opened: ['kind'],
  approval_resolved: ['kind', 'decision'],
  session_panel_opened: ['session_count'],
  session_panel_filter_changed: ['filter'],
  session_panel_agent_switched: ['session_count'],
  chat_session_selected: ['source', 'session_kind', 'from'],
  session_action: ['action'],
  agent_settings_opened: ['backend'],
  settings_row_opened: ['row', 'locked', 'backend'],
  usage_range_changed: ['range', 'cached', 'locked'],
  search_performed: ['scope', 'has_results', 'result_kinds'],
  search_message_opened: ['is_pro'],
  paywall_viewed: [
    'blocked_feature',
    'package_count',
    'preview_only',
    'selected_package_id',
    'hero',
    'variant',
    'trigger_screen',
    'launch',
  ],
  paywall_plan_change_submitted: ['package_id', 'package_type', 'price_string', 'blocked_feature', 'preview_only', 'hero', 'variant', 'trigger_screen', 'launch'],
  paywall_manage_subscription_tapped: ['blocked_feature', 'preview_only', 'hero', 'variant', 'trigger_screen', 'launch'],
  paywall_closed: [
    'blocked_feature',
    'preview_only',
    'hero',
    'variant',
    'trigger_screen',
    'launch',
    'seconds_on_paywall',
    'plan_toggled',
  ],
  paywall_package_selected: [
    'package_id',
    'package_type',
    'price_string',
    'blocked_feature',
    'preview_only',
    'hero',
    'variant',
    'trigger_screen',
    'launch',
  ],
  paywall_subscribe_tapped: [
    'package_id',
    'package_type',
    'price_string',
    'blocked_feature',
    'preview_only',
    'hero',
    'variant',
    'trigger_screen',
    'launch',
  ],
  paywall_purchase_succeeded: [
    'package_id',
    'package_type',
    'price_string',
    'blocked_feature',
    'preview_only',
    'hero',
    'variant',
    'trigger_screen',
    'launch',
  ],
  paywall_purchase_failed: [
    'package_id',
    'package_type',
    'price_string',
    'blocked_feature',
    'preview_only',
    'hero',
    'variant',
    'trigger_screen',
    'launch',
    'reason',
  ],
  paywall_restore_tapped: ['blocked_feature', 'preview_only', 'hero', 'variant', 'trigger_screen', 'launch'],
  paywall_restore_succeeded: ['blocked_feature', 'preview_only', 'hero', 'variant', 'trigger_screen', 'launch'],
  paywall_restore_failed: ['blocked_feature', 'preview_only', 'hero', 'variant', 'trigger_screen', 'launch', 'reason'],
  app_update_announcement_shown: ['version', 'release_count', 'entry_count', 'source'],
  app_update_announcement_closed: ['version', 'release_count', 'source', 'action', 'seconds_visible'],
  app_update_announcement_entry_tapped: ['version', 'entry', 'action'],
  release_notes_opened: ['release_count'],
  grace_banner_viewed: ['days_left'],
  grace_expired: ['days_left'],
  youmind_sign_in_tapped: ['method', 'source'],
  youmind_sign_in_resolved: ['method', 'result', 'source'],
  sprite_greeting_sent: [],
  app_rating_tapped: ['source', 'result'],

  // Existing, still-supported product telemetry referenced by 04-app-screens.
  chat_skill_picker_opened: ['source', 'session_key_present', 'skill_count'],
  chat_skill_selected: ['source', 'action', 'session_key_present'],
  message_favorite_toggled: ['action', 'role', 'source'],
  chat_voice_input_tapped: ['action', 'has_existing_text', 'locale', 'source'],
  chat_voice_input_failed: ['code', 'stage'],
  chat_model_selected: ['provider', 'source', 'session_key_present'],
  chat_slash_command_triggered: ['action', 'source', 'session_key_present'],
  theme_accent_changed: ['selected_accent_id', 'source'],
  app_icon_changed: ['selected_icon_id', 'source'],
  skill_install_tapped: ['source'],
  cron_save_succeeded: ['is_editing', 'payload_kind', 'schedule_kind', 'has_model_override', 'delivery_mode', 'source'],
  cron_create_tapped: ['source'],
  agent_create_started: ['source'],
  agent_save_tapped: ['fallback_count', 'has_model', 'has_name'],
  tools_save_tapped: ['changed_count', 'enabled_count', 'total_count'],
  models_save_tapped: ['fallback_count', 'has_primary_model', 'has_thinking_default'],
  model_cost_save_tapped: ['provider', 'has_existing_override', 'changed_field_count', 'source'],
  model_add_tapped: ['provider', 'has_custom_name', 'source'],
  model_allowlist_toggled: ['provider', 'enabled', 'source'],
  model_delete_tapped: ['provider', 'blocked_reference_count', 'source'],
  gateway_config_view_opened: ['source'],
  gateway_config_backup_created: ['source', 'backup_count'],
  gateway_config_restore_tapped: ['source', 'backup_count'],
  heartbeat_save_tapped: ['has_active_hours', 'has_model', 'has_prompt', 'session_mode'],
  chat_appearance_opened: ['source'],
  chat_appearance_saved: [
    'source',
    'has_background_image',
    'bubble_style',
    'bubble_opacity',
    'blur',
    'show_agent_avatar',
    'show_model_name',
    'chat_font_size',
  ],
  chat_reply_notification_shown: ['app_state', 'source', 'session_kind', 'has_preview_text'],
  chat_reply_notification_opened: ['source', 'session_kind', 'has_agent_id'],
} as const);

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENT_PROPERTY_WHITELIST;

const MAX_ANALYTICS_STRING_LENGTH = 128;

function isSafeAnalyticsValue(value: AnalyticsValue): value is boolean | number | string {
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && value.length <= MAX_ANALYTICS_STRING_LENGTH;
}

export function sanitizeAnalyticsEventProperties(
  event: AnalyticsEventName,
  properties: AnalyticsProperties,
): Record<string, boolean | number | string> {
  const eventProperties = ANALYTICS_EVENT_PROPERTY_WHITELIST[event] as readonly string[] | undefined;
  if (!eventProperties) return {};
  const allowed = new Set<string>([
    ...ANALYTICS_GLOBAL_EVENT_PROPERTIES,
    ...eventProperties,
  ]);
  return Object.entries(properties).reduce<Record<string, boolean | number | string>>((result, [key, value]) => {
    if (!allowed.has(key) || !isSafeAnalyticsValue(value)) return result;
    result[key] = typeof value === 'string'
      ? normalizeAnalyticsEventString(event, key, value)
      : value;
    return result;
  }, {});
}

function captureAnalyticsEvent(event: AnalyticsEventName, properties: AnalyticsProperties = {}): void {
  const sanitized = sanitizeAnalyticsEventProperties(event, {
    ...getAnalyticsSubscriptionProperties(),
    ...properties,
  });
  recordPostHogDiagnosticEvent('event', event, sanitized);
  posthogClient?.capture(event, sanitized);
}

function buildPaywallPackageProperties(pkg: PaywallPackageSummary): AnalyticsProperties {
  return {
    package_id: pkg?.packageIdentifier ?? null,
    package_type: pkg?.packageType ?? null,
    price_string: pkg?.priceString ?? null,
  };
}

function legacyBackend(mode: string | undefined): AnalyticsBackend | undefined {
  if (mode === 'hermes') return 'hermes';
  if (mode === 'https') return 'youmind';
  if (mode === 'relay' || mode === 'local' || mode === 'tailscale' || mode === 'cloudflare' || mode === 'custom') {
    return 'openclaw';
  }
  return undefined;
}

function legacyTransport(mode: string | undefined): AnalyticsTransport | undefined {
  if (mode === 'relay' || mode === 'local' || mode === 'tailscale' || mode === 'cloudflare' || mode === 'custom' || mode === 'https') {
    return mode;
  }
  return undefined;
}

export const analyticsEvents = {
  agentFileActivity(properties: { action: 'edit' | 'saved' | 'failed'; backend: AnalyticsBackend; document: AnalyticsAgentDocument }): void {
    try { captureAnalyticsEvent('agent_file_activity', properties); } catch { /* Telemetry cannot interrupt editing. */ }
  },
  onboardingViewed(properties: { source: 'first_run' | 'add_connection' }): void {
    captureAnalyticsEvent('onboarding_viewed', properties);
  },

  pairingCodeSubmitted(properties: { length_ok: boolean }): void {
    captureAnalyticsEvent('pairing_code_submitted', properties);
  },

  onboardingDocsOpened(properties: { backend: AnalyticsBackend }): void {
    captureAnalyticsEvent('onboarding_docs_opened', properties);
  },

  onboardingAgentPromptCopied(properties: { backend: AnalyticsBackend }): void {
    captureAnalyticsEvent('onboarding_agent_prompt_copied', properties);
  },

  gatewayConnectSaved(properties: {
    backend?: AnalyticsBackend;
    transport?: AnalyticsTransport;
    source: string;
    /** Legacy input accepted for one transition release. */
    mode?: string;
    is_editing?: boolean;
    has_password?: boolean;
    has_token?: boolean;
  }): void {
    captureAnalyticsEvent('gateway_connect_saved', {
      backend: properties.backend ?? legacyBackend(properties.mode),
      transport: properties.transport ?? legacyTransport(properties.mode),
      source: properties.source,
    });
  },

  gatewayScanQrTapped(properties: { source: string }): void {
    captureAnalyticsEvent('gateway_scan_qr_tapped', properties);
  },

  gatewaySecurePairingFinished(properties: {
    method: 'link' | 'code';
    environment: 'production' | 'preview';
    connected: boolean;
  }): void {
    captureAnalyticsEvent('gateway_secure_pairing_finished', properties);
  },

  connectPhase(properties: {
    protocol: 'challenge' | 'health';
    route: 'relay' | 'direct';
    phase: 'socket_open' | 'challenge_received' | 'credentials_ready' | 'authenticated'
      | 'bootstrap_handoff' | 'backend_restarted' | 'ready' | 'reconnecting' | 'closed' | 'error';
    elapsed_ms: number;
    phase_ms: number;
    attempt: number;
  }): void {
    captureAnalyticsEvent('connect_phase', properties);
  },

  connectAttempt(properties: {
    backend: AnalyticsBackend;
    transport: AnalyticsTransport;
    reason: 'launch' | 'switch' | 'foreground' | 'manual' | 'retry';
  }): void {
    captureAnalyticsEvent('connect_attempt', properties);
  },

  connectReady(properties: {
    backend: AnalyticsBackend;
    transport: AnalyticsTransport;
    elapsed_ms: number;
    attempt: number;
  }): void {
    captureAnalyticsEvent('connect_ready', properties);
  },

  connectFailed(properties: {
    backend: AnalyticsBackend;
    transport: AnalyticsTransport;
    code: string;
    stage: 'socket' | 'handshake' | 'ready';
    attempt: number;
  }): void {
    captureAnalyticsEvent('connect_failed', properties);
  },

  reconnect(properties: {
    backend: AnalyticsBackend;
    transport: AnalyticsTransport;
    reason: 'tick_timeout' | 'socket_close' | 'probe_failed' | 'seq_gap' | 'foreground';
  }): void {
    captureAnalyticsEvent('reconnect', properties);
  },

  rosterViewed(properties: {
    connection_count: number;
    agent_count: number;
    pinned_count: number;
    unread_count: number;
    attention_count: number;
  }): void {
    captureAnalyticsEvent('roster_viewed', properties);
  },

  rosterRowOpened(properties: {
    kind: 'agent' | 'pinned_session';
    unread: boolean;
    attention: boolean;
    locked: boolean;
    cached: boolean;
  }): void {
    captureAnalyticsEvent('roster_row_opened', properties);
  },

  rosterPinToggled(properties: { action: 'pin' | 'unpin'; kind: 'agent' | 'session' }): void {
    captureAnalyticsEvent('roster_pin_toggled', properties);
  },

  threadOpened(properties: {
    backend: AnalyticsBackend;
    kind: SessionKind;
    from: 'roster' | 'panel' | 'search' | 'notification' | 'deeplink' | 'onboarding';
  }): void {
    captureAnalyticsEvent('thread_opened', properties);
  },

  sessionPreviewViewed(properties: { backend: AnalyticsBackend; kind: SessionKind }): void {
    captureAnalyticsEvent('session_preview_viewed', properties);
  },

  threadLoadState(properties: {
    backend: AnalyticsBackend;
    phase: 'loading' | 'ready' | 'empty' | 'reconnecting' | 'offline' | 'locked' | 'error';
    history_loaded: boolean;
    subscription_loading: boolean;
    target_session_ready: boolean;
    preview_only: boolean;
    elapsed_ms: number;
  }): void {
    captureAnalyticsEvent('thread_load_state', properties);
  },

  chatSendTapped(properties: {
    backend?: AnalyticsBackend;
    has_text: boolean;
    has_skill?: boolean;
    text_length: number;
    attachment_count: number;
    image_count: number;
    file_count: number;
    attachment_formats?: string;
    is_command: boolean;
    /** Accepted but intentionally removed by the property whitelist. */
    slash_command?: string;
    session_key_present: boolean;
  }): void {
    captureAnalyticsEvent('chat_send_tapped', properties);
  },

  chatAbortTapped(properties: { backend: AnalyticsBackend }): void {
    captureAnalyticsEvent('chat_abort_tapped', properties);
  },

  chatMessageQueued(properties: {
    backend?: AnalyticsBackend;
    queue_length: number;
    has_attachments: boolean;
  }): void {
    captureAnalyticsEvent('chat_message_queued', properties);
  },

  chatQueuedMessageDelivered(properties: {
    backend?: AnalyticsBackend;
    wait_ms: number;
    remaining: number;
  }): void {
    captureAnalyticsEvent('chat_queued_message_delivered', properties);
  },

  chatQueuedMessageEdited(properties: { backend?: AnalyticsBackend }): void {
    captureAnalyticsEvent('chat_queued_message_edited', properties);
  },

  chatQueuedMessageRemoved(properties: { backend?: AnalyticsBackend }): void {
    captureAnalyticsEvent('chat_queued_message_removed', properties);
  },

  chatQueueHeld(properties: {
    reason: 'abort' | 'run_error' | 'send_failed' | 'preflight_failed';
    queue_length: number;
  }): void {
    captureAnalyticsEvent('chat_queue_held', properties);
  },

  runCardOpened(properties: { kind: 'subagent' | 'cron' }): void {
    captureAnalyticsEvent('run_card_opened', properties);
  },

  approvalResolved(properties: {
    kind: 'exec' | 'plugin' | 'pair';
    decision: 'allow-once' | 'allow-always' | 'deny' | 'approve' | 'reject';
  }): void {
    captureAnalyticsEvent('approval_resolved', properties);
  },

  sessionPanelOpened(properties: { session_count: number }): void {
    captureAnalyticsEvent('session_panel_opened', properties);
  },

  sessionPanelFilterChanged(properties: {
    filter: 'all' | 'channel' | 'direct_group' | 'subagent' | 'cron';
  }): void {
    captureAnalyticsEvent('session_panel_filter_changed', properties);
  },

  sessionPanelAgentSwitched(properties: { session_count: number }): void {
    captureAnalyticsEvent('session_panel_agent_switched', properties);
  },

  chatSessionSelected(properties: {
    source?: string;
    session_kind: SessionKind;
    from?: 'panel' | 'search';
    /** Legacy input accepted but intentionally not emitted. */
    session_key_prefix?: string;
  }): void {
    const legacyFrom = properties.source === 'panel' || properties.source === 'search'
      ? properties.source
      : undefined;
    captureAnalyticsEvent('chat_session_selected', {
      source: properties.source,
      session_kind: properties.session_kind,
      from: properties.from ?? legacyFrom,
    });
  },

  sessionAction(properties: { action: 'pin' | 'rename' | 'reset' | 'delete' | 'create' }): void {
    captureAnalyticsEvent('session_action', properties);
  },

  agentSettingsOpened(properties: { backend: AnalyticsBackend }): void {
    captureAnalyticsEvent('agent_settings_opened', properties);
  },

  settingsRowOpened(properties: { row: string; locked: boolean; backend: AnalyticsBackend }): void {
    captureAnalyticsEvent('settings_row_opened', properties);
  },

  searchPerformed(properties: { scope: 'global' | 'panel'; has_results: boolean; result_kinds: string }): void {
    captureAnalyticsEvent('search_performed', properties);
  },

  searchMessageOpened(properties: { is_pro: boolean }): void {
    captureAnalyticsEvent('search_message_opened', properties);
  },

  paywallViewed(properties: PaywallContext & {
    package_count: number;
    preview_only: boolean;
    selected_package_id?: string | null;
  }): void {
    captureAnalyticsEvent('paywall_viewed', properties);
  },

  paywallClosed(properties: PaywallContext & {
    preview_only: boolean;
    seconds_on_paywall?: number;
    plan_toggled?: boolean;
  }): void {
    captureAnalyticsEvent('paywall_closed', properties);
  },

  paywallPackageSelected(pkg: PaywallPackageSummary, properties: PaywallContext & { preview_only: boolean }): void {
    captureAnalyticsEvent('paywall_package_selected', { ...buildPaywallPackageProperties(pkg), ...properties });
  },

  paywallSubscribeTapped(pkg: PaywallPackageSummary, properties: PaywallContext & { preview_only: boolean }): void {
    captureAnalyticsEvent('paywall_subscribe_tapped', { ...buildPaywallPackageProperties(pkg), ...properties });
  },

  paywallPurchaseSucceeded(pkg: PaywallPackageSummary, properties: PaywallContext & { preview_only: boolean }): void {
    captureAnalyticsEvent('paywall_purchase_succeeded', { ...buildPaywallPackageProperties(pkg), ...properties });
  },

  paywallPlanChangeSubmitted(pkg: PaywallPackageSummary, properties: PaywallContext & { preview_only: boolean }): void {
    captureAnalyticsEvent('paywall_plan_change_submitted', { ...buildPaywallPackageProperties(pkg), ...properties });
  },

  paywallManageSubscriptionTapped(properties: PaywallContext & { preview_only: boolean }): void {
    captureAnalyticsEvent('paywall_manage_subscription_tapped', properties);
  },

  paywallPurchaseFailed(pkg: PaywallPackageSummary, properties: PaywallContext & {
    preview_only: boolean;
    reason?: string;
  }): void {
    captureAnalyticsEvent('paywall_purchase_failed', { ...buildPaywallPackageProperties(pkg), ...properties });
  },

  paywallRestoreTapped(properties: PaywallContext & { preview_only: boolean }): void {
    captureAnalyticsEvent('paywall_restore_tapped', properties);
  },

  paywallRestoreSucceeded(properties: PaywallContext & { preview_only: boolean }): void {
    captureAnalyticsEvent('paywall_restore_succeeded', properties);
  },

  paywallRestoreFailed(properties: PaywallContext & { preview_only: boolean; reason?: string }): void {
    captureAnalyticsEvent('paywall_restore_failed', properties);
  },

  appUpdateAnnouncementShown(properties: {
    version: string;
    release_count: number;
    entry_count: number;
    source: AppUpdateAnnouncementSource;
  }): void {
    captureAnalyticsEvent('app_update_announcement_shown', properties);
  },

  appUpdateAnnouncementClosed(properties: {
    version: string;
    release_count: number;
    source: AppUpdateAnnouncementSource;
    action: 'dismiss' | 'continue' | 'entry';
    seconds_visible: number;
  }): void {
    captureAnalyticsEvent('app_update_announcement_closed', properties);
  },

  appUpdateAnnouncementEntryTapped(properties: {
    version: string;
    entry: string;
    action: 'open_url' | 'open_paywall';
  }): void {
    captureAnalyticsEvent('app_update_announcement_entry_tapped', properties);
  },

  releaseNotesOpened(properties: { release_count: number }): void {
    captureAnalyticsEvent('release_notes_opened', properties);
  },

  graceBannerViewed(properties: { days_left: number }): void {
    captureAnalyticsEvent('grace_banner_viewed', properties);
  },

  graceExpired(properties: { days_left: number }): void {
    captureAnalyticsEvent('grace_expired', properties);
  },

  youMindSignInTapped(properties: { method: 'email'; source: string }): void {
    captureAnalyticsEvent('youmind_sign_in_tapped', properties);
  },

  youMindSignInResolved(properties: {
    method: 'email';
    result: 'success' | 'failure' | 'cancel';
    source: string;
  }): void {
    captureAnalyticsEvent('youmind_sign_in_resolved', properties);
  },

  spriteGreetingSent(): void {
    captureAnalyticsEvent('sprite_greeting_sent');
  },

  appRatingTapped(properties: {
    source: string;
    result: 'review_prompt' | 'store_page' | 'unavailable' | 'error';
  }): void {
    captureAnalyticsEvent('app_rating_tapped', properties);
  },

  chatSkillPickerOpened(properties: { source: string; session_key_present: boolean; skill_count: number }): void {
    captureAnalyticsEvent('chat_skill_picker_opened', properties);
  },

  chatSkillSelected(properties: {
    source: string;
    action: 'select' | 'clear';
    skill_id?: string;
    skill_name?: string;
    session_key_present: boolean;
  }): void {
    captureAnalyticsEvent('chat_skill_selected', properties);
  },

  messageFavoriteToggled(properties: { action: 'favorite' | 'unfavorite'; role: string; source: string }): void {
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
    provider_model?: string;
    model_id?: string;
    model_name?: string;
    provider: string;
    source: string;
    session_key_present: boolean;
  }): void {
    captureAnalyticsEvent('chat_model_selected', properties);
  },

  chatAddMenuOpened(properties: {
    backend?: AnalyticsBackend;
    photo_access: 'unavailable' | 'checking' | 'undetermined' | 'denied' | 'granted';
  }): void {
    captureAnalyticsEvent('chat_add_menu_opened', properties);
  },

  chatAddMenuAction(properties: {
    backend?: AnalyticsBackend;
    action: 'photo-library' | 'camera' | 'file' | 'recent-photos' | 'skills' | 'commands' | 'schedule' | 'tools';
    count?: number;
  }): void {
    captureAnalyticsEvent('chat_add_menu_action', properties);
  },

  chatSlashCommandTriggered(properties: {
    command_key?: string;
    command?: string;
    action: 'send' | 'fill' | 'custom';
    source: string;
    session_key_present: boolean;
  }): void {
    captureAnalyticsEvent('chat_slash_command_triggered', properties);
  },

  themeAccentChanged(properties: { selected_accent_id: AccentColorId; source: string }): void {
    captureAnalyticsEvent('theme_accent_changed', properties);
    posthogClient?.setPersonProperties({ theme_accent_id: properties.selected_accent_id }, undefined, false);
    void posthogClient?.register({ theme_accent_id: properties.selected_accent_id })?.catch(() => {});
  },

  appIconChanged(properties: { selected_icon_id: 'default' | 'black'; source: string }): void {
    captureAnalyticsEvent('app_icon_changed', properties);
  },

  skillInstallTapped(properties: { source: string }): void {
    captureAnalyticsEvent('skill_install_tapped', properties);
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

  cronCreateTapped(properties: { source: string }): void {
    captureAnalyticsEvent('cron_create_tapped', properties);
  },

  usageRangeChanged(properties: { range: 'today' | '7d' | '30d'; cached: boolean; locked: boolean }): void {
    captureAnalyticsEvent('usage_range_changed', properties);
  },

  agentCreateStarted(properties: { source: string }): void {
    captureAnalyticsEvent('agent_create_started', properties);
  },

  agentSaveTapped(properties: { fallback_count: number; has_model: boolean; has_name: boolean }): void {
    captureAnalyticsEvent('agent_save_tapped', properties);
  },

  toolsSaveTapped(properties: { changed_count: number; enabled_count: number; total_count: number }): void {
    captureAnalyticsEvent('tools_save_tapped', properties);
  },

  modelsSaveTapped(properties: { fallback_count: number; has_primary_model: boolean; has_thinking_default: boolean }): void {
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

  modelAddTapped(properties: { provider: string; has_custom_name: boolean; source: string }): void {
    captureAnalyticsEvent('model_add_tapped', properties);
  },

  modelAllowlistToggled(properties: { provider: string; enabled: boolean; source: string }): void {
    captureAnalyticsEvent('model_allowlist_toggled', properties);
  },

  modelDeleteTapped(properties: { provider: string; blocked_reference_count: number; source: string }): void {
    captureAnalyticsEvent('model_delete_tapped', properties);
  },

  gatewayConfigViewOpened(properties: { source: string }): void {
    captureAnalyticsEvent('gateway_config_view_opened', properties);
  },

  gatewayConfigBackupCreated(properties: { source: string; backup_count: number }): void {
    captureAnalyticsEvent('gateway_config_backup_created', properties);
  },

  gatewayConfigRestoreTapped(properties: { source: string; backup_count: number }): void {
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

  chatAppearanceOpened(properties: { source: string }): void {
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
};
