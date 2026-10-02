import {
  ANALYTICS_EVENT_PROPERTY_WHITELIST,
  ANALYTICS_GLOBAL_EVENT_PROPERTIES,
  analyticsAgentDocument,
  analyticsEvents,
  sanitizeAnalyticsEventProperties,
} from './events';
import { posthogClient, recordPostHogDiagnosticEvent } from './posthog';
import { syncAnalyticsSubscriptionContext } from './subscription-context';

jest.mock('./posthog', () => ({
  posthogClient: {
    capture: jest.fn(),
    register: jest.fn(() => Promise.resolve()),
    setPersonProperties: jest.fn(),
  },
  recordPostHogDiagnosticEvent: jest.fn(),
}));

const SPEC_EVENT_PROPERTIES: Readonly<Record<string, ReadonlyArray<string>>> = {
  agent_file_activity: ['action', 'backend', 'document'],
  chat_voice_input_timing: ['stage', 'duration_ms', 'queue_ms', 'activate_ms', 'engine_ms', 'start_ms', 'warm', 'input_route', 'bluetooth', 'other_audio'],
  channel_dm_scope_changed: ['scope'],
  channel_account_toggled: ['channel', 'enabled'],
  onboarding_viewed: ['source'],
  pairing_code_submitted: ['length_ok'],
  onboarding_agent_prompt_copied: ['backend'],
  gateway_connect_saved: ['backend', 'transport', 'source'],
  gateway_secure_pairing_finished: ['method', 'environment', 'connected'],
  connect_attempt: ['backend', 'transport', 'reason'],
  connect_phase: ['protocol', 'route', 'phase', 'elapsed_ms', 'phase_ms', 'attempt'],
  connect_ready: ['backend', 'transport', 'elapsed_ms', 'attempt'],
  connect_failed: ['backend', 'transport', 'code', 'stage', 'attempt'],
  connection_diagnostic: ['backend', 'transport', 'operation', 'environment', 'detected_backend', 'detected_environment', 'outcome', 'phase', 'code', 'http_status', 'elapsed_ms', 'network', 'evidence'],
  transport_diagnostic: ['backend', 'transport', 'environment', 'event', 'phase', 'code', 'close_code', 'elapsed_ms'],
  reconnect: ['backend', 'transport', 'reason', 'origin', 'cause'],
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
  skill_discover_detail_viewed: ['source', 'backend'],
  usage_range_changed: ['range', 'cached', 'locked'],
  search_performed: ['scope', 'has_results', 'result_kinds'],
  search_message_opened: ['is_pro'],
  paywall_plan_change_submitted: ['package_id', 'package_type', 'price_string', 'blocked_feature', 'preview_only', 'hero', 'variant', 'trigger_screen', 'launch'],
  paywall_manage_subscription_tapped: ['blocked_feature', 'preview_only', 'hero', 'variant', 'trigger_screen', 'launch'],
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
  app_update_announcement_shown: ['version', 'release_count', 'entry_count', 'source'],
  app_update_announcement_closed: ['version', 'release_count', 'source', 'action', 'seconds_visible'],
  app_update_announcement_entry_tapped: ['version', 'entry', 'action'],
  release_notes_opened: ['release_count'],
  grace_banner_viewed: ['days_left'],
  grace_expired: ['days_left'],
  app_rating_tapped: ['source', 'result'],
};

const RETAINED_COMPAT_EVENT_NAMES = [
  'agent_create_started',
  'agent_save_tapped',
  'app_icon_changed',
  'chat_appearance_opened',
  'chat_appearance_saved',
  'chat_model_selected',
  'chat_skill_picker_opened',
  'chat_skill_selected',
  'chat_slash_command_triggered',
  'chat_voice_input_failed',
  'chat_voice_input_tapped',
  'cron_create_tapped',
  'cron_save_succeeded',
  'gateway_config_backup_created',
  'gateway_config_restore_tapped',
  'gateway_config_view_opened',
  'gateway_scan_qr_tapped',
  'heartbeat_save_tapped',
  'message_favorite_toggled',
  'model_add_tapped',
  'model_allowlist_toggled',
  'model_cost_save_tapped',
  'model_delete_tapped',
  'models_save_tapped',
  'onboarding_docs_opened',
  'paywall_restore_failed',
  'paywall_restore_succeeded',
  'paywall_restore_tapped',
  'skill_install_tapped',
  'theme_accent_changed',
  'tools_save_tapped',
] as const;

