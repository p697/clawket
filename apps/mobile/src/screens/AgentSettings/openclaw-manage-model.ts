import type {
  AdapterErrorCode,
  AgentAdapter,
  ConfigView,
  PermissionStatus,
} from '@clawket/agent-protocol';

export type OpenClawManageTab =
  | 'configuration'
  | 'permissions'
  | 'diagnostics'
  | 'backups';

export type OpenClawManageSupport = Readonly<{
  root: boolean;
  configuration: boolean;
  configurationWrite: boolean;
  permissions: boolean;
  approvals: boolean;
  diagnostics: boolean;
  diagnosticRepair: boolean;
  backups: boolean;
  backupCreate: boolean;
  backupRestore: boolean;
}>;

const MANAGEMENT_ERROR_KEYS: Readonly<Record<AdapterErrorCode, string>> = {
  bridge_offline: 'Bridge is not running on your computer',
  gateway_offline: 'OpenClaw is not responding',
  pairing_required: 'Pairing expired, pair again',
  pairing_expired: 'Pairing expired, pair again',
  unauthorized: 'Sign-in expired',
  network: 'No network',
  timeout: 'Connection timed out',
  rate_limited: 'Too many requests, try again later',
  frame_too_large: 'Message too large to send',
  unsupported: 'Not supported by this backend',
  server: 'Server error',
};

const PERMISSION_STATUS_KEYS: Readonly<Record<PermissionStatus, string>> = {
  available: 'Available',
  needs_approval: 'Every Command',
  restricted: 'Allowlist',
  disabled: 'Blocked',
  configuration_needed: 'Not set',
};

export function resolveOpenClawManageSupport(
  adapter: AgentAdapter,
): OpenClawManageSupport {
  const { capabilities, management } = adapter;
  const config = management?.config;
  const root = capabilities.configManage && Boolean(config);
  const permissions = root
    && capabilities.permissions
    && Boolean(config?.permissions);
  const approvals = root
    && capabilities.execApproval
    && Boolean(management?.approvals?.resolveExec);
  const diagnostics = root
    && capabilities.diagnostics
    && Boolean(config?.doctor);
  const backups = root
    && capabilities.backups
    && Boolean(config?.backups?.list);

  return {
    root,
    configuration: root && Boolean(config?.view),
    configurationWrite: root && Boolean(config?.set),
    permissions,
    approvals,
    diagnostics,
    diagnosticRepair: diagnostics && Boolean(config?.repair),
    backups,
    backupCreate: backups && Boolean(config?.backups?.create),
    backupRestore: backups && Boolean(config?.backups?.restore),
  };
}

export function isOpenClawManageTabSupported(
  support: OpenClawManageSupport,
  tab: OpenClawManageTab,
): boolean {
  if (tab === 'permissions') return support.permissions || support.approvals;
  return support[tab];
}

export function serializeConfigView(view: ConfigView): string {
  return view.config ? JSON.stringify(view.config, null, 2) : '';
}

export function normalizeConfigDraft(raw: string): string {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SyntaxError('Configuration must be a JSON object.');
  }
  return JSON.stringify(parsed, null, 2);
}

export function permissionStatusKey(status: PermissionStatus): string {
  return PERMISSION_STATUS_KEYS[status];
}

export function managementErrorKey(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code in MANAGEMENT_ERROR_KEYS
    ? MANAGEMENT_ERROR_KEYS[code as AdapterErrorCode]
    : null;
}

export function managementErrorDetail(error: unknown, fallback: string): string {
  if (typeof error === 'string') return error.trim() || fallback;
  if (error instanceof Error) return error.message.trim() || fallback;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  return fallback;
}

/** Bound the reader UI even if an adapter fails to settle; late results cannot replace the retry. */
export async function withManagementDeadline<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([request, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Management request timed out (35s).')), 35_000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}
