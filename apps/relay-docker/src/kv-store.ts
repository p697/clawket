/**
 * kv-store.ts — In-memory KV store with optional SQLite persistence.
 *
 * Replaces Cloudflare KV Namespace for self-hosted Docker deployment.
 * Supports TTL expiration and periodic garbage collection.
 */

import type Database from 'better-sqlite3';
import { createRequire } from 'module';

export interface KVEntry {
  value: string;
  expiresAt: number | null; // epoch ms, null = no expiry
}

export class MemoryKV {
  private readonly store = new Map<string, KVEntry>();
  private readonly gcTimer: ReturnType<typeof setInterval>;
  private db: Database.Database | null = null;

  constructor(sqlitePath?: string) {
    const normalizedPath = sqlitePath?.trim() || null;
    if (normalizedPath) {
      this.initSqlite(normalizedPath);
    }
    // GC every 60 seconds
    this.gcTimer = setInterval(() => this.gc(), 60_000);
  }

  private initSqlite(path: string): void {
    try {
      // Dynamic import workaround — better-sqlite3 is CommonJS
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const require = createRequire(import.meta.url);
      const BetterSqlite3 = require('better-sqlite3') as new (filename: string) => Database.Database;
      this.db = new BetterSqlite3(path);
      this.db!.pragma('journal_mode = WAL');
      this.db!.exec(`
        CREATE TABLE IF NOT EXISTS kv (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          expires_at INTEGER
        )
      `);
      this.db!.prepare('DELETE FROM kv WHERE expires_at IS NOT NULL AND expires_at <= ?').run(Date.now());
      // Load existing entries into memory
      const rows = this.db!.prepare('SELECT key, value, expires_at FROM kv').all() as Array<{
        key: string;
        value: string;
        expires_at: number | null;
      }>;
      const now = Date.now();
      for (const row of rows) {
        if (row.expires_at && row.expires_at <= now) continue;
        this.store.set(row.key, {
          value: row.value,
          expiresAt: row.expires_at,
        });
      }
      console.log(`[kv-store] Loaded ${this.store.size} entries from ${path}`);
    } catch (err) {
      this.db = null;
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`[kv-store] SQLite init failed for ${path}: ${message}`);
    }
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      this.deleteSqlite(key, false);
      return null;
    }
    return entry.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const expiresAt = options?.expirationTtl
      ? Date.now() + options.expirationTtl * 1000
      : null;
    this.putSqlite(key, value, expiresAt);
    this.store.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.deleteSqlite(key, true);
    this.store.delete(key);
  }

  private putSqlite(key: string, value: string, expiresAt: number | null): void {
    if (!this.db) return;
    this.db.prepare(
      'INSERT OR REPLACE INTO kv (key, value, expires_at) VALUES (?, ?, ?)',
    ).run(key, value, expiresAt);
  }

  private deleteSqlite(key: string, strict: boolean): void {
    if (!this.db) return;
    try {
      this.db.prepare('DELETE FROM kv WHERE key = ?').run(key);
    } catch (err) {
      if (strict) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`[kv-store] SQLite delete failed for key ${key}: ${message}`);
      }
      console.warn(`[kv-store] SQLite cleanup failed for key ${key}:`, err);
    }
  }

  private gc(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt && entry.expiresAt <= now) {
        this.store.delete(key);
        this.deleteSqlite(key, false);
      }
    }
  }

  close(): void {
    clearInterval(this.gcTimer);
    if (this.db) {
      try { this.db.close(); } catch { /* best effort */ }
    }
  }
}
