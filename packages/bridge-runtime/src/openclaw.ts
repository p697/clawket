import { execFile } from 'node:child_process';
import { randomBytes, X509Certificate } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export type OpenClawInfo = {
  configFound: boolean;
  gatewayPort: number | null;
  gatewayTlsEnabled: boolean;
  gatewayTlsFingerprint: string | null;
  authMode: 'token' | 'password' | null;
  tokenConfigured: boolean;
  passwordConfigured: boolean;
  token: string | null;
  password: string | null;
};

export type OpenClawBootstrapStrategy = 'mobile-setup' | 'legacy-bound';

export type OpenClawBootstrapTokenResult = {
  token: string;
  expiresAtMs: number;
  strategy: OpenClawBootstrapStrategy;
  access?: 'full' | 'limited' | 'node';
  statePath?: string;
};

export type DeviceBootstrapTokenRecord = {
  token: string;
  ts: number;
  deviceId?: string;
  publicKey?: string;
  roles?: string[];
  scopes?: string[];
  issuedAtMs: number;
  lastUsedAtMs?: number;
};

export type OpenClawLanConfigResult = {
  configPath: string;
  bindChanged: boolean;
  allowedOriginAdded: boolean;
  allowedOrigins: string[];
  controlUiOrigin: string;
};

export type OpenClawGatewayRestartResult = {
  action: 'restarted' | 'started';
  result: string;
  message: string | null;
  warnings: string[];
};

const DEFAULT_GATEWAY_URL = 'ws://127.0.0.1:18789';
export const DEVICE_BOOTSTRAP_TOKEN_TTL_MS = 10 * 60 * 1000;
const BOOTSTRAP_FILENAME = 'bootstrap.json';
const PAIRING_TOKEN_BYTES = 32;
const OPENCLAW_CLI_COMMAND = 'openclaw';

type OpenClawPaths = {
  stateDir: string;
  configDir: string;
  configPath: string;
  mediaDir: string;
};

type DeviceBootstrapStateFile = Record<string, DeviceBootstrapTokenRecord>;

const withBootstrapLock = createAsyncLock();

export function resolveGatewayUrl(explicitUrl?: string | null): string {
  const trimmed = explicitUrl?.trim();
  if (trimmed) return trimmed;
  const info = readOpenClawInfo();
  const protocol = info.gatewayTlsEnabled ? 'wss' : 'ws';
  if (typeof info.gatewayPort === 'number') {
    return `${protocol}://127.0.0.1:${info.gatewayPort}`;
  }
  return info.gatewayTlsEnabled
    ? DEFAULT_GATEWAY_URL.replace(/^ws:/, 'wss:')
    : DEFAULT_GATEWAY_URL;
}

export function readOpenClawInfo(): OpenClawInfo {
  const openclaw = resolveOpenClawPaths();
  const envGatewayPort = readGatewayPortEnv();
  if (!existsSync(openclaw.configPath)) {
    return {
      configFound: false,
      gatewayPort: envGatewayPort,
      gatewayTlsEnabled: false,
      gatewayTlsFingerprint: null,
      authMode: null,
      tokenConfigured: Boolean(readGatewayTokenEnv()),
      passwordConfigured: Boolean(readGatewayPasswordEnv()),
      token: readGatewayTokenEnv(),
      password: readGatewayPasswordEnv(),
    };
  }
  try {
    const parsed = JSON.parse(readFileSync(openclaw.configPath, 'utf8')) as {
      gateway?: {
        port?: unknown;
        tls?: {
          enabled?: unknown;
          certPath?: unknown;
        };
        auth?: { mode?: unknown; token?: unknown; password?: unknown };
      };
    };
    const rawPort = parsed.gateway?.port;
    const configuredGatewayPort = typeof rawPort === 'number' && Number.isInteger(rawPort) ? rawPort : null;
    const gatewayTlsEnabled = parsed.gateway?.tls?.enabled === true;
    const gatewayTlsFingerprint = gatewayTlsEnabled
      ? readGatewayTlsFingerprint({
          configDir: openclaw.configDir,
          certPath: typeof parsed.gateway?.tls?.certPath === 'string'
            ? parsed.gateway.tls.certPath
            : null,
        })
      : null;
    const authMode = parsed.gateway?.auth?.mode === 'token' || parsed.gateway?.auth?.mode === 'password'
      ? parsed.gateway.auth.mode
      : null;
    const envToken = readGatewayTokenEnv();
    const envPassword = readGatewayPasswordEnv();
    const token = readConfiguredSecret(parsed.gateway?.auth?.token) ?? envToken;
    const password = readConfiguredSecret(parsed.gateway?.auth?.password) ?? envPassword;
    return {
      configFound: true,
      gatewayPort: envGatewayPort ?? configuredGatewayPort,
      gatewayTlsEnabled,
      gatewayTlsFingerprint,
      authMode,
      tokenConfigured: isConfiguredSecretInput(parsed.gateway?.auth?.token) || Boolean(envToken),
      passwordConfigured: isConfiguredSecretInput(parsed.gateway?.auth?.password) || Boolean(envPassword),
      token,
      password,
    };
  } catch {
    return {
      configFound: true,
      gatewayPort: envGatewayPort,
      gatewayTlsEnabled: false,
      gatewayTlsFingerprint: null,
      authMode: null,
      tokenConfigured: Boolean(readGatewayTokenEnv()),
      passwordConfigured: Boolean(readGatewayPasswordEnv()),
      token: readGatewayTokenEnv(),
      password: readGatewayPasswordEnv(),
    };
  }
}

function readGatewayTlsFingerprint(input: {
  configDir: string;
  certPath: string | null;
}): string | null {
  const certPath = resolveConfiguredUserPath(
    input.certPath,
    join(input.configDir, 'gateway', 'tls', 'gateway-cert.pem'),
  );
  if (!existsSync(certPath)) {
    return null;
  }
  try {
    const certificate = readFileSync(certPath, 'utf8');
    const fingerprint = new X509Certificate(certificate).fingerprint256 ?? '';
    return normalizeFingerprint(fingerprint);
  } catch {
    return null;
  }
}

function resolveConfiguredUserPath(input: string | null, fallback: string): string {
  const trimmed = input?.trim();
  if (!trimmed) {
    return fallback;
  }
  if (trimmed.startsWith('~/')) {
    return join(homedir(), trimmed.slice(2));
  }
  return resolve(trimmed);
}

function normalizeFingerprint(input: string): string | null {
  const normalized = input.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  return normalized ? normalized : null;
}

export function resolveGatewayToken(): string | null {
  return readOpenClawInfo().token;
}

export function resolveGatewayPassword(): string | null {
  return readOpenClawInfo().password;
}