describe('analytics event privacy boundary', () => {
  const mockedPostHogClient = posthogClient as jest.Mocked<NonNullable<typeof posthogClient>>;
  const mockedRecordDiagnostic = recordPostHogDiagnosticEvent as jest.MockedFunction<
    typeof recordPostHogDiagnosticEvent
  >;

  beforeEach(() => {
    jest.clearAllMocks();
    syncAnalyticsSubscriptionContext(null);
  });

  it('exactly covers every 3.0 event property contract and names intentional compatibility events', () => {
    for (const [event, expectedProperties] of Object.entries(SPEC_EVENT_PROPERTIES)) {
      expect(ANALYTICS_EVENT_PROPERTY_WHITELIST).toHaveProperty(event);
      expect(ANALYTICS_EVENT_PROPERTY_WHITELIST[event as keyof typeof ANALYTICS_EVENT_PROPERTY_WHITELIST])
        .toEqual(expectedProperties);
    }
    expect(Object.keys(ANALYTICS_EVENT_PROPERTY_WHITELIST).sort()).toEqual([
      ...Object.keys(SPEC_EVENT_PROPERTIES),
      ...RETAINED_COMPAT_EVENT_NAMES,
    ].sort());
  });

  it('exercises every whitelist entry and keeps only its declared properties', () => {
    const entries = Object.entries(ANALYTICS_EVENT_PROPERTY_WHITELIST);
    expect(entries.length).toBeGreaterThanOrEqual(Object.keys(SPEC_EVENT_PROPERTIES).length);

    for (const [event, allowedProperties] of entries) {
      expect(new Set(allowedProperties).size).toBe(allowedProperties.length);
      const expected = Object.fromEntries(allowedProperties.map((property) => [
        property,
        event === 'transport_diagnostic' && property === 'close_code' ? 1006
          : event === 'transport_diagnostic' && property === 'elapsed_ms' ? 1000 : true,
      ]));
      const input = { ...expected, message_text: 'private message', raw_id: 'private-id' };
      expect(sanitizeAnalyticsEventProperties(event as keyof typeof ANALYTICS_EVENT_PROPERTY_WHITELIST, input))
        .toEqual(expected);
    }
  });

  it('excludes removed event names and high-cardinality legacy properties', () => {
    const names = Object.keys(ANALYTICS_EVENT_PROPERTY_WHITELIST);
    expect(names).not.toEqual(expect.arrayContaining([
      'live_session_opened',
      'console_entry_tapped',
      'discover_search_changed',
      'clawhub_install_tapped',
      'lifetime_upgrade_announcement_shown',
      'chat_exec_approval_resolved',
      'pair_request_resolved',
    ]));
    expect(names.some((name) => name.startsWith('office_'))).toBe(false);
    expect(names.some((name) => name.startsWith('discover_'))).toBe(false);
    expect(names.some((name) => name.startsWith('clawhub_'))).toBe(false);

    const allProperties = new Set(Object.values(ANALYTICS_EVENT_PROPERTY_WHITELIST).flat());
    expect([...allProperties]).not.toEqual(expect.arrayContaining([
      'current_agent_id',
      'device_id',
      'message_text',
      'session_key_prefix',
      'skill_id',
      'skill_name',
      'model_id',
      'model_name',
      'provider_model',
      'slash_command',
      'command',
      'command_key',
    ]));
  });

  it('drops unknown, non-finite, and unexpectedly long runtime values', () => {
    expect(sanitizeAnalyticsEventProperties('connect_failed', {
      backend: 'hermes',
      transport: 'relay',
      code: 'bridge_offline',
      stage: 'ready',
      attempt: Number.NaN,
      raw_id: 'secret',
      subscription_status: 'free',
      subscription_type: 'none',
      subscription_tenure_bucket: 'none',
      is_pro: false,
      is_premium: false,
      reason: 'x'.repeat(129),
    })).toEqual({
      backend: 'hermes',
      transport: 'relay',
      code: 'bridge_offline',
      stage: 'ready',
      subscription_status: 'free',
      subscription_type: 'none',
      subscription_tenure_bucket: 'none',
      is_pro: false,
      is_premium: false,
    });
    expect(ANALYTICS_GLOBAL_EVENT_PROPERTIES).toEqual([
      'subscription_status',
      'subscription_type',
      'subscription_tenure_bucket',
      'is_pro',
      'is_premium',
    ]);
  });

  it('collapses runtime-derived provider aliases, error codes, rows, and store failures', () => {
    expect(sanitizeAnalyticsEventProperties('chat_model_selected', {
      provider: 'custom:moonshot-private',
      source: 'chat_model_picker',
    })).toEqual({ provider: 'custom', source: 'chat_model_picker' });
    expect(sanitizeAnalyticsEventProperties('model_add_tapped', {
      provider: 'Tenant Specific Provider',
    })).toEqual({ provider: 'other' });
    expect(sanitizeAnalyticsEventProperties('connect_failed', {
      code: 'customer-secret-error',
    })).toEqual({ code: 'other' });
    expect(sanitizeAnalyticsEventProperties('settings_row_opened', {
      row: 'skills.discover',
    })).toEqual({ row: 'skills_discover' });
    expect(sanitizeAnalyticsEventProperties('settings_row_opened', {
      row: 'private tenant row',
    })).toEqual({ row: 'other' });
    expect(sanitizeAnalyticsEventProperties('paywall_purchase_failed', {
      reason: 'store_error:merchant_private_code',
    })).toEqual({ reason: 'store_error:OTHER' });
    expect(sanitizeAnalyticsEventProperties('paywall_restore_failed', {
      reason: 'store_error:RESTORE_NOT_FOUND',
    })).toEqual({ reason: 'store_error:RESTORE_NOT_FOUND' });
  });

  it('converts legacy connection inputs to the canonical backend and transport properties', () => {
    analyticsEvents.gatewayConnectSaved({
      mode: 'tailscale',
      is_editing: false,
      has_password: false,
      has_token: true,
      source: 'onboarding',
    });

    expect(mockedPostHogClient.capture).toHaveBeenCalledWith('gateway_connect_saved', {
      subscription_status: 'free',
      subscription_type: 'none',
      subscription_tenure_bucket: 'none',
      is_pro: false,
      is_premium: false,
      backend: 'openclaw',
      transport: 'tailscale',
      source: 'onboarding',
    });
  });

  it('captures each approval kind through the canonical event helper', () => {
    analyticsEvents.approvalResolved({ kind: 'exec', decision: 'allow-once' });
    analyticsEvents.approvalResolved({ kind: 'pair', decision: 'reject' });

    expect(mockedPostHogClient.capture).toHaveBeenNthCalledWith(1, 'approval_resolved', expect.objectContaining({
      kind: 'exec',
      decision: 'allow-once',
    }));
    expect(mockedPostHogClient.capture).toHaveBeenNthCalledWith(2, 'approval_resolved', expect.objectContaining({
      kind: 'pair',
      decision: 'reject',
    }));
  });

  it('removes raw model, skill, command, and session identifiers from retained events', () => {
    analyticsEvents.chatModelSelected({
      provider_model: 'provider/private-model',
      model_id: 'private-model',
      model_name: 'Private model',
      provider: 'openai',
      source: 'picker',
      session_key_present: true,
    });
    analyticsEvents.chatSkillSelected({
      source: 'picker',
      action: 'select',
      skill_id: 'private-skill-id',
      skill_name: 'Private skill name',
      session_key_present: true,
    });
    analyticsEvents.chatSlashCommandTriggered({
      command_key: 'private-key',
      command: '/private arguments',
      action: 'send',
      source: 'picker',
      session_key_present: true,
    });
    analyticsEvents.chatSessionSelected({
      source: 'panel',
      session_kind: 'main',
      session_key_prefix: 'agent:private',
    });

    const serialized = JSON.stringify(mockedPostHogClient.capture.mock.calls);
    expect(serialized).not.toContain('private-model');
    expect(serialized).not.toContain('private-skill');
    expect(serialized).not.toContain('/private');
    expect(serialized).not.toContain('agent:private');
    expect(mockedPostHogClient.capture).toHaveBeenLastCalledWith(
      'chat_session_selected',
      expect.objectContaining({ from: 'panel' }),
    );
  });

  it('records the same sanitized payload in the local diagnostics ring', () => {
    analyticsEvents.rosterViewed({
      connection_count: 2,
      agent_count: 4,
      pinned_count: 1,
      unread_count: 3,
      attention_count: 1,
    });

    expect(mockedRecordDiagnostic).toHaveBeenCalledWith(
      'event',
      'roster_viewed',
      expect.objectContaining({ connection_count: 2, agent_count: 4 }),
    );
  });

  it('captures theme changes and updates the matching super property', () => {
    analyticsEvents.themeAccentChanged({ selected_accent_id: 'rosePink', source: 'account_settings' });

    expect(mockedPostHogClient.setPersonProperties).toHaveBeenCalledWith(
      { theme_accent_id: 'rosePink' },
      undefined,
      false,
    );
    expect(mockedPostHogClient.register).toHaveBeenCalledWith({ theme_accent_id: 'rosePink' });
  });
});


