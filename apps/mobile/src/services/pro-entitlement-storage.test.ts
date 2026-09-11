import {
  FIRST_3_0_GRACE_PERIOD_MS,
  FREE_CONNECTION_SWITCH_INTERVAL_MS,
  canUseConnection,
} from '../utils/pro';
import {
  ProEntitlementStore,
  createInitialProEntitlementState,
  createProEntitlementStorageKey,
  reconcileProEntitlementState,
  resolveFreeConnectionSwitch,
  type PersistedProEntitlementState,
  type ProEntitlementSecureStorage,
} from './pro-entitlement-storage';

const DAY = 24 * 60 * 60 * 1_000;
const NOW = 2_000_000;

class MemorySecureStorage implements ProEntitlementSecureStorage {
  readonly values = new Map<string, string>();
  readonly writes: Array<{ key: string; value: string }> = [];
  failNextWrite = false;

  async getItemAsync(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setItemAsync(key: string, value: string): Promise<void> {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('secure write failed');
    }
    this.values.set(key, value);
    this.writes.push({ key, value });
  }
}

function persisted(
  overrides: Partial<PersistedProEntitlementState> = {},
): PersistedProEntitlementState {
  return {
    version: 1,
    freeConnectionId: 'home',
    lastFreeConnectionSwitchAt: null,
    graceEvaluatedAt: NOW,
    graceUntil: null,
    ...overrides,
  };
}

function resolveInput(overrides: Partial<Parameters<ProEntitlementStore['resolve']>[0]> = {}) {
  return {
    deviceId: 'device-a',
    isPro: false,
    connectionIds: ['home', 'work'],
    activeConnectionId: 'work',
    hasNonMainAgentSession: false,
    now: NOW,
    ...overrides,
  };
}