export function resolveGatewayAuth():
  | { token: string; password: null; label: 'token' }
  | { token: null; password: string; label: 'password' }
  | { token: string | null; password: string | null; label: 'token' | 'password'; error: string }
  | { token: null; password: null; label: null }
{
  const info = readOpenClawInfo();
  const token = info.token;
  const password = info.password;
  if (info.tokenConfigured && info.passwordConfigured && info.authMode == null) {
    return {
      token,
      password,
      label: 'token',
      error: 'OpenClaw has both gateway token and password configured, but gateway.auth.mode is unset. Set the mode to token or password before pairing.',
    };
  }
  if (info.authMode === 'password') {
    return password
      ? { token: null, password, label: 'password' }
      : { token: null, password: null, label: null };
  }
  if (info.authMode === 'token') {
    return token
      ? { token, password: null, label: 'token' }
      : { token: null, password: null, label: null };
  }
  if (token) {
    return { token, password: null, label: 'token' };
  }
  if (password) {
    return { token: null, password, label: 'password' };
  }
  return { token: null, password: null, label: null };
}

export function isOpenClawGatewayAuthConfigured(info = readOpenClawInfo()): boolean {
  if (info.authMode === 'token') return info.tokenConfigured;
  if (info.authMode === 'password') return info.passwordConfigured;
  return info.tokenConfigured || info.passwordConfigured;
}

export function getOpenClawConfigDir(): string {
  return resolveOpenClawPaths().configDir;
}

export function getOpenClawStateDir(): string {
  return resolveOpenClawPaths().stateDir;
}

export function getOpenClawMediaDir(): string {
  return resolveOpenClawPaths().mediaDir;
}

export function getOpenClawConfigPath(): string {
  return resolveOpenClawPaths().configPath;
}

export function getOpenClawConfigCandidates(): string[] {
  return buildOpenClawStateDirCandidates();
}

export async function configureOpenClawLanAccess(params: {
  controlUiOrigin: string;
}): Promise<OpenClawLanConfigResult> {
  const openclaw = resolveOpenClawPaths();
  if (!existsSync(openclaw.configPath)) {
    throw new Error(
      `OpenClaw config was not found at ${openclaw.configPath}. Run OpenClaw setup first, then retry local pairing.`,
    );
  }

  const controlUiOrigin = normalizeControlUiOrigin(params.controlUiOrigin);
  const currentBind = await readOpenClawConfigString('gateway.bind', openclaw);
  const currentAllowedOrigins = await readOpenClawAllowedOrigins(openclaw);

  let bindChanged = false;
  if (currentBind !== 'lan') {
    await runOpenClawCli(['config', 'set', 'gateway.bind', 'lan'], openclaw);
    bindChanged = true;
  }

  const allowedOrigins = appendUniqueOrigin(currentAllowedOrigins, controlUiOrigin);
  const allowedOriginAdded = allowedOrigins.length !== currentAllowedOrigins.length;
  if (allowedOriginAdded) {
    await runOpenClawCli(
      [
        'config',
        'set',
        'gateway.controlUi.allowedOrigins',
        JSON.stringify(allowedOrigins),
        '--strict-json',
      ],
      openclaw,
    );
  }

  return {
    configPath: openclaw.configPath,
    bindChanged,
    allowedOriginAdded,
    allowedOrigins,
    controlUiOrigin,
  };
}

export type OpenClawDoctorCheckResult = {
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'skip' | string;
  message?: string;
};

export type OpenClawDoctorResult = {
  ok: boolean;
  checks: OpenClawDoctorCheckResult[];
  summary: string;
  raw?: string;
};

export type OpenClawPermissionsStatus =
  | 'available'
  | 'needs_approval'
  | 'restricted'
  | 'disabled'
  | 'configuration_needed';

export type OpenClawPermissionsSummary = {
  status: OpenClawPermissionsStatus;
  summary: string;
  reasons: string[];
};

export type OpenClawPermissionsResult = {
  configPath: string;
  approvalsPath: string;
  web: {
    searchEnabled: boolean;
    searchProvider: string;
    searchConfigured: boolean;
    fetchEnabled: boolean;
    firecrawlConfigured: boolean;
  } & OpenClawPermissionsSummary;
  exec: {
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
  } & OpenClawPermissionsSummary;
  codeExecution: OpenClawPermissionsSummary & {
    inheritsFromExec: true;
  };
};

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

function collectCliOutput(parts: Array<string | undefined>): string {
  return parts
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => stripAnsi(value.trim()))
    .join('\n')
    .trim();
}

