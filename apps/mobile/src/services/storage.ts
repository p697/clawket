import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { sha256 } from 'js-sha256';
import {
  AccentColorId,
  DeviceIdentity,
  GatewayBackendKind,
  GatewayConfig,
  GatewayConfigsState,
  GatewayMode,
  GatewayProfileMode,
  GatewayProfilesConfig,
  GatewayTransportKind,
  SavedGatewayConfig,
  SpeechRecognitionLanguage,
  ChatAppearanceSettings,
  ThemeMode,
} from '../types';
import { defaultAccentId, isBuiltInAccentId } from '../theme/accents';
import { DEFAULT_CHAT_APPEARANCE, normalizeChatAppearanceSettings } from '../features/chat-appearance/defaults';
import {
  resolveExistingStoredChatBackgroundImagePath,
  toStoredChatBackgroundImagePath,
} from '../features/chat-appearance/image-store';
import {
  DEFAULT_NODE_CAPABILITY_TOGGLES,
  NodeCapabilityToggles,
  normalizeNodeCapabilityToggles,
} from './node-capabilities';
import {
  isGatewayBackendKind,
  isGatewayTransportKind,
  resolveGatewayBackendKind,
  resolveGatewayTransportKind,
  toLegacyGatewayMode,
} from '@clawket/agent-protocol';
import { resolveSavedGatewayName } from '../connection/registry/connection-name';
import type { ProSubscriptionSnapshot } from './pro-subscription';
import {
  normalizeAutoAppReviewState,
  type AutoAppReviewState,
} from './auto-app-review-state';

export type { AutoAppReviewState } from './auto-app-review-state';

export type NodeInvokeAuditEntry = {
  id: string;
  nodeId: string;
  command: string;
  source: string;
  timestampMs: number;
  result: 'success' | 'error';
  errorCode?: string;
  errorMessage?: string;
};

export type SavedPrompt = {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  pinnedAt?: number;
};

export type DashboardCacheEntry<T = Record<string, unknown>> = {
  version: 2;
  cacheKey: string;
  savedAt: number;
  source: 'network';
  connectionStateAtSave: string;
  data: T;
};

export type LastOpenedSessionSnapshot = {
  sessionKey: string;
  sessionId?: string;
  sessionLabel?: string;
  updatedAt: number;
  agentId: string;
  agentName?: string;
  agentEmoji?: string;
  agentAvatarUri?: string;
};

export type CachedAgentIdentitySnapshot = {
  agentId: string;
  updatedAt: number;
  agentName?: string;
  agentEmoji?: string;
  agentAvatarUri?: string;
};

export type GatewayConfigBackupEntry = {
  version: 1;
  id: string;
  createdAt: number;
  config: Record<string, unknown>;
};

export type GatewayConfigBackupSummary = {
  id: string;
  createdAt: number;
};

export type DeviceTokenStorageScope = {
  serverUrl?: string | null;
  gatewayId?: string | null;
  gatewayUrl?: string | null;
  /** Operator keeps the legacy key; other roles are isolated suffixes. */
  role?: string | null;
};

export type DeviceTokenRecord = {
  version: 1;
  token: string;
  role: string;
  scopes: string[];
  updatedAtMs: number;
};

export type YouMindAuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  createdAtMs: number;
  user?: {
    id?: string;
    email?: string;
    name?: string;
    avatarUrl?: string;
  } | null;
};

type ProSubscriptionCacheEntry = {
  snapshot: ProSubscriptionSnapshot;
  cachedAtMs: number;
};

const KEYS = {
  identity: 'clawket.identity.v1',
  gatewayConfig: 'clawket.gatewayConfig.v1',
  gatewayProfilesConfig: 'clawket.gatewayProfilesConfig.v1',
  gatewayConfigsState: 'clawket.gatewayConfigsState.v1',
  deviceTokenPrefix: 'clawket.deviceToken.',
  debugMode: 'clawket.debugMode.v1',
  relayServiceEnvironment: 'clawket.relayServiceEnvironment.v1',
  showAgentAvatar: 'clawket.showAgentAvatar.v1',
  themeMode: 'clawket.themeMode.v1',
  accentColor: 'clawket.accentColor.v1',
  currentAgentId: 'clawket.currentAgentId.v1',
  showModelUsage: 'clawket.showModelUsage.v1',
  execApproval: 'clawket.execApproval.v1',
  chatFontSize: 'clawket.chatFontSize.v1',
  chatAppearance: 'clawket.chatAppearance.v1',
  speechRecognitionLanguage: 'clawket.speechRecognitionLanguage.v1',
  lastSessionKey: 'clawket.lastSessionKey.v1',
  lastOpenedSessionSnapshotPrefix: 'clawket.lastOpenedSessionSnapshot.v1',
  cachedAgentIdentityPrefix: 'clawket.cachedAgentIdentity.v1',
  nodeEnabled: 'clawket.nodeEnabled.v1',
  nodeCapabilityToggles: 'clawket.nodeCapabilityToggles.v1',
  userPrompts: 'clawket.userPrompts.v1',
  userPromptsSeeded: 'clawket.userPrompts.seeded.v1',
  promptPeekShown: 'clawket.promptPeekShown.v1',
  proSubscriptionSnapshot: 'clawket.proSubscriptionSnapshot.v1',
  lifetimeUpgradeAnnouncementShown: 'clawket.lifetimeUpgradeAnnouncementShown.v1',
  autoAppReviewState: 'clawket.autoAppReviewState.v1',
  youmindAuthPrefix: 'clawket.youmind.auth.v1',
  youmindDeviceId: 'clawket.youmind.deviceId.v1',
} as const;

const NODE_INVOKE_AUDIT_KEY = 'clawket.nodeInvokeAudit.v1';
const MAX_NODE_INVOKE_AUDIT_ENTRIES = 50;
const LEGACY_DASHBOARD_CACHE_KEY = 'clawket.dashboard.cache.v1';
const DASHBOARD_CACHE_PREFIX = 'clawket.dashboard.cache.v2:';
const GATEWAY_CONFIG_BACKUP_PREFIX = 'clawket.gatewayConfigBackup.v1.';

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function lastSessionKeyStorageKey(scopeId?: string): string {
  const normalizedScope = scopeId?.trim();
  return normalizedScope
    ? `${KEYS.lastSessionKey}.${normalizedScope}`
    : KEYS.lastSessionKey;
}

function lastOpenedSessionSnapshotStorageKey(scopeId: string, agentId?: string): string {
  return agentId
    ? `${KEYS.lastOpenedSessionSnapshotPrefix}.${scopeId}::${agentId}`
    : `${KEYS.lastOpenedSessionSnapshotPrefix}.${scopeId}`;
}

