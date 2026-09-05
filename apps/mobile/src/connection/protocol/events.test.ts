import type { GatewayProtocolEvents } from './types';
import { routeGatewayEvent, type RoutedEventResult } from './events';

type EmittedEvent = {
  event: keyof GatewayProtocolEvents;
  payload: GatewayProtocolEvents[keyof GatewayProtocolEvents];
};

function routeWithResult(event: string, payload: unknown): {
  emitted: EmittedEvent[];
  result: RoutedEventResult;
} {
  const emitted: EmittedEvent[] = [];
  const result = routeGatewayEvent(
    event,
    payload,
    ((name: keyof GatewayProtocolEvents, value: GatewayProtocolEvents[keyof GatewayProtocolEvents]) => {
      emitted.push({ event: name, payload: value });
    }) as never,
    () => 999,
  );
  return { emitted, result };
}

function route(event: string, payload: unknown): EmittedEvent[] {
  return routeWithResult(event, payload).emitted;
}

describe('routeGatewayEvent pairing approvals', () => {
  it.each([
    ['device.pair.requested', 'device'],
    ['node.pair.requested', 'node'],
  ] as const)('normalizes %s without leaking backend-only fields', (event, target) => {
    expect(route(event, {
      requestId: `${target}-request`,
      displayName: 'Work phone',
      platform: 'ios',
      ts: 123,
      publicKey: 'not-forwarded',
      remoteIp: 'not-forwarded',
    })).toEqual([{
      event: 'pairApprovalRequested',
      payload: {
        requestId: `${target}-request`,
        target,
        displayName: 'Work phone',
        platform: 'ios',
        ts: 123,
      },
    }]);
  });

  it('tolerates missing optional request metadata and rejects a missing request id', () => {
    expect(route('node.pair.requested', { requestId: 'node-request' })).toEqual([{
      event: 'pairApprovalRequested',
      payload: {
        requestId: 'node-request',
        target: 'node',
        displayName: null,
        platform: null,
        ts: 999,
      },
    }]);
    expect(route('device.pair.requested', { displayName: 'No id' })).toEqual([]);
  });

  it('routes owner resolutions and returns the device resolution for exact self correlation', () => {
    const device = routeWithResult('device.pair.resolved', {
      requestId: 'device-request',
      deviceId: 'device-1',
      decision: 'approved',
      ts: 321,
    });
    expect(device.emitted).toEqual([{
      event: 'pairApprovalResolved',
      payload: {
        requestId: 'device-request',
        target: 'device',
        decision: 'approved',
        ts: 321,
      },
    }]);
    expect(device.result).toEqual({
      pairingResolution: {
        requestId: 'device-request',
        deviceId: 'device-1',
        decision: 'approved',
      },
    });
    expect(route('node.pair.resolved', {
      requestId: 'node-request',
      decision: 'rejected',
      ts: 654,
    })).toEqual([{
      event: 'pairApprovalResolved',
      payload: {
        requestId: 'node-request',
        target: 'node',
        decision: 'rejected',
        ts: 654,
      },
    }]);
  });
});