test('channel routing telemetry keeps bounded platform ids and scopes only', () => {
  expect(sanitizeAnalyticsEventProperties('channel_dm_scope_changed', {
    scope: 'per-channel-peer', accountId: 'private account',
  })).toEqual({ scope: 'per-channel-peer' });
  expect(sanitizeAnalyticsEventProperties('channel_dm_scope_changed', { scope: 'per-room' })).toEqual({ scope: 'other' });
  expect(sanitizeAnalyticsEventProperties('channel_account_toggled', {
    channel: 'Telegram', enabled: false, accountId: 'private account', name: 'private name',
  })).toEqual({ channel: 'telegram', enabled: false });
  expect(sanitizeAnalyticsEventProperties('channel_account_toggled', { channel: 'my-private-plugin', enabled: true }))
    .toEqual({ channel: 'other', enabled: true });
});

test('voice start timing keeps bounded step durations and port categories only', () => {
  expect(sanitizeAnalyticsEventProperties('chat_voice_input_timing', {
    stage: 'native_started', duration_ms: 120, queue_ms: 1, activate_ms: 0, engine_ms: 3, start_ms: 96,
    warm: true, input_route: 'bluetooth', bluetooth: true, other_audio: false, device_name: 'private headset',
  })).toEqual({
    stage: 'native_started', duration_ms: 120, queue_ms: 1, activate_ms: 0, engine_ms: 3, start_ms: 96,
    warm: true, input_route: 'bluetooth', bluetooth: true, other_audio: false,
  });
  expect(sanitizeAnalyticsEventProperties('chat_voice_input_timing', { input_route: 'Lucy AirPods Pro' }))
    .toEqual({ input_route: 'other' });
});

