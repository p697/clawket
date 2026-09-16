import {
  AdapterError,
  CAPABILITY_MATRIX,
  type AgentAdapter,
  type ManagementOperations,
} from '@clawket/agent-protocol';

import {
  withManagementDeadline,
  isOpenClawManageTabSupported,
  managementErrorDetail,
  managementErrorKey,
  normalizeConfigDraft,
  permissionStatusKey,
  resolveOpenClawManageSupport,
  serializeConfigView,
} from './openclaw-manage-model';

function adapterWith(
  management: ManagementOperations | undefined,
  capabilities = CAPABILITY_MATRIX.openclaw,
  backendKind: 'openclaw' | 'hermes' = 'openclaw',
): AgentAdapter {
  return {
    connection: {
      id: 'studio',
      backendKind,
      transportKind: 'relay',
      label: 'Studio',
      createdAt: 1,
      isFreeSlot: true,
    },
    capabilities,
    state: 'ready',
    management,
  } as AgentAdapter;
}

function completeManagement(): ManagementOperations {
  const noop = async () => undefined;
  return {
    config: {
      view: async () => ({ config: {}, hash: 'hash' }),
      set: async () => ({ ok: true }),
      permissions: async () => ({}) as never,
      doctor: async () => ({ ok: true, checks: [], summary: '' }),
      repair: async () => ({ ok: true, summary: '' }),
      backups: {
        list: async () => [],
        create: async () => ({ id: 'one', createdAt: 1 }),
        restore: noop,
      },
    },
    approvals: { resolveExec: noop },
  };
}

describe('openclaw manage model', () => {
  it('requires both declared capabilities and concrete management operations', () => {
    const complete = resolveOpenClawManageSupport(adapterWith(completeManagement()));
    expect(complete).toEqual({
      root: true,
      configuration: true,
      configurationWrite: true,
      permissions: true,
      approvals: true,
      diagnostics: true,
      diagnosticRepair: true,
      backups: true,
      backupCreate: true,
      backupRestore: true,
    });
    expect(isOpenClawManageTabSupported(complete, 'permissions')).toBe(true);

    const downgraded = resolveOpenClawManageSupport(adapterWith(
      completeManagement(),
      { ...CAPABILITY_MATRIX.openclaw, permissions: false, backups: false },
    ));
    expect(downgraded.permissions).toBe(false);
    expect(downgraded.approvals).toBe(true);
    expect(downgraded.backups).toBe(false);

    const missingOperations = resolveOpenClawManageSupport(adapterWith({ config: {} }));
    expect(missingOperations.configuration).toBe(false);
    expect(missingOperations.diagnostics).toBe(false);
    expect(missingOperations.backups).toBe(false);
  });

  it('hides the management surface when runtime capability metadata downgrades it', () => {
    const support = resolveOpenClawManageSupport(adapterWith(
      completeManagement(),
      { ...CAPABILITY_MATRIX.openclaw, configManage: false },
    ));
    expect(support.root).toBe(false);
    expect(Object.values(support).every((value) => value === false)).toBe(true);
  });

  it('normalizes object JSON and rejects non-object config drafts', () => {
    expect(normalizeConfigDraft('{"theme":"dark"}')).toBe(
      '{\n  "theme": "dark"\n}',
    );
    expect(() => normalizeConfigDraft('[]')).toThrow(SyntaxError);
    expect(() => normalizeConfigDraft('{')).toThrow(SyntaxError);
    expect(serializeConfigView({ config: { ok: true }, hash: 'hash' })).toContain(
      '"ok": true',
    );
    expect(serializeConfigView({ config: null, hash: null })).toBe('');
  });

  it('maps permission states and adapter error codes without hiding raw details', () => {
    expect(permissionStatusKey('needs_approval')).toBe('Every Command');
    expect(permissionStatusKey('configuration_needed')).toBe('Not set');
    expect(managementErrorKey(new AdapterError('timeout', 'slow'))).toBe(
      'Connection timed out',
    );
    expect(managementErrorDetail(new Error('specific failure'), 'fallback')).toBe(
      'specific failure',
    );
    expect(managementErrorDetail(null, 'fallback')).toBe('fallback');
  });
});

describe('management read deadline', () => {
  afterEach(() => jest.useRealTimers());

  it('settles an unresponsive request and clears its deadline', async () => {
    jest.useFakeTimers();
    const result = withManagementDeadline(new Promise(() => {}));
    const assertion = expect(result).rejects.toThrow('Management request timed out (35s).');
    await jest.advanceTimersByTimeAsync(35_000);
    await assertion;
    expect(jest.getTimerCount()).toBe(0);
  });

  it('preserves results and failures without leaving timers behind', async () => {
    jest.useFakeTimers();
    await expect(withManagementDeadline(Promise.resolve({ ok: true }))).resolves.toEqual({ ok: true });
    await expect(withManagementDeadline(Promise.reject(new Error('offline')))).rejects.toThrow('offline');
    expect(jest.getTimerCount()).toBe(0);
  });
});
