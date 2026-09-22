import type { HermesActiveRun } from './stream-mapping.js';
import { isRecord, readString } from './internal.js';

/** Capability discovery is read-only and never makes an older API unhealthy. */
export async function readHermesRunCapabilities(baseUrl: string, key: string | null): Promise<ReadonlySet<string>> {
  try {
    const response = await fetch(`${baseUrl}/v1/capabilities`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return new Set();
    const body: unknown = await response.json();
    if (!isRecord(body) || !isRecord(body.features)) return new Set();
    return new Set([...(body.features.run_steer === true ? ['hermes.run-steer.v1'] : []),
      ...(body.features.run_approval_response === true && body.features.approval_events === true ? ['hermes.run-approval.v1'] : [])]);
  } catch { return new Set(); }
}

export abstract class HermesRunControlMethods {
  declare apiBaseUrl: string;
  declare apiKey: string | null;
  declare activeRuns: Map<string, HermesActiveRun>;
  declare hermesRunCapabilities: ReadonlySet<string>;

  declare broadcastEvent: (event: string, payload: unknown) => void;

  handleRunApprovalEvent(runId: string, event: Record<string, unknown>): void {
    const run = this.activeRuns.get(runId);
    if (!run || run.abortController.signal.aborted || !this.hermesRunCapabilities.has('hermes.run-approval.v1')
      || (event.run_id !== undefined && event.run_id !== runId)) return;
    const requestId = readString(event.request_id);
    if (!requestId || requestId.length > 256) return;
    const id = `${runId}:${requestId}`;
    run.closedApprovalIds ??= new Set();
    if (event.event === 'approval.request') {
      if (run.closedApprovalIds.has(id) || run.closedApprovalIds.size >= 512) return;
      const command = readString(event.command);
      if (!command || command.length > 32_000 || !Array.isArray(event.choices)) return;
      const decisions = event.choices.flatMap((choice) => choice === 'once' ? ['allow-once'] : choice === 'always' ? ['allow-always'] : choice === 'deny' ? ['deny'] : []);
      if (!decisions.includes('deny')) return;
      run.approvals ??= new Map();
      if (run.approvals.size >= 32 || run.approvals.has(id)) return;
      // Native Hermes keeps its timeout server-side and does not include it
      // in approval events. Do not invent a client-side approval lifetime.
      const expiresAtMs = typeof event.expires_at_ms === 'number' && Number.isFinite(event.expires_at_ms) ? event.expires_at_ms : null;
      run.approvals.set(id, { requestId, command, decisions, expiresAtMs, resolving: false });
      this.broadcastEvent('exec.approval.requested', { id, createdAtMs: Date.now(), expiresAtMs,
        request: { command, sessionKey: run.sessionKey, decisions } });
    } else if (event.event === 'approval.responded' && run.approvals?.has(id)
      && ['once', 'session', 'always', 'deny'].includes(readString(event.choice))) {
      run.approvals.delete(id);
      run.closedApprovalIds.add(id);
      this.broadcastEvent('exec.approval.resolved', { id, decision: event.choice === 'deny' ? 'deny' : 'allow-once' });
    }
  }

  listRunApprovals(sessionKey: string) {
    if (!this.hermesRunCapabilities.has('hermes.run-approval.v1')) return [];
    return [...this.activeRuns.values()].filter((run) => run.sessionKey === sessionKey && !run.abortController.signal.aborted)
      .flatMap((run) => [...(run.approvals ?? new Map()).entries()].filter(([, value]) => value.expiresAtMs === null || value.expiresAtMs > Date.now())
        .map(([id, value]) => ({ sessionKey, approval: { kind: 'exec' as const, id, command: value.command, decisions: value.decisions, expiresAtMs: value.expiresAtMs } })));
  }

  expireRunApprovals(runId: string): void {
    const run = this.activeRuns.get(runId);
    for (const id of run?.approvals?.keys() ?? []) this.broadcastEvent('exec.approval.resolved', { id, decision: 'expired' });
    run?.approvals?.clear();
  }

  async handleExecApprovalResolve(payload: Record<string, unknown>): Promise<{ ok: true }> {
    if (!this.hermesRunCapabilities.has('hermes.run-approval.v1')) throw new Error('Approvals are unavailable.');
    const id = readString(payload.id); const decision = readString(payload.decision);
    const run = [...this.activeRuns.values()].find((active) => active.approvals?.has(id));
    const request = run?.approvals?.get(id);
    if (!run || !request || run.abortController.signal.aborted || (request.expiresAtMs !== null && request.expiresAtMs <= Date.now())) throw new Error('Approval is no longer pending.');
    if (request.resolving || !request.decisions.includes(decision)) throw new Error('Approval choice is unavailable.');
    request.resolving = true;
    try {
      const response = await fetch(`${this.apiBaseUrl}/v1/runs/${encodeURIComponent(run.runId)}/approval`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
        body: JSON.stringify({ request_id: request.requestId, choice: decision === 'allow-once' ? 'once' : decision === 'allow-always' ? 'always' : 'deny' }),
        signal: AbortSignal.any([run.abortController.signal, AbortSignal.timeout(10_000)]),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.status === 409 && isRecord(body) && isRecord(body.error)
        && ['approval_not_active', 'approval_not_pending'].includes(readString(body.error.code))) {
        run.approvals?.delete(id);
        (run.closedApprovalIds ??= new Set()).add(id);
        this.broadcastEvent('exec.approval.resolved', { id, decision: 'expired' });
        throw new Error('Approval is no longer pending.');
      }
      if (!response.ok) throw new Error('Hermes did not confirm this approval.');
      if (!isRecord(body) || body.run_id !== run.runId || body.request_id !== request.requestId || body.resolved !== 1) throw new Error('Hermes did not confirm this approval.');
      run.approvals?.delete(id);
      (run.closedApprovalIds ??= new Set()).add(id);
      this.broadcastEvent('exec.approval.resolved', { id, decision });
      return { ok: true };
    } finally { request.resolving = false; }
  }

  async handleChatSteer(payload: Record<string, unknown>): Promise<{ accepted: true; runId: string }> {
    if (!this.hermesRunCapabilities.has('hermes.run-steer.v1')) throw new Error('Current-run steering is unavailable.');
    const runId = readString(payload.runId);
    const sessionKey = readString(payload.sessionKey);
    const text = readString(payload.message);
    if (!runId || !sessionKey || !text || text.length > 100_000) throw new Error('Invalid steering request.');
    const run = this.activeRuns.get(runId);
    if (!run || run.sessionKey !== sessionKey || run.abortController.signal.aborted) throw new Error('This run is no longer accepting input.');
    const response = await fetch(`${this.apiBaseUrl}/v1/runs/${encodeURIComponent(runId)}/steer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify({ input: text }),
      signal: AbortSignal.any([run.abortController.signal, AbortSignal.timeout(10_000)]),
    });
    if (!response.ok) throw new Error(`Hermes did not confirm steering (${response.status}). Check the current task before retrying.`);
    const body: unknown = await response.json();
    if (!isRecord(body) || body.accepted !== true || body.run_id !== runId) throw new Error('Hermes did not confirm steering.');
    return { accepted: true, runId };
  }
}
