import { AdapterError } from '@clawket/agent-protocol';
import { bridgeUpdateOperations } from './bridge-update';

const status = { id: '5b0c7a0e-3c1f-4e8e-9b2a-6f1d2c3b4a59', state: 'installing', startedAt: 1, version: '3.1.14' };
it('sends only the two parameterless update methods and validates their replies', async () => {
  const request = jest.fn(async (method: string) => method === 'bridge.update.start' ? { accepted: true, status } : { status: { ...status, path: '/private' } });
  const operations = bridgeUpdateOperations(request);
  await expect(operations.start()).resolves.toEqual({ accepted: true, status });
  await expect(operations.status()).resolves.toEqual(status);
  expect(request.mock.calls).toEqual([['bridge.update.start'], ['bridge.update.status']]);
});

it('treats a computer that never updated as no status and rejects malformed replies', async () => {
  await expect(bridgeUpdateOperations(async () => ({ status: null })).status()).resolves.toBeNull();
  await expect(bridgeUpdateOperations(async () => ({ status: { id: 'x' } })).status()).rejects.toBeInstanceOf(AdapterError);
  await expect(bridgeUpdateOperations(async () => ({ accepted: 'yes' })).start()).rejects.toThrow('Invalid Bridge update reply');
});