test('agent file editing telemetry excludes source content and unbounded labels', () => {
  expect(sanitizeAnalyticsEventProperties('agent_file_activity', {
    action: 'saved', backend: 'openclaw', document: 'memory', content: 'private source', agentId: 'private identity',
  })).toEqual({ action: 'saved', backend: 'openclaw', document: 'memory' });
  expect(sanitizeAnalyticsEventProperties('agent_file_activity', { document: 'private filename' })).toEqual({ document: 'other' });
  expect(analyticsAgentDocument('SOUL.md')).toBe('soul');
  expect(analyticsAgentDocument('notes/private.md')).toBe('other');
});

it('closes every free-text path in connection diagnostics and drops payloads and identities', () => {
  const privateText = 'private message https://host/?token=secret /Users/private';
  const properties = Object.fromEntries(ANALYTICS_EVENT_PROPERTY_WHITELIST.connection_diagnostic.map(key => [key, privateText]));
  const sanitized = sanitizeAnalyticsEventProperties('connection_diagnostic', {
    ...properties, message: privateText, payload: privateText, ssid: privateText, ip: privateText,
    token: privateText, gatewayId: privateText, diagnosticId: privateText, clientLabel: privateText,
  });
  expect(Object.keys(sanitized)).toEqual([...ANALYTICS_EVENT_PROPERTY_WHITELIST.connection_diagnostic]);
  expect(new Set(Object.values(sanitized))).toEqual(new Set(['other']));
  expect(sanitizeAnalyticsEventProperties('connection_diagnostic', { code: 'unknown', phase: 'body', http_status: 429 }))
    .toEqual({ code: 'unknown', phase: 'body', http_status: 429 });
});

