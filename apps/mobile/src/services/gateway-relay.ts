import type { GatewayConfig } from '../types';
import { normalizeWsUrl } from './gateway-auth';
import { resolveGatewayTransportKind } from './gateway-backends';

export const RELAY_CONTROL_PREFIX = '__clawket_relay_control__:';

export type RelayLookupResult = {
  relayUrl: string;
  accessToken: string;
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
};

export type RelayControlFrame = {
  event: string;
  payload: Record<string, unknown>;
};

export type PendingRelayBootstrapRequest = {
  requestId: string;
  startedAt: number;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (bootstrapToken: string) => void;
  reject: (error: Error) => void;
};

export class RelayBootstrapRequestError extends Error {
  public readonly code: 'relay_bootstrap_timeout' | 'relay_bootstrap_failed';
  public readonly detailCode?: string;

  constructor(
    code: 'relay_bootstrap_timeout' | 'relay_bootstrap_failed',
    message: string,
    detailCode?: string,
  ) {
    super(message);
    this.name = 'RelayBootstrapRequestError';
    this.code = code;
    this.detailCode = detailCode;
  }
}

export type GatewayRelayContext = {
  config: GatewayConfig | null;
  connectAttemptId: number;
  manuallyClosed: boolean;
  connectTraceId: string | null;
  relayAttemptedForCycle: boolean;
  relayBootstrapInFlight: boolean;
  reconnectBlockedReason: { code: string; message: string; hint?: string } | null;
  logTelemetry: (event: string, fields: Record<string, unknown>) => void;
  redactWsUrl: (rawUrl: string) => string;
  ensureIdentity: () => Promise<{ deviceId: string }>;
  openSocket: (wsUrl: string, route: 'direct' | 'relay', attemptId: number) => void;
  refreshRelayRouteInBackground: (attemptId: number) => Promise<void>;
  scheduleReconnect: () => void;
  clearRelayBootstrapTimer: () => void;
  blockReconnect: (reason: { code: string; message: string; hint?: string }) => void;
  emit: (event: 'error', payload: { code: string; message: string; retryable?: boolean; hint?: string }) => void;
  isNonRetryableAuthError: (message: string) => boolean;
};

export function shouldTryRelayFallback(_context: GatewayRelayContext, _route: 'direct' | 'relay'): boolean {
  return false;
}

export function shouldConnectRelayFirst(context: GatewayRelayContext): boolean {
  return resolveGatewayTransportKind(context.config) === 'relay'
    && !!context.config?.url
    && !!context.config?.relay?.gatewayId;
}

export async function tryConnectRelayFastPath(context: GatewayRelayContext, attemptId: number): Promise<void> {
  try {
    const relayConfig = context.config?.relay;
    const relayUrl = context.config?.url?.trim() ?? '';
    const accessToken = relayConfig?.clientToken?.trim() ?? '';
    if (!relayConfig?.gatewayId || !relayUrl || !accessToken) {
      throw new Error('Relay connection is not configured.');
    }
    const identity = await context.ensureIdentity();
    if (attemptId !== context.connectAttemptId || context.manuallyClosed) return;
    const relayClientUrl = buildRelayClientWsUrl(
      relayUrl,
      relayConfig.gatewayId,
      accessToken,
      identity.deviceId,
      context.config?.backendKind ?? 'openclaw',
      context.connectTraceId ?? undefined,
    );
    context.logTelemetry('relay_fastpath_connect', {
      attemptId,
      source: 'configured',
      relayUrl: context.redactWsUrl(relayClientUrl),
    });
    context.relayBootstrapInFlight = false;
    context.clearRelayBootstrapTimer();
    context.openSocket(normalizeWsUrl(relayClientUrl), 'relay', attemptId);
  } catch (error: unknown) {
    if (attemptId !== context.connectAttemptId || context.manuallyClosed) return;
    const message = error instanceof Error ? error.message : String(error);
    context.logTelemetry('relay_fastpath_failed', { attemptId, message });
    context.relayBootstrapInFlight = false;
    context.clearRelayBootstrapTimer();
    context.blockReconnect({
      code: 'relay_config_invalid',
      message: 'Relay connection is incomplete.',
      hint: 'Scan a fresh Clawket Bridge QR code or re-enter the paired Relay details.',
    });
  }
}

export async function refreshRelayRouteInBackground(_context: GatewayRelayContext, _attemptId: number): Promise<void> {
  // Relay routes are now fixed after pairing; there is nothing to refresh.
}

