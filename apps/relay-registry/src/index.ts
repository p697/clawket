import {
  errorResponse,
  hmacSha256Hex,
  isSecurePairingSecretConfigured,
  issuePairingRelayTicket,
  jsonResponse,
  normalizeRegion,
  parsePositiveInt,
  readBearerToken,
  sha256Hex,
  SECURE_PAIRING_V2_CAPABILITY,
  type PairAccessCodeRequest,
  type PairAccessCodeResponse,
  type PairClaimRequest,
  type PairClaimResponse,
  type PairRegisterRequest,
  type PairRegisterResponse,
  type PairingSessionCiphertext,
  type PairingSessionCreateRequest,
  type PairingSessionCreateResponse,
  type PairingSessionReadResponse,
  type PairingSessionResolveRequest,
  type SecurePairingResolveRequest,
  type SecurePairingResolveResponse,
  type HermesPairAccessCodeRequest,
  type HermesPairAccessCodeResponse,
  type HermesPairClaimRequest,
  type HermesPairClaimResponse,
  type HermesPairRegisterRequest,
  type HermesPairRegisterResponse,
} from '@clawket/shared';
import {
  OPENCLAW_REGISTRY_POLICY,
  resolveRegistryBackendPolicy,
  type RegistryBackendPolicy,
} from './backend-policy';

interface Env {
  RELAY_BACKEND?: string;
  ROUTES_KV?: KVNamespace;
  HERMES_ROUTES_KV?: KVNamespace;
  RELAY_REGION_MAP: string;
  PAIR_ACCESS_CODE_TTL_SEC?: string;
  PAIR_CLIENT_TOKEN_MAX?: string;
  PAIR_PUBLIC_BASE_URL?: string;
  PAIR_SESSION_RESOLVE_MAX_ATTEMPTS?: string;
  PAIRING_TICKET_SECRET?: string;
  APPLE_APP_IDS?: string;
  ANDROID_APP_LINK_PACKAGE?: string;
  ANDROID_APP_LINK_SHA256_CERT_FINGERPRINTS?: string;
  PAIRING_SYNC_SECRET?: string;
  RELAY_SYNC_SERVICE?: Fetcher;
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
  pairingSessionId: string | null;
  pairingSessionCodeHash: string | null;
  pairingSessionShortCodeLookup: string | null;
  clientTokens: PairClientTokenRecord[];
  createdAt: string;
  updatedAt: string;
};

