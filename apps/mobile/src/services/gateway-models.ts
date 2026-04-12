type GatewayModel = {
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

type GatewayConfigSnapshot = {
  config: Record<string, unknown> | null;
  hash: string | null;
};

type GatewayModelsGateway = {
  listModels(): Promise<GatewayModel[]>;
  getConfig(): Promise<GatewayConfigSnapshot>;
};

type GatewayModelsListGateway = {
  listModels(): Promise<GatewayModel[]>;
};

export type GatewayModelsConfigBundle = {
  models: GatewayModel[];
  config: Record<string, unknown> | null;
  configHash: string | null;
};

export type GatewayModelPickerOption = {
  id: string;
  name: string;
  provider: string;
};

export async function loadGatewayModelsConfigBundle(
  gateway: GatewayModelsGateway,
): Promise<GatewayModelsConfigBundle> {
  const [models, configResult] = await Promise.all([
    gateway.listModels(),
    gateway.getConfig(),
  ]);
  return {
    models,
    config: configResult.config,
    configHash: configResult.hash,
  };
}

export function listGatewayModelRefs(models: GatewayModel[]): string[] {
  return models
    .map((model) => `${model.provider}/${model.id}`)
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .sort((a, b) => a.localeCompare(b));
}

export async function loadGatewayModelPickerOptions(
  gateway: GatewayModelsListGateway,
): Promise<GatewayModelPickerOption[]> {
  const models = await gateway.listModels();
  return models.map((model) => ({
    id: model.id,
    name: model.name,
    provider: model.provider,
  }));
}
