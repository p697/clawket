const CONTROL_PREFIX = '__clawket_relay_control__:';

export type RelayControl = {
  event: string;
  requestId?: string;
  payload?: Record<string, unknown>;
  sourceClientId?: string;
  targetClientId?: string;
  count?: number;
};

export type ConnectStartIdentity = {
  id: string;
  label: string;
};

export type ConnectHandshakeMeta = {
  id: string | null;
  method: 'connect' | 'connect.start';
  minProtocol: number | null;
  maxProtocol: number | null;
  capabilities: string[] | null;
  noncePresent: boolean;
  nonceLength: number | null;
  authFields: string[];
};

export type PendingPairRequest = {
  requestId: string;
  deviceId: string;
  displayName: string | null;
  platform: string | null;
  deviceFamily: string | null;
  role: string | null;
  remoteIp: string | null;
  receivedAtMs: number;
  status: 'pending' | 'approved' | 'rejected';
};

export type ResponseEnvelopeMeta = {
  id: string;
  ok: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  errorDetails: Record<string, unknown> | null;
  retryAfterMs: number | null;
};

export function parseControl(text: string): RelayControl | null {
  if (!text.startsWith(CONTROL_PREFIX)) return null;
  try {
    const parsed = JSON.parse(text.slice(CONTROL_PREFIX.length)) as {
      event?: unknown;
      requestId?: unknown;
      payload?: unknown;
      sourceClientId?: unknown;
      targetClientId?: unknown;
      count?: unknown;
    };
    if (typeof parsed.event !== 'string' || !parsed.event.trim()) return null;
    const payload = isRecord(parsed.payload) ? parsed.payload : undefined;
    const countCandidate = typeof parsed.count === 'number' && Number.isFinite(parsed.count)
      ? parsed.count
      : typeof payload?.count === 'number' && Number.isFinite(payload.count)
        ? payload.count
        : undefined;
    return {
      event: parsed.event.trim(),
      requestId: readOptionalString(parsed.requestId),
      payload,
      sourceClientId: readOptionalString(parsed.sourceClientId),
      targetClientId: readOptionalString(parsed.targetClientId),
      count: countCandidate,
    };
  } catch {
    return null;
  }
}

export function parseConnectStartIdentity(text: string): ConnectStartIdentity | null {
  try {
    const parsed = JSON.parse(text) as {
      type?: unknown;
      method?: unknown;
      id?: unknown;
      params?: Record<string, unknown>;
    };
    if (parsed.type !== 'req') return null;
    if (parsed.method !== 'connect' && parsed.method !== 'connect.start') return null;
    const params = parsed.params ?? {};
    const id = typeof parsed.id === 'string' && parsed.id.trim()
      ? parsed.id.trim()
      : `req-${Math.random().toString(36).slice(2, 12)}`;
    const label = firstString(
      params.deviceName,
      params.clientName,
      params.deviceId,
      'Mobile Client',
    );
    return { id, label };
  } catch {
    return null;
  }
}

export function isConnectHandshakeRequest(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as { type?: unknown; method?: unknown };
    return parsed.type === 'req' && (parsed.method === 'connect' || parsed.method === 'connect.start');
  } catch {
    return false;
  }
}

export function parseConnectHandshakeMeta(text: string): ConnectHandshakeMeta | null {
  try {
    const parsed = JSON.parse(text) as {
      type?: unknown;
      method?: unknown;
      id?: unknown;
      meta?: unknown;
      params?: {
        minProtocol?: unknown;
        maxProtocol?: unknown;
        auth?: Record<string, unknown>;
        device?: {
          nonce?: unknown;
        };
      };
    };
    if (parsed.type !== 'req') return null;
    if (parsed.method !== 'connect' && parsed.method !== 'connect.start') return null;
    const nonce = parsed.params?.device?.nonce;
    const auth = parsed.params?.auth;
    const capabilities = isRecord(parsed.meta) && Array.isArray(parsed.meta.capabilities)
      ? normalizeConnectCapabilities(parsed.meta.capabilities)
      : null;
    return {
      id: typeof parsed.id === 'string' && parsed.id.trim() ? parsed.id.trim() : null,
      method: parsed.method,
      minProtocol: readProtocolVersion(parsed.params?.minProtocol),
      maxProtocol: readProtocolVersion(parsed.params?.maxProtocol),
      capabilities,
      noncePresent: typeof nonce === 'string' && nonce.length > 0,
      nonceLength: typeof nonce === 'string' ? nonce.length : null,
      authFields: auth && typeof auth === 'object'
        ? Object.keys(auth).sort()
        : [],
    };
  } catch {
    return null;
  }
}