export async function tryConnectViaRelay(context: GatewayRelayContext, attemptId: number): Promise<void> {
  await tryConnectRelayFastPath(context, attemptId);
}

export async function lookupRelayRoute(
  context: GatewayRelayContext,
  _options: { forceNetwork?: boolean } = {},
): Promise<RelayLookupResult | null> {
  const relayConfig = context.config?.relay;
  const relayUrl = context.config?.url?.trim() ?? '';
  const accessToken = relayConfig?.clientToken?.trim() ?? '';
  if (!relayConfig?.gatewayId || !relayUrl || !accessToken) return null;
  return { relayUrl, accessToken };
}

export async function resolveRelayAccessToken(
  context: GatewayRelayContext,
  relayConfig?: NonNullable<GatewayConfig['relay']>,
): Promise<string> {
  if (!relayConfig?.gatewayId) {
    throw new Error('Relay gateway ID is not configured.');
  }
  const token = relayConfig.clientToken?.trim() ?? '';
  if (!token) {
    throw new Error('Relay pairing credential is not configured.');
  }
  return token;
}

export function relaySupportsBootstrapV2(relayConfig?: NonNullable<GatewayConfig['relay']>): boolean {
  if (relayConfig?.supportsBootstrap === true) return true;
  if (relayConfig?.supportsBootstrap === false) return false;
  return (relayConfig?.protocolVersion ?? 0) >= 2;
}

export function selectRelayConnectAuth(params: {
  token?: string;
  password?: string;
  storedDeviceToken?: string | null;
  bootstrapToken?: string | null;
}): RelayConnectAuthSelection {
  const deviceToken = trimToUndefined(params.storedDeviceToken);
  if (deviceToken) {
    return {
      auth: { deviceToken },
      signatureToken: deviceToken,
      source: 'device-token',
    };
  }

  const bootstrapToken = trimToUndefined(params.bootstrapToken);
  if (bootstrapToken) {
    return {
      auth: { bootstrapToken },
      signatureToken: bootstrapToken,
      source: 'bootstrap-token',
    };
  }

  const token = trimToUndefined(params.token);
  if (token) {
    return {
      auth: { token },
      signatureToken: token,
      source: 'legacy-token',
    };
  }

  const password = trimToUndefined(params.password);
  if (password) {
    return {
      auth: { password },
      source: 'legacy-password',
    };
  }

  return { auth: {}, source: 'none' };
}

export function buildRelayBootstrapRequestFrame(params: {
  requestId: string;
  deviceId: string;
  publicKey: string;
  role: string;
  scopes: string[];
}): string {
  return `${RELAY_CONTROL_PREFIX}${JSON.stringify({
    type: 'control',
    event: 'bootstrap.request',
    requestId: params.requestId,
    payload: {
      deviceId: params.deviceId,
      publicKey: params.publicKey,
      role: params.role,
      scopes: params.scopes,
    },
  })}`;
}

export function parseRelayControlFrame(raw: string): RelayControlFrame | null {
  if (!raw.startsWith(RELAY_CONTROL_PREFIX)) return null;
  try {
    const parsed = JSON.parse(raw.slice(RELAY_CONTROL_PREFIX.length)) as {
      event?: unknown;
      [key: string]: unknown;
    };
    if (typeof parsed.event !== 'string' || !parsed.event.trim()) return null;
    const { event, ...payload } = parsed;
    return {
      event: event.trim(),
      payload,
    };
  } catch {
    return null;
  }
}

export function parseRelayBootstrapIssued(control: RelayControlFrame): { requestId?: string; bootstrapToken: string } | null {
  if (control.event !== 'bootstrap.issued') return null;
  const payload = unwrapRelayControlPayload(control.payload);
  const bootstrapToken = trimToUndefined(payload.bootstrapToken ?? payload.token);
  if (!bootstrapToken) return null;
  const requestId = trimToUndefined(payload.requestId);
  return { requestId, bootstrapToken };
}

export function parseRelayBootstrapError(control: RelayControlFrame): { requestId?: string; error: RelayBootstrapRequestError } | null {
  if (control.event !== 'bootstrap.error') return null;
  const payload = unwrapRelayControlPayload(control.payload);
  const errorRecord = payload.error && typeof payload.error === 'object'
    ? payload.error as Record<string, unknown>
    : undefined;
  const requestId = trimToUndefined(payload.requestId);
  const detailCode = trimToUndefined(payload.code ?? errorRecord?.code);
  const rawMessage = trimToUndefined(payload.message ?? errorRecord?.message) ?? 'Relay bootstrap failed.';
  const message = detailCode ? `[${detailCode}] ${rawMessage}` : rawMessage;
  return {
    requestId,
    error: new RelayBootstrapRequestError('relay_bootstrap_failed', message, detailCode),
  };
}

