import type { GatewayModelProviderInfo } from './gateway-backend-operations';

type GatewayHermesModelInfo = {
  id: string;
  name: string;
  provider: string;
};

type GatewayHermesModelSelectionGateway = {
  getModelSelectionState(): Promise<{
    currentModel: string;
    currentProvider: string;
    currentBaseUrl: string;
    models: GatewayHermesModelInfo[];
    providers?: GatewayModelProviderInfo[];
    note?: string | null;
  }>;
  setModelSelection(params: {
    model: string;
    provider?: string;
    scope?: 'global' | 'session';
    sessionKey?: string | null;
  }): Promise<{
    ok: boolean;
    scope: 'global';
    currentModel: string;
    currentProvider: string;
    currentBaseUrl: string;
    models: GatewayHermesModelInfo[];
    providers?: GatewayModelProviderInfo[];
    note?: string | null;
  }>;
};

export type GatewayHermesModelSelectionState = {
  currentModel: string;
  currentProvider: string;
  currentBaseUrl: string;
  note: string | null;
  models: GatewayHermesModelInfo[];
  providers: GatewayModelProviderInfo[];
};

export async function loadGatewayHermesModelSelection(
  gateway: GatewayHermesModelSelectionGateway,
): Promise<GatewayHermesModelSelectionState> {
  const result = await gateway.getModelSelectionState();
  return {
    currentModel: result.currentModel,
    currentProvider: result.currentProvider,
    currentBaseUrl: result.currentBaseUrl,
    note: result.note ?? null,
    models: result.models,
    providers: result.providers ?? [],
  };
}

export async function saveGatewayHermesModelSelection(
  gateway: GatewayHermesModelSelectionGateway,
  params: { model: string; provider?: string },
): Promise<GatewayHermesModelSelectionState> {
  const result = await gateway.setModelSelection({
    model: params.model,
    ...(params.provider ? { provider: params.provider } : {}),
    scope: 'global',
  });
  return {
    currentModel: result.currentModel,
    currentProvider: result.currentProvider,
    currentBaseUrl: result.currentBaseUrl,
    note: result.note ?? null,
    models: result.models,
    providers: result.providers ?? [],
  };
}
