import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const loadNodeBuiltin = createRequire(import.meta.url);

/** Inspect the host schema only; OpenClaw owns all credential writes. */
export async function assertLegacyBootstrapStorage(stateDir: string): Promise<void> {
  const databasePath = join(stateDir, 'state', 'openclaw.sqlite');
  if (!existsSync(databasePath)) return;
  let migrated: boolean;
  try {
    // Loaded only for hosts with SQLite state; older Node/JSON-only hosts keep working.
    // tsup strips node: from dynamic imports; sqlite is a prefix-only builtin.
    const { DatabaseSync } = loadNodeBuiltin('node:sqlite') as typeof import('node:sqlite');
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      database.exec('PRAGMA query_only = ON');
      migrated = Boolean(database.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'device_bootstrap_tokens'",
      ).get());
    } finally {
      database.close();
    }
  } catch {
    throw new Error('Cannot verify OpenClaw legacy bootstrap storage. Use a current App or the Gateway token/password pairing flow.');
  }
  if (migrated) {
    // Old Apps already fall back to the QR's token/password on bootstrap.error.
    throw new Error('This OpenClaw no longer accepts legacy bootstrap credentials. Use the Gateway token/password pairing flow and approve the device, or update the App.');
  }
}