type PairBridgeRecord = {
  bridgeId: string;
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

type PairPrincipalRecord = PairGatewayRecord | PairBridgeRecord;

type PairGatewayLookupResult =
  | { ok: true; record: PairGatewayRecord | null }
  | { ok: false; gatewayId: string };

type PairPrincipalLookupResult =
  | { ok: true; record: PairPrincipalRecord | null }
  | { ok: false; principalId: string };

const ACCESS_CODE_TTL_FALLBACK_SEC = 10 * 60;
const PAIR_CLIENT_TOKEN_MAX_FALLBACK = 8;
const ACCESS_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const ACCESS_CODE_LENGTH = 6;
const ACCESS_CODE_RANDOM_LIMIT = Math.floor(256 / ACCESS_CODE_ALPHABET.length) * ACCESS_CODE_ALPHABET.length;
const PAIR_SESSION_RESOLVE_MAX_ATTEMPTS_FALLBACK = 5;
const PAIR_SESSION_MAX_CIPHERTEXT_LENGTH = 64 * 1024;

type PairingSessionRecord = {
  sessionId: string;
  gatewayId: string;
  displayName: string | null;
  expiresAt: string;
  linkPayload: PairingSessionCiphertext;
  codePayload: PairingSessionCiphertext;
  codeHash: string;
  shortCodeLookup: string | null;
};

export default {
  async fetch(request, env): Promise<Response> {
    const startedAt = Date.now();
    if (request.method === 'OPTIONS') return handleCors();

    const policy = resolveRegistryBackendPolicy(env.RELAY_BACKEND);
    const url = new URL(request.url);
    let response: Response;

    if (request.method === 'GET' && url.pathname === '/v1/health') {
      response = withCors(jsonResponse({ ok: true, regions: Object.keys(readRelayMap(env)) }));
      logRegistryTelemetry(policy, 'http_request', request, url, response.status, Date.now() - startedAt);
      return response;
    }

    if (policy.backend === 'openclaw'
      && request.method === 'GET'
      && url.pathname === '/.well-known/apple-app-site-association') {
      response = appleAppSiteAssociationResponse(env);
      logRegistryTelemetry(policy, 'http_request', request, url, response.status, Date.now() - startedAt);
      return response;
    }

    if (policy.backend === 'openclaw'
      && request.method === 'GET'
      && url.pathname === '/.well-known/assetlinks.json') {
      response = androidAssetLinksResponse(env);
      logRegistryTelemetry(policy, 'http_request', request, url, response.status, Date.now() - startedAt);
      return response;
    }

    if (request.method === 'POST' && url.pathname === `${policy.pairBasePath}/register`) {
      response = withCors(await handlePairRegister(request, env, policy));
      logRegistryTelemetry(policy, 'http_request', request, url, response.status, Date.now() - startedAt);
      return response;
    }

    if (request.method === 'POST' && url.pathname === `${policy.pairBasePath}/access-code`) {
      response = withCors(await handlePairAccessCode(request, env, policy));
      logRegistryTelemetry(policy, 'http_request', request, url, response.status, Date.now() - startedAt);
      return response;
    }

    if (request.method === 'POST' && url.pathname === `${policy.pairBasePath}/claim`) {
      response = withCors(await handlePairClaim(request, env, policy));
      logRegistryTelemetry(policy, 'http_request', request, url, response.status, Date.now() - startedAt);
      return response;
    }

    if (policy.backend === 'openclaw' && request.method === 'POST' && url.pathname === '/v1/pair/session') {
      response = withCors(await handlePairingSessionCreate(request, env));
      logRegistryTelemetry(policy, 'http_request', request, url, response.status, Date.now() - startedAt);
      return response;
    }

    if (policy.backend === 'openclaw'
      && request.method === 'POST'
      && url.pathname === '/v1/pair/session/resolve') {
      response = withCors(await handlePairingSessionResolve(request, env));
      logRegistryTelemetry(policy, 'http_request', request, url, response.status, Date.now() - startedAt);
      return response;
    }

    if (policy.backend === 'openclaw'
      && request.method === 'POST'
      && url.pathname === '/v2/pair/session/resolve') {
      response = withCors(await handleSecurePairingSessionResolve(request, env));
      logRegistryTelemetry(policy, 'http_request', request, url, response.status, Date.now() - startedAt);
      return response;
    }

    if (policy.backend === 'openclaw'
      && request.method === 'GET'
      && url.pathname.startsWith('/v1/pair/session/')) {
      const sessionId = decodeURIComponent(url.pathname.slice('/v1/pair/session/'.length));
      response = withCors(await handlePairingSessionRead(env, sessionId, 'link'));
      logRegistryTelemetry(policy, 'http_request', request, url, response.status, Date.now() - startedAt);
      return response;
    }

    if (policy.backend === 'openclaw' && request.method === 'GET' && url.pathname.startsWith('/pair/')) {
      const sessionId = decodeURIComponent(url.pathname.slice('/pair/'.length));
      response = await handlePairingLandingPage(env, sessionId, url.origin);
      logRegistryTelemetry(policy, 'http_request', request, url, response.status, Date.now() - startedAt);
      return response;
    }

    if (request.method === 'GET' && url.pathname.startsWith(policy.verifyPathPrefix)) {
      const principalId = decodeURIComponent(url.pathname.slice(policy.verifyPathPrefix.length));
      response = withCors(await handleVerify(request, env, policy, principalId));
      logRegistryTelemetry(policy, 'http_request', request, url, response.status, Date.now() - startedAt);
      return response;
    }

    response = withCors(errorResponse('NOT_FOUND', 'Route not found', 404));
    logRegistryTelemetry(policy, 'http_request', request, url, response.status, Date.now() - startedAt);
    return response;
  },
} satisfies ExportedHandler<Env>;

async function handlePairRegister(
  request: Request,
  env: Env,
  policy: RegistryBackendPolicy,
): Promise<Response> {
  const body = await readJson<PairRegisterRequest | HermesPairRegisterRequest>(request);
  const relayMap = readRelayMap(env);
  const region = resolveRegion(request, body?.preferredRegion ?? undefined);
  const relayUrl = resolveRelayUrl(relayMap, region);
  if (!relayUrl) {
    return errorResponse('RELAY_REGION_UNAVAILABLE', `No relay URL configured for region ${region}`, 500);
  }

  const now = new Date().toISOString();
  const principalId = `${policy.principalIdPrefix}${crypto.randomUUID().replace(/-/g, '')}`;
  const relaySecret = generateRelaySecret(policy);
  const accessCode = generateAccessCode();
  const accessCodeExpiresAt = new Date(
    Date.now() + parsePositiveInt(env.PAIR_ACCESS_CODE_TTL_SEC, ACCESS_CODE_TTL_FALLBACK_SEC) * 1000,
  ).toISOString();

  const record = createPairRecord(policy, {
    principalId,
    relayUrl,
    region,
    displayName: body?.displayName?.trim() || null,
    relaySecretHash: await sha256Hex(relaySecret),
    accessCodeHash: await sha256Hex(accessCode),
    accessCodeExpiresAt,
    createdAt: now,
    updatedAt: now,
  });

  await putPairRecord(routesKv(env, policy), policy, record);

  const response = {
    [policy.principalParam]: principalId,
    relaySecret,
    relayUrl,
    accessCode,
    accessCodeExpiresAt,
    displayName: record.displayName,
    region,
  } as unknown as PairRegisterResponse | HermesPairRegisterResponse;
  return jsonResponse(response, 200);
}

async function handlePairAccessCode(
  request: Request,
  env: Env,
  policy: RegistryBackendPolicy,
): Promise<Response> {
  const body = await readJson<PairAccessCodeRequest | HermesPairAccessCodeRequest>(request);
  const principalId = requestPrincipalId(body, policy)?.trim();
  if (!principalId) {
    return errorResponse(policy.errors.invalidPrincipal, `${policy.principalParam} is required`, 400);
  }
  if (!body?.relaySecret?.trim()) return errorResponse('INVALID_RELAY_SECRET', 'relaySecret is required', 400);

  const kv = routesKv(env, policy);
  const lookup = await getPairRecord(kv, policy, principalId);
  if (!lookup.ok) return pairingRecordCorruptResponse(policy, lookup.principalId);
  const record = lookup.record;
  if (!record) return errorResponse(policy.errors.principalNotFound, `${policy.principalLabel} not found`, 404);
  if (await sha256Hex(body.relaySecret.trim()) !== record.relaySecretHash) {
    return errorResponse('UNAUTHORIZED', 'Invalid relay secret', 401);
  }

  const accessCode = generateAccessCode();
  const nextDisplayName = body.displayName === undefined
    ? record.displayName
    : body.displayName?.trim() || null;
  const nextAccessCodeHash = await sha256Hex(accessCode);
  const nextAccessCodeExpiresAt = new Date(
    Date.now() + parsePositiveInt(env.PAIR_ACCESS_CODE_TTL_SEC, ACCESS_CODE_TTL_FALLBACK_SEC) * 1000,
  ).toISOString();
  let next: PairPrincipalRecord;
  if (policy.backend === 'openclaw') {
    const gateway = record as PairGatewayRecord;
    next = {
      ...gateway,
      displayName: nextDisplayName,
      accessCodeHash: nextAccessCodeHash,
      accessCodeExpiresAt: nextAccessCodeExpiresAt,
      pairingSessionId: null,
      pairingSessionCodeHash: null,
      pairingSessionShortCodeLookup: null,
      updatedAt: new Date().toISOString(),
    };
    await deletePairingSession(
      kv,
      gateway.pairingSessionId,
      gateway.pairingSessionCodeHash,
      gateway.pairingSessionShortCodeLookup,
    );
  } else {
    next = {
      ...record,
      displayName: nextDisplayName,
      accessCodeHash: nextAccessCodeHash,
      accessCodeExpiresAt: nextAccessCodeExpiresAt,
      updatedAt: new Date().toISOString(),
    };
  }
  await putPairRecord(kv, policy, next);

  const response = {
    [policy.principalParam]: principalId,
    relayUrl: next.relayUrl,
    accessCode,
    accessCodeExpiresAt: next.accessCodeExpiresAt as string,
    displayName: next.displayName,
    region: next.region,
  } as unknown as PairAccessCodeResponse | HermesPairAccessCodeResponse;
  return jsonResponse(response, 200);
}

async function handlePairClaim(
  request: Request,
  env: Env,
  policy: RegistryBackendPolicy,
): Promise<Response> {
  const body = await readJson<PairClaimRequest | HermesPairClaimRequest>(request);
  const principalId = requestPrincipalId(body, policy)?.trim();
  if (!principalId) {
    return errorResponse(policy.errors.invalidPrincipal, `${policy.principalParam} is required`, 400);
  }
  const normalizedAccessCode = normalizeAccessCode(body?.accessCode);
  if (!normalizedAccessCode) return errorResponse('INVALID_ACCESS_CODE', 'accessCode is required', 400);

  const kv = routesKv(env, policy);
  const lookup = await getPairRecord(kv, policy, principalId);
  if (!lookup.ok) return pairingRecordCorruptResponse(policy, lookup.principalId);
  const record = lookup.record;
  if (!record) return errorResponse(policy.errors.principalNotFound, `${policy.principalLabel} not found`, 404);

  const codeHash = await sha256Hex(normalizedAccessCode);
  if (!record.accessCodeHash || !record.accessCodeExpiresAt) {
    return errorResponse('ACCESS_CODE_REQUIRED', `${policy.principalLabel} does not have an active access code`, 409);
  }
  if (Date.parse(record.accessCodeExpiresAt) <= Date.now()) {
    return errorResponse('ACCESS_CODE_EXPIRED', 'Access code expired', 410);
  }
  if (codeHash !== record.accessCodeHash) {
    return errorResponse('UNAUTHORIZED', 'Invalid access code', 401);
  }

  const now = new Date().toISOString();
  const issued = await mintClientToken(policy, record, env, body?.clientLabel, now);
  let next: PairPrincipalRecord;
  if (policy.backend === 'openclaw') {
    const gateway = record as PairGatewayRecord;
    next = {
      ...issued.record,
      accessCodeHash: null,
      accessCodeExpiresAt: null,
      pairingSessionId: null,
      pairingSessionCodeHash: null,
      pairingSessionShortCodeLookup: null,
    } as PairGatewayRecord;
    await deletePairingSession(
      kv,
      gateway.pairingSessionId,
      gateway.pairingSessionCodeHash,
      gateway.pairingSessionShortCodeLookup,
    );
  } else {
    next = {
      ...issued.record,
      accessCodeHash: null,
      accessCodeExpiresAt: null,
    };
  }
  await putPairRecord(kv, policy, next);
  await syncClientTokensToRelay(env, policy, next);
  return jsonResponse(buildPairClaimResponse(policy, next, issued.clientToken), 200);
}

async function handlePairingSessionCreate(request: Request, env: Env): Promise<Response> {
  const body = await readJson<PairingSessionCreateRequest>(request);
  const gatewayId = body?.gatewayId?.trim() ?? '';
  const relaySecret = body?.relaySecret?.trim() ?? '';
  const codeHash = body?.codeHash?.trim().toLowerCase() ?? '';
  const shortCodeHash = body?.shortCodeHash?.trim().toLowerCase() ?? '';
  if (!gatewayId) return errorResponse('INVALID_GATEWAY_ID', 'gatewayId is required', 400);
  if (!relaySecret) return errorResponse('UNAUTHORIZED', 'relaySecret is required', 401);
  if (!isSha256Hex(codeHash)) return errorResponse('INVALID_PAIRING_CODE', 'codeHash is invalid', 400);
  if (shortCodeHash && !isSha256Hex(shortCodeHash)) {
    return errorResponse('INVALID_SHORT_PAIRING_CODE', 'shortCodeHash is invalid', 400);
  }
  if (!isValidSessionCiphertext(body?.linkPayload) || !isValidSessionCiphertext(body?.codePayload)) {
    return errorResponse('INVALID_PAIRING_PAYLOAD', 'Encrypted pairing payload is invalid', 400);
  }

  const gatewayLookup = await getPairGateway(openClawRoutesKv(env), gatewayId);
  if (!gatewayLookup.ok) return pairingRecordCorruptResponse(OPENCLAW_REGISTRY_POLICY, gatewayLookup.gatewayId);
  const gateway = gatewayLookup.record;
  if (!gateway) return errorResponse('GATEWAY_NOT_FOUND', 'Gateway not found', 404);
  if (await sha256Hex(relaySecret) !== gateway.relaySecretHash) {
    return errorResponse('UNAUTHORIZED', 'Invalid relay secret', 401);
  }
  if (!gateway.accessCodeHash || !gateway.accessCodeExpiresAt) {
    return errorResponse('ACCESS_CODE_REQUIRED', 'Gateway does not have an active access code', 409);
  }
  if (Date.parse(gateway.accessCodeExpiresAt) <= Date.now()) {
    return errorResponse('ACCESS_CODE_EXPIRED', 'Access code expired', 410);
  }

  const securePairingEnabled = Boolean(
    shortCodeHash
    && isSecurePairingSecretConfigured(env.PAIRING_TICKET_SECRET)
    && await relaySupportsSecurePairing(env, gateway.relayUrl),
  );
  const shortCodeLookup = securePairingEnabled
    ? await securePairingCodeLookup(env, shortCodeHash)
    : null;
  await deletePairingSession(
    openClawRoutesKv(env),
    gateway.pairingSessionId,
    gateway.pairingSessionCodeHash,
    gateway.pairingSessionShortCodeLookup,
  );
  const sessionId = generatePairingSessionId();
  const record: PairingSessionRecord = {
    sessionId,
    gatewayId,
    displayName: gateway.displayName,
    expiresAt: gateway.accessCodeExpiresAt,
    linkPayload: body.linkPayload,
    codePayload: body.codePayload,
    codeHash,
    shortCodeLookup,
  };
  const ttl = expirationTtlSeconds(record.expiresAt);
  await Promise.all([
    openClawRoutesKv(env).put(pairingSessionKey(sessionId), JSON.stringify(record), { expirationTtl: ttl }),
    openClawRoutesKv(env).put(pairingSessionCodeKey(codeHash), sessionId, { expirationTtl: ttl }),
    ...(shortCodeLookup
      ? [openClawRoutesKv(env).put(pairingSessionShortCodeKey(shortCodeLookup), sessionId, { expirationTtl: ttl })]
      : []),
    putPairGateway(openClawRoutesKv(env), {
      ...gateway,
      pairingSessionId: sessionId,
      pairingSessionCodeHash: codeHash,
      pairingSessionShortCodeLookup: shortCodeLookup,
      updatedAt: new Date().toISOString(),
    }),
  ]);

  const response: PairingSessionCreateResponse = {
    sessionId,
    pairingUrl: `${resolvePairingPublicBase(request, env)}/pair/${encodeURIComponent(sessionId)}`,
    expiresAt: record.expiresAt,
    displayName: record.displayName,
    capabilities: securePairingEnabled ? [SECURE_PAIRING_V2_CAPABILITY] : [],
  };
  return jsonResponse(response);
}

async function handlePairingSessionRead(
  env: Env,
  sessionId: string,
  payloadKind: 'link' | 'code',
): Promise<Response> {
  const record = await readPairingSession(openClawRoutesKv(env), sessionId);
  if (!record) return errorResponse('PAIRING_SESSION_NOT_FOUND', 'Pairing session not found or expired', 404);
  const response: PairingSessionReadResponse = {
    sessionId: record.sessionId,
    expiresAt: record.expiresAt,
    displayName: record.displayName,
    encryptedPayload: payloadKind === 'link' ? record.linkPayload : record.codePayload,
  };
  return jsonResponse(response);
}

async function handlePairingSessionResolve(request: Request, env: Env): Promise<Response> {
  if (await consumePairingResolveAttempt(request, env)) {
    return errorResponse('PAIRING_CODE_RATE_LIMITED', 'Too many pairing code attempts. Try again later.', 429);
  }
  const body = await readJson<PairingSessionResolveRequest>(request);
  const codeHash = body?.codeHash?.trim().toLowerCase() ?? '';
  if (!isSha256Hex(codeHash)) return errorResponse('INVALID_PAIRING_CODE', 'Pairing code is invalid', 400);
  const sessionId = await openClawRoutesKv(env).get(pairingSessionCodeKey(codeHash));
  if (!sessionId) return errorResponse('PAIRING_SESSION_NOT_FOUND', 'Pairing code is invalid or expired', 404);
  return handlePairingSessionRead(env, sessionId, 'code');
}

async function handleSecurePairingSessionResolve(request: Request, env: Env): Promise<Response> {
  const ticketSecret = env.PAIRING_TICKET_SECRET?.trim() ?? '';
  if (!isSecurePairingSecretConfigured(ticketSecret)) {
    return errorResponse('SECURE_PAIRING_UNAVAILABLE', 'Secure short-code pairing is unavailable', 503);
  }
  if (await consumePairingResolveAttempt(request, env)) {
    return errorResponse('PAIRING_CODE_RATE_LIMITED', 'Too many pairing code attempts. Try again later.', 429);
  }
  const body = await readJson<SecurePairingResolveRequest>(request);
  const codeHash = body?.codeHash?.trim().toLowerCase() ?? '';
  if (!isSha256Hex(codeHash)) return errorResponse('INVALID_PAIRING_CODE', 'Pairing code is invalid', 400);
  const lookup = await securePairingCodeLookup(env, codeHash);
  const sessionId = await openClawRoutesKv(env).get(pairingSessionShortCodeKey(lookup));
  if (!sessionId) return errorResponse('PAIRING_SESSION_NOT_FOUND', 'Pairing code is invalid or expired', 404);
  const record = await readPairingSession(openClawRoutesKv(env), sessionId);
  if (!record || record.shortCodeLookup !== lookup) {
    return errorResponse('PAIRING_SESSION_NOT_FOUND', 'Pairing code is invalid or expired', 404);
  }
  const gatewayLookup = await getPairGateway(openClawRoutesKv(env), record.gatewayId);
  if (!gatewayLookup.ok) return pairingRecordCorruptResponse(OPENCLAW_REGISTRY_POLICY, gatewayLookup.gatewayId);
  const gateway = gatewayLookup.record;
  if (!gateway || gateway.pairingSessionId !== record.sessionId) {
    return errorResponse('PAIRING_SESSION_NOT_FOUND', 'Pairing code is invalid or expired', 404);
  }
  const ticketExpiresAt = Math.min(Date.parse(record.expiresAt), Date.now() + 90_000);
  const relayTicket = await issuePairingRelayTicket({
    version: 2,
    scope: 'pairing',
    gatewayId: record.gatewayId,
    sessionId: record.sessionId,
    tokenId: crypto.randomUUID(),
    expiresAt: ticketExpiresAt,
  }, ticketSecret);
  const response: SecurePairingResolveResponse = {
    protocol: 2,
    sessionId: record.sessionId,
    gatewayId: record.gatewayId,
    relayUrl: gateway.relayUrl,
    relayTicket,
    expiresAt: record.expiresAt,
    displayName: record.displayName,
  };
  return jsonResponse(response);
}

async function handlePairingLandingPage(env: Env, sessionId: string, requestOrigin: string): Promise<Response> {
  const record = await readPairingSession(openClawRoutesKv(env), sessionId);
  if (!record) return htmlResponse(renderExpiredPairingPage(), 404);
  return htmlResponse(renderPairingPage({
    sessionId: record.sessionId,
    displayName: record.displayName,
    expiresAt: record.expiresAt,
    serverUrl: requestOrigin,
  }));
}

async function handleVerify(
  request: Request,
  env: Env,
  policy: RegistryBackendPolicy,
  principalId: string,
): Promise<Response> {
  if (!principalId.trim()) {
    return errorResponse(policy.errors.invalidPrincipal, `${policy.principalParam} is required`, 400);
  }
  const token = readBearerToken(request);
  if (!token) return errorResponse('UNAUTHORIZED', 'Missing token for verify', 401);

  const lookup = await getPairRecord(routesKv(env, policy), policy, principalId.trim());
  if (!lookup.ok) return pairingRecordCorruptResponse(policy, lookup.principalId);
  const record = lookup.record;
  if (!record) return errorResponse(policy.errors.principalNotFound, `${policy.principalLabel} not found`, 404);

  const tokenHash = await sha256Hex(token);
  if (tokenHash === record.relaySecretHash) {
    // Hermes has always used the gateway/client wire-role vocabulary even though
    // its semantic owner is a bridge. M2a must preserve that public response.
    return jsonResponse({ ok: true, role: 'gateway' }, 200);
  }
  if (record.clientTokens.some((item) => item.hash === tokenHash)) {
    return jsonResponse({ ok: true, role: 'client' }, 200);
  }
  return errorResponse('UNAUTHORIZED', 'Invalid pairing token', 401);
}

async function getPairGateway(routesKv: KVNamespace, gatewayId: string): Promise<PairGatewayLookupResult> {
  const lookup = await getPairRecord(routesKv, OPENCLAW_REGISTRY_POLICY, gatewayId);
  if (!lookup.ok) return { ok: false, gatewayId: lookup.principalId };
  return { ok: true, record: lookup.record as PairGatewayRecord | null };
}

async function getPairRecord(
  kv: KVNamespace,
  policy: RegistryBackendPolicy,
  principalId: string,
): Promise<PairPrincipalLookupResult> {
  const raw = await kv.get(pairRecordKey(policy, principalId));
  if (!raw) return { ok: true, record: null };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed
      || typeof parsed[policy.principalParam] !== 'string'
      || typeof parsed.relaySecretHash !== 'string') {
      return { ok: false, principalId };
    }
    const clientTokens = Array.isArray(parsed.clientTokens) ? parsed.clientTokens : [];
    const common = {
      relayUrl: typeof parsed.relayUrl === 'string' ? parsed.relayUrl : '',
      region: typeof parsed.region === 'string' ? parsed.region : 'us',
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : null,
      relaySecretHash: parsed.relaySecretHash,
      accessCodeHash: typeof parsed.accessCodeHash === 'string' ? parsed.accessCodeHash : null,
      accessCodeExpiresAt: typeof parsed.accessCodeExpiresAt === 'string' ? parsed.accessCodeExpiresAt : null,
      // Tolerate legacy stored fields such as reusableCodes or issuedByReusableCodeId.
      clientTokens: clientTokens
        .filter((item): item is Record<string, unknown> => (
          typeof item === 'object' && item !== null && typeof item.hash === 'string'
        ))
        .map((item) => ({
          hash: item.hash as string,
          label: typeof item.label === 'string' ? item.label : null,
          createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
          lastUsedAt: typeof item.lastUsedAt === 'string' ? item.lastUsedAt : null,
        })),
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    };

    if (policy.backend === 'hermes') {
      return {
        ok: true,
        record: {
          bridgeId: parsed.bridgeId as string,
          ...common,
        },
      };
    }

    return {
      ok: true,
      record: {
        gatewayId: parsed.gatewayId as string,
        relayUrl: common.relayUrl,
        region: common.region,
        displayName: common.displayName,
        relaySecretHash: common.relaySecretHash,
        accessCodeHash: common.accessCodeHash,
        accessCodeExpiresAt: common.accessCodeExpiresAt,
        pairingSessionId: typeof parsed.pairingSessionId === 'string' ? parsed.pairingSessionId : null,
        pairingSessionCodeHash: typeof parsed.pairingSessionCodeHash === 'string' ? parsed.pairingSessionCodeHash : null,
        pairingSessionShortCodeLookup: typeof parsed.pairingSessionShortCodeLookup === 'string'
          ? parsed.pairingSessionShortCodeLookup
          : null,
        clientTokens: common.clientTokens,
        createdAt: common.createdAt,
        updatedAt: common.updatedAt,
      },
    };
  } catch {
    return { ok: false, principalId };
  }
}