function isUnsupportedJsonOptionOutput(text: string): boolean {
  return /unknown option ['"]?--json['"]?/i.test(text);
}

export async function readOpenClawPermissions(): Promise<OpenClawPermissionsResult> {
  const openclaw = resolveOpenClawPaths();
  const config = await readJsonFile<Record<string, unknown>>(openclaw.configPath);
  const approvalsPath = resolveOpenClawExecApprovalsPath();
  const approvals = await readJsonFile<Record<string, unknown>>(approvalsPath);
  const configEnv = readConfigEnvVars(config);

  const tools = readRecord(config?.tools);
  const currentAgent = resolveCurrentAgent(config);
  const agentTools = readRecord(currentAgent.record?.tools);
  const web = readRecord(tools?.web);
  const webSearch = readRecord(web?.search);
  const webFetch = readRecord(web?.fetch);
  const exec = resolveMergedExecConfig(tools, agentTools);
  const toolProfile = resolveToolProfile(tools, agentTools);
  const toolDeny = uniqueSortedStrings([
    ...readStringArray(tools?.deny),
    ...readStringArray(agentTools?.deny),
  ]);

  const searchEnabled = readBoolean(webSearch?.enabled, true);
  const searchProvider = readString(webSearch?.provider) ?? 'auto';
  const searchConfigured = resolveWebSearchConfigured(webSearch, searchProvider, configEnv);
  const webReasons: string[] = [];
  let webStatus: OpenClawPermissionsStatus;
  let webSummary: string;
  if (toolDeny.includes('web_search') && toolDeny.includes('web_fetch')) {
    webStatus = 'disabled';
    webSummary = 'Web search and fetch are blocked by tool policy.';
    webReasons.push('Global tool policy denies both web_search and web_fetch.');
  } else if (!searchEnabled && !readBoolean(webFetch?.enabled, true)) {
    webStatus = 'disabled';
    webSummary = 'Web search and fetch are turned off.';
    webReasons.push('tools.web.search.enabled is false.');
    webReasons.push('tools.web.fetch.enabled is false.');
  } else if (searchEnabled && !searchConfigured) {
    webStatus = 'configuration_needed';
    webSummary = 'Web search is enabled, but no search provider key was found.';
    webReasons.push(
      searchProvider === 'auto'
        ? 'No supported web search provider API key was found in config or current environment.'
        : `Provider "${searchProvider}" is selected, but its API key was not found in config or current environment.`,
    );
  } else {
    webStatus = 'available';
    webSummary = 'Common web tools look available.';
    if (toolDeny.includes('web_search')) {
      webStatus = 'restricted';
      webSummary = 'Web fetch is available, but web search is blocked by tool policy.';
      webReasons.push('Global tool policy denies web_search.');
    } else if (toolDeny.includes('web_fetch')) {
      webStatus = 'restricted';
      webSummary = 'Web search is available, but web fetch is blocked by tool policy.';
      webReasons.push('Global tool policy denies web_fetch.');
    } else {
      if (!searchEnabled) {
        webReasons.push('tools.web.search.enabled is false.');
      }
      if (!readBoolean(webFetch?.enabled, true)) {
        webReasons.push('tools.web.fetch.enabled is false.');
      }
    }
  }

  const firecrawlConfigured = resolveFirecrawlConfigured(webFetch, configEnv);
  const configuredHost = readExecHost(exec?.host);
  const sandboxMode = readSandboxMode(config, currentAgent.id);
  const implicitSandboxFallback = configuredHost === 'sandbox' && sandboxMode === 'off';
  const effectiveHost = implicitSandboxFallback
    ? 'gateway'
    : configuredHost;
  const configSecurity = readExecSecurity(
    exec?.security,
    configuredHost === 'sandbox' ? 'deny' : 'allowlist',
  );
  const configAsk = readExecAsk(exec?.ask, 'on-miss');
  const safeBins = readStringArray(exec?.safeBins);
  const safeBinTrustedDirs = uniqueSortedStrings([
    '/bin',
    '/usr/bin',
    ...readStringArray(exec?.safeBinTrustedDirs),
  ]);
  const trustedDirWarnings = safeBinTrustedDirs.filter((dir) =>
    ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin', '/snap/bin'].includes(dir),
  ).map(
    (dir) =>
      `safe-bin trust includes ${dir}; this is often needed, but commands there are treated as explicitly trusted.`,
  );

  const resolvedApprovals = resolveExecApprovalsSummary(approvals, {
    security: configSecurity,
    ask: configAsk,
  });
  // OpenClaw only applies exec-approvals host gating on explicit gateway/node paths.
  // The default host still resolves to "sandbox" even when sandbox mode is off, and
  // that implicit path does not route through host approvals.
  const usesHostApprovals = configuredHost === 'gateway' || configuredHost === 'node';
  const effectiveSecurity = usesHostApprovals
    ? minExecSecurity(configSecurity, resolvedApprovals.security)
    : configSecurity;
  const effectiveAsk = usesHostApprovals
    ? (resolvedApprovals.ask === 'off' ? 'off' : maxExecAsk(configAsk, resolvedApprovals.ask))
    : 'off';
  const toolPolicyDenied = deniesExecTool(toolDeny);
  const execToolAvailable = toolProfileAllowsExec(toolProfile) && !toolPolicyDenied;
  const execReasons: string[] = [];
  let execStatus: OpenClawPermissionsStatus;
  let execSummary: string;

  if (!execToolAvailable) {
    execStatus = 'disabled';
    execSummary = 'This agent cannot run commands right now.';
    if (!toolProfileAllowsExec(toolProfile)) {
      execReasons.push(`The current agent uses the ${toolProfile} tool profile, which does not expose command tools.`);
    }
    if (toolPolicyDenied) {
      execReasons.push('A tool deny rule is blocking command execution for the current agent.');
    }
  } else if (implicitSandboxFallback) {
    execStatus = 'available';
    execSummary = 'Commands currently run directly on this OpenClaw machine.';
    execReasons.push('The current agent still exposes command tools.');
    execReasons.push('Sandbox mode is off, so commands are not running in an isolated sandbox.');
    execReasons.push('OpenClaw is currently falling back to direct host execution on this machine.');
  } else if (effectiveHost === 'sandbox') {
    execStatus = 'available';
    execSummary = 'Commands run inside OpenClaw\'s sandbox.';
    execReasons.push('The current agent still exposes command tools.');
    execReasons.push(`Sandbox mode is ${sandboxMode}.`);
  } else if (effectiveSecurity === 'deny') {
    execStatus = 'disabled';
    execSummary = 'Command execution is disabled.';
    execReasons.push(`Effective exec security resolves to ${effectiveSecurity}.`);
  } else if (effectiveAsk !== 'off') {
    execStatus = 'needs_approval';
    execSummary = 'Commands can run, but exec approvals currently require confirmation.';
    execReasons.push(`Effective exec ask policy is ${effectiveAsk}.`);
    if (effectiveSecurity === 'allowlist' && resolvedApprovals.allowlistCount === 0 && safeBins.length === 0) {
      execReasons.push('No allowlist entries or safe bins are configured yet, so most commands will still be denied.');
    }
  } else if (effectiveSecurity === 'allowlist') {
    execStatus = 'restricted';
    execSummary = 'Commands are limited to allowlisted executables and safe bins.';
    execReasons.push('Effective exec security is allowlist.');
    if (resolvedApprovals.allowlistCount === 0 && safeBins.length === 0) {
      execReasons.push('No allowlist entries or safe bins are configured yet.');
    }
  } else {
    execStatus = 'available';
    execSummary = 'Command execution is broadly available.';
  }

  if (usesHostApprovals && resolvedApprovals.security !== configSecurity) {
    execReasons.push(
      `exec-approvals.json is stricter than tools.exec.security (${configSecurity} -> ${resolvedApprovals.security}).`,
    );
  }
  if (usesHostApprovals && resolvedApprovals.ask !== configAsk) {
    execReasons.push(
      `exec-approvals.json is stricter than tools.exec.ask (${configAsk} -> ${resolvedApprovals.ask}).`,
    );
  }

  if (usesHostApprovals && safeBins.some(isInterpreterLikeSafeBin)) {
    execStatus = execStatus === 'disabled' ? execStatus : 'restricted';
    execReasons.push('Interpreter/runtime binaries appear in safeBins and may still be unsafe or blocked.');
  }
  if (usesHostApprovals) {
    execReasons.push(...trustedDirWarnings);
  }
  if (!usesHostApprovals) {
    execReasons.push(
      `The app controls tools.exec.security=${configSecurity} and tools.exec.ask=${configAsk}, but this current command path is not using OpenClaw's host approval flow.`,
    );
  }

  const codeReasons: string[] = [];
  let codeStatus: OpenClawPermissionsStatus = execStatus;
  let codeSummary = execSummary;
  if (!execToolAvailable) {
    codeStatus = 'disabled';
    codeSummary = 'Scripts are currently unavailable because this agent cannot run commands.';
  } else if (implicitSandboxFallback) {
    codeStatus = 'available';
    codeSummary = 'Scripts follow the same direct command path as command execution on this machine.';
    codeReasons.push('Code execution follows the same direct command path as command execution.');
  } else if (effectiveHost === 'sandbox') {
    codeStatus = 'available';
    codeSummary = 'Code runs inside OpenClaw\'s sandbox.';
    codeReasons.push('Code execution follows the same sandboxed path as command execution.');
  } else if (effectiveSecurity === 'deny') {
    codeStatus = 'disabled';
    codeSummary = 'Code execution is disabled because command execution is disabled.';
  } else if (effectiveAsk !== 'off') {
    codeStatus = 'needs_approval';
    codeSummary = 'Running scripts or code inherits the current exec approval requirement.';
    codeReasons.push('Interpreter and runtime commands inherit exec approval rules.');
    codeReasons.push(
      'Approval-backed interpreter runs are conservative and may be denied when OpenClaw cannot bind one concrete file.',
    );
  } else if (effectiveSecurity === 'allowlist') {
    codeStatus = 'restricted';
    codeSummary = 'Running scripts is restricted by allowlist rules.';
    codeReasons.push('Interpreter and runtime commands usually need explicit allowlist entries.');
  } else {
    codeStatus = 'available';
    codeSummary = 'Code execution inherits the current command execution policy and looks available.';
  }
  if (safeBins.some(isInterpreterLikeSafeBin)) {
    codeStatus = codeStatus === 'disabled' ? codeStatus : 'restricted';
    codeReasons.push('Interpreter/runtime binaries should not rely on safeBins alone.');
  }

  return {
    configPath: openclaw.configPath,
    approvalsPath,
    web: {
      status: webStatus,
      summary: webSummary,
      reasons: uniqueSortedStrings(webReasons),
      searchEnabled,
      searchProvider,
      searchConfigured,
      fetchEnabled: readBoolean(webFetch?.enabled, true),
      firecrawlConfigured,
    },
    exec: {
      currentAgentId: currentAgent.id,
      currentAgentName: currentAgent.name,
      toolProfile,
      execToolAvailable,
      hostApprovalsApply: usesHostApprovals,
      implicitSandboxFallback,
      status: execStatus,
      summary: execSummary,
      reasons: uniqueSortedStrings(execReasons),
      configuredHost,
      effectiveHost,
      sandboxMode,
      configSecurity,
      configAsk,
      approvalsExists: approvals != null,
      approvalsSecurity: resolvedApprovals.security,
      approvalsAsk: resolvedApprovals.ask,
      effectiveSecurity,
      effectiveAsk,
      allowlistCount: resolvedApprovals.allowlistCount,
      toolPolicyDenied,
      safeBins,
      safeBinTrustedDirs,
      trustedDirWarnings,
    },
    codeExecution: {
      status: codeStatus,
      summary: codeSummary,
      reasons: uniqueSortedStrings(codeReasons),
      inheritsFromExec: true,
    },
  };
}

export async function runOpenClawDoctor(): Promise<OpenClawDoctorResult> {
  const openclaw = resolveOpenClawPaths();
  try {
    const { stdout, stderr } = await runOpenClawCli(['doctor', '--json'], openclaw);
    try {
      const parsed = parseEmbeddedJsonValue(collectCliOutput([stdout, stderr])) as {
        ok?: boolean;
        checks?: unknown[];
        summary?: string;
      };
      const checks: OpenClawDoctorCheckResult[] = Array.isArray(parsed.checks)
        ? parsed.checks
          .filter((c): c is Record<string, unknown> => typeof c === 'object' && c != null)
          .map((c) => ({
            name: typeof c.name === 'string' ? c.name : 'unknown',
            status: typeof c.status === 'string' ? c.status : 'unknown',
            message: typeof c.message === 'string' ? c.message : undefined,
          }))
        : [];
      return {
        ok: parsed.ok === true,
        checks,
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      };
    } catch {
      // --json not supported or output not JSON; return raw stdout
      return {
        ok: true,
        checks: [],
        summary: '',
        raw: collectCliOutput([stdout, stderr]),
      };
    }
  } catch (error) {
    // doctor may exit non-zero when issues are found; try to parse stdout
    if (isExecFileError(error)) {
      const output = collectCliOutput([error.stdout, error.stderr]);
      if (output) {
        if (isUnsupportedJsonOptionOutput(output)) {
          // Fall through to the plain-text doctor invocation below for older OpenClaw versions.
        } else {
          try {
            const parsed = parseEmbeddedJsonValue(output) as {
              ok?: boolean;
              checks?: unknown[];
              summary?: string;
            };
            const checks: OpenClawDoctorCheckResult[] = Array.isArray(parsed.checks)
              ? parsed.checks
                .filter((c): c is Record<string, unknown> => typeof c === 'object' && c != null)
                .map((c) => ({
                  name: typeof c.name === 'string' ? c.name : 'unknown',
                  status: typeof c.status === 'string' ? c.status : 'unknown',
                  message: typeof c.message === 'string' ? c.message : undefined,
                }))
              : [];
            return {
              ok: parsed.ok === true,
              checks,
              summary: typeof parsed.summary === 'string' ? parsed.summary : '',
            };
          } catch {
            return {
              ok: false,
              checks: [],
              summary: '',
              raw: output,
            };
          }
        }
      }
    }
    // If --json is not supported, try without --json
    try {
      const { stdout, stderr } = await runOpenClawCli(['doctor'], openclaw);
      return {
        ok: true,
        checks: [],
        summary: '',
        raw: collectCliOutput([stdout, stderr]),
      };
    } catch (fallbackError) {
      if (isExecFileError(fallbackError)) {
        const output = collectCliOutput([fallbackError.stdout, fallbackError.stderr]);
        if (output) {
          return {
            ok: false,
            checks: [],
            summary: '',
            raw: output,
          };
        }
      }
      throw fallbackError instanceof Error ? fallbackError : formatOpenClawCliError(['doctor'], fallbackError);
    }
  }
}

export type OpenClawDoctorFixResult = {
  ok: boolean;
  summary: string;
  raw?: string;
};

export async function runOpenClawDoctorFix(): Promise<OpenClawDoctorFixResult> {
  const openclaw = resolveOpenClawPaths();
  try {
    const { stdout, stderr } = await runOpenClawCli(['doctor', '--fix'], openclaw);
    return {
      ok: true,
      summary: '',
      raw: collectCliOutput([stdout, stderr]),
    };
  } catch (error) {
    if (isExecFileError(error)) {
      const output = collectCliOutput([error.stdout, error.stderr]);
      if (output) {
        return {
          ok: false,
          summary: '',
          raw: output,
        };
      }
    }
    throw formatOpenClawCliError(['doctor', '--fix'], error);
  }
}

export async function restartOpenClawGateway(): Promise<OpenClawGatewayRestartResult> {
  const openclaw = resolveOpenClawPaths();
  const restart = await runOpenClawDaemonCommand(['gateway', 'restart', '--json'], openclaw);
  if (restart.result === 'not-loaded') {
    const start = await runOpenClawDaemonCommand(['gateway', 'start', '--json'], openclaw);
    if (start.result === 'not-loaded') {
      throw new Error(buildGatewayNotLoadedMessage(start));
    }
    return {
      action: 'started',
      result: start.result ?? 'started',
      message: start.message,
      warnings: start.warnings,
    };
  }

  return {
    action: 'restarted',
    result: restart.result ?? 'restarted',
    message: restart.message,
    warnings: restart.warnings,
  };
}

export function getOpenClawBootstrapPath(stateDir = getOpenClawStateDir()): string {
  return join(stateDir, 'devices', BOOTSTRAP_FILENAME);
}

export async function issueOpenClawBootstrapToken(params: {
  deviceId: string;
  publicKey: string;
  role: string;
  scopes: readonly string[];
  gatewayUrl?: string;
  stateDir?: string;
}): Promise<OpenClawBootstrapTokenResult> {
  const deviceId = params.deviceId.trim();
  const publicKey = params.publicKey.trim();
  const role = params.role.trim();
  const scopes = normalizeStringArray(params.scopes);
  if (!deviceId || !publicKey || !role || scopes.length === 0) {
    throw new Error('deviceId, publicKey, role, and scopes are required');
  }

  try {
    return await issueOpenClawPairingSetupToken({
      gatewayUrl: params.gatewayUrl,
      stateDir: params.stateDir,
    });
  } catch (error) {
    if (!isUnsupportedOpenClawPairingSetupCliError(error)) {
      throw error;
    }
  }

  return issueLegacyOpenClawBootstrapToken(params);
}

export async function issueLegacyOpenClawBootstrapToken(params: {
  deviceId: string;
  publicKey: string;
  role: string;
  scopes: readonly string[];
  gatewayUrl?: string;
  stateDir?: string;
}): Promise<OpenClawBootstrapTokenResult> {
  const deviceId = params.deviceId.trim();
  const publicKey = params.publicKey.trim();
  const role = params.role.trim();
  const scopes = normalizeStringArray(params.scopes);
  if (!deviceId || !publicKey || !role || scopes.length === 0) {
    throw new Error('deviceId, publicKey, role, and scopes are required');
  }

  return await withBootstrapLock(async () => {
    const stateDir = params.stateDir ?? getOpenClawStateDir();
    const statePath = getOpenClawBootstrapPath(stateDir);
    const state = await loadBootstrapState(statePath);
    const token = generatePairingToken();
    const issuedAtMs = Date.now();
    state[token] = {
      token,
      ts: issuedAtMs,
      deviceId,
      publicKey,
      roles: [role],
      scopes,
      issuedAtMs,
    };
    await writeJsonAtomic(statePath, state);
    return {
      token,
      expiresAtMs: issuedAtMs + DEVICE_BOOTSTRAP_TOKEN_TTL_MS,
      strategy: 'legacy-bound',
      statePath,
    };
  });
}

export async function issueOpenClawPairingSetupToken(params: {
  gatewayUrl?: string;
  stateDir?: string;
} = {}): Promise<OpenClawBootstrapTokenResult> {
  const openclaw = resolveOpenClawPaths();
  const gatewayUrl = params.gatewayUrl?.trim() || resolveGatewayUrl();
  const cliPaths = params.stateDir?.trim()
    ? { ...openclaw, stateDir: params.stateDir.trim() }
    : openclaw;
  const { stdout } = await runOpenClawCli(['qr', '--json', '--url', gatewayUrl], cliPaths);
  const parsed = parseEmbeddedJsonValue(stdout) as {
    setupCode?: unknown;
    access?: unknown;
  };
  const setupCode = typeof parsed.setupCode === 'string' ? parsed.setupCode.trim() : '';
  if (!setupCode) {
    throw new Error('OpenClaw qr --json did not return a setup code.');
  }
  const payload = decodeOpenClawPairingSetupCode(setupCode);
  const access = parsed.access === 'full' || parsed.access === 'limited' || parsed.access === 'node'
    ? parsed.access
    : undefined;
  return {
    token: payload.bootstrapToken,
    expiresAtMs: payload.expiresAtMs,
    strategy: 'mobile-setup',
    ...(access ? { access } : {}),
  };
}

function decodeOpenClawPairingSetupCode(setupCode: string): {
  bootstrapToken: string;
  expiresAtMs: number;
} {
  const encoded = setupCode.toLowerCase().startsWith('oc-pair://')
    ? setupCode.slice('oc-pair://'.length)
    : setupCode;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch (error) {
    throw new Error('OpenClaw qr --json returned an invalid setup code.', { cause: error });
  }
  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
  const bootstrapToken = typeof record?.bootstrapToken === 'string'
    ? record.bootstrapToken.trim()
    : '';
  const rawExpiresAtMs = record?.expiresAtMs;
  const expiresAtMs = typeof rawExpiresAtMs === 'number' && Number.isSafeInteger(rawExpiresAtMs)
    ? rawExpiresAtMs
    : Date.now() + DEVICE_BOOTSTRAP_TOKEN_TTL_MS;
  if (!bootstrapToken || expiresAtMs <= Date.now()) {
    throw new Error('OpenClaw qr --json returned an invalid or expired bootstrap credential.');
  }
  return { bootstrapToken, expiresAtMs };
}

function isUnsupportedOpenClawPairingSetupCliError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes('unknown command')
    || message.includes('unrecognized command')
    || message.includes('unknown option')
    || message.includes('invalid command')
    || message.includes('command not found');
}

