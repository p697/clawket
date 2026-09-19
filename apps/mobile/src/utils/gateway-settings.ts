import { DM_SCOPES, type DmScope } from '@clawket/agent-protocol';
import { sanitizeFallbackModels } from './fallback-models';

type UnknownRecord = Record<string, unknown>;

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive'] as const;
export type ThinkingLevel = typeof THINKING_LEVELS[number];

export type GatewayRuntimeSettings = {
  heartbeatEvery: string;
  heartbeatActiveStart: string;
  heartbeatActiveEnd: string;
  heartbeatActiveTimezone: string;
  heartbeatSession: string;
  heartbeatModel: string;
  defaultModel: string;
  fallbackModels: string[];
  thinkingDefault: string;
};

export function parseGatewayRuntimeSettings(config: Record<string, unknown> | null): GatewayRuntimeSettings {
  const agents = readRecord(config?.agents);
  const defaults = readRecord(agents?.defaults);
  const heartbeat = readRecord(defaults?.heartbeat);
  const activeHours = readRecord(heartbeat?.activeHours);
  const model = defaults?.model;
  const resolvedDefaultModel = readDefaultModelPrimary(model);
  const resolvedFallbackModels = readDefaultModelFallbacks(model);

  return {
    heartbeatEvery: readString(heartbeat?.every),
    heartbeatActiveStart: readString(activeHours?.start),
    heartbeatActiveEnd: readString(activeHours?.end),
    heartbeatActiveTimezone: readString(activeHours?.timezone),
    heartbeatSession: readString(heartbeat?.session),
    heartbeatModel: readString(heartbeat?.model),
    defaultModel: resolvedDefaultModel,
    fallbackModels: resolvedFallbackModels,
    thinkingDefault: readString(defaults?.thinkingDefault),
  };
}

export function buildGatewayRuntimePatch(input: GatewayRuntimeSettings): Record<string, unknown> {
  const heartbeatEvery = input.heartbeatEvery.trim();
  const activeStart = input.heartbeatActiveStart.trim();
  const activeEnd = input.heartbeatActiveEnd.trim();
  const activeTimezone = input.heartbeatActiveTimezone.trim();
  const defaultModel = input.defaultModel.trim();
  const fallbackModels = sanitizeFallbackModels(input.fallbackModels, { primaryModel: defaultModel });

  const heartbeatSession = input.heartbeatSession.trim();
  const heartbeatModel = input.heartbeatModel.trim();

  const heartbeatPatch: UnknownRecord = {
    every: heartbeatEvery || null,
    session: heartbeatSession || null,
    model: heartbeatModel || null,
  };

  if (!activeStart && !activeEnd && !activeTimezone) {
    heartbeatPatch.activeHours = null;
  } else {
    heartbeatPatch.activeHours = {
      start: activeStart || null,
      end: activeEnd || null,
      timezone: activeTimezone || null,
    };
  }

  const thinkingDefault = input.thinkingDefault.trim();

  const defaultsPatch: UnknownRecord = {
    heartbeat: heartbeatPatch,
    thinkingDefault: thinkingDefault || null,
  };

  if (defaultModel) {
    defaultsPatch.model = {
      primary: defaultModel,
      ...(fallbackModels.length > 0 ? { fallbacks: fallbackModels } : {}),
    };
    defaultsPatch.models = {
      [defaultModel]: {},
      ...Object.fromEntries(fallbackModels.map((model) => [model, {}])),
    };
  }

  return {
    agents: {
      defaults: defaultsPatch,
    },
  };
}

/** OpenClaw leaves `session.dmScope` unset for the personal-agent default, which behaves as `main`. */
export function parseDmScope(config: Record<string, unknown> | null): DmScope {
  const session = readRecord(config?.session);
  const raw = readString(session?.dmScope);
  return (DM_SCOPES as readonly string[]).includes(raw) ? raw as DmScope : 'main';
}

export function buildDmScopePatch(dmScope: DmScope): Record<string, unknown> {
  return { session: { dmScope } };
}

export function buildChannelAccountEnabledPatch(
  channelId: string,
  accountId: string,
  enabled: boolean,
): Record<string, unknown> {
  return { channels: { [channelId]: { accounts: { [accountId]: { enabled } } } } };
}

function readRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as UnknownRecord;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readDefaultModelPrimary(model: unknown): string {
  if (typeof model === 'string') return model.trim();
  const modelRecord = readRecord(model);
  return readString(modelRecord?.primary);
}

function readDefaultModelFallbacks(model: unknown): string[] {
  const modelRecord = readRecord(model);
  if (!modelRecord) return [];
  const rawFallbacks = modelRecord.fallbacks;
  if (!Array.isArray(rawFallbacks)) return [];
  return rawFallbacks
    .map((value) => readString(value))
    .filter((value, index, arr) => value.length > 0 && arr.indexOf(value) === index);
}
