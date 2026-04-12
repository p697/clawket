import {
  loadGatewayHermesThinkingState,
  saveGatewayHermesFastMode,
  saveGatewayHermesThinkingLevel,
} from './gateway-hermes-thinking';

describe('gateway-hermes-thinking', () => {
  it('loads Hermes thinking and fast state', async () => {
    const gateway = {
      request: jest.fn(async (method: string) => {
        if (method === 'hermes.reasoning.get') {
          return {
            level: 'high',
            rawLevel: 'high',
            showReasoning: true,
          };
        }
        if (method === 'hermes.fast.get') {
          return {
            enabled: true,
            supported: true,
          };
        }
        throw new Error(`Unexpected method: ${method}`);
      }) as <T = unknown>(method: string, params?: object) => Promise<T>,
    };

    await expect(loadGatewayHermesThinkingState(gateway)).resolves.toEqual({
      thinkingLevel: 'high',
      rawThinkingLevel: 'high',
      showReasoning: true,
      fastModeEnabled: true,
      fastModeSupported: true,
    });
  });

  it('saves Hermes thinking level', async () => {
    const gateway = {
      request: jest.fn(async (method: string, params?: Record<string, unknown>) => {
        if (method === 'hermes.reasoning.set') {
          expect(params).toEqual({ level: 'minimal' });
          return {
            level: 'minimal',
            rawLevel: 'minimal',
            showReasoning: false,
          };
        }
        if (method === 'hermes.fast.get') {
          return {
            enabled: false,
            supported: true,
          };
        }
        throw new Error(`Unexpected method: ${method}`);
      }) as <T = unknown>(method: string, params?: object) => Promise<T>,
    };

    await expect(saveGatewayHermesThinkingLevel(gateway, 'minimal')).resolves.toEqual({
      thinkingLevel: 'minimal',
      rawThinkingLevel: 'minimal',
      showReasoning: false,
      fastModeEnabled: false,
      fastModeSupported: true,
    });
  });

  it('saves Hermes fast mode', async () => {
    const gateway = {
      request: jest.fn(async (method: string, params?: Record<string, unknown>) => {
        if (method === 'hermes.reasoning.get') {
          return {
            level: 'medium',
            rawLevel: 'medium',
            showReasoning: false,
          };
        }
        if (method === 'hermes.fast.set') {
          expect(params).toEqual({ enabled: true });
          return {
            enabled: true,
            supported: true,
          };
        }
        throw new Error(`Unexpected method: ${method}`);
      }) as <T = unknown>(method: string, params?: object) => Promise<T>,
    };

    await expect(saveGatewayHermesFastMode(gateway, true)).resolves.toEqual({
      thinkingLevel: 'medium',
      rawThinkingLevel: 'medium',
      showReasoning: false,
      fastModeEnabled: true,
      fastModeSupported: true,
    });
  });
});