async function putPairGateway(routesKv: KVNamespace, record: PairGatewayRecord): Promise<void> {
  await putPairRecord(routesKv, OPENCLAW_REGISTRY_POLICY, record);
}

async function putPairRecord(
  kv: KVNamespace,
  policy: RegistryBackendPolicy,
  record: PairPrincipalRecord,
): Promise<void> {
  await kv.put(pairRecordKey(policy, recordPrincipalId(record, policy)), JSON.stringify(record), {
    expirationTtl: 365 * 24 * 3600,
  });
}

async function syncClientTokensToRelay(
  env: Env,
  policy: RegistryBackendPolicy,
  record: PairPrincipalRecord,
): Promise<void> {
  const secret = env.PAIRING_SYNC_SECRET?.trim() ?? '';
  if (!secret) return;
  const endpoint = buildRelayPairingSyncUrl(record.relayUrl, policy);
  if (!endpoint) return;
  try {
    const requestInit: RequestInit = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-clawket-pairing-sync-secret': secret,
      },
      body: JSON.stringify({
        [policy.principalParam]: recordPrincipalId(record, policy),
        clientTokenHashes: record.clientTokens.map((item) => item.hash),
        updatedAt: Date.now(),
      }),
    };
    const response = policy.useRelaySyncServiceBinding && env.RELAY_SYNC_SERVICE
      ? await env.RELAY_SYNC_SERVICE.fetch(endpoint, requestInit)
      : await fetch(endpoint, requestInit);
    if (!response.ok) {
      console.warn(JSON.stringify({
        scope: policy.telemetryScope,
        event: 'relay_token_sync_failed',
        ts: new Date().toISOString(),
        status: response.status,
      }));
    }
  } catch (error) {
    console.warn(JSON.stringify({
      scope: policy.telemetryScope,
      event: 'relay_token_sync_failed',
      ts: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
    }));
  }
}