function cachedAgentIdentityStorageKey(scopeId: string, agentId: string): string {
  return `${KEYS.cachedAgentIdentityPrefix}.${scopeId}::${agentId}`;
}

function normalizeYouMindScope(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return 'default';
  return sha256(trimmed.replace(/\/+$/, '').toLowerCase());
}

function normalizeYouMindScopeKey(scopeKey?: string | null): string | null {
  const trimmed = scopeKey?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('cfg:')) {
    return trimmed.slice(4).trim() || null;
  }
  return trimmed;
}

function normalizeYouMindScopedStorageKey(url: string, scopeKey?: string | null): string {
  const normalizedScope = normalizeYouMindScopeKey(scopeKey);
  if (normalizedScope) {
    return `scope.${sha256(normalizedScope)}`;
  }
  return normalizeYouMindScope(url);
}

function youmindAuthStorageKey(url: string, scopeKey?: string | null): string {
  return `${KEYS.youmindAuthPrefix}.${normalizeYouMindScopedStorageKey(url, scopeKey)}`;
}

function youmindPrefixedScopeAuthStorageKey(url: string, scopeKey?: string | null): string | null {
  const trimmed = scopeKey?.trim();
  if (!trimmed || trimmed.startsWith('cfg:')) return null;
  return `${KEYS.youmindAuthPrefix}.${normalizeYouMindScopedStorageKey(url, `cfg:${trimmed}`)}`;
}

function youmindLegacyAuthStorageKey(url: string): string {
  return `${KEYS.youmindAuthPrefix}.${normalizeYouMindScope(url)}`;
}

function normalizeDeviceTokenScopePart(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}

function legacyDeviceTokenStorageKey(deviceId: string): string {
  return `${KEYS.deviceTokenPrefix}${deviceId.trim()}`;
}

function deviceTokenStorageKey(deviceId: string, scope?: DeviceTokenStorageScope): string {
  const normalizedDeviceId = deviceId.trim();
  const role = normalizeDeviceTokenScopePart(scope?.role).toLowerCase();
  const roleSuffix = role && role !== 'operator' ? `_role_${sha256(role)}` : '';
  const serverUrl = normalizeDeviceTokenScopePart(scope?.serverUrl);
  const gatewayId = normalizeDeviceTokenScopePart(scope?.gatewayId);
  if (serverUrl && gatewayId) {
    return `${legacyDeviceTokenStorageKey(normalizedDeviceId)}_relay_${sha256(`${serverUrl}::${gatewayId}`)}${roleSuffix}`;
  }

  const gatewayUrl = normalizeDeviceTokenScopePart(scope?.gatewayUrl);
  if (gatewayUrl) {
    return `${legacyDeviceTokenStorageKey(normalizedDeviceId)}_url_${sha256(gatewayUrl)}${roleSuffix}`;
  }

  return `${legacyDeviceTokenStorageKey(normalizedDeviceId)}${roleSuffix}`;
}

function normalizeDeviceTokenRecord(value: string | null): DeviceTokenRecord | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const token = typeof parsed.token === 'string' ? parsed.token.trim() : '';
    const role = typeof parsed.role === 'string' ? parsed.role.trim() : '';
    const scopes = Array.isArray(parsed.scopes)
      ? [...new Set(parsed.scopes
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean))].sort()
      : [];
    const updatedAtMs = typeof parsed.updatedAtMs === 'number' && Number.isFinite(parsed.updatedAtMs)
      ? parsed.updatedAtMs
      : 0;
    if (parsed.version !== 1 || !token || !role) return null;
    return { version: 1, token, role, scopes, updatedAtMs };
  } catch {
    return {
      version: 1,
      token: trimmed,
      role: 'operator',
      scopes: [],
      updatedAtMs: 0,
    };
  }
}

async function readStoredDeviceTokenValue(
  deviceId: string,
  scope?: DeviceTokenStorageScope,
): Promise<string | null> {
  const scopedKey = deviceTokenStorageKey(deviceId, scope);
  const scopedValue = await SecureStore.getItemAsync(scopedKey, SECURE_OPTIONS);
  if (scopedValue) return scopedValue;
  const role = normalizeDeviceTokenScopePart(scope?.role).toLowerCase();
  // A legacy token has operator semantics. Never offer it to another role.
  if (role && role !== 'operator') return null;
  if (scopedKey === legacyDeviceTokenStorageKey(deviceId)) return scopedValue;
  return SecureStore.getItemAsync(legacyDeviceTokenStorageKey(deviceId), SECURE_OPTIONS);
}

function normalizeLastOpenedSessionSnapshot(value: unknown): LastOpenedSessionSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const sessionKey = typeof record.sessionKey === 'string' ? record.sessionKey.trim() : '';
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : '';
  const sessionLabel = typeof record.sessionLabel === 'string' ? record.sessionLabel.trim() : '';
  const updatedAt = typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
    ? record.updatedAt
    : 0;
  const agentId = typeof record.agentId === 'string' ? record.agentId.trim() : '';
  const agentName = typeof record.agentName === 'string' ? record.agentName.trim() : '';
  const agentEmoji = typeof record.agentEmoji === 'string' ? record.agentEmoji.trim() : '';
  const agentAvatarUri = typeof record.agentAvatarUri === 'string' ? record.agentAvatarUri.trim() : '';

  if (!sessionKey || !agentId || updatedAt <= 0) return null;

  return {
    sessionKey,
    sessionId: sessionId || undefined,
    sessionLabel: sessionLabel || undefined,
    updatedAt,
    agentId,
    agentName: agentName || undefined,
    agentEmoji: agentEmoji || undefined,
    agentAvatarUri: agentAvatarUri || undefined,
  };
}