export function normalizeConnectCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const capabilities: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== 'string') continue;
    const capability = candidate.trim();
    if (!capability || seen.has(capability)) continue;
    seen.add(capability);
    capabilities.push(capability);
  }
  return capabilities;
}

export function parsePairingRequestFromError(text: string, nowMs = Date.now()): PendingPairRequest | null {
  try {
    const parsed = JSON.parse(text) as {
      type?: unknown;
      ok?: unknown;
      error?: {
        code?: unknown;
        message?: unknown;
        details?: Record<string, unknown>;
        data?: Record<string, unknown>;
      };
    };
    if (parsed.type !== 'res' || parsed.ok !== false || !parsed.error) return null;
    const code = typeof parsed.error.code === 'string' ? parsed.error.code : '';
    const message = typeof parsed.error.message === 'string' ? parsed.error.message : '';
    if (!code.includes('NOT_PAIRED')
      && !code.includes('PAIRING_REQUIRED')
      && !message.includes('NOT_PAIRED')
      && !message.includes('pairing required')) {
      return null;
    }
    const details = parsed.error.details ?? parsed.error.data ?? {};
    const requestId = firstString(
      details.requestId,
      extractRequestIdFromMessage(message),
      'unknown',
    );
    return {
      requestId,
      deviceId: firstString(details.deviceId, ''),
      displayName: firstNullableString(details.displayName),
      platform: firstNullableString(details.platform),
      deviceFamily: firstNullableString(details.deviceFamily),
      role: firstNullableString(details.role),
      remoteIp: firstNullableString(details.remoteIp),
      receivedAtMs: nowMs,
      status: 'pending',
    };
  } catch {
    return null;
  }
}

export function parsePairResolvedEvent(text: string): { requestId: string; decision: 'approved' | 'rejected' | 'unknown' } | null {
  try {
    const parsed = JSON.parse(text) as {
      type?: unknown;
      event?: unknown;
      payload?: Record<string, unknown>;
    };
    if (parsed.type !== 'event' || parsed.event !== 'device.pair.resolved' || !parsed.payload) return null;
    const requestId = typeof parsed.payload.requestId === 'string' ? parsed.payload.requestId.trim() : '';
    if (!requestId) return null;
    const decisionValue = typeof parsed.payload.decision === 'string' ? parsed.payload.decision : 'unknown';
    const decision = decisionValue === 'approved' || decisionValue === 'rejected' ? decisionValue : 'unknown';
    return { requestId, decision };
  } catch {
    return null;
  }
}

export function parseResponseEnvelopeMeta(text: string): ResponseEnvelopeMeta | null {
  try {
    const parsed = JSON.parse(text) as {
      type?: unknown;
      id?: unknown;
      ok?: unknown;
      error?: {
        code?: unknown;
        message?: unknown;
        details?: unknown;
        retryAfterMs?: unknown;
      };
    };
    if (parsed.type !== 'res') return null;
    if (typeof parsed.id !== 'string' || !parsed.id.trim()) return null;
    return {
      id: parsed.id.trim(),
      ok: parsed.ok === true,
      errorCode: typeof parsed.error?.code === 'string' && parsed.error.code.trim()
        ? parsed.error.code.trim()
        : null,
      errorMessage: typeof parsed.error?.message === 'string' && parsed.error.message.trim()
        ? parsed.error.message.trim()
        : null,
      errorDetails: isRecord(parsed.error?.details) ? parsed.error.details : null,
      retryAfterMs: readRetryAfterMs(parsed.error?.retryAfterMs, parsed.error?.details),
    };
  } catch {
    return null;
  }
}

function readRetryAfterMs(value: unknown, details: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (isRecord(details)) {
    const detailsValue = details.retryAfterMs;
    if (typeof detailsValue === 'number' && Number.isFinite(detailsValue) && detailsValue >= 0) {
      return detailsValue;
    }
  }
  return null;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function firstNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readProtocolVersion(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.trunc(value)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

function extractRequestIdFromMessage(message: string): string | null {
  const matched = message.match(/requestId[:\s]*([a-f0-9-]+)/i);
  return matched?.[1] ?? null;
}
