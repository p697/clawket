import { readRebuildingOpenClawHistory } from './openclaw-history-retry';
const rebuilding = new Error('[UNAVAILABLE] session history is rebuilding; retry shortly');
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
it('retries only native rebuilding reads until managed attachments become available', async () => {
  const result = { attachments: ['artifact'] };
  const read = jest.fn().mockRejectedValueOnce(rebuilding).mockRejectedValueOnce(rebuilding).mockResolvedValue(result);
  const pending = readRebuildingOpenClawHistory(read, () => true);
  await jest.runAllTimersAsync();
  await expect(pending).resolves.toBe(result);
  expect(read).toHaveBeenCalledTimes(3);
});
it('bounds rebuilding retries and returns the final failure', async () => {
  const read = jest.fn().mockRejectedValue(rebuilding);
  const pending = readRebuildingOpenClawHistory(read, () => true).catch(e => e);
  await jest.runAllTimersAsync();
  expect(await pending).toBe(rebuilding); expect(read).toHaveBeenCalledTimes(5);
});
it('does not read again after the connection scope retires', async () => {
  let current = true;
  const read = jest.fn().mockRejectedValue(rebuilding);
  const pending = readRebuildingOpenClawHistory(read, () => current).catch(e => e);
  await Promise.resolve(); current = false;
  await jest.runAllTimersAsync();
  expect(await pending).toBe(rebuilding); expect(read).toHaveBeenCalledTimes(1);
});
it.each(['[UNAVAILABLE] offline', 'permission denied', 'timeout'])('does not retry other errors: %s', async message => {
  const read = jest.fn().mockRejectedValue(new Error(message));
  await expect(readRebuildingOpenClawHistory(read, () => true)).rejects.toThrow(message);
  expect(read).toHaveBeenCalledTimes(1);
});
