import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '@clawket/shared';
import worker, { PairRegisterRateLimiter } from './index';
import {
  PAIR_REGISTER_LIMIT,
  PAIR_REGISTER_WINDOW_MS,
} from './pair-register-rate-limiter';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    protected readonly ctx: DurableObjectState;
    protected readonly env: unknown;

    constructor(ctx: DurableObjectState, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

type StoredRateLimitRow = {
  windowStart: number;
  resetAt: number;
  requestCount: number;
};

class MemoryRateLimitSql {
  private row: StoredRateLimitRow | null = null;

  exec<T extends Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: unknown[]
  ): SqlStorageCursor<T> {
    const normalized = query.replace(/\s+/g, ' ').trim();
    let rows: Array<Record<string, SqlStorageValue>> = [];

    if (normalized.startsWith('CREATE TABLE IF NOT EXISTS register_rate_limit')) {
      rows = [];
    } else if (normalized.startsWith('INSERT INTO register_rate_limit')) {
      const [windowStart, resetAt] = bindings;
      if (typeof windowStart !== 'number' || typeof resetAt !== 'number') {
        throw new Error('Invalid rate-limit SQL bindings');
      }
      this.row = {
        windowStart,
        resetAt,
        requestCount: this.row?.windowStart === windowStart ? this.row.requestCount + 1 : 1,
      };
      rows = [{ requestCount: this.row.requestCount, resetAt: this.row.resetAt }];
    } else if (normalized.startsWith('SELECT reset_at AS resetAt')) {
      rows = this.row ? [{ resetAt: this.row.resetAt }] : [];
    } else if (normalized.startsWith('DELETE FROM register_rate_limit')) {
      this.row = null;
    } else {
      throw new Error(`Unexpected SQL in test: ${normalized}`);
    }

    return createCursor(rows as T[]);
  }

  snapshot(): StoredRateLimitRow | null {
    return this.row ? { ...this.row } : null;
  }
}

class MemoryRateLimitStorage {
  readonly memorySql = new MemoryRateLimitSql();
  readonly sql = this.memorySql as unknown as SqlStorage;
  alarmAt: number | null = null;

  async setAlarm(scheduledTime: number | Date): Promise<void> {
    this.alarmAt = scheduledTime instanceof Date ? scheduledTime.getTime() : scheduledTime;
  }
}

class MemoryRateLimiterNamespace {
  readonly requestedNames: string[] = [];
  private readonly entries = new Map<string, {
    limiter: PairRegisterRateLimiter;
    storage: MemoryRateLimitStorage;
  }>();

  getByName(name: string): PairRegisterRateLimiter {
    this.requestedNames.push(name);
    const existing = this.entries.get(name);
    if (existing) return existing.limiter;

    const storage = new MemoryRateLimitStorage();
    const limiter = createLimiter(storage);
    this.entries.set(name, { limiter, storage });
    return limiter;
  }

  binding(): DurableObjectNamespace<PairRegisterRateLimiter> {
    return this as unknown as DurableObjectNamespace<PairRegisterRateLimiter>;
  }

  storageFor(name: string): MemoryRateLimitStorage | undefined {
    return this.entries.get(name)?.storage;
  }
}

class MemoryKV {
  readonly puts: Array<{ key: string; options?: { expirationTtl?: number } }> = [];
  private readonly map = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.map.set(key, value);
    this.puts.push({ key, options });
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

const fetchHandler = worker.fetch as (request: Request, env: unknown) => Promise<Response>;
const WINDOW_START = Math.floor(Date.UTC(2026, 8, 5, 3, 0, 0) / PAIR_REGISTER_WINDOW_MS)
  * PAIR_REGISTER_WINDOW_MS;

afterEach(() => {
  vi.useRealTimers();
});

describe('PairRegisterRateLimiter', () => {
  it('atomically allows the tenth concurrent request and rejects the eleventh', async () => {
    const limiter = createLimiter(new MemoryRateLimitStorage());
    const results = await Promise.all(Array.from(
      { length: PAIR_REGISTER_LIMIT + 1 },
      () => limiter.consume(WINDOW_START + 1),
    ));

    expect(results.filter((result) => result.allowed)).toHaveLength(PAIR_REGISTER_LIMIT);
    expect(results.at(PAIR_REGISTER_LIMIT)).toEqual({
      allowed: false,
      count: PAIR_REGISTER_LIMIT + 1,
      resetAt: WINDOW_START + PAIR_REGISTER_WINDOW_MS,
    });
  });

  it('starts a fresh fixed window exactly at the hour boundary', async () => {
    const limiter = createLimiter(new MemoryRateLimitStorage());
    for (let attempt = 0; attempt < PAIR_REGISTER_LIMIT; attempt += 1) {
      expect((await limiter.consume(WINDOW_START + PAIR_REGISTER_WINDOW_MS - 1)).allowed).toBe(true);
    }
    expect((await limiter.consume(WINDOW_START + PAIR_REGISTER_WINDOW_MS - 1)).allowed).toBe(false);

    await expect(limiter.consume(WINDOW_START + PAIR_REGISTER_WINDOW_MS)).resolves.toEqual({
      allowed: true,
      count: 1,
      resetAt: WINDOW_START + 2 * PAIR_REGISTER_WINDOW_MS,
    });
  });

  it('persists counts across object instances and lets the alarm remove an expired window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(WINDOW_START + 1);
    const storage = new MemoryRateLimitStorage();
    const firstInstance = createLimiter(storage);
    await firstInstance.consume(Date.now());

    const restartedInstance = createLimiter(storage);
    await expect(restartedInstance.consume(Date.now())).resolves.toMatchObject({ count: 2 });
    expect(storage.memorySql.snapshot()).toEqual({
      windowStart: WINDOW_START,
      resetAt: WINDOW_START + PAIR_REGISTER_WINDOW_MS,
      requestCount: 2,
    });
    expect(storage.alarmAt).toBe(WINDOW_START + PAIR_REGISTER_WINDOW_MS);

    vi.setSystemTime(WINDOW_START + PAIR_REGISTER_WINDOW_MS);
    await restartedInstance.alarm();
    expect(storage.memorySql.snapshot()).toBeNull();
  });
});

