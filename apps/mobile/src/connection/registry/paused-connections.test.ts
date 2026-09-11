import AsyncStorage from '@react-native-async-storage/async-storage';
import { pausedConnectionStore } from './paused-connections';

describe('paused connection preferences', () => {
  afterEach(() => jest.restoreAllMocks());
  it.each(['{', 'null', '42', '{}', '"oops"'])('degrades corrupt value %s without rewriting storage', async (raw) => {
    jest.spyOn(AsyncStorage, 'getItem').mockResolvedValue(raw);
    const write = jest.spyOn(AsyncStorage, 'setItem');
    await expect(pausedConnectionStore.read()).resolves.toEqual([]);
    expect(write).not.toHaveBeenCalled();
  });
  it('preserves valid paused connections in a partially corrupt array', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockResolvedValue('["alpha",null,"","alpha",12,"beta"]');
    await expect(pausedConnectionStore.read()).resolves.toEqual(['alpha', 'beta']);
  });
  it('does not let a preference storage failure prevent startup', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValue(new Error('storage unavailable'));
    await expect(pausedConnectionStore.read()).resolves.toEqual([]);
  });
});
