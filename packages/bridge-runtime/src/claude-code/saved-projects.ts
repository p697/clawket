import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

/** Optional native metadata only. Never expose values (MCP settings, credentials, etc.). */
export async function savedClaudeProjects(path?: string): Promise<string[]> {
  // A custom Claude home must not accidentally import the default account's metadata.
  if (!path && process.env.CLAUDE_CONFIG_DIR) return [];
  const file = await open(path ?? join(homedir(), '.claude.json'), 'r').catch(() => undefined);
  if (!file) return [];
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) return [];
    const data = Buffer.alloc(stat.size + 1);
    const { bytesRead } = await file.read(data, 0, data.length, 0);
    if (bytesRead > stat.size) return [];
    const value = JSON.parse(data.subarray(0, bytesRead).toString('utf8'));
    if (!value?.projects || typeof value.projects !== 'object' || Array.isArray(value.projects)) return [];
    return Object.keys(value.projects).filter(path => isAbsolute(path) && path.length <= 4096).slice(0, 2000);
  } catch { return []; }
  finally { await file.close(); }
}
