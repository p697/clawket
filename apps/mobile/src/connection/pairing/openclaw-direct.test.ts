import { buildOpenClawDirectRecord, connectOpenClawDirect, normalizeOpenClawDirectUrl, classifyOpenClawDirectFailure } from './openclaw-direct';

const draft = { mode: 'local', url: 'ws://192.168.1.2:18789', authMethod: 'token', credential: 'secret' } as const;
const descriptor = (id: string, backendKind = 'openclaw', transportKind = 'local') => ({ id, backendKind, transportKind, label: 'My computer' });
function runtime(records: Array<{ id: string; backendKind: string; transportKind: string; url: string }> = []) {
  const state = { connections: records.map(r => descriptor(r.id, r.backendKind, r.transportKind)), activeConnectionId: null as string | null };
  return {
    getSnapshot: () => state,
    getRuntimeConnectionRecord: jest.fn(async (id: string) => records.find(r => r.id === id)),
    replaceConnection: jest.fn(async (id: string) => descriptor(id)),
    addConnection: jest.fn(async () => { state.activeConnectionId = 'new'; return descriptor('new'); }),
    activate: jest.fn(async (id: string) => { state.activeConnectionId = id; }),
    probeActive: jest.fn(async () => true),
    pauseConnection: jest.fn(async () => { state.activeConnectionId = null; }),
  };
}
const connect = (r: ReturnType<typeof runtime>, overrides = {}) => connectOpenClawDirect({ runtime: r as never, draft, isCurrent: () => true, onSaved: jest.fn(), ...overrides });

describe('OpenClaw direct connections', () => {
  it.each([
    ['192.168.1.2:18789', 'ws://192.168.1.2:18789/'],
    ['http://host.local:18789/socket', 'ws://host.local:18789/socket'],
    ['https://machine.tailnet.ts.net', 'wss://machine.tailnet.ts.net/'],
    ['ws://100.64.0.1:18789', 'ws://100.64.0.1:18789/'],
    ['ws://[fd7a:115c:a1e0::1]:18789', 'ws://[fd7a:115c:a1e0::1]:18789/'],
  ])('normalizes %s without downgrading TLS', (input, output) => expect(normalizeOpenClawDirectUrl(input)).toBe(output));
  it.each(['', 'ftp://host', 'ws://a:b@host', 'ws://host?token=secret', 'ws://host#secret', 'ws://host:99999', 'ws://bad host', 'wss://'])('rejects unsafe or malformed input %s', input => {
    expect(() => normalizeOpenClawDirectUrl(input)).toThrow('invalid_direct_url');
  });
  it('saves one credential and keeps backend separate from each transport', () => {
    for (const mode of ['local', 'tailscale', 'custom'] as const) {
      const record = buildOpenClawDirectRecord({ ...draft, mode, authMethod: 'password', credential: ' password ' });
      expect(record).toMatchObject({ backendKind: 'openclaw', transportKind: mode, auth: { password: 'password' } });
      expect(record.auth?.token).toBeUndefined();
    }
    expect(() => buildOpenClawDirectRecord({ ...draft, credential: '  ' })).toThrow('missing_direct_credential');
  });
  it('reuses an endpoint and replaces obsolete auth, preserving its label', async () => {
    const r = runtime([{ id: 'old', backendKind: 'openclaw', transportKind: 'tailscale', url: draft.url + '/' }]);
    await connect(r, { draft: { ...draft, authMethod: 'password', credential: 'new-password' } });
    expect(r.replaceConnection).toHaveBeenCalledWith('old', expect.objectContaining({ auth: { password: 'new-password' }, label: 'My computer' }));
    expect(r.addConnection).not.toHaveBeenCalled();
    expect(r.activate).toHaveBeenCalledWith('old');
  });
  it('does not overwrite Relay or another backend, even with a retry ID', async () => {
    const r = runtime([{ id: 'relay', backendKind: 'openclaw', transportKind: 'relay', url: draft.url }, { id: 'hermes', backendKind: 'hermes', transportKind: 'local', url: draft.url }]);
    await connect(r, { retryConnectionId: 'relay' });
    expect(r.getRuntimeConnectionRecord).not.toHaveBeenCalled();
    expect(r.addConnection).toHaveBeenCalled();
  });
  it('retires a saved but cancelled first connection before it can activate', async () => {
    const r = runtime(); let current = true;
    r.addConnection.mockImplementation(async () => { current = false; r.getSnapshot().activeConnectionId = 'new'; return descriptor('new'); });
    expect(await connect(r, { isCurrent: () => current })).toBeNull();
    expect(r.pauseConnection).toHaveBeenCalledWith('new');
    expect(r.activate).not.toHaveBeenCalled();
  });
  it('does not pause an unrelated connection when an old probe finishes after leaving', async () => {
    const r = runtime(); let current = true;
    r.probeActive.mockImplementation(async () => { current = false; r.getSnapshot().activeConnectionId = 'other'; return true; });
    expect(await connect(r, { isCurrent: () => current })).toBeNull();
    expect(r.pauseConnection).not.toHaveBeenCalled();
  });
  it('never lets a timed-out probe pause a newer retry of the same saved connection', async () => {
    const r = runtime([{ id: 'old', backendKind: 'openclaw', transportKind: 'local', url: draft.url }]);
    let current = true; let finish!: (value: boolean) => void; let entered!: () => void;
    const probing = new Promise<void>(resolve => { entered = resolve; });
    r.probeActive.mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve; entered(); }));
    const oldAttempt = connect(r, { isCurrent: () => current });
    await probing; current = false;
    await connect(r); finish(true);
    expect(await oldAttempt).toBeNull(); expect(r.pauseConnection).not.toHaveBeenCalled();
  });
  it.each([
    [{ message: 'pairing required' }, 'pairing_required'],
    [{ code: 'PAIRING_REQUIRED' }, 'pairing_required'],
    [{ message: 'auth_rejected: token mismatch' }, 'unauthorized'],
    [new Error('invalid token'), 'unauthorized'],
    [{ message: 'Gateway connection timeout' }, 'network'],
    [new Error('other raw private details'), 'server'],
  ])('classifies Gateway failures without displaying raw details', (error, category) => {
    expect(classifyOpenClawDirectFailure(error)).toBe(category);
  });

});