function normalizeYouMindAuthSession(value: unknown): YouMindAuthSession | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const accessToken = typeof record.accessToken === 'string' ? record.accessToken.trim() : '';
  const refreshToken = typeof record.refreshToken === 'string' ? record.refreshToken.trim() : '';
  const expiresIn = typeof record.expiresIn === 'number' && Number.isFinite(record.expiresIn)
    ? record.expiresIn
    : 0;
  const createdAtMs = typeof record.createdAtMs === 'number' && Number.isFinite(record.createdAtMs)
    ? record.createdAtMs
    : 0;
  if (!accessToken || !refreshToken || expiresIn <= 0 || createdAtMs <= 0) return null;
  const rawUser = record.user;
  const user = rawUser && typeof rawUser === 'object'
    ? {
      id: typeof (rawUser as Record<string, unknown>).id === 'string'
        ? ((rawUser as Record<string, unknown>).id as string).trim() || undefined
        : undefined,
      email: typeof (rawUser as Record<string, unknown>).email === 'string'
        ? ((rawUser as Record<string, unknown>).email as string).trim() || undefined
        : undefined,
      name: typeof (rawUser as Record<string, unknown>).name === 'string'
        ? ((rawUser as Record<string, unknown>).name as string).trim() || undefined
        : undefined,
      avatarUrl: typeof (rawUser as Record<string, unknown>).avatarUrl === 'string'
        ? ((rawUser as Record<string, unknown>).avatarUrl as string).trim() || undefined
        : undefined,
    }
    : undefined;
  return {
    accessToken,
    refreshToken,
    expiresIn,
    createdAtMs,
    user: user ?? null,
  };
}

function normalizeCachedAgentIdentitySnapshot(value: unknown): CachedAgentIdentitySnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const agentId = typeof record.agentId === 'string' ? record.agentId.trim() : '';
  const updatedAt = typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
    ? record.updatedAt
    : 0;
  const agentName = typeof record.agentName === 'string' ? record.agentName.trim() : '';
  const agentEmoji = typeof record.agentEmoji === 'string' ? record.agentEmoji.trim() : '';
  const agentAvatarUri = typeof record.agentAvatarUri === 'string' ? record.agentAvatarUri.trim() : '';

  if (!agentId || updatedAt <= 0) return null;

  return {
    agentId,
    updatedAt,
    agentName: agentName || undefined,
    agentEmoji: agentEmoji || undefined,
    agentAvatarUri: agentAvatarUri || undefined,
  };
}

function normalizeGatewayConfigBackupEntry(value: unknown): GatewayConfigBackupEntry | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const version = record.version;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const createdAt = typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
    ? record.createdAt
    : 0;
  const config = record.config;
  if (version !== 1 || !id || createdAt <= 0 || !config || typeof config !== 'object' || Array.isArray(config)) {
    return null;
  }
  return {
    version: 1,
    id,
    createdAt,
    config: config as Record<string, unknown>,
  };
}

function normalizeMode(mode: unknown): GatewayMode {
  if (mode === 'tailscale' || mode === 'cloudflare' || mode === 'custom' || mode === 'relay' || mode === 'hermes') return mode;
  return 'local';
}

function normalizeBackendKind(value: unknown): GatewayBackendKind | undefined {
  return isGatewayBackendKind(value) ? value : undefined;
}

function normalizeTransportKind(value: unknown): GatewayTransportKind | undefined {
  return isGatewayTransportKind(value) ? value : undefined;
}

function normalizeProfileMode(mode: unknown): GatewayProfileMode {
  if (mode === 'tailscale' || mode === 'cloudflare') return mode;
  return 'local';
}

function normalizeRelayConfig(
  value: unknown,
): {
  serverUrl: string;
  gatewayId: string;
  clientToken?: string;
  displayName?: string;
  protocolVersion?: number;
  supportsBootstrap?: boolean;
} | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const serverUrl = typeof record.serverUrl === 'string' ? record.serverUrl.trim() : '';
  const gatewayId = typeof record.gatewayId === 'string' ? record.gatewayId.trim() : '';
  const clientToken = typeof record.clientToken === 'string' ? record.clientToken.trim() : '';
  const displayName = typeof record.displayName === 'string' ? record.displayName.trim() : undefined;
  const protocolVersion = typeof record.protocolVersion === 'number'
    && Number.isFinite(record.protocolVersion)
    && record.protocolVersion >= 1
    ? Math.trunc(record.protocolVersion)
    : undefined;
  const supportsBootstrap = typeof record.supportsBootstrap === 'boolean'
    ? record.supportsBootstrap
    : undefined;
  if (!serverUrl || !gatewayId) return undefined;
  return {
    serverUrl,
    gatewayId,
    clientToken: clientToken || undefined,
    displayName: displayName || undefined,
    protocolVersion,
    supportsBootstrap,
  };
}

function normalizeHermesConfig(
  value: unknown,
): {
  bridgeUrl: string;
  displayName?: string;
} | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const bridgeUrl = typeof record.bridgeUrl === 'string' ? record.bridgeUrl.trim() : '';
  const displayName = typeof record.displayName === 'string' ? record.displayName.trim() : '';
  if (!bridgeUrl) return undefined;
  return {
    bridgeUrl,
    displayName: displayName || undefined,
  };
}

function normalizeOpenClawBootstrapConfig(value: unknown): SavedGatewayConfig['bootstrap'] {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const token = typeof record.token === 'string' ? record.token.trim() : '';
  const strategy = record.strategy === 'mobile-setup' || record.strategy === 'legacy-bound'
    ? record.strategy
    : undefined;
  const expiresAtMs = typeof record.expiresAtMs === 'number' && Number.isSafeInteger(record.expiresAtMs)
    ? record.expiresAtMs
    : undefined;
  const access = record.access === 'full' || record.access === 'limited' || record.access === 'node'
    ? record.access
    : undefined;
  if (!token || !strategy) return undefined;
  return {
    token,
    strategy,
    ...(expiresAtMs !== undefined ? { expiresAtMs } : {}),
    ...(access ? { access } : {}),
  };
}

function normalizeProfiles(value: unknown): GatewayProfilesConfig | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const readProfile = (raw: unknown) => {
    if (!raw || typeof raw !== 'object') {
      return { url: '', token: undefined, password: undefined };
    }
    const profile = raw as Record<string, unknown>;
    const url = typeof profile.url === 'string' ? profile.url : '';
    const token = typeof profile.token === 'string' && profile.token.trim() ? profile.token : undefined;
    const password = typeof profile.password === 'string' && profile.password.trim() ? profile.password : undefined;
    return { url, token, password };
  };
  return {
    activeMode: normalizeProfileMode(record.activeMode),
    local: readProfile(record.local),
    tailscale: readProfile(record.tailscale),
    cloudflare: readProfile(record.cloudflare),
  };
}