describe('pure Pro entitlement transitions', () => {
  it('selects the active connection and grants exactly 14 days for eligible upgrades', () => {
    const state = createInitialProEntitlementState(resolveInput());
    expect(state).toEqual({
      version: 1,
      freeConnectionId: 'work',
      lastFreeConnectionSwitchAt: null,
      graceEvaluatedAt: NOW,
      graceUntil: NOW + 14 * DAY,
    });
    expect(state.graceUntil).toBe(NOW + FIRST_3_0_GRACE_PERIOD_MS);
  });

  it('also grants grace for non-main cached history with one connection', () => {
    expect(createInitialProEntitlementState(resolveInput({
      connectionIds: ['home'],
      activeConnectionId: 'home',
      hasNonMainAgentSession: true,
    })).graceUntil).toBe(NOW + FIRST_3_0_GRACE_PERIOD_MS);
  });

  it('does not grant grace to Pro, ineligible, or corruption-recovery states', () => {
    expect(createInitialProEntitlementState(resolveInput({ isPro: true })).graceUntil).toBeNull();
    expect(createInitialProEntitlementState(resolveInput({
      connectionIds: ['home'],
      activeConnectionId: 'home',
    })).graceUntil).toBeNull();
    expect(createInitialProEntitlementState({ ...resolveInput(), allowGrace: false }).graceUntil).toBeNull();
  });

  it('uses the sole connection when the active id is unavailable and normalizes ids', () => {
    expect(createInitialProEntitlementState(resolveInput({
      connectionIds: [' ', ' home ', 'home'],
      activeConnectionId: 'missing',
    })).freeConnectionId).toBe('home');
    expect(createInitialProEntitlementState(resolveInput({
      connectionIds: [],
      activeConnectionId: null,
    })).freeConnectionId).toBeNull();
  });

  it('selects the current active connection when Pro expires without a free selection', () => {
    const state = persisted({ freeConnectionId: null });
    expect(reconcileProEntitlementState(state, {
      isPro: false,
      connectionIds: ['home', 'work'],
      activeConnectionId: 'work',
    }).freeConnectionId).toBe('work');
  });

  it('retains an existing selection on Pro expiry and clears a removed one while Pro', () => {
    const state = persisted();
    expect(reconcileProEntitlementState(state, {
      isPro: false,
      connectionIds: ['home', 'work'],
      activeConnectionId: 'work',
    })).toBe(state);
    expect(reconcileProEntitlementState(state, {
      isPro: true,
      connectionIds: ['work'],
      activeConnectionId: 'work',
    }).freeConnectionId).toBeNull();
  });

  it('switches once per 24 hours and makes the old connection lock immediately', () => {
    const first = resolveFreeConnectionSwitch(persisted(), {
      isPro: false,
      connectionIds: ['home', 'work'],
      targetConnectionId: 'work',
      now: NOW,
    });
    expect(first).toMatchObject({
      ok: true,
      changed: true,
      nextSwitchAt: NOW + FREE_CONNECTION_SWITCH_INTERVAL_MS,
    });
    if (!first.ok) throw new Error('Expected first switch to succeed.');
    expect(canUseConnection({ id: 'home' }, {
      isPro: false,
      graceUntil: null,
      now: NOW,
      freeConnectionId: first.state.freeConnectionId,
    })).toBe(false);

    expect(resolveFreeConnectionSwitch(first.state, {
      isPro: false,
      connectionIds: ['home', 'work'],
      targetConnectionId: 'home',
      now: NOW + FREE_CONNECTION_SWITCH_INTERVAL_MS - 1,
    })).toMatchObject({
      ok: false,
      reason: 'cooldown',
      retryAt: NOW + FREE_CONNECTION_SWITCH_INTERVAL_MS,
    });

    expect(resolveFreeConnectionSwitch(first.state, {
      isPro: false,
      connectionIds: ['home', 'work'],
      targetConnectionId: 'home',
      now: NOW + FREE_CONNECTION_SWITCH_INTERVAL_MS,
    })).toMatchObject({ ok: true, changed: true, state: { freeConnectionId: 'home' } });
  });

  it('does not consume a switch for the current selection', () => {
    expect(resolveFreeConnectionSwitch(persisted(), {
      isPro: false,
      connectionIds: ['home', 'work'],
      targetConnectionId: 'home',
      now: NOW,
    })).toEqual({
      ok: true,
      changed: false,
      state: persisted(),
      nextSwitchAt: null,
    });
    expect(resolveFreeConnectionSwitch(persisted({ lastFreeConnectionSwitchAt: NOW - DAY }), {
      isPro: false,
      connectionIds: ['home', 'work'],
      targetConnectionId: 'home',
      now: NOW,
    })).toMatchObject({ ok: true, changed: false, nextSwitchAt: NOW });
  });

  it('rejects Pro and unknown-target switching', () => {
    expect(resolveFreeConnectionSwitch(persisted(), {
      isPro: true,
      connectionIds: ['home', 'work'],
      targetConnectionId: 'work',
      now: NOW,
    })).toMatchObject({ ok: false, reason: 'pro_active', retryAt: null });
    expect(resolveFreeConnectionSwitch(persisted(), {
      isPro: false,
      connectionIds: ['home'],
      targetConnectionId: 'missing',
      now: NOW,
    })).toMatchObject({ ok: false, reason: 'unknown_connection', retryAt: null });
  });

  it('rejects invalid timestamps instead of weakening the cooldown', () => {
    expect(() => createInitialProEntitlementState({ ...resolveInput(), now: -1 })).toThrow(
      'now must be a non-negative safe integer.',
    );
    expect(() => resolveFreeConnectionSwitch(persisted(), {
      isPro: false,
      connectionIds: ['home', 'work'],
      targetConnectionId: 'work',
      now: Number.NaN,
    })).toThrow('now must be a non-negative safe integer.');
  });
});

