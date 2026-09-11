import { mapGatewayAdapterEvent, mapGatewayErrorCode } from './gateway-session-update';

describe('mapGatewayAdapterEvent', () => {
  it('maps the complete chat lifecycle to SessionUpdate', () => {
    expect(mapGatewayAdapterEvent({
      type: 'chatRunStart',
      payload: { runId: 'run-1', sessionKey: 'agent:main:main' },
    }, 'fallback')).toEqual([{
      type: 'run_started',
      runId: 'run-1',
      sessionKey: 'agent:main:main',
    }]);

    expect(mapGatewayAdapterEvent({
      type: 'chatDelta',
      payload: { runId: 'run-1', sessionKey: 'agent:main:main', text: 'hello' },
    }, 'fallback')).toEqual([{
      type: 'agent_message_chunk',
      runId: 'run-1',
      sessionKey: 'agent:main:main',
      text: 'hello',
    }]);

    expect(mapGatewayAdapterEvent({
      type: 'chatFinal',
      payload: {
        runId: 'run-1',
        sessionKey: 'agent:main:main',
        message: { role: 'assistant', content: [{ type: 'text', text: 'done' }], model: 'm' },
      },
    }, 'fallback')).toEqual([{
      type: 'run_finished',
      runId: 'run-1',
      sessionKey: 'agent:main:main',
      stopReason: 'end_turn',
      message: { role: 'assistant', content: 'done', provider: undefined, model: 'm' },
      usage: undefined,
    }]);
  });

  it('maps abort and errors to terminal updates', () => {
    expect(mapGatewayAdapterEvent({
      type: 'chatAborted',
      payload: { runId: 'run-2' },
    }, 'main')).toEqual([{
      type: 'run_finished',
      runId: 'run-2',
      sessionKey: 'main',
      stopReason: 'cancelled',
    }]);

    expect(mapGatewayAdapterEvent({
      type: 'chatError',
      payload: { runId: 'run-3', message: 'boom' },
    }, 'main')).toEqual([
      { type: 'error', sessionKey: 'main', runId: 'run-3', code: 'server', message: 'boom' },
      { type: 'run_finished', sessionKey: 'main', runId: 'run-3', stopReason: 'error' },
    ]);
  });

  it('maps approval events without exposing transport details', () => {
    expect(mapGatewayAdapterEvent({
      type: 'execApprovalRequested',
      payload: {
        id: 'approval-1',
        request: { command: 'npm test', sessionKey: 'main' },
        expiresAtMs: 123,
      },
    }, 'fallback')).toEqual([{
      type: 'approval_requested',
      sessionKey: 'main',
      approval: {
        kind: 'exec',
        id: 'approval-1',
        command: 'npm test',
        cwd: undefined,
        host: undefined,
        expiresAtMs: 123,
      },
    }]);
    expect(mapGatewayAdapterEvent({
      type: 'execApprovalResolved',
      payload: { id: 'approval-1', decision: 'deny' },
    }, 'fallback')).toEqual([{
      type: 'approval_resolved',
      approvalId: 'approval-1',
      decision: 'deny',
      kind: 'exec',
    }]);
  });

  it('keeps self-device handshake pairing state separate from owner approvals', () => {
    expect(mapGatewayAdapterEvent({
      type: 'pairingRequired',
      payload: {},
    }, 'fallback', () => 123)).toEqual([{ type: 'pairing_required', requestId: undefined }]);

    expect(mapGatewayAdapterEvent({
      type: 'pairingResolved',
      payload: { decision: 'approved' },
    }, 'fallback')).toEqual([{
      type: 'pairing_resolved',
      requestId: undefined,
      decision: 'approved',
    }]);
  });

  it('maps device and node pair approvals to the backend-neutral contract', () => {
    expect(mapGatewayAdapterEvent({
      type: 'pairApprovalRequested',
      payload: {
        requestId: 'pair-device',
        target: 'device',
        displayName: 'Work phone',
        platform: 'ios',
        ts: 123,
      },
    }, 'fallback')).toEqual([{
      type: 'approval_requested',
      approval: {
        kind: 'pair',
        id: 'pair-device',
        target: 'device',
        displayName: 'Work phone',
        platform: 'ios',
        receivedAtMs: 123,
      },
    }]);
    expect(mapGatewayAdapterEvent({
      type: 'pairApprovalRequested',
      payload: {
        requestId: 'pair-node',
        target: 'node',
        displayName: null,
        platform: null,
      },
    }, 'fallback', () => 456)).toEqual([{
      type: 'approval_requested',
      approval: {
        kind: 'pair',
        id: 'pair-node',
        target: 'node',
        displayName: null,
        platform: null,
        receivedAtMs: 456,
      },
    }]);
    expect(mapGatewayAdapterEvent({
      type: 'pairApprovalResolved',
      payload: {
        requestId: 'pair-node',
        target: 'node',
        decision: 'rejected',
        ts: 789,
      },
    }, 'fallback')).toEqual([{
      type: 'approval_resolved',
      approvalId: 'pair-node',
      decision: 'rejected',
      kind: 'pair',
      target: 'node',
    }]);
  });
});

describe('mapGatewayErrorCode', () => {
  it.each([
    ['frame_too_large', 'frame_too_large'],
    ['1009 Message too big', 'frame_too_large'],
    ['rate_limited', 'rate_limited'],
    ['4008 Policy violation', 'rate_limited'],
    ['auth_failed', 'unauthorized'],
    ['challenge_timeout', 'bridge_offline'],
    ['request_timeout', 'timeout'],
    ['BRIDGE_UNAVAILABLE', 'bridge_offline'],
    ['ws_error', 'network'],
    ['unknown', 'server'],
  ])('maps %s to %s', (raw, expected) => {
    expect(mapGatewayErrorCode(raw)).toBe(expected);
  });
});
