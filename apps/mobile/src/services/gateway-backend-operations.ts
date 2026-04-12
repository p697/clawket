import type { GatewayConfig } from '../types';
import type { ToolsCatalogResult } from '../types/index';
import type { CostSummary, UsageResult } from '../types/usage';
import { resolveGatewayBackendKind } from './gateway-backends';

type GatewayRequestFn = <T = unknown>(method: string, params?: object) => Promise<T>;

type GatewayModelInfo = {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
  input?: Array<'text' | 'image'>;
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
};

export type GatewayModelProviderInfo = {
  slug: string;
  name: string;
  isCurrent: boolean;
  models: string[];
  totalModels: number;
  source?: string;
  apiUrl?: string;
};

export type GatewayModelSelectionState = {
  currentModel: string;
  currentProvider: string;
  currentBaseUrl: string;
  models: GatewayModelInfo[];
  providers?: GatewayModelProviderInfo[];
  note?: string | null;
};

export type GatewayCurrentModelState = {
  currentModel: string;
  currentProvider: string;
  currentBaseUrl: string;
  note?: string | null;
};

export type GatewayModelSelectionWriteResult = GatewayModelSelectionState & {
  ok: boolean;
  scope: 'global';
};

type GatewayConfigSnapshot = {
  config: Record<string, unknown> | null;
  hash: string | null;
};

type GatewayConfigWriteResult = {
  ok: boolean;
  config?: Record<string, unknown>;
  hash?: string;
  path?: string;
};

type GatewayAgentFileSummary = {
  name: string;
  path: string;
  missing: boolean;
  size?: number;
  updatedAtMs?: number;
};

type GatewayAgentFileDetail = GatewayAgentFileSummary & {
  content?: string;
};

export type GatewayBackendOperations = {
  usesConnectHandshake: boolean;
  listModels(request: GatewayRequestFn): Promise<GatewayModelInfo[]>;
  getCurrentModelState(request: GatewayRequestFn): Promise<GatewayCurrentModelState>;
  getModelSelectionState(request: GatewayRequestFn): Promise<GatewayModelSelectionState>;
  setModelSelection(
    request: GatewayRequestFn,
    params: { model: string; provider?: string; scope?: 'global' | 'session'; sessionKey?: string | null },
  ): Promise<GatewayModelSelectionWriteResult>;
  getConfig(request: GatewayRequestFn): Promise<GatewayConfigSnapshot>;
  patchConfig(request: GatewayRequestFn, raw: string, baseHash: string): Promise<GatewayConfigWriteResult>;
  setConfig(request: GatewayRequestFn, raw: string, baseHash: string): Promise<GatewayConfigWriteResult>;
  fetchToolsCatalog(request: GatewayRequestFn, agentId: string): Promise<ToolsCatalogResult>;
  listAgentFiles(request: GatewayRequestFn, agentId: string): Promise<GatewayAgentFileSummary[]>;
  getAgentFile(request: GatewayRequestFn, agentId: string, name: string): Promise<GatewayAgentFileDetail>;
  setAgentFile(request: GatewayRequestFn, agentId: string, name: string, content: string): Promise<{ ok: boolean }>;
  fetchUsage(request: GatewayRequestFn, params: { startDate: string; endDate: string }): Promise<UsageResult>;
  fetchCostSummary(request: GatewayRequestFn, params: { startDate: string; endDate: string }): Promise<CostSummary>;
  getBaseUrl(config: GatewayConfig | null): string | null;
};

