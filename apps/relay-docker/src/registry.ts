/**
 * registry.ts — Registry HTTP API server for Docker deployment.
 *
 * Ported from apps/relay-registry/src/index.ts.
 * Replaces Cloudflare Worker with Node.js http server.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  normalizeRegion,
  parsePositiveInt,
  sha256Hex,
  type PairAccessCodeRequest,
  type PairAccessCodeResponse,
  type PairClaimRequest,
  type PairClaimResponse,
  type PairRegisterRequest,
  type PairRegisterResponse,
} from '@clawket/shared';
import type { MemoryKV } from './kv-store.js';

interface RegistryConfig {
  routesKv: MemoryKV;
  relayRegionMap: string;
  pairAccessCodeTtlSec?: string;
  pairClientTokenMax?: string;
  relayUrl: string; // The public WebSocket relay URL for this deployment
}

type PairClientTokenRecord = {
  hash: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

type PairGatewayRecord = {
  gatewayId: string;
  relayUrl: string;
  region: string;
  displayName: string | null;
  relaySecretHash: string;
  accessCodeHash: string | null;
  accessCodeExpiresAt: string | null;
  clientTokens: PairClientTokenRecord[];
  createdAt: string;
  updatedAt: string;
};

type PairGatewayLookupResult =
  | { ok: true; record: PairGatewayRecord | null }
  | { ok: false; gatewayId: string };

const ACCESS_CODE_TTL_FALLBACK_SEC = 10 * 60;
const PAIR_CLIENT_TOKEN_MAX_FALLBACK = 8;
const ACCESS_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const ACCESS_CODE_LENGTH = 6;
const ACCESS_CODE_RANDOM_LIMIT = Math.floor(256 / ACCESS_CODE_ALPHABET.length) * ACCESS_CODE_ALPHABET.length;
const MAX_JSON_BODY_BYTES = 16 * 1024;

export function createRegistryServer(
  config: RegistryConfig,
  port: number,
): { start: () => void; close: () => Promise<void> } {
  const server = createServer(async (req, res) => {
    const startedAt = Date.now();
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      sendCors(res, 204);
      return;
    }

    try {
      if (req.method === 'GET' && url.pathname === '/v1/health') {
        const relayMap = readRelayMap(config);
        sendJsonCors(res, 200, { ok: true, regions: Object.keys(relayMap) });
        logTelemetry('http_request', req, url, 200, Date.now() - startedAt);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/pair/register') {
        const bodyResult = await readJsonBodyLimited<PairRegisterRequest>(req, MAX_JSON_BODY_BYTES);
        if (!bodyResult.ok) {
          sendJsonCors(res, bodyResult.status, bodyResult.body);
          logTelemetry('http_request', req, url, bodyResult.status, Date.now() - startedAt);
          return;
        }
        const body = bodyResult.data;
        const result = await handlePairRegister(body, config, req);
        sendJsonCors(res, result.status, result.body);
        logTelemetry('http_request', req, url, result.status, Date.now() - startedAt);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/pair/access-code') {
        const bodyResult = await readJsonBodyLimited<PairAccessCodeRequest>(req, MAX_JSON_BODY_BYTES);
        if (!bodyResult.ok) {
          sendJsonCors(res, bodyResult.status, bodyResult.body);
          logTelemetry('http_request', req, url, bodyResult.status, Date.now() - startedAt);
          return;
        }
        const body = bodyResult.data;
        const result = await handlePairAccessCode(body, config);
        sendJsonCors(res, result.status, result.body);
        logTelemetry('http_request', req, url, result.status, Date.now() - startedAt);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/pair/claim') {
        const bodyResult = await readJsonBodyLimited<PairClaimRequest>(req, MAX_JSON_BODY_BYTES);
        if (!bodyResult.ok) {
          sendJsonCors(res, bodyResult.status, bodyResult.body);
          logTelemetry('http_request', req, url, bodyResult.status, Date.now() - startedAt);
          return;
        }
        const body = bodyResult.data;
        const result = await handlePairClaim(body, config);
        sendJsonCors(res, result.status, result.body);
        logTelemetry('http_request', req, url, result.status, Date.now() - startedAt);
        return;
      }

      if (req.method === 'GET' && url.pathname.startsWith('/v1/verify/')) {
        const gatewayId = decodeURIComponent(url.pathname.slice('/v1/verify/'.length));
        const result = await handleVerify(req, config, gatewayId);
        sendJsonCors(res, result.status, result.body);
        logTelemetry('http_request', req, url, result.status, Date.now() - startedAt);
        return;
      }

      sendJsonCors(res, 404, { error: { code: 'NOT_FOUND', message: 'Route not found' } });
      logTelemetry('http_request', req, url, 404, Date.now() - startedAt);
    } catch (err) {
      console.error('[registry] Unhandled error:', err);
      sendJsonCors(res, 500, { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
      logTelemetry('http_request', req, url, 500, Date.now() - startedAt);
    }
  });

  return {
    start: () => {
      server.listen(port, () => {
        console.log(`[registry] Registry API listening on port ${port}`);
      });
    },
    close: () => new Promise((resolve, reject) => {
      server.close((error) => {
        if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
          reject(error);
          return;
        }
        resolve();
      });
    }),
  };
}

// ---------- Handlers ----------

async function handlePairRegister(
  body: PairRegisterRequest | null,
  config: RegistryConfig,
  req: IncomingMessage,
): Promise<{ status: number; body: unknown }> {
  const relayMap = readRelayMap(config);
  const region = resolveRegion(req, body?.preferredRegion ?? undefined);
  const relayUrl = resolveRelayUrl(relayMap, region);
  if (!relayUrl) {
    return { status: 500, body: { error: { code: 'RELAY_REGION_UNAVAILABLE', message: `No relay URL configured for region ${region}` } } };
  }

  const now = new Date().toISOString();
  const gatewayId = `gw_${crypto.randomUUID().replace(/-/g, '')}`;
  const relaySecret = generateRelaySecret();
  const accessCode = generateAccessCode();
  const accessCodeExpiresAt = new Date(
    Date.now() + parsePositiveInt(config.pairAccessCodeTtlSec, ACCESS_CODE_TTL_FALLBACK_SEC) * 1000,
  ).toISOString();

  const record: PairGatewayRecord = {
    gatewayId,
    relayUrl,
    region,
    displayName: body?.displayName?.trim() || null,
    relaySecretHash: await sha256Hex(relaySecret),
    accessCodeHash: await sha256Hex(accessCode),
    accessCodeExpiresAt,
    clientTokens: [],
    createdAt: now,
    updatedAt: now,
  };

  await putPairGateway(config.routesKv, record);

  const response: PairRegisterResponse = {
    gatewayId,
    relaySecret,
    relayUrl,
    accessCode,
    accessCodeExpiresAt,
    displayName: record.displayName,
    region,
  };
  return { status: 200, body: response };
}

async function handlePairAccessCode(
  body: PairAccessCodeRequest | null,
  config: RegistryConfig,
): Promise<{ status: number; body: unknown }> {
  if (!body?.gatewayId?.trim()) return { status: 400, body: { error: { code: 'INVALID_GATEWAY_ID', message: 'gatewayId is required' } } };
  if (!body?.relaySecret?.trim()) return { status: 400, body: { error: { code: 'INVALID_RELAY_SECRET', message: 'relaySecret is required' } } };

  const gatewayLookup = await getPairGateway(config.routesKv, body.gatewayId.trim());
  if (!gatewayLookup.ok) return pairingRecordCorruptResponse(gatewayLookup.gatewayId);
  const record = gatewayLookup.record;
  if (!record) return { status: 404, body: { error: { code: 'GATEWAY_NOT_FOUND', message: 'Gateway not found' } } };
  if (await sha256Hex(body.relaySecret.trim()) !== record.relaySecretHash) {
    return { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'Invalid relay secret' } } };
  }

  const accessCode = generateAccessCode();
  const nextDisplayName = body.displayName === undefined
    ? record.displayName
    : body.displayName?.trim() || null;
  const next: PairGatewayRecord = {
    ...record,
    displayName: nextDisplayName,
    accessCodeHash: await sha256Hex(accessCode),
    accessCodeExpiresAt: new Date(
      Date.now() + parsePositiveInt(config.pairAccessCodeTtlSec, ACCESS_CODE_TTL_FALLBACK_SEC) * 1000,
    ).toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await putPairGateway(config.routesKv, next);

  const response: PairAccessCodeResponse = {
    gatewayId: next.gatewayId,
    relayUrl: next.relayUrl,
    accessCode,
    accessCodeExpiresAt: next.accessCodeExpiresAt as string,
    displayName: next.displayName,
    region: next.region,
  };
  return { status: 200, body: response };
}

async function handlePairClaim(
  body: PairClaimRequest | null,
  config: RegistryConfig,
): Promise<{ status: number; body: unknown }> {
  if (!body?.gatewayId?.trim()) return { status: 400, body: { error: { code: 'INVALID_GATEWAY_ID', message: 'gatewayId is required' } } };
  const normalizedAccessCode = normalizeAccessCode(body?.accessCode);
  if (!normalizedAccessCode) return { status: 400, body: { error: { code: 'INVALID_ACCESS_CODE', message: 'accessCode is required' } } };

  const gatewayLookup = await getPairGateway(config.routesKv, body.gatewayId.trim());
  if (!gatewayLookup.ok) return pairingRecordCorruptResponse(gatewayLookup.gatewayId);
  const record = gatewayLookup.record;
  if (!record) return { status: 404, body: { error: { code: 'GATEWAY_NOT_FOUND', message: 'Gateway not found' } } };

  const codeHash = await sha256Hex(normalizedAccessCode);
  if (!record.accessCodeHash || !record.accessCodeExpiresAt) {
    return { status: 409, body: { error: { code: 'ACCESS_CODE_REQUIRED', message: 'Gateway does not have an active access code' } } };
  }
  if (Date.parse(record.accessCodeExpiresAt) <= Date.now()) {
    return { status: 410, body: { error: { code: 'ACCESS_CODE_EXPIRED', message: 'Access code expired' } } };
  }
  if (codeHash !== record.accessCodeHash) {
    return { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'Invalid access code' } } };
  }

  const now = new Date().toISOString();
  const issued = await mintClientToken(record, config, body.clientLabel, now);
  const next: PairGatewayRecord = {
    ...issued.record,
    accessCodeHash: null,
    accessCodeExpiresAt: null,
  };
  await putPairGateway(config.routesKv, next);
  return { status: 200, body: buildPairClaimResponse(next, issued.clientToken) };
}

async function handleVerify(
  req: IncomingMessage,
  config: RegistryConfig,
  gatewayId: string,
): Promise<{ status: number; body: unknown }> {
  if (!gatewayId.trim()) return { status: 400, body: { error: { code: 'INVALID_GATEWAY_ID', message: 'gatewayId is required' } } };
  const token = readBearerTokenFromNode(req);
  if (!token) return { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'Missing token for verify' } } };

  const gatewayLookup = await getPairGateway(config.routesKv, gatewayId.trim());
  if (!gatewayLookup.ok) return pairingRecordCorruptResponse(gatewayLookup.gatewayId);
  const gateway = gatewayLookup.record;
  if (!gateway) return { status: 404, body: { error: { code: 'GATEWAY_NOT_FOUND', message: 'Gateway not found' } } };

  const tokenHash = await sha256Hex(token);
  if (tokenHash === gateway.relaySecretHash) {
    return { status: 200, body: { ok: true, role: 'gateway' } };
  }
  if (gateway.clientTokens.some((item) => item.hash === tokenHash)) {
    return { status: 200, body: { ok: true, role: 'client' } };
  }
  return { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'Invalid pairing token' } } };
}

// ---------- KV Operations ----------

async function getPairGateway(routesKv: MemoryKV, gatewayId: string): Promise<PairGatewayLookupResult> {
  const raw = await routesKv.get(pairGatewayKey(gatewayId));
  if (!raw) return { ok: true, record: null };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed.gatewayId !== 'string' || typeof parsed.relaySecretHash !== 'string') {
      return { ok: false, gatewayId };
    }
    const clientTokens = Array.isArray(parsed.clientTokens) ? parsed.clientTokens : [];
    return {
      ok: true,
      record: {
        gatewayId: parsed.gatewayId,
        relayUrl: typeof parsed.relayUrl === 'string' ? parsed.relayUrl : '',
        region: typeof parsed.region === 'string' ? parsed.region : 'us',
        displayName: typeof parsed.displayName === 'string' ? parsed.displayName : null,
        relaySecretHash: parsed.relaySecretHash,
        accessCodeHash: typeof parsed.accessCodeHash === 'string' ? parsed.accessCodeHash : null,
        accessCodeExpiresAt: typeof parsed.accessCodeExpiresAt === 'string' ? parsed.accessCodeExpiresAt : null,
        clientTokens: clientTokens
          .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && typeof item.hash === 'string')
          .map((item) => ({
            hash: item.hash as string,
            label: typeof item.label === 'string' ? item.label : null,
            createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
            lastUsedAt: typeof item.lastUsedAt === 'string' ? item.lastUsedAt : null,
          })),
        createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      },
    };
  } catch {
    return { ok: false, gatewayId };
  }
}

async function putPairGateway(routesKv: MemoryKV, record: PairGatewayRecord): Promise<void> {
  await routesKv.put(pairGatewayKey(record.gatewayId), JSON.stringify(record), {
    expirationTtl: 365 * 24 * 3600,
  });
}

// ---------- Helpers ----------

function resolveRegion(req: IncomingMessage, preferred?: string): string {
  if (preferred?.trim()) return normalizeRegion(preferred);
  // In Docker, use X-Real-Country header or default to 'us'
  const country = (req.headers['x-real-country'] ?? 'US').toString().toUpperCase();
  if (country === 'CN') return 'cn';
  if (['SG', 'MY', 'TH', 'VN', 'ID', 'PH', 'JP', 'KR', 'TW', 'HK', 'MO', 'IN', 'AU', 'NZ'].includes(country)) return 'sg';
  if (['GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'SE', 'NO', 'DK', 'FI', 'PL', 'CZ', 'AT', 'CH', 'BE', 'IE', 'PT'].includes(country)) return 'eu';
  return 'us';
}

function resolveRelayUrl(map: Record<string, string>, region: string): string | null {
  return map[region] ?? map.us ?? null;
}

function readRelayMap(config: RegistryConfig): Record<string, string> {
  const raw = config.relayRegionMap;
  if (!raw?.trim()) {
    // Default: single self-hosted relay
    return { us: config.relayUrl };
  }
  const parsed = safeParseJson<Record<string, string>>(raw, {});
  return {
    us: config.relayUrl,
    ...Object.fromEntries(
      Object.entries(parsed)
        .filter(([, value]) => typeof value === 'string' && value.trim().startsWith('ws'))
        .map(([key, value]) => [key.trim().toLowerCase(), value.trim()]),
    ),
  };
}

function readBearerTokenFromNode(req: IncomingMessage): string | null {
  const auth = req.headers['authorization'] ?? '';
  if (!auth.toString().toLowerCase().startsWith('bearer ')) return null;
  const token = auth.toString().slice(7).trim();
  return token || null;
}

async function mintClientToken(
  record: PairGatewayRecord,
  config: RegistryConfig,
  clientLabel: string | null | undefined,
  now: string,
): Promise<{ record: PairGatewayRecord; clientToken: string }> {
  const clientToken = generateClientToken();
  return {
    clientToken,
    record: {
      ...record,
      clientTokens: [
        {
          hash: await sha256Hex(clientToken),
          label: clientLabel?.trim() || null,
          createdAt: now,
          lastUsedAt: null,
        },
        ...record.clientTokens,
      ].slice(0, parsePositiveInt(config.pairClientTokenMax, PAIR_CLIENT_TOKEN_MAX_FALLBACK)),
      updatedAt: now,
    },
  };
}

function buildPairClaimResponse(record: PairGatewayRecord, clientToken: string): PairClaimResponse {
  return {
    gatewayId: record.gatewayId,
    relayUrl: record.relayUrl,
    clientToken,
    displayName: record.displayName,
    region: record.region,
  };
}

function pairGatewayKey(gatewayId: string): string {
  return `pair-gateway:${gatewayId}`;
}

function pairingRecordCorruptResponse(gatewayId: string): { status: number; body: unknown } {
  return {
    status: 500,
    body: {
      error: {
        code: 'PAIRING_RECORD_CORRUPT',
        message: `Stored pairing record for ${gatewayId} is invalid. Reset the bridge pairing and pair again.`,
      },
    },
  };
}

function generateAccessCode(): string {
  let code = '';
  while (code.length < ACCESS_CODE_LENGTH) {
    const randomBytes = crypto.getRandomValues(new Uint8Array(ACCESS_CODE_LENGTH));
    for (const byte of randomBytes) {
      if (byte >= ACCESS_CODE_RANDOM_LIMIT) continue;
      code += ACCESS_CODE_ALPHABET[byte % ACCESS_CODE_ALPHABET.length];
      if (code.length === ACCESS_CODE_LENGTH) break;
    }
  }
  return code;
}

function normalizeAccessCode(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toUpperCase();
}

function generateRelaySecret(): string {
  return `grs_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
}

function generateClientToken(): string {
  return `gct_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
}

function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function logTelemetry(
  event: string,
  req: IncomingMessage,
  url: URL,
  status: number,
  elapsedMs: number,
): void {
  const pathname = url.pathname.startsWith('/v1/verify/') ? '/v1/verify/:gatewayId' : url.pathname;
  console.log(JSON.stringify({
    scope: 'registry_worker',
    event,
    ts: new Date().toISOString(),
    method: req.method,
    path: pathname,
    status,
    elapsedMs,
  }));
}

// ---------- HTTP Helpers ----------

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-relay-trace-id,x-clawket-admin-secret',
  };
}

function sendCors(res: ServerResponse, status: number): void {
  res.writeHead(status, corsHeaders());
  res.end();
}

function sendJsonCors(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...corsHeaders(),
  });
  res.end(body);
}

type ReadJsonBodyResult<T> =
  | { ok: true; data: T | null }
  | { ok: false; status: number; body: unknown };

async function readJsonBodyLimited<T>(req: IncomingMessage, maxBytes: number): Promise<ReadJsonBodyResult<T>> {
  const declaredLength = parseContentLength(req);
  if (declaredLength !== null && declaredLength > maxBytes) {
    return {
      ok: false,
      status: 413,
      body: { error: { code: 'PAYLOAD_TOO_LARGE', message: `Request body exceeds ${maxBytes} bytes` } },
    };
  }

  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    const finish = (result: ReadJsonBodyResult<T>): void => {
      if (settled) return;
      settled = true;
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      resolve(result);
    };

    const onData = (chunk: Buffer): void => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        req.resume();
        finish({
          ok: false,
          status: 413,
          body: { error: { code: 'PAYLOAD_TOO_LARGE', message: `Request body exceeds ${maxBytes} bytes` } },
        });
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = (): void => {
      try {
        finish({ ok: true, data: JSON.parse(Buffer.concat(chunks).toString()) as T });
      } catch {
        finish({ ok: true, data: null });
      }
    };

    const onError = (): void => {
      finish({ ok: true, data: null });
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

function parseContentLength(req: IncomingMessage): number | null {
  const raw = req.headers['content-length'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