describe('ProEntitlementStore persistence', () => {
  it('scopes state to the device identity without putting the raw id in the key', async () => {
    const storage = new MemorySecureStorage();
    const store = new ProEntitlementStore(storage);
    const first = await store.resolve(resolveInput({ deviceId: 'device-a' }));
    const second = await store.resolve(resolveInput({ deviceId: 'device-b', now: NOW + 1 }));

    expect(first.graceGranted).toBe(true);
    expect(second.graceGranted).toBe(true);
    expect(storage.values.size).toBe(2);
    expect(createProEntitlementStorageKey('device-a')).not.toContain('device-a');
    expect(createProEntitlementStorageKey('device-a')).not.toBe(
      createProEntitlementStorageKey('device-b'),
    );
  });

  it('evaluates grace once for the same identity and never reissues it', async () => {
    const storage = new MemorySecureStorage();
    const store = new ProEntitlementStore(storage);
    const first = await store.resolve(resolveInput());
    const second = await store.resolve(resolveInput({
      now: NOW + FIRST_3_0_GRACE_PERIOD_MS + 1,
    }));

    expect(first.graceGranted).toBe(true);
    expect(second.graceGranted).toBe(false);
    expect(second.state.graceEvaluatedAt).toBe(NOW);
    expect(second.state.graceUntil).toBe(first.state.graceUntil);
    expect(second.entitlement.now).toBe(NOW + FIRST_3_0_GRACE_PERIOD_MS + 1);
    expect(storage.writes).toHaveLength(1);
  });

  it('does not grant later if the first 3.0 evaluation was ineligible', async () => {
    const storage = new MemorySecureStorage();
    const store = new ProEntitlementStore(storage);
    const first = await store.resolve(resolveInput({
      connectionIds: ['home'],
      activeConnectionId: 'home',
    }));
    const later = await store.resolve(resolveInput({ now: NOW + 1 }));

    expect(first.state.graceUntil).toBeNull();
    expect(later.graceGranted).toBe(false);
    expect(later.state.graceUntil).toBeNull();
  });

  it('selects an active connection when a Pro user later expires', async () => {
    const storage = new MemorySecureStorage();
    const store = new ProEntitlementStore(storage);
    await store.resolve(resolveInput({
      isPro: true,
      connectionIds: [],
      activeConnectionId: null,
    }));
    const expired = await store.resolve(resolveInput({
      isPro: false,
      connectionIds: ['home', 'work'],
      activeConnectionId: 'work',
      now: NOW + 1,
    }));

    expect(expired.graceGranted).toBe(false);
    expect(expired.entitlement.freeConnectionId).toBe('work');
    expect(expired.entitlement.graceUntil).toBeNull();
  });

  it('recovers corrupt state without granting a repeat grace period', async () => {
    const storage = new MemorySecureStorage();
    const key = createProEntitlementStorageKey('device-a');
    storage.values.set(key, '{not-json');
    const store = new ProEntitlementStore(storage);

    const resolved = await store.resolve(resolveInput());

    expect(resolved.recoveredCorruptState).toBe(true);
    expect(resolved.graceGranted).toBe(false);
    expect(resolved.state.graceUntil).toBeNull();
    expect(resolved.state.freeConnectionId).toBe('work');
    expect(JSON.parse(storage.values.get(key) ?? '{}')).toEqual(resolved.state);
  });

  it.each([
    ['null JSON', 'null'],
    ['array JSON', '[]'],
    ['primitive JSON', '"value"'],
    ['wrong version', JSON.stringify({ version: 2 })],
    ['missing free id', JSON.stringify({
      version: 1,
      lastFreeConnectionSwitchAt: null,
      graceEvaluatedAt: NOW,
      graceUntil: null,
    })],
    ['blank free id', JSON.stringify({
      version: 1,
      freeConnectionId: ' ',
      lastFreeConnectionSwitchAt: null,
      graceEvaluatedAt: NOW,
      graceUntil: null,
    })],
    ['invalid switch time', JSON.stringify({
      version: 1,
      freeConnectionId: null,
      lastFreeConnectionSwitchAt: 'now',
      graceEvaluatedAt: NOW,
      graceUntil: null,
    })],
    ['unsafe evaluation time', JSON.stringify({
      version: 1,
      freeConnectionId: null,
      lastFreeConnectionSwitchAt: null,
      graceEvaluatedAt: Number.MAX_VALUE,
      graceUntil: null,
    })],
    ['negative evaluation time', JSON.stringify({
      version: 1,
      freeConnectionId: null,
      lastFreeConnectionSwitchAt: null,
      graceEvaluatedAt: -1,
      graceUntil: null,
    })],
    ['invalid grace deadline', JSON.stringify({
      version: 1,
      freeConnectionId: null,
      lastFreeConnectionSwitchAt: null,
      graceEvaluatedAt: NOW,
      graceUntil: 'later',
    })],
    ['grace before evaluation', JSON.stringify({
      version: 1,
      freeConnectionId: null,
      lastFreeConnectionSwitchAt: null,
      graceEvaluatedAt: NOW,
      graceUntil: NOW - 1,
    })],
  ])('fails closed and repairs %s', async (_label, raw) => {
    const storage = new MemorySecureStorage();
    storage.values.set(createProEntitlementStorageKey('device-a'), raw);

    const resolved = await new ProEntitlementStore(storage).resolve(resolveInput());

    expect(resolved).toMatchObject({
      graceGranted: false,
      recoveredCorruptState: true,
      state: { graceUntil: null, freeConnectionId: 'work' },
    });
  });

  it('persists successful switches and serializes concurrent attempts', async () => {
    const storage = new MemorySecureStorage();
    const store = new ProEntitlementStore(storage);
    await store.resolve(resolveInput({ connectionIds: ['home', 'work', 'lab'], activeConnectionId: 'home' }));

    const [first, second] = await Promise.all([
      store.switchFreeConnection({
        deviceId: 'device-a',
        isPro: false,
        connectionIds: ['home', 'work', 'lab'],
        targetConnectionId: 'work',
        now: NOW + 1,
      }),
      store.switchFreeConnection({
        deviceId: 'device-a',
        isPro: false,
        connectionIds: ['home', 'work', 'lab'],
        targetConnectionId: 'lab',
        now: NOW + 1,
      }),
    ]);

    expect(first).toMatchObject({ ok: true, changed: true, state: { freeConnectionId: 'work' } });
    expect(second).toMatchObject({ ok: false, reason: 'cooldown' });
    const restarted = new ProEntitlementStore(storage);
    const resolved = await restarted.resolve(resolveInput({
      connectionIds: ['home', 'work', 'lab'],
      activeConnectionId: 'home',
      now: NOW + 2,
    }));
    expect(resolved.state.freeConnectionId).toBe('work');
  });

  it('fails closed when switching before initialization or from corrupt state', async () => {
    const storage = new MemorySecureStorage();
    const store = new ProEntitlementStore(storage);
    const input = {
      deviceId: 'device-a',
      isPro: false,
      connectionIds: ['home', 'work'],
      targetConnectionId: 'work',
      now: NOW,
    } as const;

    await expect(store.switchFreeConnection(input)).resolves.toMatchObject({
      ok: false,
      reason: 'not_initialized',
      state: null,
    });
    storage.values.set(createProEntitlementStorageKey('device-a'), '{bad');
    await expect(store.switchFreeConnection(input)).resolves.toMatchObject({
      ok: false,
      reason: 'corrupt_state',
      state: null,
    });
  });

  it('does not expose an unpersisted grace period when secure storage fails', async () => {
    const storage = new MemorySecureStorage();
    const store = new ProEntitlementStore(storage);
    storage.failNextWrite = true;

    await expect(store.resolve(resolveInput())).rejects.toThrow('secure write failed');
    expect(storage.values.size).toBe(0);
    await expect(store.resolve(resolveInput())).resolves.toMatchObject({
      graceGranted: true,
      state: { graceUntil: NOW + FIRST_3_0_GRACE_PERIOD_MS },
    });
  });

  it('rejects an empty identity and invalid clock values', async () => {
    const store = new ProEntitlementStore(new MemorySecureStorage());
    await expect(store.resolve(resolveInput({ deviceId: ' ' }))).rejects.toThrow(
      'deviceId must not be empty.',
    );
    await expect(store.resolve(resolveInput({ now: -1 }))).rejects.toThrow(
      'now must be a non-negative safe integer.',
    );
  });

  it('uses Date.now when callers omit an explicit clock', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
    const storage = new MemorySecureStorage();
    const store = new ProEntitlementStore(storage);
    const input = resolveInput();
    const { now: _ignored, ...withoutNow } = input;

    const resolved = await store.resolve(withoutNow);
    const switched = await store.switchFreeConnection({
      deviceId: input.deviceId,
      isPro: false,
      connectionIds: input.connectionIds,
      targetConnectionId: 'home',
    });

    expect(resolved.entitlement.now).toBe(NOW);
    expect(switched).toMatchObject({ ok: true, changed: true });
    nowSpy.mockRestore();
  });
});
