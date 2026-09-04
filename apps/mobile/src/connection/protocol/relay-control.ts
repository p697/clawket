import type { GatewayBackendKind, GatewayConfig } from '../../types';
import { normalizeWsUrl } from '../../services/gateway-auth';

export const RELAY_CONTROL_PREFIX = '__clawket_relay_control__:';
export const OPENCLAW_MOBILE_SETUP_CAPABILITY = 'openclaw.bootstrap.mobile-setup.v1';
export const RELAY_CLIENT_PONG_CAPABILITY = 'relay.client-pong.v1';

export type RelayBootstrapStrategy = 'mobile-setup' | 'legacy-bound';

export type RelayBootstrapCredential = {
  token: string;
  strategy: RelayBootstrapStrategy;
  access?: 'full' | 'limited' | 'node';
};

export type RelayConnectAuthSelection = {
  auth: {
    token?: string;
    password?: string;
    deviceToken?: string;
    bootstrapToken?: string;
  };
  signatureToken?: string;
  source: 'device-token' | 'bootstrap-token' | 'legacy-token' | 'legacy-password' | 'none';
  bootstrapStrategy?: RelayBootstrapStrategy;
};

export type RelayControlFrame = {
  event: string;
  requestId?: string;
  payload: Record<string, unknown>;
};

export function buildRelayClientWsUrl(input: {
  relayUrl: string;
  gatewayId: string;
  token: string;
  clientId: string;
  backendKind: GatewayBackendKind;
}): string {
  const url = new URL(normalizeWsUrl(input.relayUrl));
  if (!url.pathname || url.pathname === '/') url.pathname = '/ws';
  url.searchParams.set(input.backendKind === 'hermes' ? 'bridgeId' : 'gatewayId', input.gatewayId);
  url.searchParams.set('role', 'client');
  url.searchParams.set('clientId', input.clientId);
  url.searchParams.set('token', input.token);
  url.searchParams.set('capabilities', RELAY_CLIENT_PONG_CAPABILITY);
  return url.toString();
}

export function relaySupportsBootstrapV2(relay?: GatewayConfig['relay']): boolean {
  if (relay?.supportsBootstrap === true) return true;
  if (relay?.supportsBootstrap === false) return false;
  return (relay?.protocolVersion ?? 0) >= 2;
}

export function selectConnectAuth(input: {
  token?: string;
  password?: string;
  storedDeviceToken?: string | null;
  bootstrapToken?: string | null;
  bootstrapStrategy?: RelayBootstrapStrategy;
}): RelayConnectAuthSelection {
  const deviceToken = readString(input.storedDeviceToken);
  if (deviceToken) {
    return {
      auth: { deviceToken },
      signatureToken: deviceToken,
      source: 'device-token',
    };
  }
  const bootstrapToken = readString(input.bootstrapToken);
  if (bootstrapToken) {
    return {
      auth: { bootstrapToken },
      signatureToken: bootstrapToken,
      source: 'bootstrap-token',
      ...(input.bootstrapStrategy ? { bootstrapStrategy: input.bootstrapStrategy } : {}),
    };
  }
  const token = readString(input.token);
  if (token) {
    return { auth: { token }, signatureToken: token, source: 'legacy-token' };
  }
  const password = readString(input.password);
  if (password) return { auth: { password }, source: 'legacy-password' };
  return { auth: {}, source: 'none' };
}

export function buildRelayControlFrame(
  event: string,
  requestId?: string,
  payload?: Record<string, unknown>,
): string {
  return `${RELAY_CONTROL_PREFIX}${JSON.stringify({
    type: 'control',
    event,
    ...(requestId ? { requestId } : {}),
    ...(payload ? { payload } : {}),
  })}`;
}

export function parseRelayControlFrame(raw: unknown): RelayControlFrame | null {
  if (typeof raw !== 'string' || !raw.startsWith(RELAY_CONTROL_PREFIX)) return null;
  try {
    const parsed = JSON.parse(raw.slice(RELAY_CONTROL_PREFIX.length)) as Record<string, unknown>;
    const event = readString(parsed.event);
    if (!event) return null;
    const nested = isRecord(parsed.payload) ? parsed.payload : {};
    const requestId = readString(parsed.requestId) ?? readString(nested.requestId);
    return {
      event,
      ...(requestId ? { requestId } : {}),
      payload: { ...parsed, ...nested },
    };
  } catch {
    return null;
  }
}

export function readBootstrapCredential(control: RelayControlFrame): RelayBootstrapCredential | null {
  if (control.event !== 'bootstrap.issued') return null;
  const token = readString(control.payload.bootstrapToken ?? control.payload.token);
  if (!token) return null;
  const strategy: RelayBootstrapStrategy = control.payload.strategy === 'mobile-setup'
    ? 'mobile-setup'
    : 'legacy-bound';
  const access = control.payload.access === 'full'
    || control.payload.access === 'limited'
    || control.payload.access === 'node'
    ? control.payload.access
    : undefined;
  return { token, strategy, ...(access ? { access } : {}) };
}

export function readRelayControlError(control: RelayControlFrame): Error {
  const nested = isRecord(control.payload.error) ? control.payload.error : {};
  const code = readString(control.payload.code ?? nested.code) ?? 'relay_control_failed';
  const message = readString(control.payload.message ?? nested.message) ?? 'Relay control request failed.';
  return new Error(`[${code}] ${message}`);
}

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