describe('pair register HTTP rate limit', () => {
  it.each([
    { backend: 'openclaw', path: '/v1/pair/register' },
    { backend: 'hermes', path: '/v1/hermes/pair/register' },
  ])('returns the exact 429 contract for the eleventh $backend request', async ({ backend, path }) => {
    vi.useFakeTimers();
    vi.setSystemTime(WINDOW_START + 1);
    const namespace = new MemoryRateLimiterNamespace();
    const env = createRegistryEnv(backend, namespace);
    const sourceIp = '203.0.113.42';
    const responses = [];
    for (let attempt = 0; attempt < PAIR_REGISTER_LIMIT + 1; attempt += 1) {
      responses.push(await postRegister(path, env, sourceIp));
    }

    expect(responses.slice(0, PAIR_REGISTER_LIMIT).every((response) => response.status === 200)).toBe(true);
    expect(responses[PAIR_REGISTER_LIMIT].status).toBe(429);
    await expect(responses[PAIR_REGISTER_LIMIT].json()).resolves.toEqual({
      error: {
        code: 'PAIRING_REGISTER_RATE_LIMITED',
        message: 'Too many pairing registration attempts. Try again later.',
      },
    });

    const expectedHash = await sha256Hex(sourceIp);
    expect(new Set(namespace.requestedNames)).toEqual(new Set([expectedHash]));
    expect(namespace.requestedNames.join(',')).not.toContain(sourceIp);
    expect(namespace.storageFor(expectedHash)?.memorySql.snapshot()).toMatchObject({
      requestCount: PAIR_REGISTER_LIMIT + 1,
    });
  });

  it('serializes concurrent HTTP attempts through one hashed-IP object', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(WINDOW_START + 1);
    const namespace = new MemoryRateLimiterNamespace();
    const env = createRegistryEnv('openclaw', namespace);
    const responses = await Promise.all(Array.from(
      { length: PAIR_REGISTER_LIMIT + 1 },
      () => postRegister('/v1/pair/register', env, '198.51.100.8'),
    ));

    expect(responses.filter((response) => response.status === 200)).toHaveLength(PAIR_REGISTER_LIMIT);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(1);
    expect(new Set(namespace.requestedNames)).toHaveLength(1);
  });

  it('uses one deterministic hash bucket when CF-Connecting-IP is missing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(WINDOW_START + 1);
    const namespace = new MemoryRateLimiterNamespace();
    const env = createRegistryEnv('openclaw', namespace);
    const responses = [];
    for (let attempt = 0; attempt < PAIR_REGISTER_LIMIT + 1; attempt += 1) {
      responses.push(await postRegister('/v1/pair/register', env));
    }

    expect(responses[PAIR_REGISTER_LIMIT].status).toBe(429);
    expect(new Set(namespace.requestedNames)).toEqual(new Set([await sha256Hex('')]));
  });
});

function createLimiter(storage: MemoryRateLimitStorage): PairRegisterRateLimiter {
  const state = { storage } as unknown as DurableObjectState;
  return new PairRegisterRateLimiter(state, {});
}

function createCursor<T extends Record<string, SqlStorageValue>>(rows: T[]): SqlStorageCursor<T> {
  return {
    one: () => {
      if (rows.length !== 1) throw new Error(`Expected one row, received ${rows.length}`);
      return rows[0];
    },
    toArray: () => [...rows],
  } as unknown as SqlStorageCursor<T>;
}

function createRegistryEnv(backend: string, namespace: MemoryRateLimiterNamespace) {
  const openClawKv = new MemoryKV();
  const hermesKv = new MemoryKV();
  return {
    RELAY_BACKEND: backend,
    ROUTES_KV: openClawKv as unknown as KVNamespace,
    HERMES_ROUTES_KV: hermesKv as unknown as KVNamespace,
    PAIR_REGISTER_LIMITER: namespace.binding(),
    RELAY_REGION_MAP: JSON.stringify({ us: 'wss://relay-us.example.com/ws' }),
  };
}

async function postRegister(path: string, env: unknown, sourceIp?: string): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (sourceIp !== undefined) headers.set('CF-Connecting-IP', sourceIp);
  return fetchHandler(new Request(`https://registry.example.com${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ preferredRegion: 'us' }),
  }), env);
}
