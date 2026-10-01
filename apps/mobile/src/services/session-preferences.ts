import AsyncStorage from '@react-native-async-storage/async-storage';

export type AgentRosterPreferences = Readonly<{
  pinnedSessionKeys: string[];
  agentPinned: boolean;
}>;

type SessionPreferenceState = AgentRosterPreferences;

const SESSION_PREFERENCES_PREFIX = 'clawket.sessionPreferences.v1.';
/** Models chosen on this device, newest first: the model sheet offers them before the catalog order. */
const RECENT_MODELS_LIMIT = 6;
const RECENT_MODEL_REF_MAX_LENGTH = 256;

function recentModelsKey(connectionId: string): string {
  // Under the connection's prefix, so `clearConnection` removes it with the rest.
  return `${SESSION_PREFERENCES_PREFIX}${connectionId}::recentModels`;
}

function normalizeRecentModels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const refs = value.filter((item): item is string => (
    typeof item === 'string' && item.trim().length > 0 && item.length <= RECENT_MODEL_REF_MAX_LENGTH
  ));
  return Array.from(new Set(refs)).slice(0, RECENT_MODELS_LIMIT);
}

function makeScopeKey(gatewayConfigId: string, agentId: string): string {
  return `${SESSION_PREFERENCES_PREFIX}${gatewayConfigId}::${agentId}`;
}

function normalizeState(value: unknown): SessionPreferenceState {
  if (!value || typeof value !== 'object') {
    return { pinnedSessionKeys: [], agentPinned: false };
  }
  const record = value as Record<string, unknown>;
  const pinnedSessionKeys = Array.isArray(record.pinnedSessionKeys)
    ? Array.from(new Set(record.pinnedSessionKeys.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)))
    : [];
  // Older records may still carry `muted`; the Agent mute was removed on 2026-09-17.
  return {
    pinnedSessionKeys,
    agentPinned: record.agentPinned === true,
  };
}

async function readState(gatewayConfigId: string, agentId: string): Promise<SessionPreferenceState> {
  try {
    const raw = await AsyncStorage.getItem(makeScopeKey(gatewayConfigId, agentId));
    if (!raw) return { pinnedSessionKeys: [], agentPinned: false };
    return normalizeState(JSON.parse(raw));
  } catch {
    return { pinnedSessionKeys: [], agentPinned: false };
  }
}

async function writeState(gatewayConfigId: string, agentId: string, state: SessionPreferenceState): Promise<void> {
  await AsyncStorage.setItem(makeScopeKey(gatewayConfigId, agentId), JSON.stringify(normalizeState(state)));
}

export const SessionPreferencesService = {
  async getLastSession(connectionId: string, agentId: string): Promise<string | null> {
    const value = await AsyncStorage.getItem(makeScopeKey(connectionId, agentId) + '.lastSession');
    return value && value.length <= 512 ? value : null;
  },

  async setLastSession(connectionId: string, agentId: string, sessionKey: string): Promise<void> {
    if (!sessionKey || sessionKey.length > 512) return;
    await AsyncStorage.setItem(makeScopeKey(connectionId, agentId) + '.lastSession', sessionKey);
  },
  async getRecentModels(connectionId: string): Promise<string[]> {
    try {
      const raw = await AsyncStorage.getItem(recentModelsKey(connectionId));
      return raw ? normalizeRecentModels(JSON.parse(raw)) : [];
    } catch {
      return [];
    }
  },

  /** Moves `modelRef` (a provider/model reference) to the front; returns the new list. */
  async recordRecentModel(connectionId: string, modelRef: string): Promise<string[]> {
    const ref = modelRef.trim();
    const current = await this.getRecentModels(connectionId);
    if (!ref || ref.length > RECENT_MODEL_REF_MAX_LENGTH) return current;
    const next = normalizeRecentModels([ref, ...current.filter((item) => item !== ref)]);
    await AsyncStorage.setItem(recentModelsKey(connectionId), JSON.stringify(next));
    return next;
  },

  async clearConnection(gatewayConfigId: string): Promise<void> {
    const connectionPrefix = `${SESSION_PREFERENCES_PREFIX}${gatewayConfigId}::`;
    const keys = (await AsyncStorage.getAllKeys()).filter((key) => (
      key.startsWith(connectionPrefix)
    ));
    if (keys.length > 0) await AsyncStorage.multiRemove(keys);
  },

  async getAgentPreferences(
    gatewayConfigId: string,
    agentId: string,
  ): Promise<AgentRosterPreferences> {
    return readState(gatewayConfigId, agentId);
  },

  async getPinnedSessionKeys(gatewayConfigId: string, agentId: string): Promise<string[]> {
    const state = await readState(gatewayConfigId, agentId);
    return state.pinnedSessionKeys;
  },

  async setPinnedSession(gatewayConfigId: string, agentId: string, sessionKey: string, pinned: boolean): Promise<string[]> {
    const state = await readState(gatewayConfigId, agentId);
    const next = pinned
      ? Array.from(new Set([sessionKey, ...state.pinnedSessionKeys]))
      : state.pinnedSessionKeys.filter((item) => item !== sessionKey);
    await writeState(gatewayConfigId, agentId, { ...state, pinnedSessionKeys: next });
    return next;
  },

  async togglePinnedSession(gatewayConfigId: string, agentId: string, sessionKey: string): Promise<string[]> {
    const state = await readState(gatewayConfigId, agentId);
    const isPinned = state.pinnedSessionKeys.includes(sessionKey);
    return this.setPinnedSession(gatewayConfigId, agentId, sessionKey, !isPinned);
  },

  async clearSession(gatewayConfigId: string, agentId: string, sessionKey: string): Promise<void> {
    await this.setPinnedSession(gatewayConfigId, agentId, sessionKey, false);
    if (await this.getLastSession(gatewayConfigId, agentId) === sessionKey) {
      await AsyncStorage.multiRemove([makeScopeKey(gatewayConfigId, agentId) + '.lastSession']);
    }
  },

  async setAgentPinned(
    gatewayConfigId: string,
    agentId: string,
    pinned: boolean,
  ): Promise<AgentRosterPreferences> {
    const state = await readState(gatewayConfigId, agentId);
    const next = { ...state, agentPinned: pinned };
    await writeState(gatewayConfigId, agentId, next);
    return next;
  },

  async toggleAgentPinned(
    gatewayConfigId: string,
    agentId: string,
  ): Promise<AgentRosterPreferences> {
    const state = await readState(gatewayConfigId, agentId);
    const next = { ...state, agentPinned: !state.agentPinned };
    await writeState(gatewayConfigId, agentId, next);
    return next;
  },

};
