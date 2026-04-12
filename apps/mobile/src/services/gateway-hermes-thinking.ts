import { getGatewayThinkingLevels } from './gateway-backends';
import type { ThinkingLevel } from '../utils/gateway-settings';

type GatewayHermesThinkingGateway = {
  request<T = unknown>(method: string, params?: object): Promise<T>;
};

type GatewayHermesReasoningPayload = {
  level?: string;
  rawLevel?: string;
  showReasoning?: boolean;
};

type GatewayHermesFastPayload = {
  enabled?: boolean;
  supported?: boolean;
};

export type GatewayHermesThinkingState = {
  thinkingLevel: ThinkingLevel;
  rawThinkingLevel: string;
  showReasoning: boolean;
  fastModeEnabled: boolean;
  fastModeSupported: boolean;
};

const HERMES_THINKING_LEVELS = new Set(getGatewayThinkingLevels('hermes'));

function normalizeThinkingLevel(value: string | undefined): ThinkingLevel {
  const candidate = (value ?? '').trim().toLowerCase();
  return HERMES_THINKING_LEVELS.has(candidate as ThinkingLevel)
    ? candidate as ThinkingLevel
    : 'medium';
}

function normalizeThinkingState(
  reasoning: GatewayHermesReasoningPayload | null | undefined,
  fast: GatewayHermesFastPayload | null | undefined,
): GatewayHermesThinkingState {
  return {
    thinkingLevel: normalizeThinkingLevel(reasoning?.level),
    rawThinkingLevel: (reasoning?.rawLevel ?? '').trim() || 'medium',
    showReasoning: reasoning?.showReasoning === true,
    fastModeEnabled: fast?.enabled === true,
    fastModeSupported: fast?.supported === true,
  };
}

export async function loadGatewayHermesThinkingState(
  gateway: GatewayHermesThinkingGateway,
): Promise<GatewayHermesThinkingState> {
  const [reasoning, fast] = await Promise.all([
    gateway.request<GatewayHermesReasoningPayload>('hermes.reasoning.get', {}),
    gateway.request<GatewayHermesFastPayload>('hermes.fast.get', {}),
  ]);
  return normalizeThinkingState(reasoning, fast);
}

export async function saveGatewayHermesThinkingLevel(
  gateway: GatewayHermesThinkingGateway,
  level: ThinkingLevel,
): Promise<GatewayHermesThinkingState> {
  const [reasoning, fast] = await Promise.all([
    gateway.request<GatewayHermesReasoningPayload>('hermes.reasoning.set', { level }),
    gateway.request<GatewayHermesFastPayload>('hermes.fast.get', {}),
  ]);
  return normalizeThinkingState(reasoning, fast);
}

export async function saveGatewayHermesFastMode(
  gateway: GatewayHermesThinkingGateway,
  enabled: boolean,
): Promise<GatewayHermesThinkingState> {
  const [reasoning, fast] = await Promise.all([
    gateway.request<GatewayHermesReasoningPayload>('hermes.reasoning.get', {}),
    gateway.request<GatewayHermesFastPayload>('hermes.fast.set', { enabled }),
  ]);
  return normalizeThinkingState(reasoning, fast);
}
