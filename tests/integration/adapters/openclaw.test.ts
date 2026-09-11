// @vitest-environment node

import { describe, expect, it } from 'vitest';
import openClawFixture from '../../compat/fixtures/v1/bridge/openclaw-forwarding-v1.json';
import './mobile-node-mocks';
import { RecordedGateway } from './recorded-gateway';

type RecordedRequest = {
  method: string;
  params: {
    sessionKey: string;
    message: string;
    thinking: string;
    deliver: boolean;
    idempotencyKey: string;
  };
};

describe('OpenClawAdapter Node integration', () => {
  it('connects, sends one recorded message, and cancels its run', async () => {
    const { OpenClawAdapter } = await import('../../../apps/mobile/src/connection/adapters/openclaw');
    const gateway = new RecordedGateway();
    const states: string[] = [];
    const updates: Array<Record<string, unknown>> = [];
    const request = openClawFixture.frames.find((frame) => frame.sequence === 20)?.payload as RecordedRequest;
    const response = openClawFixture.frames.find((frame) => frame.sequence === 22)?.payload as {
      payload: { runId: string };
    };

    gateway.onConnect = () => {
      gateway.emit('connection', { state: 'challenging' });
      gateway.emit('connection', { state: 'ready' });
    };
    gateway.requestHandler = (method) => {
      if (method !== request.method) throw new Error(`Unexpected method: ${method}`);
      return response.payload;
    };

    const adapter = new OpenClawAdapter({
      id: 'openclaw-node-recording',
      backendKind: 'openclaw',
      transportKind: 'relay',
      label: 'Recorded OpenClaw',
      createdAt: 1_700_000_000_000,
      url: 'wss://relay.fixture.invalid/ws',
    }, {
      gateway: gateway as never,
      bridgeCapabilityMode: 'legacy',
      historyCache: null,
    });
    adapter.on('state', (state) => states.push(state));
    adapter.on('update', (update) => updates.push(update as unknown as Record<string, unknown>));

    await adapter.connect();
    const sent = await adapter.prompt(request.params.sessionKey, {
      text: request.params.message,
      idempotencyKey: request.params.idempotencyKey,
    });
    await adapter.cancel(request.params.sessionKey, sent.runId);
    gateway.emit('chatAborted', {
      sessionKey: request.params.sessionKey,
      runId: sent.runId,
    });

    expect(adapter.state).toBe('ready');
    expect(states).toEqual(['connecting', 'handshaking', 'ready']);
    expect(gateway.requests).toEqual([{ method: request.method, params: request.params }]);
    expect(sent).toEqual(response.payload);
    expect(gateway.aborts).toEqual([{ key: request.params.sessionKey, runId: response.payload.runId }]);
    expect(updates).toContainEqual({
      type: 'run_finished',
      sessionKey: request.params.sessionKey,
      runId: response.payload.runId,
      stopReason: 'cancelled',
    });

    adapter.dispose();
  });
});
