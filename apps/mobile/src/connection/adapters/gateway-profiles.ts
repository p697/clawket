import type { GatewayProtocolProfile } from '../protocol/types';

export const OPENCLAW_GATEWAY_PROTOCOL_PROFILE: GatewayProtocolProfile = Object.freeze({
  relayIdQueryParam: 'gatewayId',
  baseUrlSocketPathPattern: /\/ws\/?$/,
  challengeEvent: 'connect.challenge',
  readinessTimeoutOption: 'handshakeTimeoutMs',
  readinessTimeoutMs: 20_000,
  readinessTimeoutError: Object.freeze({
    code: 'challenge_timeout',
    message: 'Gateway handshake timed out',
  }),
  currentModelMethod: 'model.get',
});

export const HERMES_GATEWAY_PROTOCOL_PROFILE: GatewayProtocolProfile = Object.freeze({
  relayIdQueryParam: 'bridgeId',
  relayHealthRequestMethod: 'health',
  baseUrlSocketPathPattern: /\/v1\/hermes\/ws\/?$/,
  healthReadiness: (payload, { hasPayload }) => {
    const status = typeof payload.status === 'string'
      ? payload.status.trim().toLowerCase()
      : '';
    if (
      hasPayload
      && payload.hermesApiReachable !== false
      && (!status || status === 'ok' || status === 'healthy')
    ) {
      return { state: 'ready' };
    }
    return {
      state: 'error',
      code: 'gateway_offline',
      message: 'Hermes did not respond to the Bridge health probe',
      retryable: true,
    };
  },
  readinessTimeoutOption: 'directFirstFrameTimeoutMs',
  readinessTimeoutMs: 8_000,
  readinessTimeoutError: Object.freeze({
    code: 'first_health_timeout',
    message: 'Hermes health frame timed out',
  }),
  currentModelMethod: 'model.current',
});