export type RelayDoctorCheckResult = {
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'skip' | string;
  message?: string;
};

export type RelayDoctorResult = {
  ok: boolean;
  checks: RelayDoctorCheckResult[];
  summary: string;
  raw?: string;
};

export type PendingRelayDoctorRequest = {
  requestId: string;
  startedAt: number;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (result: RelayDoctorResult) => void;
  reject: (error: Error) => void;
};

export class RelayDoctorRequestError extends Error {
  public readonly code: 'relay_doctor_timeout' | 'relay_doctor_failed' | 'relay_doctor_fix_timeout' | 'relay_doctor_fix_failed';
  public readonly detailCode?: string;

  constructor(
    code: 'relay_doctor_timeout' | 'relay_doctor_failed' | 'relay_doctor_fix_timeout' | 'relay_doctor_fix_failed',
    message: string,
    detailCode?: string,
  ) {
    super(message);
    this.name = 'RelayDoctorRequestError';
    this.code = code;
    this.detailCode = detailCode;
  }
}

export function buildRelayDoctorRequestFrame(params: {
  requestId: string;
}): string {
  return `${RELAY_CONTROL_PREFIX}${JSON.stringify({
    type: 'control',
    event: 'doctor.request',
    requestId: params.requestId,
  })}`;
}

export function parseRelayDoctorResult(control: RelayControlFrame): { requestId?: string; result: RelayDoctorResult } | null {
  if (control.event !== 'doctor.result') return null;
  const payload = unwrapRelayControlPayload(control.payload);
  const requestId = trimToUndefined(payload.requestId);
  const checks = Array.isArray(payload.checks)
    ? (payload.checks as Record<string, unknown>[])
      .filter((c): c is Record<string, unknown> => typeof c === 'object' && c != null)
      .map((c) => ({
        name: typeof c.name === 'string' ? c.name : 'unknown',
        status: (typeof c.status === 'string' ? c.status : 'unknown') as RelayDoctorCheckResult['status'],
        message: typeof c.message === 'string' ? c.message : undefined,
      }))
    : [];
  return {
    requestId,
    result: {
      ok: payload.ok === true,
      checks,
      summary: typeof payload.summary === 'string' ? payload.summary : '',
      raw: typeof payload.raw === 'string' ? payload.raw : undefined,
    },
  };
}

export type RelayPermissionsStatus =
  | 'available'
  | 'needs_approval'
  | 'restricted'
  | 'disabled'
  | 'configuration_needed';

export type RelayPermissionsSummary = {
  status: RelayPermissionsStatus;
  summary: string;
  reasons: string[];
};

export type RelayPermissionsResult = {
  configPath: string;
  approvalsPath: string;
  web: RelayPermissionsSummary & {
    searchEnabled: boolean;
    searchProvider: string;
    searchConfigured: boolean;
    fetchEnabled: boolean;
    firecrawlConfigured: boolean;
  };
  exec: RelayPermissionsSummary & {
    currentAgentId: string;
    currentAgentName: string;
    toolProfile: 'minimal' | 'coding' | 'messaging' | 'full' | 'unset';
    execToolAvailable: boolean;
    hostApprovalsApply: boolean;
    implicitSandboxFallback: boolean;
    configuredHost: 'sandbox' | 'gateway' | 'node';
    effectiveHost: 'sandbox' | 'gateway' | 'node';
    sandboxMode: 'off' | 'non-main' | 'all';
    configSecurity: 'deny' | 'allowlist' | 'full';
    configAsk: 'off' | 'on-miss' | 'always';
    approvalsExists: boolean;
    approvalsSecurity: 'deny' | 'allowlist' | 'full';
    approvalsAsk: 'off' | 'on-miss' | 'always';
    effectiveSecurity: 'deny' | 'allowlist' | 'full';
    effectiveAsk: 'off' | 'on-miss' | 'always';
    allowlistCount: number;
    toolPolicyDenied: boolean;
    safeBins: string[];
    safeBinTrustedDirs: string[];
    trustedDirWarnings: string[];
  };
  codeExecution: RelayPermissionsSummary & {
    inheritsFromExec: true;
  };
};

export type PendingRelayPermissionsRequest = {
  requestId: string;
  startedAt: number;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (result: RelayPermissionsResult) => void;
  reject: (error: Error) => void;
};

