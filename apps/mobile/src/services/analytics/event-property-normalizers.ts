import type { AnalyticsEventName } from './events';

const ANALYTICS_MODEL_PROVIDERS = new Set([
  'anthropic',
  'azure',
  'azure-openai',
  'bedrock',
  'cerebras',
  'cohere',
  'deepseek',
  'fireworks',
  'gemini',
  'google',
  'google-gemini',
  'groq',
  'hermes',
  'lmstudio',
  'mistral',
  'ollama',
  'openai',
  'openai-codex',
  'openclaw',
  'openrouter',
  'perplexity',
  'together',
  'venice',
  'xai',
  'youmind',
]);

const CONNECTION_ERROR_CODES = new Set([
  'aborted',
  'bad_token',
  'bootstrap_handoff_failed',
  'bridge_offline',
  'challenge_failed',
  'challenge_timeout',
  'config_missing',
  'connection_failed',
  'connection_restarted',
  'first_frame_timeout',
  'first_health_timeout',
  'frame_too_large',
  'gateway_offline',
  'heartbeat_timeout',
  'invalid_connect_challenge',
  'invalid_frame',
  'invalid_json',
  'invalid_request',
  'network',
  'not_connected',
  'pairing_expired',
  'pairing_required',
  'rate_limited',
  'request_timeout',
  'server',
  'timeout',
  'unauthorized',
  'unsupported',
  'ws_connect_timeout',
  'ws_error',
  'ws_open_failed',
]);

const VOICE_ERROR_CODES = new Set([
  'ERR_MICROPHONE_PERMISSION_DENIED',
  'ERR_SPEECH_PERMISSION_DENIED',
  'ERR_SPEECH_START_FAILED',
  'ERR_SPEECH_UNAVAILABLE',
]);

const SETTINGS_ROWS = new Set([
  'channels_devices',
  'channels_devices_channels',
  'channels_devices_devices',
  'channels_devices_nodes',
  'connection',
  'connection_bridge_capabilities',
  'connection_bridge_version',
  'connection_environment',
  'connection_last_ready',
  'connection_reconnect',
  'connection_remove',
  'connection_status',
  'cron',
  'cron_create',
  'cron_heartbeat',
  'cron_tasks',
  'files',
  'files_browse',
  'files_edit',
  'identity',
  'identity_profile',
  'logs',
  'logs_view',
  'models',
  'models_default',
  'models_providers_cost',
  'models_thinking',
  'openclaw',
  'openclaw_backups',
  'openclaw_config',
  'openclaw_diagnostics',
  'openclaw_permissions',
  'providers',
  'skills',
  'skills_discover',
  'skills_installed',
  'tools',
  'tools_catalog',
  'usage',
  'usage_activity',
  'usage_cost',
]);

const PAYWALL_FAILURE_REASONS = new Set([
  'cancelled',
  'pending',
  'offerings_unavailable',
]);

const STORE_ERROR_CODES = new Set([
  'BILLING_UNAVAILABLE',
  'CONFIGURATION_ERROR',
  'ENTITLEMENT_INACTIVE',
  'ITEM_UNAVAILABLE',
  'NETWORK_ERROR',
  'PAYMENT_PENDING_ERROR',
  'PRODUCT_ALREADY_PURCHASED_ERROR',
  'PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR',
  'PURCHASE_CANCELLED_ERROR',
  'PURCHASE_NOT_ALLOWED_ERROR',
  'RESTORE_NOT_FOUND',
  'STORE_PROBLEM_ERROR',
  'UNKNOWN',
]);

function normalizeAnalyticsToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizeAnalyticsModelProvider(value: string): string {
  const provider = value.trim().toLowerCase();
  if (provider === 'custom' || provider.startsWith('custom:')) return 'custom';
  return ANALYTICS_MODEL_PROVIDERS.has(provider) ? provider : 'other';
}

function normalizeAnalyticsCode(event: AnalyticsEventName, value: string): string {
  if (event === 'chat_voice_input_failed') {
    const code = value.trim().toUpperCase();
    return VOICE_ERROR_CODES.has(code) ? code : 'other';
  }
  const code = normalizeAnalyticsToken(value);
  return CONNECTION_ERROR_CODES.has(code) ? code : 'other';
}

/** Release versions are bounded by the catalog; anything else is `other`. */
function normalizeAppVersion(value: string): string {
  const version = value.trim();
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(version) ? version : 'other';
}

function normalizeSettingsRow(value: string): string {
  const row = normalizeAnalyticsToken(value);
  return SETTINGS_ROWS.has(row) ? row : 'other';
}

function normalizePaywallFailureReason(value: string): string {
  const reason = value.trim();
  if (PAYWALL_FAILURE_REASONS.has(reason)) return reason;
  if (!reason.startsWith('store_error:')) return 'other';
  const code = reason.slice('store_error:'.length).trim().toUpperCase();
  return `store_error:${STORE_ERROR_CODES.has(code) ? code : 'OTHER'}`;
}

export function normalizeAnalyticsEventString(
  event: AnalyticsEventName,
  property: string,
  value: string,
): string {
  if (event === 'agent_file_activity') {
    const allowed: Record<string, readonly string[]> = {
      action: ['edit', 'saved', 'failed'],
      document: ['agents', 'soul', 'identity', 'user', 'bootstrap', 'memory'],
      backend: ['openclaw', 'hermes', 'youmind', 'local-model'],
    };
    return allowed[property]?.includes(value) ? value : 'other';
  }
  if (property === 'provider') return normalizeAnalyticsModelProvider(value);
  if (property === 'code') return normalizeAnalyticsCode(event, value);
  if (event === 'settings_row_opened' && property === 'row') return normalizeSettingsRow(value);
  if (event.startsWith('app_update_announcement_')) {
    if (property === 'version') return normalizeAppVersion(value);
    if (property === 'entry') return normalizeAnalyticsToken(value).slice(0, 48) || 'other';
  }
  if (
    (event === 'paywall_purchase_failed' || event === 'paywall_restore_failed')
    && property === 'reason'
  ) {
    return normalizePaywallFailureReason(value);
  }
  return value;
}