function readConfiguredSecret(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isConfiguredSecretInput(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueSortedStrings(
    value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()),
  );
}

function uniqueSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort();
}

function resolveCurrentAgent(config: Record<string, unknown> | null): {
  id: string;
  name: string;
  record: Record<string, unknown> | null;
} {
  const agents = readRecord(config?.agents);
  const list = Array.isArray(agents?.list) ? agents.list : [];
  const entries = list
    .map((entry) => readRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry != null);
  const target = entries.find((entry) => entry.default === true)
    ?? entries.find((entry) => readString(entry.id) === 'main')
    ?? entries[0]
    ?? null;
  const id = readString(target?.id) ?? 'main';
  const name = readString(target?.name) ?? id;
  return { id, name, record: target };
}

function resolveToolProfile(
  globalTools: Record<string, unknown> | null,
  agentTools: Record<string, unknown> | null,
): 'minimal' | 'coding' | 'messaging' | 'full' | 'unset' {
  const raw = readString(agentTools?.profile) ?? readString(globalTools?.profile);
  return raw === 'minimal' || raw === 'coding' || raw === 'messaging' || raw === 'full'
    ? raw
    : 'unset';
}

function toolProfileAllowsExec(profile: 'minimal' | 'coding' | 'messaging' | 'full' | 'unset'): boolean {
  return profile === 'coding' || profile === 'full' || profile === 'unset';
}