export function buildRelayPermissionsRequestFrame(params: {
  requestId: string;
}): string {
  return `${RELAY_CONTROL_PREFIX}${JSON.stringify({
    type: 'control',
    event: 'permissions.request',
    requestId: params.requestId,
  })}`;
}

function parseRelayPermissionsSummary(
  value: unknown,
): RelayPermissionsSummary {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    status: (typeof record.status === 'string' ? record.status : 'disabled') as RelayPermissionsStatus,
    summary: typeof record.summary === 'string' ? record.summary : '',
    reasons: Array.isArray(record.reasons)
      ? record.reasons.filter((reason): reason is string => typeof reason === 'string')
      : [],
  };
}

export function parseRelayPermissionsResult(control: RelayControlFrame): { requestId?: string; result: RelayPermissionsResult } | null {
  if (control.event !== 'permissions.result') return null;
  const payload = unwrapRelayControlPayload(control.payload);
  const requestId = trimToUndefined(payload.requestId);
  const web = payload.web && typeof payload.web === 'object' ? payload.web as Record<string, unknown> : {};
  const exec = payload.exec && typeof payload.exec === 'object' ? payload.exec as Record<string, unknown> : {};
  const codeExecution = payload.codeExecution && typeof payload.codeExecution === 'object'
    ? payload.codeExecution as Record<string, unknown>
    : {};
  const legacyHost = (trimToUndefined(exec.host) ?? 'sandbox') as RelayPermissionsResult['exec']['effectiveHost'];
  const configuredHost = (trimToUndefined(exec.configuredHost) ?? legacyHost) as RelayPermissionsResult['exec']['configuredHost'];
  const effectiveHost = (trimToUndefined(exec.effectiveHost) ?? legacyHost) as RelayPermissionsResult['exec']['effectiveHost'];
  return {
    requestId,
    result: {
      configPath: trimToUndefined(payload.configPath) ?? '',
      approvalsPath: trimToUndefined(payload.approvalsPath) ?? '',
      web: {
        ...parseRelayPermissionsSummary(web),
        searchEnabled: web.searchEnabled === true,
        searchProvider: trimToUndefined(web.searchProvider) ?? 'auto',
        searchConfigured: web.searchConfigured === true,
        fetchEnabled: web.fetchEnabled !== false,
        firecrawlConfigured: web.firecrawlConfigured === true,
      },
      exec: {
        ...parseRelayPermissionsSummary(exec),
        currentAgentId: trimToUndefined(exec.currentAgentId) ?? 'main',
        currentAgentName: trimToUndefined(exec.currentAgentName) ?? 'main',
        toolProfile: (trimToUndefined(exec.toolProfile) ?? 'unset') as RelayPermissionsResult['exec']['toolProfile'],
        execToolAvailable: exec.execToolAvailable !== false,
        hostApprovalsApply: exec.hostApprovalsApply === true,
        implicitSandboxFallback: exec.implicitSandboxFallback === true,
        configuredHost,
        effectiveHost,
        sandboxMode: (trimToUndefined(exec.sandboxMode) ?? 'off') as RelayPermissionsResult['exec']['sandboxMode'],
        configSecurity: (trimToUndefined(exec.configSecurity) ?? 'deny') as RelayPermissionsResult['exec']['configSecurity'],
        configAsk: (trimToUndefined(exec.configAsk) ?? 'on-miss') as RelayPermissionsResult['exec']['configAsk'],
        approvalsExists: exec.approvalsExists === true,
        approvalsSecurity: (trimToUndefined(exec.approvalsSecurity) ?? 'deny') as RelayPermissionsResult['exec']['approvalsSecurity'],
        approvalsAsk: (trimToUndefined(exec.approvalsAsk) ?? 'on-miss') as RelayPermissionsResult['exec']['approvalsAsk'],
        effectiveSecurity: (trimToUndefined(exec.effectiveSecurity) ?? 'deny') as RelayPermissionsResult['exec']['effectiveSecurity'],
        effectiveAsk: (trimToUndefined(exec.effectiveAsk) ?? 'on-miss') as RelayPermissionsResult['exec']['effectiveAsk'],
        allowlistCount: typeof exec.allowlistCount === 'number' ? exec.allowlistCount : 0,
        toolPolicyDenied: exec.toolPolicyDenied === true,
        safeBins: Array.isArray(exec.safeBins)
          ? exec.safeBins.filter((entry): entry is string => typeof entry === 'string')
          : [],
        safeBinTrustedDirs: Array.isArray(exec.safeBinTrustedDirs)
          ? exec.safeBinTrustedDirs.filter((entry): entry is string => typeof entry === 'string')
          : [],
        trustedDirWarnings: Array.isArray(exec.trustedDirWarnings)
          ? exec.trustedDirWarnings.filter((entry): entry is string => typeof entry === 'string')
          : [],
      },
      codeExecution: {
        ...parseRelayPermissionsSummary(codeExecution),
        inheritsFromExec: true,
      },
    },
  };
}

