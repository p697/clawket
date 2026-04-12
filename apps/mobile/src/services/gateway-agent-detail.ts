import type { AgentInfo, AgentsListResult } from '../types/agent';
import {
  EMPTY_AGENT_IDENTITY_PROFILE,
  parseAgentIdentityProfile,
  type AgentIdentityProfile,
} from '../utils/agent-identity-profile';
import { sanitizeFallbackModels } from '../utils/fallback-models';

type GatewayAgentFile = {
  content?: string;
};

type GatewayAgentDetailGateway = {
  listAgents(): Promise<AgentsListResult>;
  fetchIdentity(agentId?: string): Promise<{ name?: string; avatar?: string; emoji?: string }>;
  getAgentFile(name: string, agentId?: string): Promise<GatewayAgentFile>;
  getConfig(): Promise<{ config: Record<string, unknown> | null; hash: string | null }>;
};

export type GatewayAgentDetailBundle = {
  agent: AgentInfo | null;
  mainKey: string;
  configHash: string | null;
  agentIndex: number;
  identityFileContent: string;
  identityProfile: AgentIdentityProfile;
  form: {
    name: string;
    emoji: string;
    vibe: string;
    model: string;
    fallbacks: string[];
  };
};

export async function loadGatewayAgentDetailBundle(
  gateway: GatewayAgentDetailGateway,
  agentId: string,
): Promise<GatewayAgentDetailBundle> {
  const [agentsResult, identityResult, identityFileResult, configResult] = await Promise.allSettled([
    gateway.listAgents(),
    gateway.fetchIdentity(agentId),
    gateway.getAgentFile('IDENTITY.md', agentId),
    gateway.getConfig(),
  ]);

  let agent: AgentInfo | null = null;
  let mainKey = 'main';
  let loadedName = '';
  let loadedEmoji = '';
  let loadedCreature = '';
  let loadedVibe = '';
  let loadedTheme = '';
  let loadedAvatar = '';
  let loadedModel = '';
  let loadedFallbacks: string[] = [];
  let configHash: string | null = null;
  let agentIndex = -1;
  let identityFileContent = '';

  if (agentsResult.status === 'fulfilled') {
    agent = agentsResult.value.agents.find((item) => item.id === agentId) ?? null;
    mainKey = agentsResult.value.mainKey;
    loadedName = agent?.identity?.name || agent?.name || '';
  }

  if (identityResult.status === 'fulfilled') {
    if (identityResult.value.name) loadedName = identityResult.value.name;
    loadedEmoji = identityResult.value.emoji ?? '';
    loadedAvatar = identityResult.value.avatar ?? '';
  }

  if (configResult.status === 'fulfilled' && configResult.value.config) {
    configHash = configResult.value.hash;
    const configAgent = readConfiguredAgent(configResult.value.config, agentId);
    agentIndex = configAgent.index;
    if (configAgent.identityTheme) loadedTheme = configAgent.identityTheme;
    if (configAgent.identityAvatar) loadedAvatar = configAgent.identityAvatar;
    if (configAgent.model) loadedModel = configAgent.model;
    if (configAgent.fallbacks.length > 0) loadedFallbacks = configAgent.fallbacks;
  }

  if (identityFileResult.status === 'fulfilled') {
    identityFileContent = identityFileResult.value.content ?? '';
    const identityProfile = parseAgentIdentityProfile(identityFileContent);
    if (identityProfile.name) loadedName = identityProfile.name;
    if (identityProfile.emoji) loadedEmoji = identityProfile.emoji;
    if (identityProfile.creature) loadedCreature = identityProfile.creature;
    if (identityProfile.vibe) loadedVibe = identityProfile.vibe;
    if (identityProfile.theme) loadedTheme = identityProfile.theme;
    if (identityProfile.avatar) loadedAvatar = identityProfile.avatar;
  }

  return {
    agent,
    mainKey,
    configHash,
    agentIndex,
    identityFileContent,
    identityProfile: {
      ...EMPTY_AGENT_IDENTITY_PROFILE,
      name: loadedName,
      emoji: loadedEmoji,
      creature: loadedCreature,
      vibe: loadedVibe,
      theme: loadedTheme,
      avatar: loadedAvatar,
    },
    form: {
      name: loadedName,
      emoji: loadedEmoji,
      vibe: loadedVibe,
      model: loadedModel,
      fallbacks: loadedFallbacks,
    },
  };
}

function readConfiguredAgent(
  config: Record<string, unknown>,
  agentId: string,
): {
  index: number;
  identityTheme: string;
  identityAvatar: string;
  model: string;
  fallbacks: string[];
} {
  const agentsList = (config.agents as Record<string, unknown> | undefined)?.list;
  if (!Array.isArray(agentsList)) {
    return {
      index: -1,
      identityTheme: '',
      identityAvatar: '',
      model: '',
      fallbacks: [],
    };
  }

  const index = agentsList.findIndex((entry: Record<string, unknown>) => entry && entry.id === agentId);
  if (index < 0) {
    return {
      index: -1,
      identityTheme: '',
      identityAvatar: '',
      model: '',
      fallbacks: [],
    };
  }

  const agentConfig = agentsList[index] as Record<string, unknown>;
  const agentIdentity = typeof agentConfig.identity === 'object' && agentConfig.identity !== null
    ? agentConfig.identity as Record<string, unknown>
    : null;
  const identityTheme = typeof agentIdentity?.theme === 'string' ? agentIdentity.theme : '';
  const identityAvatar = typeof agentIdentity?.avatar === 'string' ? agentIdentity.avatar : '';

  let model = '';
  let fallbacks: string[] = [];
  if (typeof agentConfig.model === 'string') {
    model = agentConfig.model;
  } else if (typeof agentConfig.model === 'object' && agentConfig.model !== null) {
    const modelObject = agentConfig.model as Record<string, unknown>;
    const primaryVal = typeof modelObject.primary === 'string' ? modelObject.primary : '';
    if (primaryVal) model = primaryVal;
    if (Array.isArray(modelObject.fallbacks)) {
      fallbacks = sanitizeFallbackModels(
        modelObject.fallbacks.filter((value): value is string => typeof value === 'string' && value.length > 0),
        { primaryModel: model || primaryVal },
      );
    }
  }

  return {
    index,
    identityTheme,
    identityAvatar,
    model,
    fallbacks,
  };
}
