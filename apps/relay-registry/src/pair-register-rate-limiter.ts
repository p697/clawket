import { DurableObject } from 'cloudflare:workers';

export const PAIR_REGISTER_LIMIT = 10;
export const PAIR_REGISTER_WINDOW_MS = 60 * 60 * 1000;

export type PairRegisterLimitResult = {
  allowed: boolean;
  count: number;
  resetAt: number;
};

type PairRegisterRateLimiterEnv = Record<string, never>;

type RateLimitRow = {
  requestCount: number;
  resetAt: number;
};

type AlarmRow = {
  resetAt: number;
};

export class PairRegisterRateLimiter extends DurableObject<PairRegisterRateLimiterEnv> {
  constructor(ctx: DurableObjectState, env: PairRegisterRateLimiterEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS register_rate_limit (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        window_start INTEGER NOT NULL,
        reset_at INTEGER NOT NULL,
        request_count INTEGER NOT NULL CHECK (request_count >= 0)
      )
    `);
  }

  async consume(nowMs: number): Promise<PairRegisterLimitResult> {
    const now = normalizeTimestamp(nowMs);
    const windowStart = Math.floor(now / PAIR_REGISTER_WINDOW_MS) * PAIR_REGISTER_WINDOW_MS;
    const resetAt = windowStart + PAIR_REGISTER_WINDOW_MS;
    const row = this.ctx.storage.sql.exec<RateLimitRow>(`
      INSERT INTO register_rate_limit (singleton, window_start, reset_at, request_count)
      VALUES (1, ?, ?, 1)
      ON CONFLICT(singleton) DO UPDATE SET
        window_start = excluded.window_start,
        reset_at = excluded.reset_at,
        request_count = CASE
          WHEN register_rate_limit.window_start = excluded.window_start
            THEN register_rate_limit.request_count + 1
          ELSE 1
        END
      RETURNING request_count AS requestCount, reset_at AS resetAt
    `, windowStart, resetAt).one();

    await this.ctx.storage.setAlarm(row.resetAt);
    return {
      allowed: row.requestCount <= PAIR_REGISTER_LIMIT,
      count: row.requestCount,
      resetAt: row.resetAt,
    };
  }

  async alarm(): Promise<void> {
    const row = this.ctx.storage.sql.exec<AlarmRow>(`
      SELECT reset_at AS resetAt
      FROM register_rate_limit
      WHERE singleton = 1
    `).toArray()[0];
    if (!row) return;

    if (row.resetAt <= Date.now()) {
      this.ctx.storage.sql.exec('DELETE FROM register_rate_limit WHERE singleton = 1');
      return;
    }

    await this.ctx.storage.setAlarm(row.resetAt);
  }
}

function normalizeTimestamp(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : Date.now();
}
