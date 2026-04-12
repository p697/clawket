import { listGatewayModelRefs } from './gateway-models';
import {
  parseGatewayRuntimeSettings,
  type GatewayRuntimeSettings,
} from '../utils/gateway-settings';

type GatewayRuntimeSettingsGateway = {
  listModels(): Promise<Array<{ id: string; name: string; provider: string }>>;
  getConfig(): Promise<{ config: Record<string, unknown> | null; hash: string | null }>;
};

export const DEFAULT_GATEWAY_RUNTIME_SETTINGS: GatewayRuntimeSettings = {
  heartbeatEvery: '',
  heartbeatActiveStart: '',
  heartbeatActiveEnd: '',
  heartbeatActiveTimezone: '',
  heartbeatSession: '',
  heartbeatModel: '',
  defaultModel: '',
  fallbackModels: [],
  thinkingDefault: '',
};

export type GatewayRuntimeSettingsBundle = {
  settings: GatewayRuntimeSettings;
  configHash: string | null;
  availableModels: string[];
};

export async function loadGatewayRuntimeSettingsBundle(
  gateway: GatewayRuntimeSettingsGateway,
  options: {
    canReadConfig: boolean;
    canListModels: boolean;
  },
): Promise<GatewayRuntimeSettingsBundle> {
  if (!options.canReadConfig) {
    const availableModels = options.canListModels
      ? listGatewayModelRefs(await gateway.listModels())
      : [];
    return {
      settings: DEFAULT_GATEWAY_RUNTIME_SETTINGS,
      configHash: null,
      availableModels,
    };
  }

  const [configResult, modelsResult] = await Promise.allSettled([
    gateway.getConfig(),
    options.canListModels ? gateway.listModels() : Promise.resolve([]),
  ]);

  if (configResult.status !== 'fulfilled') {
    throw configResult.reason;
  }

  return {
    settings: parseGatewayRuntimeSettings(configResult.value.config),
    configHash: configResult.value.hash,
    availableModels: modelsResult.status === 'fulfilled'
      ? listGatewayModelRefs(modelsResult.value)
      : [],
  };
}
