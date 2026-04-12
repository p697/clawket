import { resolveHermesModelDisplayState } from './gateway-hermes-model-display';

describe('gateway-hermes-model-display', () => {
  it('returns ready when a current model is available', () => {
    expect(resolveHermesModelDisplayState({
      currentModel: 'gpt-5',
      currentProvider: 'openai',
      loading: true,
    })).toEqual({
      model: 'gpt-5',
      provider: 'openai',
      status: 'ready',
    });
  });

  it('returns loading while the current model is still being fetched', () => {
    expect(resolveHermesModelDisplayState({
      currentModel: '',
      currentProvider: '',
      loading: true,
      error: false,
    })).toEqual({
      model: null,
      provider: null,
      status: 'loading',
    });
  });

  it('returns unavailable after loading finishes without a current model', () => {
    expect(resolveHermesModelDisplayState({
      currentModel: '',
      currentProvider: 'openrouter',
      loading: false,
      error: true,
    })).toEqual({
      model: null,
      provider: 'openrouter',
      status: 'unavailable',
    });
  });
});