function deniesExecTool(denyList: readonly string[]): boolean {
  const normalized = new Set(denyList.map((entry) => entry.trim().toLowerCase()).filter(Boolean));
  return normalized.has('*')
    || normalized.has('exec')
    || normalized.has('bash')
    || normalized.has('group:runtime');
}

function resolveMergedExecConfig(
  globalTools: Record<string, unknown> | null,
  agentTools: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const globalExec = readRecord(globalTools?.exec);
  const agentExec = readRecord(agentTools?.exec);
  if (!globalExec && !agentExec) {
    return null;
  }
  return {
    ...(globalExec ?? {}),
    ...(agentExec ?? {}),
  };
}

function readExecHost(value: unknown): 'sandbox' | 'gateway' | 'node' {
  return value === 'gateway' || value === 'node' || value === 'sandbox' ? value : 'sandbox';
}

function readSandboxMode(
  config: Record<string, unknown> | null,
  agentId = 'main',
): 'off' | 'non-main' | 'all' {
  const agents = readRecord(config?.agents);
  const defaults = readRecord(agents?.defaults);
  const defaultSandbox = readRecord(defaults?.sandbox);
  const list = Array.isArray(agents?.list) ? agents.list : [];
  const targetAgent = list.find((entry) => {
    const record = readRecord(entry);
    return readString(record?.id) === agentId;
  });
  const agentSandbox = readRecord(readRecord(targetAgent)?.sandbox);
  const value = readString(agentSandbox?.mode) ?? readString(defaultSandbox?.mode);
  return value === 'all' || value === 'non-main' || value === 'off' ? value : 'off';
}