export function parseRelayPermissionsError(control: RelayControlFrame): { requestId?: string; error: RelayDoctorRequestError } | null {
  if (control.event !== 'permissions.error') return null;
  const payload = unwrapRelayControlPayload(control.payload);
  const requestId = trimToUndefined(payload.requestId);
  const detailCode = trimToUndefined(payload.code);
  const rawMessage = trimToUndefined(payload.message) ?? 'Permissions request failed.';
  const message = detailCode ? `[${detailCode}] ${rawMessage}` : rawMessage;
  return {
    requestId,
    error: new RelayDoctorRequestError('relay_doctor_failed', message, detailCode),
  };
}

export function parseRelayDoctorError(control: RelayControlFrame): { requestId?: string; error: RelayDoctorRequestError } | null {
  if (control.event !== 'doctor.error') return null;
  const payload = unwrapRelayControlPayload(control.payload);
  const requestId = trimToUndefined(payload.requestId);
  const detailCode = trimToUndefined(payload.code);
  const rawMessage = trimToUndefined(payload.message) ?? 'Doctor command failed.';
  const message = detailCode ? `[${detailCode}] ${rawMessage}` : rawMessage;
  return {
    requestId,
    error: new RelayDoctorRequestError('relay_doctor_failed', message, detailCode),
  };
}

export type RelayDoctorFixResult = {
  ok: boolean;
  summary: string;
  raw?: string;
};

export type PendingRelayDoctorFixRequest = {
  requestId: string;
  startedAt: number;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (result: RelayDoctorFixResult) => void;
  reject: (error: Error) => void;
};

export function buildRelayDoctorFixRequestFrame(params: {
  requestId: string;
}): string {
  return `${RELAY_CONTROL_PREFIX}${JSON.stringify({
    type: 'control',
    event: 'doctor-fix.request',
    requestId: params.requestId,
  })}`;
}

export function parseRelayDoctorFixResult(control: RelayControlFrame): { requestId?: string; result: RelayDoctorFixResult } | null {
  if (control.event !== 'doctor-fix.result') return null;
  const payload = unwrapRelayControlPayload(control.payload);
  const requestId = trimToUndefined(payload.requestId);
  return {
    requestId,
    result: {
      ok: payload.ok === true,
      summary: typeof payload.summary === 'string' ? payload.summary : '',
      raw: typeof payload.raw === 'string' ? payload.raw : undefined,
    },
  };
}

export function parseRelayDoctorFixError(control: RelayControlFrame): { requestId?: string; error: RelayDoctorRequestError } | null {
  if (control.event !== 'doctor-fix.error') return null;
  const payload = unwrapRelayControlPayload(control.payload);
  const requestId = trimToUndefined(payload.requestId);
  const detailCode = trimToUndefined(payload.code);
  const rawMessage = trimToUndefined(payload.message) ?? 'Doctor fix command failed.';
  const message = detailCode ? `[${detailCode}] ${rawMessage}` : rawMessage;
  return {
    requestId,
    error: new RelayDoctorRequestError('relay_doctor_fix_failed', message, detailCode),
  };
}

export function buildRelayClientWsUrl(
  relayUrl: string,
  relayGatewayId: string,
  token: string,
  clientId: string,
  backendKind: GatewayConfig['backendKind'] = 'openclaw',
  traceId?: string,
): string {
  const base = normalizeWsUrl(relayUrl);
  const url = new URL(base);
  if (!url.pathname || url.pathname === '/') {
    url.pathname = '/ws';
  }
  url.searchParams.set(backendKind === 'hermes' ? 'bridgeId' : 'gatewayId', relayGatewayId);
  url.searchParams.set('role', 'client');
  url.searchParams.set('clientId', clientId);
  url.searchParams.set('token', token);
  if (traceId) url.searchParams.set('traceId', traceId);
  return url.toString();
}

function unwrapRelayControlPayload(payload: Record<string, unknown>): Record<string, unknown> {
  if (payload.payload && typeof payload.payload === 'object') {
    const nested = payload.payload as Record<string, unknown>;
    const { payload: _ignored, ...outer } = payload;
    return { ...outer, ...nested };
  }
  return payload;
}

function trimToUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
