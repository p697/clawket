// @vitest-environment node

import { describe, expect, it } from 'vitest';
import hermesFixture from '../../fixtures/hermes/m3-attachment-abort-v2.json';
import './mobile-node-mocks';
import { RecordedGateway } from './recorded-gateway';

describe('HermesAdapter Node integration', () => {
  it('connects after recorded health, sends one image message, and cancels its run', async () => {
    const { HermesAdapter } = await import('../../../apps/mobile/src/connection/adapters/hermes');
    const gateway = new RecordedGateway();
    const states: string[] = [];
    const updates: Array<Record<string, unknown>> = [];
    const request = hermesFixture.sendPacket.request;
    const runId = 'recorded-hermes-node-run';

    gateway.onConnect = () => {
      gateway.emit('connection', { state: 'ready' });
      gateway.emit('health', hermesFixture.firstFrame.payload);
    };
    gateway.requestHandler = (method) => {
      if (method !== request.method) throw new Error(`Unexpected method: ${method}`);
      return { runId };
    };

    const adapter = new HermesAdapter({
      id: 'hermes-node-recording',
      backendKind: 'hermes',
      transportKind: 'local',
      label: 'Recorded Hermes',
      createdAt: 1_700_000_000_000,
      url: 'ws://127.0.0.1:8787/v1/hermes/ws',
    }, {
      gateway: gateway as never,
      historyCache: null,
    });
    adapter.on('state', (state) => states.push(state));
    adapter.on('update', (update) => updates.push(update as unknown as Record<string, unknown>));

    await adapter.connect();
    const sent = await adapter.prompt(request.params.sessionKey, {
      text: request.params.message,
      idempotencyKey: request.params.idempotencyKey,
      attachments: request.params.attachments.map((attachment) => ({
        type: attachment.type as 'image',
        mimeType: attachment.mimeType,
        content: attachment.content,
      })),
    });
    await adapter.cancel(request.params.sessionKey, sent.runId);
    gateway.emit('chatAborted', {
      sessionKey: request.params.sessionKey,
      runId: sent.runId,
    });

    expect(adapter.state).toBe('ready');
    expect(states).toEqual(['connecting', 'handshaking', 'ready']);
    expect(gateway.requests).toEqual([{ method: request.method, params: request.params }]);
    expect(sent).toEqual({ runId });
    expect(gateway.aborts).toEqual([{
      key: hermesFixture.abortPacket.request.params.sessionKey,
      runId,
    }]);
    expect(updates).toContainEqual({
      type: 'run_finished',
      sessionKey: request.params.sessionKey,
      runId,
      stopReason: 'cancelled',
    });

    adapter.dispose();
  });
});