function readExecSecurity(
  value: unknown,
  fallback: 'deny' | 'allowlist' | 'full',
): 'deny' | 'allowlist' | 'full' {
  return value === 'deny' || value === 'allowlist' || value === 'full' ? value : fallback;
}

function readExecAsk(
  value: unknown,
  fallback: 'off' | 'on-miss' | 'always',
): 'off' | 'on-miss' | 'always' {
  return value === 'off' || value === 'on-miss' || value === 'always' ? value : fallback;
}

function minExecSecurity(
  a: 'deny' | 'allowlist' | 'full',
  b: 'deny' | 'allowlist' | 'full',
): 'deny' | 'allowlist' | 'full' {
  const order = { deny: 0, allowlist: 1, full: 2 } as const;
  return order[a] <= order[b] ? a : b;
}

function maxExecAsk(
  a: 'off' | 'on-miss' | 'always',
  b: 'off' | 'on-miss' | 'always',
): 'off' | 'on-miss' | 'always' {
  const order = { off: 0, 'on-miss': 1, always: 2 } as const;
  return order[a] >= order[b] ? a : b;
}

function resolveWebSearchConfigured(
  webSearch: Record<string, unknown> | null,
  provider: string,
  configEnv: Record<string, string>,
): boolean {
  const braveKey =
    readConfiguredSecret(webSearch?.apiKey)
    ?? readConfigEnvValue(configEnv, 'BRAVE_API_KEY')
    ?? readEnvValue('BRAVE_API_KEY', 'BRAVE_API_KEY');
  const gemini = readRecord(webSearch?.gemini);
  const geminiKey =
    readConfiguredSecret(gemini?.apiKey)
    ?? readConfigEnvValue(configEnv, 'GEMINI_API_KEY')
    ?? readEnvValue('GEMINI_API_KEY', 'GEMINI_API_KEY');
  const grok = readRecord(webSearch?.grok);
  const grokKey =
    readConfiguredSecret(grok?.apiKey)
    ?? readConfigEnvValue(configEnv, 'XAI_API_KEY')
    ?? readEnvValue('XAI_API_KEY', 'XAI_API_KEY');
  const kimi = readRecord(webSearch?.kimi);
  const kimiKey =
    readConfiguredSecret(kimi?.apiKey)
    ?? readConfigEnvValue(configEnv, 'KIMI_API_KEY', 'MOONSHOT_API_KEY')
    ?? readConfigEnvValue(configEnv, 'MOONSHOT_API_KEY', 'KIMI_API_KEY')
    ?? readEnvValue('KIMI_API_KEY', 'MOONSHOT_API_KEY')
    ?? readEnvValue('MOONSHOT_API_KEY', 'KIMI_API_KEY');
  const perplexity = readRecord(webSearch?.perplexity);
  const perplexityKey =
    readConfiguredSecret(perplexity?.apiKey)
    ?? readConfigEnvValue(configEnv, 'PERPLEXITY_API_KEY', 'OPENROUTER_API_KEY')
    ?? readConfigEnvValue(configEnv, 'OPENROUTER_API_KEY', 'PERPLEXITY_API_KEY')
    ?? readEnvValue('PERPLEXITY_API_KEY', 'OPENROUTER_API_KEY')
    ?? readEnvValue('OPENROUTER_API_KEY', 'PERPLEXITY_API_KEY');

  const configuredByProvider: Record<string, boolean> = {
    brave: Boolean(braveKey),
    gemini: Boolean(geminiKey),
    grok: Boolean(grokKey),
    kimi: Boolean(kimiKey),
    perplexity: Boolean(perplexityKey),
  };

  if (provider !== 'auto') {
    return configuredByProvider[provider] === true;
  }

  return Object.values(configuredByProvider).some(Boolean);
}

function resolveFirecrawlConfigured(webFetch: Record<string, unknown> | null, configEnv: Record<string, string>): boolean {
  const firecrawl = readRecord(webFetch?.firecrawl);
  return Boolean(
    readConfiguredSecret(firecrawl?.apiKey)
    ?? readConfigEnvValue(configEnv, 'FIRECRAWL_API_KEY')
    ?? readEnvValue('FIRECRAWL_API_KEY', 'FIRECRAWL_API_KEY'),
  );
}

function readConfigEnvVars(config: Record<string, unknown> | null): Record<string, string> {
  const env = readRecord(config?.env);
  if (!env) {
    return {};
  }

  const vars = readRecord(env.vars);
  const result: Record<string, string> = {};
  if (vars) {
    for (const [key, value] of Object.entries(vars)) {
      const normalized = key.trim();
      if (!normalized) {
        continue;
      }
      const secret = readConfiguredSecret(value);
      if (secret) {
        result[normalized] = secret;
      }
    }
  }

  for (const [key, value] of Object.entries(env)) {
    if (key === 'vars' || key === 'shellEnv') {
      continue;
    }
    const normalized = key.trim();
    if (!normalized) {
      continue;
    }
    const secret = readConfiguredSecret(value);
    if (secret) {
      result[normalized] = secret;
    }
  }

  return result;
}

function readConfigEnvValue(configEnv: Record<string, string>, primary: string, legacy?: string): string | null {
  const current = configEnv[primary]?.trim();
  if (current) {
    return current;
  }
  if (!legacy) {
    return null;
  }
  const fallback = configEnv[legacy]?.trim();
  return fallback || null;
}

