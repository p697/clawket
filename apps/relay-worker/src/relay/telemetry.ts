import type { RelayRuntime } from './runtime';

const REDACTED_FIELD_KEYS = new Set([
  'accessCode',
  'authorization',
  'cfRay',
  'clientId',
  'clientLabel',
  'currentBridgeClientId',
  'currentGatewayClientId',
  'bridgeClientId',
  'bridgeId',
  'gatewayClientId',
  'gatewayId',
  'objectId',
  'reqId',
  'secret',
  'sourceClientId',
  'targetClientId',
  'token',
  'traceId',
]);

function sanitizeTelemetryFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).filter(([key, value]) => !REDACTED_FIELD_KEYS.has(key) && value !== undefined),
  );
}

export function logRelayTelemetry(
  scope: 'relay_worker' | 'registry_worker' | 'hermes_relay_worker' | 'hermes_registry_worker',
  event: string,
  fields: Record<string, unknown>,
): void {
  const sanitizedFields = sanitizeTelemetryFields(fields);
  console.log(JSON.stringify({
    scope,
    event,
    ts: new Date().toISOString(),
    ...sanitizedFields,
  }));
}

export function logRuntimeTelemetry(
  runtime: RelayRuntime,
  event: string,
  fields: Record<string, unknown>,
): void {
  logRelayTelemetry(runtime.policy.telemetryScope, event, fields);
}
