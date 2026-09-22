import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForHermesTerminalRun } from './run-recovery.js';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe('Hermes disconnected run recovery', () => {
  it('recovers an exact pending approval while continuing to wait for terminal evidence', async () => {
    const onStatus = vi.fn();
    const approval = { event: 'approval.request', run_id: 'run-1', request_id: 'request-1' };
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ run_id: 'other', status: 'waiting_for_approval', approval }))
      .mockResolvedValueOnce(Response.json({ run_id: 'run-1', status: 'waiting_for_approval', approval }))
      .mockResolvedValueOnce(Response.json({ run_id: 'run-1', status: 'completed' }));
    await waitForHermesTerminalRun({ apiBaseUrl: 'http://localhost', headers: {}, runId: 'run-1', signal: new AbortController().signal, onStatus });
    expect(onStatus).toHaveBeenCalledTimes(2);
    expect(onStatus.mock.calls[0][0]).toMatchObject({ status: 'waiting_for_approval', approval });
  });
  it('retains active ownership through stopping, network failure and mismatched status', async () => {
    const controller = new AbortController();
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ run_id: 'run-1', status: 'stopping', output: 'partial' }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(Response.json({ run_id: 'other', status: 'completed' }))
      .mockResolvedValueOnce(Response.json({ run_id: 'run-1', status: 'cancelled' }));
    let done = false;
    const pending = waitForHermesTerminalRun({ apiBaseUrl: 'http://localhost', headers: {}, runId: 'run-1', signal: controller.signal })
      .then(value => { done = true; return value; });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(done).toBe(false);
    await expect(pending).resolves.toMatchObject({ run_id: 'run-1', status: 'cancelled' });
    expect(fetch).toHaveBeenCalledTimes(4);
  }, 10_000);
  it('cancels retry waits and never converts unavailable status into success', async () => {
    const controller = new AbortController();
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    const pending = waitForHermesTerminalRun({ apiBaseUrl: 'http://localhost', headers: {}, runId: 'run-1', signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    await expect(pending).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['completed', 'failed', 'interrupted'])('accepts only an exact %s status', async status => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ run_id: 'run-1', status, output: 'result' }));
    await expect(waitForHermesTerminalRun({ apiBaseUrl: 'http://localhost', headers: {}, runId: 'run-1', signal: new AbortController().signal }))
      .resolves.toMatchObject({ status, output: 'result' });
  });
});
