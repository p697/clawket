import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HermesActiveRun } from './stream-mapping.js';
import { HermesRunControlMethods, readHermesRunCapabilities } from './run-control.js';
class Control extends HermesRunControlMethods {
  apiBaseUrl = 'http://127.0.0.1:8080'; apiKey = 'test-only-key';
  hermesRunCapabilities = new Set(['hermes.run-steer.v1']);
  broadcastEvent = vi.fn();
  activeRuns = new Map<string, HermesActiveRun>([['run/1', { runId: 'run/1', sessionKey: 'main', sessionId: 'session', abortController: new AbortController() }]]);
}
afterEach(() => vi.unstubAllGlobals());
describe('Hermes exact-run guidance', () => {
  it('negotiates only an explicitly supported feature and keeps legacy APIs usable', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ features: { run_steer: true } }))
      .mockResolvedValueOnce(Response.json({ features: { run_steer: 'true' } }))
      .mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetcher);
    expect(await readHermesRunCapabilities('http://local', null)).toEqual(new Set(['hermes.run-steer.v1']));
    expect(await readHermesRunCapabilities('http://local', null)).toEqual(new Set());
    expect(await readHermesRunCapabilities('http://local', null)).toEqual(new Set());
  });
  it('never steers another session, a cancelled run, or an unsupported server', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const control = new Control();
    await expect(control.handleChatSteer({ runId: 'run/1', sessionKey: 'other', message: 'change' })).rejects.toThrow('no longer');
    control.activeRuns.get('run/1')!.abortController.abort();
    await expect(control.handleChatSteer({ runId: 'run/1', sessionKey: 'main', message: 'change' })).rejects.toThrow('no longer');
    control.hermesRunCapabilities.clear();
    await expect(control.handleChatSteer({})).rejects.toThrow('unavailable');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('requires acknowledgement for the exact run and preserves rejection', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ accepted: true, run_id: 'run/1' }))
      .mockResolvedValueOnce(new Response('', { status: 409 }))
      .mockResolvedValueOnce(Response.json({ accepted: true, run_id: 'other' }));
    vi.stubGlobal('fetch', fetcher);
    const control = new Control();
    const input = { runId: 'run/1', sessionKey: 'main', message: 'Use a shorter answer' };
    await expect(control.handleChatSteer(input)).resolves.toEqual({ accepted: true, runId: 'run/1' });
    expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:8080/v1/runs/run%2F1/steer');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ input: input.message });
    await expect(control.handleChatSteer(input)).rejects.toThrow('409');
    await expect(control.handleChatSteer(input)).rejects.toThrow('not confirm');
  });
});


describe('Hermes exact-request approval', () => {
  it('does not resurrect a resolved approval from a stale polled snapshot', async () => {
    const control = new Control(); control.hermesRunCapabilities.add('hermes.run-approval.v1');
    const event = { event: 'approval.request', run_id: 'run/1', request_id: 'request', command: 'test', choices: ['deny'] };
    control.handleRunApprovalEvent('run/1', { ...event, run_id: 'other' });
    expect(control.listRunApprovals('main')).toEqual([]);
    control.handleRunApprovalEvent('run/1', event);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ run_id: 'run/1', request_id: 'request', resolved: 1 })));
    await control.handleExecApprovalResolve({ id: 'run/1:request', decision: 'deny' });
    control.broadcastEvent.mockClear();
    control.handleRunApprovalEvent('run/1', event);
    expect(control.listRunApprovals('main')).toEqual([]);
    expect(control.broadcastEvent).not.toHaveBeenCalled();
    control.activeRuns.get('run/1')!.abortController.abort();
    control.handleRunApprovalEvent('run/1', { ...event, request_id: 'new-request' });
    expect(control.listRunApprovals('main')).toEqual([]);
  });
  it('binds consent to an active request, honors available choices and expires on completion', async () => {
    const control = new Control();
    control.hermesRunCapabilities.add('hermes.run-approval.v1');
    control.handleRunApprovalEvent('run/1', { event: 'approval.request', request_id: 'request-1', command: 'test-only operation', choices: ['once', 'deny'] });
    expect(control.listRunApprovals('main')[0]?.approval.expiresAtMs).toBeNull();
    expect(control.broadcastEvent).toHaveBeenCalledWith('exec.approval.requested', expect.objectContaining({ id: 'run/1:request-1', request: expect.objectContaining({ decisions: ['allow-once', 'deny'], sessionKey: 'main' }) }));
    const fetcher = vi.fn().mockResolvedValue(Response.json({ run_id: 'run/1', request_id: 'request-1', resolved: 1 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(control.handleExecApprovalResolve({ id: 'run/1:request-1', decision: 'allow-always' })).rejects.toThrow('unavailable');
    expect(fetcher).not.toHaveBeenCalled();
    await expect(control.handleExecApprovalResolve({ id: 'run/1:request-1', decision: 'allow-once' })).resolves.toEqual({ ok: true });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ request_id: 'request-1', choice: 'once' });
    await expect(control.handleExecApprovalResolve({ id: 'run/1:request-1', decision: 'allow-once' })).rejects.toThrow('no longer');
    control.handleRunApprovalEvent('run/1', { event: 'approval.request', request_id: 'request-2', command: 'test', choices: ['once', 'deny'] });
    control.expireRunApprovals('run/1');
    expect(control.broadcastEvent).toHaveBeenLastCalledWith('exec.approval.resolved', { id: 'run/1:request-2', decision: 'expired' });
  });
  it('retains a failed request without reporting consent or silently retrying it', async () => {
    const control = new Control(); control.hermesRunCapabilities.add('hermes.run-approval.v1');
    control.handleRunApprovalEvent('run/1', { event: 'approval.request', request_id: 'request', command: 'test', choices: ['deny'] });
    control.broadcastEvent.mockClear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ run_id: 'other', request_id: 'request', resolved: 1 })));
    await expect(control.handleExecApprovalResolve({ id: 'run/1:request', decision: 'deny' })).rejects.toThrow('not confirm');
    expect(control.activeRuns.get('run/1')?.approvals?.get('run/1:request')?.resolving).toBe(false);
    expect(control.broadcastEvent).not.toHaveBeenCalled();
  });

  it('retires a request only when native Hermes confirms it is no longer pending', async () => {
    const control = new Control(); control.hermesRunCapabilities.add('hermes.run-approval.v1');
    control.handleRunApprovalEvent('run/1', { event: 'approval.request', request_id: 'request', command: 'test', choices: ['deny'] });
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: { code: 'conflict' } }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ error: { code: 'approval_not_pending' } }, { status: 409 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(control.handleExecApprovalResolve({ id: 'run/1:request', decision: 'deny' })).rejects.toThrow('not confirm');
    expect(control.listRunApprovals('main')).toHaveLength(1);
    await expect(control.handleExecApprovalResolve({ id: 'run/1:request', decision: 'deny' })).rejects.toThrow('no longer');
    expect(control.listRunApprovals('main')).toEqual([]);
    expect(control.broadcastEvent).toHaveBeenLastCalledWith('exec.approval.resolved', { id: 'run/1:request', decision: 'expired' });
  });
});