function buildRelayPairingSyncUrl(relayUrl: string, policy: RegistryBackendPolicy): string | null {
  const trimmed = relayUrl.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
    parsed.pathname = policy.relaySyncPath;
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function resolveRegion(request: Request, preferred?: string): string {
  if (preferred?.trim()) return normalizeRegion(preferred);
  const country = (request as Request & { cf?: { country?: string } }).cf?.country ?? 'US';
  if (country === 'CN') return 'cn';
  if (['SG', 'MY', 'TH', 'VN', 'ID', 'PH', 'JP', 'KR', 'TW', 'HK', 'MO', 'IN', 'AU', 'NZ'].includes(country)) return 'sg';
  if (['GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'SE', 'NO', 'DK', 'FI', 'PL', 'CZ', 'AT', 'CH', 'BE', 'IE', 'PT'].includes(country)) return 'eu';
  return 'us';
}

function resolveRelayUrl(map: Record<string, string>, region: string): string | null {
  return map[region] ?? map.us ?? null;
}

function readRelayMap(env: Env): Record<string, string> {
  const defaults: Record<string, string> = {
    cn: 'wss://relay-cn.clawket.ai/ws',
    sg: 'wss://relay-sg.clawket.ai/ws',
    us: 'wss://relay-us.clawket.ai/ws',
    eu: 'wss://relay-eu.clawket.ai/ws',
  };
  const raw = env.RELAY_REGION_MAP;
  if (!raw?.trim()) return defaults;
  const parsed = safeParseJson<Record<string, string>>(raw, {});
  return {
    ...defaults,
    ...Object.fromEntries(
      Object.entries(parsed)
        .filter(([, value]) => typeof value === 'string' && value.trim().startsWith('ws'))
        .map(([key, value]) => [key.trim().toLowerCase(), value.trim()]),
    ),
  };
}

function normalizeRequestPath(policy: RegistryBackendPolicy, pathname: string): string {
  if (pathname.startsWith(policy.verifyPathPrefix)) {
    return `${policy.verifyPathPrefix}:${policy.principalParam}`;
  }
  if (policy.backend === 'openclaw') {
    if (pathname === '/v1/pair/session/resolve') return pathname;
    if (pathname.startsWith('/v1/pair/session/')) return '/v1/pair/session/:sessionId';
    if (pathname.startsWith('/pair/')) return '/pair/:sessionId';
  }
  return pathname;
}

function logRegistryTelemetry(
  policy: RegistryBackendPolicy,
  event: string,
  request: Request,
  url: URL,
  status: number,
  elapsedMs: number,
  extra?: Record<string, unknown>,
): void {
  console.log(JSON.stringify({
    scope: policy.telemetryScope,
    event,
    ts: new Date().toISOString(),
    method: request.method,
    path: normalizeRequestPath(policy, url.pathname),
    status,
    elapsedMs,
    ...extra,
  }));
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function routesKv(env: Env, policy: RegistryBackendPolicy): KVNamespace {
  const binding = env[policy.kvBinding];
  if (!binding) throw new Error(`Missing Registry KV binding: ${policy.kvBinding}`);
  return binding;
}

function openClawRoutesKv(env: Env): KVNamespace {
  return routesKv(env, OPENCLAW_REGISTRY_POLICY);
}

function requestPrincipalId(
  body: PairAccessCodeRequest | HermesPairAccessCodeRequest | PairClaimRequest | HermesPairClaimRequest | null,
  policy: RegistryBackendPolicy,
): string | undefined {
  return (body as unknown as Record<string, string | undefined> | null)?.[policy.principalParam];
}

function recordPrincipalId(record: PairPrincipalRecord, policy: RegistryBackendPolicy): string {
  return (record as unknown as Record<string, string>)[policy.principalParam];
}

function createPairRecord(
  policy: RegistryBackendPolicy,
  input: {
    principalId: string;
    relayUrl: string;
    region: string;
    displayName: string | null;
    relaySecretHash: string;
    accessCodeHash: string;
    accessCodeExpiresAt: string;
    createdAt: string;
    updatedAt: string;
  },
): PairPrincipalRecord {
  if (policy.backend === 'hermes') {
    return {
      bridgeId: input.principalId,
      relayUrl: input.relayUrl,
      region: input.region,
      displayName: input.displayName,
      relaySecretHash: input.relaySecretHash,
      accessCodeHash: input.accessCodeHash,
      accessCodeExpiresAt: input.accessCodeExpiresAt,
      clientTokens: [],
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    };
  }

  return {
    gatewayId: input.principalId,
    relayUrl: input.relayUrl,
    region: input.region,
    displayName: input.displayName,
    relaySecretHash: input.relaySecretHash,
    accessCodeHash: input.accessCodeHash,
    accessCodeExpiresAt: input.accessCodeExpiresAt,
    pairingSessionId: null,
    pairingSessionCodeHash: null,
    pairingSessionShortCodeLookup: null,
    clientTokens: [],
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

async function mintClientToken(
  policy: RegistryBackendPolicy,
  record: PairPrincipalRecord,
  env: Env,
  clientLabel: string | null | undefined,
  now: string,
): Promise<{ record: PairPrincipalRecord; clientToken: string }> {
  const clientToken = generateClientToken(policy);
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
      ].slice(0, parsePositiveInt(env.PAIR_CLIENT_TOKEN_MAX, PAIR_CLIENT_TOKEN_MAX_FALLBACK)),
      updatedAt: now,
    },
  };
}

function buildPairClaimResponse(
  policy: RegistryBackendPolicy,
  record: PairPrincipalRecord,
  clientToken: string,
): PairClaimResponse | HermesPairClaimResponse {
  return {
    [policy.principalParam]: recordPrincipalId(record, policy),
    relayUrl: record.relayUrl,
    clientToken,
    displayName: record.displayName,
    region: record.region,
  } as unknown as PairClaimResponse | HermesPairClaimResponse;
}

function pairGatewayKey(gatewayId: string): string {
  return pairRecordKey(OPENCLAW_REGISTRY_POLICY, gatewayId);
}

function pairRecordKey(policy: RegistryBackendPolicy, principalId: string): string {
  return `${policy.pairKeyPrefix}${principalId}`;
}

function pairingSessionKey(sessionId: string): string {
  return `pair-session:${sessionId}`;
}

function pairingSessionCodeKey(codeHash: string): string {
  return `pair-session-code:${codeHash}`;
}

function pairingSessionShortCodeKey(lookup: string): string {
  return `pair-session-short-code:${lookup}`;
}

async function securePairingCodeLookup(env: Env, codeHash: string): Promise<string> {
  const secret = env.PAIRING_TICKET_SECRET?.trim() ?? '';
  if (!isSecurePairingSecretConfigured(secret)) {
    throw new Error('PAIRING_TICKET_SECRET must contain at least 32 characters for secure short-code pairing');
  }
  return hmacSha256Hex(secret, `clawket-short-code-v2:${codeHash}`);
}

async function relaySupportsSecurePairing(env: Env, relayUrl: string): Promise<boolean> {
  const healthUrl = buildRelayHealthUrl(relayUrl);
  if (!healthUrl) return false;
  try {
    const response = env.RELAY_SYNC_SERVICE
      ? await env.RELAY_SYNC_SERVICE.fetch(healthUrl, { method: 'GET' })
      : await fetch(healthUrl, { method: 'GET' });
    if (!response.ok) return false;
    const payload = await response.json() as { capabilities?: unknown };
    return Array.isArray(payload.capabilities)
      && payload.capabilities.includes(SECURE_PAIRING_V2_CAPABILITY);
  } catch {
    return false;
  }
}

function buildRelayHealthUrl(relayUrl: string): string | null {
  try {
    const parsed = new URL(relayUrl);
    parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : parsed.protocol === 'ws:' ? 'http:' : parsed.protocol;
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    parsed.pathname = '/v1/health';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

async function readPairingSession(routesKv: KVNamespace, sessionId: string): Promise<PairingSessionRecord | null> {
  if (!/^ps_[a-f0-9]{64}$/.test(sessionId)) return null;
  const raw = await routesKv.get(pairingSessionKey(sessionId));
  const parsed = safeParseJson<PairingSessionRecord | null>(raw, null);
  if (!parsed || parsed.sessionId !== sessionId || Date.parse(parsed.expiresAt) <= Date.now()) return null;
  if (!isValidSessionCiphertext(parsed.linkPayload) || !isValidSessionCiphertext(parsed.codePayload)) return null;
  if (parsed.shortCodeLookup != null && !isSha256Hex(parsed.shortCodeLookup)) return null;
  return parsed;
}

async function deletePairingSession(
  routesKv: KVNamespace,
  sessionId: string | null,
  codeHash: string | null,
  shortCodeLookup: string | null,
): Promise<void> {
  const deletes: Promise<void>[] = [];
  if (sessionId) deletes.push(routesKv.delete(pairingSessionKey(sessionId)));
  if (codeHash) deletes.push(routesKv.delete(pairingSessionCodeKey(codeHash)));
  if (shortCodeLookup) deletes.push(routesKv.delete(pairingSessionShortCodeKey(shortCodeLookup)));
  await Promise.all(deletes);
}

function isValidSessionCiphertext(value: unknown): value is PairingSessionCiphertext {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.nonce === 'string'
    && /^[A-Za-z0-9_-]{20,64}$/.test(candidate.nonce)
    && typeof candidate.ciphertext === 'string'
    && candidate.ciphertext.length >= 16
    && candidate.ciphertext.length <= PAIR_SESSION_MAX_CIPHERTEXT_LENGTH
    && /^[A-Za-z0-9_-]+$/.test(candidate.ciphertext);
}

function isSha256Hex(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function expirationTtlSeconds(expiresAt: string): number {
  return Math.max(60, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000));
}

function resolvePairingPublicBase(request: Request, env: Env): string {
  const configured = env.PAIR_PUBLIC_BASE_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Fall back to the current registry origin.
    }
  }
  return new URL(request.url).origin;
}

async function consumePairingResolveAttempt(request: Request, env: Env): Promise<boolean> {
  const forwarded = request.headers.get('cf-connecting-ip')?.trim()
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
  const window = Math.floor(Date.now() / (10 * 60 * 1000));
  const key = `pair-session-attempt:${await sha256Hex(forwarded)}:${window}`;
  const kv = openClawRoutesKv(env);
  const current = Number.parseInt(await kv.get(key) ?? '0', 10) || 0;
  const max = parsePositiveInt(
    env.PAIR_SESSION_RESOLVE_MAX_ATTEMPTS,
    PAIR_SESSION_RESOLVE_MAX_ATTEMPTS_FALLBACK,
  );
  if (current >= max) return true;
  await kv.put(key, String(current + 1), { expirationTtl: 20 * 60 });
  return false;
}

function generatePairingSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `ps_${Array.from(bytes).map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function pairingRecordCorruptResponse(policy: RegistryBackendPolicy, principalId: string): Response {
  return errorResponse(
    'PAIRING_RECORD_CORRUPT',
    policy.errors.corruptRecordMessage(principalId),
    500,
  );
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

function generateRelaySecret(policy: RegistryBackendPolicy): string {
  return `${policy.relaySecretPrefix}${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
}

function generateClientToken(policy: RegistryBackendPolicy): string {
  return `${policy.clientTokenPrefix}${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
}

function appleAppSiteAssociationResponse(env: Env): Response {
  const appIds = splitCsv(env.APPLE_APP_IDS, ['C8TM82D73W.com.p697.clawket']);
  return jsonDocumentResponse({
    applinks: {
      details: appIds.map((appID) => ({
        appIDs: [appID],
        components: [{ '/': '/pair/*', comment: 'Clawket one-tap pairing' }],
      })),
    },
  });
}

function androidAssetLinksResponse(env: Env): Response {
  const packageName = env.ANDROID_APP_LINK_PACKAGE?.trim() || 'com.p697.clawket';
  const fingerprints = splitCsv(env.ANDROID_APP_LINK_SHA256_CERT_FINGERPRINTS, []);
  return jsonDocumentResponse(fingerprints.length === 0 ? [] : [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: packageName,
      sha256_cert_fingerprints: fingerprints,
    },
  }]);
}

function splitCsv(value: string | undefined, fallback: string[]): string[] {
  const values = value?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];
  return values.length > 0 ? values : fallback;
}

function jsonDocumentResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    },
  });
}

function renderPairingPage(input: {
  sessionId: string;
  displayName: string | null;
  expiresAt: string;
  serverUrl: string;
}): string {
  const displayName = escapeHtml(input.displayName || 'Your computer');
  const sessionId = JSON.stringify(input.sessionId);
  const serverUrl = JSON.stringify(input.serverUrl);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Connect with Clawket</title><style>${pairingPageCss()}</style></head><body><main><div class="mark">C</div><p class="eyebrow">CLAWKET</p><h1>Connect to ${displayName}</h1><p class="sub">Open this secure invitation on your phone. Connection details stay encrypted and expire automatically.</p><a class="primary" id="open" href="#">Open Clawket</a><button id="copy">Copy connection link</button><section id="codeWrap" hidden><span>Pairing code</span><strong id="code"></strong></section><p class="expires">Expires ${escapeHtml(new Date(input.expiresAt).toUTCString())}</p></main><script>(()=>{const p=new URLSearchParams(location.hash.slice(1));const key=p.get('k')||'';const code=p.get('c')||'';const q=new URLSearchParams({server:${serverUrl},session:${sessionId},key});document.getElementById('open').href='clawket://pair?'+q.toString();if(code){document.getElementById('code').textContent=/^\\d{6}$/.test(code)?code.replace(/(\\d{3})(?=\\d)/g,'$1 '):code.replace(/(.{4})/g,'$1 ').trim();document.getElementById('codeWrap').hidden=false;}document.getElementById('copy').onclick=async()=>{await navigator.clipboard.writeText(location.href);document.getElementById('copy').textContent='Copied';};})();</script></body></html>`;
}

function renderExpiredPairingPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pairing link expired</title><style>${pairingPageCss()}</style></head><body><main><div class="mark">C</div><p class="eyebrow">CLAWKET</p><h1>This link has expired</h1><p class="sub">Create a fresh pairing link on your computer and try again.</p></main></body></html>`;
}

function pairingPageCss(): string {
  return `:root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f7fb;color:#111827}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at top,#e7ebff,transparent 45%),#f6f7fb}main{width:min(100%,430px);padding:36px;border:1px solid rgba(17,24,39,.08);border-radius:28px;background:rgba(255,255,255,.9);box-shadow:0 24px 70px rgba(30,41,59,.12);text-align:center}.mark{display:grid;place-items:center;width:64px;height:64px;margin:0 auto 18px;border-radius:20px;background:#111827;color:#fff;font-size:30px;font-weight:750}.eyebrow{font-size:12px;font-weight:750;letter-spacing:.18em;color:#6b7280}h1{margin:8px 0 12px;font-size:30px;line-height:1.15}.sub{margin:0 0 28px;color:#64748b;line-height:1.55}.primary,button{display:flex;align-items:center;justify-content:center;width:100%;min-height:50px;border-radius:14px;font:inherit;font-weight:700;text-decoration:none;cursor:pointer}.primary{background:#111827;color:#fff}button{margin-top:10px;border:1px solid #dbe0ea;background:#fff;color:#111827}section{margin-top:22px;padding:16px;border-radius:14px;background:#f1f3f8}section span{display:block;color:#64748b;font-size:12px}section strong{display:block;margin-top:6px;font-size:22px;letter-spacing:.12em}.expires{margin:20px 0 0;color:#94a3b8;font-size:12px}@media(prefers-color-scheme:dark){:root{background:#0b1020;color:#f8fafc}body{background:radial-gradient(circle at top,#20284c,transparent 45%),#0b1020}main{background:rgba(17,24,39,.94);border-color:rgba(255,255,255,.08)}.mark{background:#f8fafc;color:#111827}.sub,.eyebrow{color:#94a3b8}button{background:#172033;border-color:#334155;color:#f8fafc}section{background:#172033}}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

function handleCors(): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders())) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-relay-trace-id,x-clawket-admin-secret',
  };
}
