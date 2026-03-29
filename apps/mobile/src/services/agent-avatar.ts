import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AgentInfo } from '../types/agent';
import { resolveAgentDisplayName } from './agent-display-name';

const AVATAR_STORAGE_KEY = 'agent_avatars';

type AvatarMap = Record<string, string>; // avatarKey → base64 data URI

function normalizeStoredAvatarValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  if (
    trimmed.startsWith('data:')
    || trimmed.startsWith('http://')
    || trimmed.startsWith('https://')
    || trimmed.startsWith('file://')
    || trimmed.startsWith('content://')
    || trimmed.startsWith('/')
  ) {
    return trimmed;
  }

  // Backward compatibility: older builds may have persisted raw base64 only.
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(trimmed) && trimmed.length >= 64) {
    const compact = trimmed.replace(/\s+/g, '');
    return `data:image/jpeg;base64,${compact}`;
  }

  return trimmed;
}

/** Build a composite storage key from agentId and optional agentName.
 *  When a name is available the key is "agentId:agentName", otherwise just "agentId". */
export function buildAvatarKey(agentId: string, agentName?: string): string {
  return agentName ? `${agentId}:${agentName}` : agentId;
}

function readLegacyAgentAvatarName(agent?: AgentInfo): string | undefined {
  const identityName = agent?.identity?.name?.trim();
  if (identityName) return identityName;
  const configName = agent?.name?.trim();
  return configName || undefined;
}

export function resolveAgentAvatarKeyCandidates(agent?: AgentInfo): string[] {
  const agentId = agent?.id?.trim();
  if (!agentId) return [];

  const legacyName = readLegacyAgentAvatarName(agent);
  const displayName = resolveAgentDisplayName(agent);
  return [...new Set([
    buildAvatarKey(agentId, legacyName),
    buildAvatarKey(agentId, displayName),
    buildAvatarKey(agentId),
  ])];
}

export function readAgentAvatar(map: Record<string, string>, agent?: AgentInfo): string | undefined {
  for (const key of resolveAgentAvatarKeyCandidates(agent)) {
    const avatar = normalizeStoredAvatarValue(map[key]);
    if (avatar) return avatar;
  }
  return undefined;
}

/** Load all agent avatar mappings from local storage. */
export async function loadAgentAvatars(): Promise<AvatarMap> {
  try {
    const raw = await AsyncStorage.getItem(AVATAR_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as AvatarMap;
  } catch {
    return {};
  }
}

/** Save avatar for a specific agent. dataUri is a full data:image/...;base64,... string. */
export async function saveAgentAvatar(agentId: string, dataUri: string): Promise<AvatarMap> {
  const map = await loadAgentAvatars();
  map[agentId] = dataUri;
  await AsyncStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify(map));
  return map;
}

/** Remove avatar for a specific agent (revert to default). */
export async function removeAgentAvatar(agentId: string): Promise<AvatarMap> {
  const map = await loadAgentAvatars();
  delete map[agentId];
  await AsyncStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify(map));
  return map;
}

/** Pick an image and return as data URI, or null if cancelled. */
export async function pickAvatarImage(): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.6,
    base64: true,
    exif: false,
  });

  if (result.canceled || !result.assets?.[0]?.base64) return null;
  const asset = result.assets[0];
  const mime = asset.mimeType ?? 'image/jpeg';
  return `data:${mime};base64,${asset.base64}`;
}
