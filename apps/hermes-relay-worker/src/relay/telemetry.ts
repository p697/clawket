const REDACTED_FIELD_KEYS = new Set([
  'accessCode',
  'authorization',
  'cfRay',
  'clientId',
  'clientLabel',
  'currentBridgeClientId',
  'bridgeClientId',
  'bridgeId',
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
  scope: 'hermes_relay_worker' | 'hermes_registry_worker',
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