function normalizeSavedGatewayConfig(value: unknown): SavedGatewayConfig | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const mode = normalizeMode(record.mode);
  const url = typeof record.url === 'string' ? record.url.trim() : '';
  const token = typeof record.token === 'string' && record.token.trim() ? record.token.trim() : undefined;
  const password = typeof record.password === 'string' && record.password.trim() ? record.password.trim() : undefined;
  const bootstrap = normalizeOpenClawBootstrapConfig(record.bootstrap);
  const relay = normalizeRelayConfig(record.relay);
  const hermes = normalizeHermesConfig(record.hermes);
  const backendKind = resolveGatewayBackendKind({
    backendKind: normalizeBackendKind(record.backendKind),
    mode,
    hermes,
  });
  const transportKind = resolveGatewayTransportKind({
    transportKind: normalizeTransportKind(record.transportKind),
    mode,
    relay,
  });
  const resolvedName = resolveSavedGatewayName({
    name,
    backendKind,
    transportKind,
    url,
    relayDisplayName: relay?.displayName,
    hermesDisplayName: hermes?.displayName,
  });
  const createdAt = typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : Date.now();
  const updatedAt = typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? record.updatedAt : createdAt;
  if (!id || !resolvedName || !url) return null;
  return {
    id,
    name: resolvedName,
    backendKind,
    transportKind,
    mode: toLegacyGatewayMode({ backendKind, transportKind }),
    url,
    token,
    password,
    bootstrap,
    hermes,
    relay,
    createdAt,
    updatedAt,
  };
}

function normalizeGatewayConfigsState(value: unknown): GatewayConfigsState | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const rawConfigs = Array.isArray(record.configs) ? record.configs : [];
  const configs = rawConfigs
    .map((item) => normalizeSavedGatewayConfig(item))
    .filter((item): item is SavedGatewayConfig => item !== null);
  const activeIdRaw = typeof record.activeId === 'string' ? record.activeId : null;
  const activeId = activeIdRaw && configs.some((config) => config.id === activeIdRaw)
    ? activeIdRaw
    : (configs[0]?.id ?? null);
  return {
    activeId,
    configs,
  };
}

function buildStateFromLegacyProfiles(profiles: GatewayProfilesConfig): GatewayConfigsState {
  const now = Date.now();
  const configs: SavedGatewayConfig[] = [];
  const pushIfPresent = (mode: GatewayProfileMode, name: string) => {
    const profile = profiles[mode];
    if (!profile?.url?.trim()) return;
    const id = `legacy_${mode}`;
    configs.push({
      id,
      name,
      backendKind: 'openclaw',
      transportKind: mode,
      mode,
      url: profile.url.trim(),
      token: profile.token?.trim() || undefined,
      password: profile.password?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    });
  };

  pushIfPresent('local', 'Local Gateway');
  pushIfPresent('tailscale', 'Tailscale Gateway');
  pushIfPresent('cloudflare', 'Cloudflare Gateway');

  const activeCandidate = configs.find((config) => config.mode === profiles.activeMode);
  return {
    activeId: activeCandidate?.id ?? configs[0]?.id ?? null,
    configs,
  };
}

function normalizeSavedPrompt(value: unknown): SavedPrompt | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const text = typeof record.text === 'string' ? record.text.trim() : '';
  const createdAtRaw = record.createdAt;
  const updatedAtRaw = record.updatedAt;
  const pinnedAtRaw = record.pinnedAt;
  const createdAt = typeof createdAtRaw === 'number' && Number.isFinite(createdAtRaw) ? createdAtRaw : 0;
  const updatedAt = typeof updatedAtRaw === 'number' && Number.isFinite(updatedAtRaw) ? updatedAtRaw : createdAt;
  const pinnedAt = typeof pinnedAtRaw === 'number' && Number.isFinite(pinnedAtRaw) ? pinnedAtRaw : undefined;
  if (!id || !text) return null;
  const normalized: SavedPrompt = {
    id,
    text,
    createdAt,
    updatedAt,
  };
  if (typeof pinnedAt === 'number') {
    normalized.pinnedAt = pinnedAt;
  }
  return normalized;
}

async function setJson<T>(key: string, value: T): Promise<void> {
  await SecureStore.setItemAsync(key, JSON.stringify(value), SECURE_OPTIONS);
}