function resolveExecApprovalsSummary(
  approvals: Record<string, unknown> | null,
  overrides: {
    security: 'deny' | 'allowlist' | 'full';
    ask: 'off' | 'on-miss' | 'always';
  },
): {
  security: 'deny' | 'allowlist' | 'full';
  ask: 'off' | 'on-miss' | 'always';
  allowlistCount: number;
} {
  const defaults = readRecord(approvals?.defaults);
  const agents = readRecord(approvals?.agents);
  const wildcard = readRecord(agents?.['*']);
  const main = readRecord(agents?.main) ?? readRecord(agents?.default);
  const security = readExecSecurity(
    main?.security ?? wildcard?.security ?? defaults?.security,
    readExecSecurity(defaults?.security, overrides.security),
  );
  const ask = readExecAsk(
    main?.ask ?? wildcard?.ask ?? defaults?.ask,
    readExecAsk(defaults?.ask, overrides.ask),
  );
  const allowlistEntries = [
    ...readAllowlistEntries(wildcard?.allowlist),
    ...readAllowlistEntries(main?.allowlist),
  ];
  return {
    security,
    ask,
    allowlistCount: uniqueSortedStrings(allowlistEntries.map((entry) => entry.pattern)).length,
  };
}

function readAllowlistEntries(value: unknown): Array<{ pattern: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  const entries: Array<{ pattern: string }> = [];
  for (const entry of value) {
    const record = readRecord(entry);
    const pattern = readString(record?.pattern);
    if (pattern) {
      entries.push({ pattern });
    }
  }
  return entries;
}

function isInterpreterLikeSafeBin(value: string): boolean {
  const normalized = value.trim().toLowerCase().split(/[\\/]/).at(-1) ?? '';
  if (!normalized) {
    return false;
  }
  if (
    [
      'ash',
      'bash',
      'bun',
      'cmd',
      'cmd.exe',
      'dash',
      'deno',
      'fish',
      'ksh',
      'lua',
      'node',
      'nodejs',
      'perl',
      'php',
      'powershell',
      'powershell.exe',
      'pypy',
      'pwsh',
      'pwsh.exe',
      'python',
      'python2',
      'python3',
      'ruby',
      'sh',
      'zsh',
    ].includes(normalized)
  ) {
    return true;
  }
  return /^(python|ruby|perl|php|node)\d+(?:\.\d+)?$/.test(normalized);
}

async function readOpenClawConfigString(
  configPath: string,
  openclaw = resolveOpenClawPaths(),
): Promise<string | null> {
  try {
    const { stdout } = await runOpenClawCli(['config', 'get', configPath], openclaw);
    const trimmed = stdout.trim();
    return trimmed || null;
  } catch (error) {
    if (isMissingConfigPathError(error)) {
      return null;
    }
    throw error;
  }
}

async function readOpenClawAllowedOrigins(openclaw = resolveOpenClawPaths()): Promise<string[]> {
  try {
    const { stdout } = await runOpenClawCli(['config', 'get', 'gateway.controlUi.allowedOrigins', '--json'], openclaw);
    const parsed = parseEmbeddedJsonValue(stdout) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean)
      : [];
  } catch (error) {
    if (isMissingConfigPathError(error)) {
      return [];
    }
    throw error;
  }
}

async function runOpenClawDaemonCommand(
  args: string[],
  openclaw = resolveOpenClawPaths(),
): Promise<{
  result?: string;
  message: string | null;
  warnings: string[];
  hints: string[];
}> {
  const { stdout } = await runOpenClawCli(args, openclaw);
  let parsed: {
    ok?: boolean;
    error?: string;
    result?: string;
    message?: string;
    warnings?: unknown;
    hints?: unknown;
  };
  try {
    parsed = parseEmbeddedJsonValue(stdout) as typeof parsed;
  } catch (error) {
    throw new Error(`OpenClaw ${args.slice(0, 2).join(' ')} returned invalid JSON output.`, { cause: error });
  }
  if (parsed.ok !== true) {
    throw new Error(parsed.error?.trim() || `OpenClaw ${args.slice(0, 2).join(' ')} failed.`);
  }
  return {
    result: typeof parsed.result === 'string' ? parsed.result : undefined,
    message: typeof parsed.message === 'string' ? parsed.message : null,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((value): value is string => typeof value === 'string') : [],
    hints: Array.isArray(parsed.hints) ? parsed.hints.filter((value): value is string => typeof value === 'string') : [],
  };
}

async function runOpenClawCli(
  args: string[],
  openclaw = resolveOpenClawPaths(),
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await new Promise<{ stdout: string; stderr: string }>((resolvePromise, rejectPromise) => {
      execFile(OPENCLAW_CLI_COMMAND, args, {
        encoding: 'utf8',
        env: {
          ...process.env,
          OPENCLAW_STATE_DIR: openclaw.stateDir,
          OPENCLAW_CONFIG_PATH: openclaw.configPath,
        },
        maxBuffer: 1024 * 1024,
      }, (error, stdout, stderr) => {
        if (error) {
          Object.assign(error, {
            stdout,
            stderr,
          });
          rejectPromise(error);
          return;
        }
        resolvePromise({ stdout, stderr });
      });
    });
  } catch (error) {
    throw preserveExecFileErrorDetails(formatOpenClawCliError(args, error), error);
  }
}

function formatOpenClawCliError(args: string[], error: unknown): Error {
  const messagePrefix = `OpenClaw ${args.join(' ')}`;
  if (isExecFileError(error)) {
    if (error.code === 'ENOENT') {
      return new Error(`OpenClaw CLI was not found on PATH. Install OpenClaw and ensure \`${OPENCLAW_CLI_COMMAND}\` is available before running local pairing.`);
    }
    const combined = [error.stderr, error.stdout]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join('\n')
      .trim();
    return new Error(combined ? `${messagePrefix} failed: ${combined}` : `${messagePrefix} failed.`);
  }
  return error instanceof Error ? error : new Error(`${messagePrefix} failed: ${String(error)}`);
}

function preserveExecFileErrorDetails(formatted: Error, original: unknown): Error {
  if (!isExecFileError(original)) {
    return formatted;
  }
  return Object.assign(formatted, {
    code: original.code,
    stdout: original.stdout,
    stderr: original.stderr,
  });
}

function isMissingConfigPathError(error: unknown): boolean {
  return error instanceof Error && /Config path not found:/i.test(error.message);
}

function isExecFileError(error: unknown): error is Error & {
  code?: string | number;
  stdout?: string;
  stderr?: string;
} {
  return error instanceof Error;
}

function normalizeControlUiOrigin(origin: string): string {
  const parsed = new URL(origin.trim());
  return parsed.origin;
}