const sharedOperations = {
  async listModels(request: GatewayRequestFn): Promise<GatewayModelInfo[]> {
    const result = await request<{
      models?: GatewayModelInfo[];
    }>('models.list', {});
    return result?.models ?? [];
  },
  async getConfig(request: GatewayRequestFn): Promise<GatewayConfigSnapshot> {
    const result = await request<{
      config?: Record<string, unknown> | null;
      hash?: string | null;
    }>('config.get', {});
    return {
      config: result?.config ?? null,
      hash: result?.hash ?? null,
    };
  },
  async getCurrentModelState(request: GatewayRequestFn): Promise<GatewayCurrentModelState> {
    const result = await request<GatewayCurrentModelState>('model.get', {});
    return {
      currentModel: result?.currentModel ?? '',
      currentProvider: result?.currentProvider ?? '',
      currentBaseUrl: result?.currentBaseUrl ?? '',
      note: result?.note ?? null,
    };
  },
  async getModelSelectionState(request: GatewayRequestFn): Promise<GatewayModelSelectionState> {
    const result = await request<GatewayModelSelectionState & { models?: GatewayModelInfo[] }>('model.get', {});
    return {
      currentModel: result?.currentModel ?? '',
      currentProvider: result?.currentProvider ?? '',
      currentBaseUrl: result?.currentBaseUrl ?? '',
      models: result?.models ?? [],
      providers: result?.providers ?? [],
      note: result?.note ?? null,
    };
  },
  async setModelSelection(
    request: GatewayRequestFn,
    params: { model: string; provider?: string; scope?: 'global' | 'session'; sessionKey?: string | null },
  ): Promise<GatewayModelSelectionWriteResult> {
    const result = await request<GatewayModelSelectionWriteResult>('model.set', params);
    return {
      ok: result?.ok ?? false,
      scope: result?.scope ?? 'global',
      currentModel: result?.currentModel ?? '',
      currentProvider: result?.currentProvider ?? '',
      currentBaseUrl: result?.currentBaseUrl ?? '',
      models: result?.models ?? [],
      providers: result?.providers ?? [],
      note: result?.note ?? null,
    };
  },
  async patchConfig(request: GatewayRequestFn, raw: string, baseHash: string): Promise<GatewayConfigWriteResult> {
    const result = await request<{
      ok?: boolean;
      config?: Record<string, unknown>;
      hash?: string;
    }>('config.patch', { raw, baseHash });
    return {
      ok: result?.ok ?? false,
      config: result?.config ?? undefined,
      hash: result?.hash ?? undefined,
    };
  },
  async setConfig(request: GatewayRequestFn, raw: string, baseHash: string): Promise<GatewayConfigWriteResult> {
    const result = await request<{
      ok?: boolean;
      config?: Record<string, unknown>;
      path?: string;
    }>('config.set', { raw, baseHash });
    return {
      ok: result?.ok ?? false,
      config: result?.config ?? undefined,
      path: result?.path ?? undefined,
    };
  },
  async fetchToolsCatalog(request: GatewayRequestFn, agentId: string): Promise<ToolsCatalogResult> {
    const result = await request<ToolsCatalogResult>('tools.catalog', { agentId, includePlugins: true });
    return (result ?? { agentId, profiles: [], groups: [] }) as ToolsCatalogResult;
  },
  async listAgentFiles(request: GatewayRequestFn, agentId: string): Promise<GatewayAgentFileSummary[]> {
    const result = await request<{
      files?: GatewayAgentFileSummary[];
    }>('agents.files.list', { agentId });
    return result?.files ?? [];
  },
  async getAgentFile(request: GatewayRequestFn, agentId: string, name: string): Promise<GatewayAgentFileDetail> {
    const result = await request<{
      file?: GatewayAgentFileDetail;
    }>('agents.files.get', { agentId, name });
    if (!result?.file) {
      throw new Error('File not found');
    }
    return result.file;
  },
  async setAgentFile(request: GatewayRequestFn, agentId: string, name: string, content: string): Promise<{ ok: boolean }> {
    const result = await request<{ ok?: boolean }>('agents.files.set', { agentId, name, content });
    return { ok: result?.ok ?? false };
  },
  async fetchUsage(
    request: GatewayRequestFn,
    params: { startDate: string; endDate: string },
  ): Promise<UsageResult> {
    const result = await request<UsageResult>('sessions.usage', {
      startDate: params.startDate,
      endDate: params.endDate,
      limit: 500,
      includeContextWeight: false,
    });
    return (result ?? {}) as UsageResult;
  },
  async fetchCostSummary(
    request: GatewayRequestFn,
    params: { startDate: string; endDate: string },
  ): Promise<CostSummary> {
    const result = await request<CostSummary>('usage.cost', {
      startDate: params.startDate,
      endDate: params.endDate,
    });
    return (result ?? {}) as CostSummary;
  },
};

const OPENCLAW_OPERATIONS: GatewayBackendOperations = {
  usesConnectHandshake: true,
  ...sharedOperations,
  getBaseUrl(config: GatewayConfig | null): string | null {
    return deriveBaseUrl(config?.url, /\/ws\/?$/);
  },
};

const HERMES_OPERATIONS: GatewayBackendOperations = {
  usesConnectHandshake: false,
  ...sharedOperations,
  async getCurrentModelState(request: GatewayRequestFn): Promise<GatewayCurrentModelState> {
    const result = await request<GatewayCurrentModelState>('model.current', {});
    return {
      currentModel: result?.currentModel ?? '',
      currentProvider: result?.currentProvider ?? '',
      currentBaseUrl: result?.currentBaseUrl ?? '',
      note: result?.note ?? null,
    };
  },
  getBaseUrl(config: GatewayConfig | null): string | null {
    return deriveBaseUrl(config?.url, /\/v1\/hermes\/ws\/?$/);
  },
};

export function getGatewayBackendOperations(config: GatewayConfig | null): GatewayBackendOperations {
  return resolveGatewayBackendKind(config) === 'hermes'
    ? HERMES_OPERATIONS
    : OPENCLAW_OPERATIONS;
}

function deriveBaseUrl(urlText: string | undefined, wsPathPattern: RegExp): string | null {
  if (!urlText) return null;
  try {
    const url = new URL(urlText.replace(/^ws(s?):\/\//, 'http$1://'));
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(wsPathPattern, '') || '/';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return urlText
      .replace(/^ws(s?):\/\//, 'http$1://')
      .replace(/\/+$/, '')
      .replace(wsPathPattern, '');
  }
}