async function getJson<T>(key: string): Promise<T | null> {
  const raw = await SecureStore.getItemAsync(key, SECURE_OPTIONS);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export const StorageService = {
  /**
   * Read-only migration source for connection data written by 2.1.x.
   * ConnectionStore owns the v3 registry and intentionally retains these keys
   * for one release so a downgrade can still recover the previous config.
   */
  async readLegacyGatewayConfigsState(): Promise<GatewayConfigsState> {
    const latestRaw = await getJson<unknown>(KEYS.gatewayConfigsState);
    const latest = normalizeGatewayConfigsState(latestRaw);
    if (latest) return latest;

    const profilesRaw = await getJson<unknown>(KEYS.gatewayProfilesConfig);
    const normalizedProfiles = normalizeProfiles(profilesRaw);
    if (normalizedProfiles) {
      return buildStateFromLegacyProfiles(normalizedProfiles);
    }

    const legacy = await getJson<GatewayConfig>(KEYS.gatewayConfig);
    if (legacy?.url?.trim()) {
      const now = Date.now();
      return {
        activeId: 'legacy_single',
        configs: [
          {
            id: 'legacy_single',
            name: 'Gateway',
            backendKind: 'openclaw',
            transportKind: 'local',
            mode: 'local',
            url: legacy.url.trim(),
            token: legacy.token?.trim() || undefined,
            password: legacy.password?.trim() || undefined,
            bootstrap: normalizeOpenClawBootstrapConfig(legacy.bootstrap),
            createdAt: now,
            updatedAt: now,
          },
        ],
      };
    }
    return { activeId: null, configs: [] };
  },

  async setIdentity(identity: DeviceIdentity): Promise<void> {
    await setJson(KEYS.identity, identity);
  },

  async getIdentity(): Promise<DeviceIdentity | null> {
    return getJson<DeviceIdentity>(KEYS.identity);
  },

  async clearIdentity(): Promise<void> {
    await SecureStore.deleteItemAsync(KEYS.identity, SECURE_OPTIONS);
  },

  async clearLegacyGatewayConfig(): Promise<void> {
    await SecureStore.deleteItemAsync(KEYS.gatewayConfig, SECURE_OPTIONS);
    await SecureStore.deleteItemAsync(KEYS.gatewayProfilesConfig, SECURE_OPTIONS);
    await SecureStore.deleteItemAsync(KEYS.gatewayConfigsState, SECURE_OPTIONS);
  },

  async setYouMindAuthSession(url: string, session: YouMindAuthSession, scopeKey?: string | null): Promise<void> {
    await setJson(youmindAuthStorageKey(url, scopeKey), session);
  },

  async getYouMindAuthSession(
    url: string,
    scopeKey?: string | null,
    options?: { allowLegacyFallback?: boolean },
  ): Promise<YouMindAuthSession | null> {
    const primaryKey = youmindAuthStorageKey(url, scopeKey);
    const value = await getJson<unknown>(primaryKey);
    if (value != null) {
      return normalizeYouMindAuthSession(value);
    }

    const prefixedScopeKey = youmindPrefixedScopeAuthStorageKey(url, scopeKey);
    if (prefixedScopeKey) {
      const prefixedValue = await getJson<unknown>(prefixedScopeKey);
      const normalizedPrefixed = normalizeYouMindAuthSession(prefixedValue);
      if (normalizedPrefixed) {
        await setJson(primaryKey, normalizedPrefixed);
        return normalizedPrefixed;
      }
    }

    if (options?.allowLegacyFallback && scopeKey?.trim()) {
      const legacyValue = await getJson<unknown>(youmindLegacyAuthStorageKey(url));
      return normalizeYouMindAuthSession(legacyValue);
    }
    return null;
  },

  async clearYouMindAuthSession(url: string, scopeKey?: string | null): Promise<void> {
    await SecureStore.deleteItemAsync(youmindAuthStorageKey(url, scopeKey), SECURE_OPTIONS);
    const prefixedScopeKey = youmindPrefixedScopeAuthStorageKey(url, scopeKey);
    if (prefixedScopeKey) {
      await SecureStore.deleteItemAsync(prefixedScopeKey, SECURE_OPTIONS);
    }
  },

  async migrateLegacyYouMindState(url: string, scopeKey: string): Promise<void> {
    const normalizedScope = scopeKey.trim();
    if (!normalizedScope) return;

    const scopedSessionKey = youmindAuthStorageKey(url, normalizedScope);
    const prefixedScopedSessionKey = youmindPrefixedScopeAuthStorageKey(url, normalizedScope);
    const legacySessionKey = youmindLegacyAuthStorageKey(url);
    const [scopedSession, prefixedScopedSession, legacySession] = await Promise.all([
      getJson<unknown>(scopedSessionKey),
      prefixedScopedSessionKey ? getJson<unknown>(prefixedScopedSessionKey) : Promise.resolve(null),
      getJson<unknown>(legacySessionKey),
    ]);
    if (scopedSession == null && prefixedScopedSession != null) {
      await setJson(scopedSessionKey, prefixedScopedSession);
    } else if (scopedSession == null && legacySession != null) {
      await setJson(scopedSessionKey, legacySession);
    }

  },

  async setYouMindDeviceId(deviceId: string): Promise<void> {
    const normalized = deviceId.trim();
    if (!normalized) {
      await AsyncStorage.removeItem(KEYS.youmindDeviceId);
      return;
    }
    await AsyncStorage.setItem(KEYS.youmindDeviceId, normalized);
  },

  async getYouMindDeviceId(): Promise<string | null> {
    const value = await AsyncStorage.getItem(KEYS.youmindDeviceId);
    const normalized = value?.trim();
    return normalized || null;
  },

  async clearYouMindDeviceId(): Promise<void> {
    await AsyncStorage.removeItem(KEYS.youmindDeviceId);
  },

  async saveGatewayConfigBackup(config: Record<string, unknown>): Promise<GatewayConfigBackupSummary> {
    const createdAt = Date.now();
    const randomSuffix = Math.random().toString(36).slice(2, 8);
    const id = `${GATEWAY_CONFIG_BACKUP_PREFIX}${createdAt}.${randomSuffix}`;
    const entry: GatewayConfigBackupEntry = {
      version: 1,
      id,
      createdAt,
      config,
    };
    await AsyncStorage.setItem(id, JSON.stringify(entry));
    return { id, createdAt };
  },

  async listGatewayConfigBackups(): Promise<GatewayConfigBackupSummary[]> {
    const keys = await AsyncStorage.getAllKeys();
    const backupKeys = keys.filter((key) => key.startsWith(GATEWAY_CONFIG_BACKUP_PREFIX));
    if (backupKeys.length === 0) {
      return [];
    }
    const entries = await AsyncStorage.multiGet(backupKeys);
    return entries
      .map(([, rawValue]) => {
        if (!rawValue) return null;
        try {
          return normalizeGatewayConfigBackupEntry(JSON.parse(rawValue));
        } catch {
          return null;
        }
      })
      .filter((entry): entry is GatewayConfigBackupEntry => Boolean(entry))
      .map((entry) => ({ id: entry.id, createdAt: entry.createdAt }))
      .sort((a, b) => b.createdAt - a.createdAt);
  },

  async getGatewayConfigBackup(id: string): Promise<GatewayConfigBackupEntry | null> {
    if (!id.startsWith(GATEWAY_CONFIG_BACKUP_PREFIX)) return null;
    const raw = await AsyncStorage.getItem(id);
    if (!raw) return null;
    try {
      return normalizeGatewayConfigBackupEntry(JSON.parse(raw));
    } catch {
      return null;
    }
  },

  async deleteGatewayConfigBackup(id: string): Promise<void> {
    if (!id.startsWith(GATEWAY_CONFIG_BACKUP_PREFIX)) return;
    await AsyncStorage.removeItem(id);
  },

  async setDeviceToken(deviceId: string, token: string, scope?: DeviceTokenStorageScope): Promise<void> {
    await SecureStore.setItemAsync(
      deviceTokenStorageKey(deviceId, scope),
      token,
      SECURE_OPTIONS,
    );
  },

  async setDeviceTokenRecord(
    deviceId: string,
    record: Omit<DeviceTokenRecord, 'version' | 'updatedAtMs'> & { updatedAtMs?: number },
    scope?: DeviceTokenStorageScope,
  ): Promise<void> {
    const token = record.token.trim();
    const role = record.role.trim();
    if (!token || !role) {
      throw new Error('Device token and role are required.');
    }
    const value: DeviceTokenRecord = {
      version: 1,
      token,
      role,
      scopes: [...new Set(record.scopes.map((entry) => entry.trim()).filter(Boolean))].sort(),
      updatedAtMs: record.updatedAtMs ?? Date.now(),
    };
    await SecureStore.setItemAsync(
      deviceTokenStorageKey(deviceId, scope),
      JSON.stringify(value),
      SECURE_OPTIONS,
    );
  },

  async getDeviceTokenRecord(
    deviceId: string,
    scope?: DeviceTokenStorageScope,
  ): Promise<DeviceTokenRecord | null> {
    return normalizeDeviceTokenRecord(await readStoredDeviceTokenValue(deviceId, scope));
  },

  async getDeviceToken(deviceId: string, scope?: DeviceTokenStorageScope): Promise<string | null> {
    return normalizeDeviceTokenRecord(await readStoredDeviceTokenValue(deviceId, scope))?.token ?? null;
  },

  async deleteDeviceToken(deviceId: string, scope?: DeviceTokenStorageScope): Promise<void> {
    const scopedKey = deviceTokenStorageKey(deviceId, scope);
    await SecureStore.deleteItemAsync(scopedKey, SECURE_OPTIONS);
    const role = normalizeDeviceTokenScopePart(scope?.role).toLowerCase();
    if (role && role !== 'operator') return;
    const legacyKey = legacyDeviceTokenStorageKey(deviceId);
    if (legacyKey !== scopedKey) {
      await SecureStore.deleteItemAsync(legacyKey, SECURE_OPTIONS);
    }
  },

  async setDebugMode(enabled: boolean): Promise<void> {
    await SecureStore.setItemAsync(KEYS.debugMode, enabled ? '1' : '0', SECURE_OPTIONS);
  },

  async getDebugMode(): Promise<boolean> {
    const raw = await SecureStore.getItemAsync(KEYS.debugMode, SECURE_OPTIONS);
    return raw === '1';
  },

  async setRelayServiceEnvironment(environment: 'production' | 'preview'): Promise<void> {
    await SecureStore.setItemAsync(KEYS.relayServiceEnvironment, environment, SECURE_OPTIONS);
  },

  async getRelayServiceEnvironment(): Promise<'production' | 'preview'> {
    const raw = await SecureStore.getItemAsync(KEYS.relayServiceEnvironment, SECURE_OPTIONS);
    return raw === 'preview' ? 'preview' : 'production';
  },

  async setShowAgentAvatar(show: boolean): Promise<void> {
    await SecureStore.setItemAsync(KEYS.showAgentAvatar, show ? '1' : '0', SECURE_OPTIONS);
  },

  async getShowAgentAvatar(): Promise<boolean> {
    const raw = await SecureStore.getItemAsync(KEYS.showAgentAvatar, SECURE_OPTIONS);
    return raw !== '0';
  },

  async setThemeMode(mode: ThemeMode): Promise<void> {
    await SecureStore.setItemAsync(KEYS.themeMode, mode, SECURE_OPTIONS);
  },

  async getThemeMode(): Promise<ThemeMode> {
    const raw = await SecureStore.getItemAsync(KEYS.themeMode, SECURE_OPTIONS);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
    return 'system';
  },

  async setAccentColor(accentColor: AccentColorId): Promise<void> {
    await SecureStore.setItemAsync(KEYS.accentColor, accentColor, SECURE_OPTIONS);
  },

  async getAccentColor(): Promise<AccentColorId> {
    const raw = await SecureStore.getItemAsync(KEYS.accentColor, SECURE_OPTIONS);
    if (raw && isBuiltInAccentId(raw)) return raw;
    return defaultAccentId;
  },

  async setCurrentAgentId(id: string): Promise<void> {
    await SecureStore.setItemAsync(KEYS.currentAgentId, id, SECURE_OPTIONS);
  },

  async getCurrentAgentId(): Promise<string | null> {
    return SecureStore.getItemAsync(KEYS.currentAgentId, SECURE_OPTIONS);
  },

  async setShowModelUsage(enabled: boolean): Promise<void> {
    await SecureStore.setItemAsync(KEYS.showModelUsage, enabled ? '1' : '0', SECURE_OPTIONS);
  },

  async getShowModelUsage(): Promise<boolean> {
    const raw = await SecureStore.getItemAsync(KEYS.showModelUsage, SECURE_OPTIONS);
    // Default to true (on) if never set
    return raw !== '0';
  },

  async setExecApprovalEnabled(enabled: boolean): Promise<void> {
    await SecureStore.setItemAsync(KEYS.execApproval, enabled ? '1' : '0', SECURE_OPTIONS);
  },

  async getExecApprovalEnabled(): Promise<boolean> {
    const raw = await SecureStore.getItemAsync(KEYS.execApproval, SECURE_OPTIONS);
    return raw === '1'; // default OFF
  },

  async setChatFontSize(size: number): Promise<void> {
    await SecureStore.setItemAsync(KEYS.chatFontSize, String(size), SECURE_OPTIONS);
  },

  async getChatFontSize(): Promise<number> {
    const raw = await SecureStore.getItemAsync(KEYS.chatFontSize, SECURE_OPTIONS);
    if (!raw) return 16;
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed) || parsed < 12 || parsed > 20) return 16;
    return parsed;
  },

  async setChatAppearance(settings: ChatAppearanceSettings): Promise<void> {
    const normalized = normalizeChatAppearanceSettings(settings);
    const storedImagePath = normalized.background.enabled
      ? toStoredChatBackgroundImagePath(normalized.background.imagePath)
      : undefined;
    await setJson(KEYS.chatAppearance, {
      ...normalized,
      background: {
        ...normalized.background,
        enabled: Boolean(storedImagePath) && normalized.background.enabled,
        imagePath: storedImagePath,
      },
    });
  },

  async getChatAppearance(): Promise<ChatAppearanceSettings> {
    const parsed = await getJson<unknown>(KEYS.chatAppearance);
    const normalized = parsed ? normalizeChatAppearanceSettings(parsed) : DEFAULT_CHAT_APPEARANCE;
    if (!normalized.background.enabled || !normalized.background.imagePath) {
      return normalized;
    }

    const storedImagePath = toStoredChatBackgroundImagePath(normalized.background.imagePath);
    const resolvedImagePath = await resolveExistingStoredChatBackgroundImagePath(storedImagePath);

    if (!storedImagePath || !resolvedImagePath) {
      const repairedAppearance: ChatAppearanceSettings = {
        ...normalized,
        background: {
          ...normalized.background,
          enabled: false,
          imagePath: undefined,
        },
      };
      if (parsed) {
        await setJson(KEYS.chatAppearance, repairedAppearance);
      }
      return repairedAppearance;
    }

    if (storedImagePath !== normalized.background.imagePath) {
      await setJson(KEYS.chatAppearance, {
        ...normalized,
        background: {
          ...normalized.background,
          imagePath: storedImagePath,
        },
      });
    }

    return {
      ...normalized,
      background: {
        ...normalized.background,
        imagePath: resolvedImagePath,
      },
    };
  },

  async setSpeechRecognitionLanguage(language: SpeechRecognitionLanguage): Promise<void> {
    await SecureStore.setItemAsync(KEYS.speechRecognitionLanguage, language, SECURE_OPTIONS);
  },

  async getSpeechRecognitionLanguage(): Promise<SpeechRecognitionLanguage> {
    const raw = await SecureStore.getItemAsync(KEYS.speechRecognitionLanguage, SECURE_OPTIONS);
    if (
      raw === 'system'
      || raw === 'en'
      || raw === 'zh-Hans'
      || raw === 'ja'
      || raw === 'ko'
      || raw === 'de'
      || raw === 'es'
    ) {
      return raw;
    }
    return 'system';
  },

  async setLastSessionKey(key: string, scopeId?: string): Promise<void> {
    await SecureStore.setItemAsync(lastSessionKeyStorageKey(scopeId), key, SECURE_OPTIONS);
  },

  async getLastSessionKey(scopeId?: string): Promise<string | null> {
    const scoped = await SecureStore.getItemAsync(lastSessionKeyStorageKey(scopeId), SECURE_OPTIONS);
    if (scoped) return scoped;
    if (scopeId?.trim()) return null;
    return scoped;
  },

  async setLastOpenedSessionSnapshot(scopeId: string, snapshot: LastOpenedSessionSnapshot): Promise<void> {
    const normalizedScope = scopeId.trim();
    const normalized = normalizeLastOpenedSessionSnapshot(snapshot);
    if (!normalizedScope || !normalized) return;
    const payload = JSON.stringify(normalized);
    await AsyncStorage.multiSet(
      [
        [lastOpenedSessionSnapshotStorageKey(normalizedScope), payload],
        [lastOpenedSessionSnapshotStorageKey(normalizedScope, normalized.agentId), payload],
      ],
    );
  },

  async getLastOpenedSessionSnapshot(
    scopeId: string,
    agentId?: string,
  ): Promise<LastOpenedSessionSnapshot | null> {
    const normalizedScope = scopeId.trim();
    const normalizedAgentId = agentId?.trim();
    if (!normalizedScope) return null;
    try {
      if (normalizedAgentId) {
        const scopedRaw = await AsyncStorage.getItem(
          lastOpenedSessionSnapshotStorageKey(normalizedScope, normalizedAgentId),
        );
        if (scopedRaw) {
          return normalizeLastOpenedSessionSnapshot(JSON.parse(scopedRaw));
        }
      }
      const raw = await AsyncStorage.getItem(
        lastOpenedSessionSnapshotStorageKey(normalizedScope),
      );
      if (raw) {
        return normalizeLastOpenedSessionSnapshot(JSON.parse(raw));
      }
      return null;
    } catch {
      return null;
    }
  },

  async setCachedAgentIdentity(
    scopeId: string,
    identity: CachedAgentIdentitySnapshot,
  ): Promise<void> {
    const normalizedScope = scopeId.trim();
    const normalized = normalizeCachedAgentIdentitySnapshot(identity);
    if (!normalizedScope || !normalized) return;
    await AsyncStorage.setItem(
      cachedAgentIdentityStorageKey(normalizedScope, normalized.agentId),
      JSON.stringify(normalized),
    );
  },

  async getCachedAgentIdentity(
    scopeId: string,
    agentId: string,
  ): Promise<CachedAgentIdentitySnapshot | null> {
    const normalizedScope = scopeId.trim();
    const normalizedAgentId = agentId.trim();
    if (!normalizedScope || !normalizedAgentId) return null;
    try {
      const raw = await AsyncStorage.getItem(
        cachedAgentIdentityStorageKey(normalizedScope, normalizedAgentId),
      );
      if (!raw) return null;
      return normalizeCachedAgentIdentitySnapshot(JSON.parse(raw));
    } catch {
      return null;
    }
  },

  async setNodeEnabled(enabled: boolean): Promise<void> {
    await SecureStore.setItemAsync(KEYS.nodeEnabled, enabled ? '1' : '0', SECURE_OPTIONS);
  },

  async getNodeEnabled(): Promise<boolean> {
    const raw = await SecureStore.getItemAsync(KEYS.nodeEnabled, SECURE_OPTIONS);
    return raw === '1'; // default OFF
  },

  async setNodeCapabilityToggles(toggles: NodeCapabilityToggles): Promise<void> {
    await setJson(KEYS.nodeCapabilityToggles, toggles);
  },

  async getNodeCapabilityToggles(): Promise<NodeCapabilityToggles> {
    const raw = await getJson<unknown>(KEYS.nodeCapabilityToggles);
    if (!raw) return { ...DEFAULT_NODE_CAPABILITY_TOGGLES };
    return normalizeNodeCapabilityToggles(raw);
  },

  async setProSubscriptionSnapshot(snapshot: ProSubscriptionSnapshot): Promise<void> {
    try {
      await AsyncStorage.setItem(KEYS.proSubscriptionSnapshot, JSON.stringify({
        snapshot,
        cachedAtMs: Date.now(),
      }));
    } catch {
      // Best-effort cache only.
    }
  },

  async getProSubscriptionSnapshot(): Promise<ProSubscriptionCacheEntry | null> {
    try {
      const raw = await AsyncStorage.getItem(KEYS.proSubscriptionSnapshot);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<ProSubscriptionCacheEntry> | null;
      if (!parsed || typeof parsed !== 'object') return null;
      if (!parsed.snapshot || typeof parsed.cachedAtMs !== 'number') return null;
      if (typeof parsed.snapshot.entitlementId !== 'string') return null;
      if (typeof parsed.snapshot.isActive !== 'boolean') return null;
      return {
        snapshot: parsed.snapshot,
        cachedAtMs: parsed.cachedAtMs,
      };
    } catch {
      return null;
    }
  },

  async clearProSubscriptionSnapshot(): Promise<void> {
    try {
      await AsyncStorage.removeItem(KEYS.proSubscriptionSnapshot);
    } catch {
      // Best-effort cache only.
    }
  },

  async hasLifetimeUpgradeAnnouncementBeenShown(): Promise<boolean> {
    try {
      return (await AsyncStorage.getItem(KEYS.lifetimeUpgradeAnnouncementShown)) === '1';
    } catch {
      return false;
    }
  },

  async markLifetimeUpgradeAnnouncementShown(): Promise<void> {
    try {
      await AsyncStorage.setItem(KEYS.lifetimeUpgradeAnnouncementShown, '1');
    } catch {
      // Best-effort cache only.
    }
  },

  async clearLifetimeUpgradeAnnouncementShown(): Promise<void> {
    try {
      await AsyncStorage.removeItem(KEYS.lifetimeUpgradeAnnouncementShown);
    } catch {
      // Best-effort cache only.
    }
  },

  async getAutoAppReviewState(): Promise<AutoAppReviewState | null> {
    try {
      const raw = await AsyncStorage.getItem(KEYS.autoAppReviewState);
      if (!raw) return null;
      return normalizeAutoAppReviewState(JSON.parse(raw));
    } catch {
      return null;
    }
  },

  async setAutoAppReviewState(state: AutoAppReviewState): Promise<void> {
    const normalized = normalizeAutoAppReviewState(state);
    if (!normalized) throw new Error('Invalid automatic app review state');
    // Unlike display caches, this write gates a one-time native side effect. Let
    // callers observe failure so a prompt is never shown without durable state.
    await AsyncStorage.setItem(KEYS.autoAppReviewState, JSON.stringify(normalized));
  },

  async appendNodeInvokeAudit(entry: NodeInvokeAuditEntry): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(NODE_INVOKE_AUDIT_KEY);
      const current = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(current) ? current : [];
      const next = [entry, ...list].slice(0, MAX_NODE_INVOKE_AUDIT_ENTRIES);
      await AsyncStorage.setItem(NODE_INVOKE_AUDIT_KEY, JSON.stringify(next));
    } catch {
      // best-effort
    }
  },

  async getNodeInvokeAuditEntries(): Promise<NodeInvokeAuditEntry[]> {
    try {
      const raw = await AsyncStorage.getItem(NODE_INVOKE_AUDIT_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item): item is NodeInvokeAuditEntry => (
          item &&
          typeof item === 'object' &&
          typeof (item as NodeInvokeAuditEntry).id === 'string' &&
          typeof (item as NodeInvokeAuditEntry).nodeId === 'string' &&
          typeof (item as NodeInvokeAuditEntry).command === 'string' &&
          typeof (item as NodeInvokeAuditEntry).source === 'string' &&
          typeof (item as NodeInvokeAuditEntry).timestampMs === 'number' &&
          ((item as NodeInvokeAuditEntry).result === 'success' || (item as NodeInvokeAuditEntry).result === 'error')
        ))
        .sort((a, b) => b.timestampMs - a.timestampMs);
    } catch {
      return [];
    }
  },

  // --- Composer draft persistence (AsyncStorage — non-sensitive, dynamic keys) ---

  _draftKey(agentId: string, sessionKey: string): string {
    return `clawket.draft.${agentId}-${sessionKey}`;
  },

  async setComposerDraft(agentId: string, sessionKey: string, text: string): Promise<void> {
    const key = this._draftKey(agentId, sessionKey);
    if (!text) {
      await AsyncStorage.removeItem(key);
    } else {
      await AsyncStorage.setItem(key, text);
    }
  },

  async getComposerDraft(agentId: string, sessionKey: string): Promise<string | null> {
    return AsyncStorage.getItem(this._draftKey(agentId, sessionKey));
  },

  // --- Dashboard cache (AsyncStorage — non-sensitive, display-only snapshot) ---

  _dashboardCacheKey: LEGACY_DASHBOARD_CACHE_KEY,

  getDashboardCacheStorageKey(scopeKey: string): string {
    return `${DASHBOARD_CACHE_PREFIX}${scopeKey}`;
  },

  async setDashboardCache<T>(
    scopeKey: string,
    entry: DashboardCacheEntry<T>,
  ): Promise<void> {
    try {
      await AsyncStorage.setItem(this.getDashboardCacheStorageKey(scopeKey), JSON.stringify(entry));
    } catch {
      // best-effort
    }
  },

  async getDashboardCache<T>(scopeKey: string): Promise<DashboardCacheEntry<T> | null> {
    try {
      const raw = await AsyncStorage.getItem(this.getDashboardCacheStorageKey(scopeKey));
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<DashboardCacheEntry<T>> | null;
        if (
          parsed
          && parsed.version === 2
          && typeof parsed.cacheKey === 'string'
          && typeof parsed.savedAt === 'number'
          && parsed.data != null
        ) {
          return {
            version: 2,
            cacheKey: parsed.cacheKey,
            savedAt: parsed.savedAt,
            source: 'network',
            connectionStateAtSave: typeof parsed.connectionStateAtSave === 'string'
              ? parsed.connectionStateAtSave
              : 'unknown',
            data: parsed.data,
          };
        }
      }

      const legacyRaw = await AsyncStorage.getItem(this._dashboardCacheKey);
      if (!legacyRaw) return null;
      const legacyData = JSON.parse(legacyRaw) as T;
      return {
        version: 2,
        cacheKey: scopeKey,
        savedAt: 0,
        source: 'network',
        connectionStateAtSave: 'unknown',
        data: legacyData,
      };
    } catch {
      return null;
    }
  },

  // --- Cron failure acknowledgment (AsyncStorage — non-sensitive, dynamic data) ---

  _cronAckedKey: 'clawket.cron.acked-failures',

  async getAckedCronFailures(): Promise<Set<string>> {
    try {
      const raw = await AsyncStorage.getItem(this._cronAckedKey);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.filter((id: unknown) => typeof id === 'string'));
    } catch {
      return new Set();
    }
  },

  async ackCronFailures(currentFailedIds: string[]): Promise<void> {
    const currentSet = new Set(currentFailedIds);
    if (currentSet.size === 0) {
      await AsyncStorage.removeItem(this._cronAckedKey);
      return;
    }
    await AsyncStorage.setItem(this._cronAckedKey, JSON.stringify([...currentSet]));
  },

  // --- User prompts (AsyncStorage — non-sensitive, user-created prompt snippets) ---

  async getUserPrompts(): Promise<SavedPrompt[]> {
    try {
      const raw = await AsyncStorage.getItem(KEYS.userPrompts);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((item) => normalizeSavedPrompt(item))
        .filter((item): item is SavedPrompt => item !== null);
    } catch {
      return [];
    }
  },

  async setUserPrompts(prompts: SavedPrompt[]): Promise<void> {
    await AsyncStorage.setItem(KEYS.userPrompts, JSON.stringify(prompts));
  },

  async isUserPromptsSeeded(): Promise<boolean> {
    const raw = await AsyncStorage.getItem(KEYS.userPromptsSeeded);
    return raw === '1';
  },

  async markUserPromptsSeeded(): Promise<void> {
    await AsyncStorage.setItem(KEYS.userPromptsSeeded, '1');
  },

  async isPromptPeekShown(): Promise<boolean> {
    const raw = await AsyncStorage.getItem(KEYS.promptPeekShown);
    return raw === '1';
  },

  async markPromptPeekShown(): Promise<void> {
    await AsyncStorage.setItem(KEYS.promptPeekShown, '1');
  },
};