it('retains fixed pairing validation evidence and drops QR contents', () => {
  expect(sanitizeAnalyticsEventProperties('connection_diagnostic', {
    backend: 'openclaw', detected_backend: 'codex', operation: 'pair_validation',
    environment: 'production', detected_environment: 'preview', phase: 'pair_payload',
    code: 'pairing_backend_mismatch', network: 'not_sampled', evidence: 'local_validation',
    qr: 'private QR', accessCode: 'private code', url: 'https://private/?secret=private',
  })).toEqual({
    backend: 'openclaw', detected_backend: 'codex', operation: 'pair_validation',
    environment: 'production', detected_environment: 'preview', phase: 'pair_payload',
    code: 'pairing_backend_mismatch', network: 'not_sampled', evidence: 'local_validation',
  });
});


it('bounds transport diagnostics and separates a recovery trigger from its underlying cause', () => {
  const privateText = 'private URL token path message';
  const props = Object.fromEntries(ANALYTICS_EVENT_PROPERTY_WHITELIST.transport_diagnostic.map(key => [key, privateText]));
  const sanitized = sanitizeAnalyticsEventProperties('transport_diagnostic', { ...props, message: privateText, url: privateText, reason: privateText });
  expect(sanitized).toEqual({ backend: 'other', transport: 'other', environment: 'other', event: 'other', phase: 'other', code: 'other' });
  expect(sanitizeAnalyticsEventProperties('transport_diagnostic', { backend: 'pi', event: 'close', phase: 'connecting', code: 'ws_error', close_code: 1006, elapsed_ms: 24, nativeError: privateText }))
    .toEqual({ backend: 'pi', event: 'close', phase: 'connecting', code: 'ws_error', close_code: 1006, elapsed_ms: 24 });
  expect(sanitizeAnalyticsEventProperties('transport_diagnostic', { close_code: 999, elapsed_ms: -1 })).toEqual({});
  expect(sanitizeAnalyticsEventProperties('transport_diagnostic', { close_code: 5000, elapsed_ms: 86_400_001 })).toEqual({});
  expect(sanitizeAnalyticsEventProperties('reconnect', { backend: 'openclaw', transport: 'relay', reason: 'probe_failed', origin: 'health_probe', cause: 'socket_open_timeout', message: privateText }))
    .toEqual({ backend: 'openclaw', transport: 'relay', reason: 'probe_failed', origin: 'health_probe', cause: 'socket_open_timeout' });
  expect(sanitizeAnalyticsEventProperties('reconnect', { origin: privateText, cause: privateText, reason: privateText }))
    .toEqual({ origin: 'other', cause: 'other', reason: 'other' });
});