function appendUniqueOrigin(currentOrigins: string[], nextOrigin: string): string[] {
  const normalizedNext = normalizeControlUiOrigin(nextOrigin).toLowerCase();
  const seen = new Set<string>();
  const seenInvalid = new Set<string>();
  const result: string[] = [];

  for (const origin of currentOrigins) {
    const trimmed = origin.trim();
    if (!trimmed) {
      continue;
    }
    let normalized: string;
    try {
      normalized = normalizeControlUiOrigin(trimmed).toLowerCase();
    } catch {
      const invalidKey = trimmed.toLowerCase();
      if (seenInvalid.has(invalidKey)) {
        continue;
      }
      seenInvalid.add(invalidKey);
      result.push(trimmed);
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized === normalizedNext ? normalizeControlUiOrigin(nextOrigin) : normalizeControlUiOrigin(trimmed));
  }

  if (!seen.has(normalizedNext)) {
    result.push(normalizeControlUiOrigin(nextOrigin));
  }

  return result;
}

function buildGatewayNotLoadedMessage(result: {
  message: string | null;
  hints: string[];
}): string {
  const parts = [
    'OpenClaw Gateway is not running under a managed service, and no unmanaged gateway process could be restarted automatically.',
  ];
  if (result.message) {
    parts.push(result.message);
  }
  if (result.hints.length > 0) {
    parts.push(result.hints.join(' '));
  }
  parts.push('Start the Gateway first, then rerun `clawket pair --local`.');
  return parts.join(' ');
}

function parseEmbeddedJsonValue(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Empty JSON output');
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char !== '{' && char !== '[') {
      continue;
    }
    const candidate = extractBalancedJsonValue(trimmed, index);
    if (!candidate) {
      continue;
    }
    try {
      return JSON.parse(candidate);
    } catch {
      // keep scanning
    }
  }

  throw new Error('Unable to locate a JSON value in command output.');
}

function extractBalancedJsonValue(text: string, startIndex: number): string | null {
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === '\\') {
        escaping = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{' || char === '[') {
      depth += 1;
      continue;
    }
    if (char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
      if (depth < 0) {
        return null;
      }
    }
  }

  return null;
}

function readGatewayTokenEnv(): string | null {
  return readEnvValue('OPENCLAW_GATEWAY_TOKEN', 'CLAWDBOT_GATEWAY_TOKEN');
}

function readGatewayPasswordEnv(): string | null {
  return readEnvValue('OPENCLAW_GATEWAY_PASSWORD', 'CLAWDBOT_GATEWAY_PASSWORD');
}

function readGatewayPortEnv(): number | null {
  const raw = readEnvValue('OPENCLAW_GATEWAY_PORT', 'CLAWDBOT_GATEWAY_PORT');
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function readEnvValue(primary: string, legacy: string): string | null {
  const current = process.env[primary]?.trim();
  if (current) return current;
  const fallback = process.env[legacy]?.trim();
  return fallback || null;
}

function resolveOpenClawPaths(): OpenClawPaths {
  const stateDir = resolveActiveOpenClawStateDir();
  const configPath = resolveActiveOpenClawConfigPath(stateDir);
  return {
    stateDir,
    configDir: dirname(configPath),
    configPath,
    mediaDir: join(stateDir, 'media'),
  };
}

function resolveOpenClawExecApprovalsPath(): string {
  return join(resolveOpenClawHomeDir(), '.openclaw', 'exec-approvals.json');
}

function resolveActiveOpenClawStateDir(): string {
  const explicitStateDir = readEnvValue('OPENCLAW_STATE_DIR', 'CLAWDBOT_STATE_DIR');
  if (explicitStateDir) {
    return resolveUserPath(explicitStateDir);
  }

  const candidates = buildOpenClawStateDirCandidates();
  const existing = candidates.find((stateDir) => existsSync(join(stateDir, 'openclaw.json')));
  return existing ?? candidates[0] ?? join(homedir(), '.openclaw');
}

function resolveActiveOpenClawConfigPath(stateDir: string): string {
  const explicitConfigPath = readEnvValue('OPENCLAW_CONFIG_PATH', 'CLAWDBOT_CONFIG_PATH');
  if (explicitConfigPath) {
    return resolveUserPath(explicitConfigPath);
  }

  return join(stateDir, 'openclaw.json');
}

function buildOpenClawStateDirCandidates(): string[] {
  const seen = new Set<string>();
  return [homedir(), '/root']
    .map((value) => value.trim())
    .filter(Boolean)
    .map((home) => join(home, '.openclaw'))
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function resolveOpenClawHomeDir(): string {
  const explicitHome = process.env.OPENCLAW_HOME?.trim();
  if (explicitHome) {
    return resolveUserPath(explicitHome);
  }
  const envHome = process.env.HOME?.trim();
  if (envHome) {
    return resolveUserPath(envHome);
  }
  const userProfile = process.env.USERPROFILE?.trim();
  if (userProfile) {
    return resolveUserPath(userProfile);
  }
  return resolve(homedir());
}

function resolveUserPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed === '~') {
    return resolve(homedir());
  }
  if (trimmed.startsWith('~/')) {
    return resolve(join(homedir(), trimmed.slice(2)));
  }
  return resolve(trimmed);
}

async function loadBootstrapState(statePath: string): Promise<DeviceBootstrapStateFile> {
  const state = await readJsonFile<DeviceBootstrapStateFile>(statePath) ?? {};
  const now = Date.now();
  for (const [token, entry] of Object.entries(state)) {
    if (!entry || typeof entry !== 'object') {
      delete state[token];
      continue;
    }
    if (typeof entry.ts !== 'number' && typeof entry.issuedAtMs === 'number') {
      entry.ts = entry.issuedAtMs;
    }
    if (now - entry.ts > DEVICE_BOOTSTRAP_TOKEN_TTL_MS) {
      delete state[token];
    }
  }
  return state;
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const payload = JSON.stringify(value, null, 2);
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const tmpPath = `${filePath}.${randomUUIDFragment()}.tmp`;
  try {
    await writeFile(tmpPath, payload, { encoding: 'utf8', mode: 0o600 });
    await safeChmod(tmpPath, 0o600);
    await rename(tmpPath, filePath);
    await safeChmod(filePath, 0o600);
  } finally {
    await rm(tmpPath, { force: true }).catch(() => undefined);
  }
}

async function safeChmod(filePath: string, mode: number): Promise<void> {
  try {
    await chmod(filePath, mode);
  } catch {
    // best-effort only
  }
}

function generatePairingToken(): string {
  return randomBytes(PAIRING_TOKEN_BYTES).toString('base64url');
}

function normalizeStringArray(values: readonly string[]): string[] {
  const normalized = new Set<string>();
  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) {
      normalized.add(trimmed);
    }
  }
  return [...normalized].sort();
}

function randomUUIDFragment(): string {
  return randomBytes(12).toString('hex');
}

function createAsyncLock() {
  let lock: Promise<void> = Promise.resolve();
  return async function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = lock;
    let release: (() => void) | undefined;
    lock = new Promise<void>((resolveLock) => {
      release = resolveLock;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release?.();
    }
  };
}
