import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir, hostname, userInfo } from 'node:os';
import { join } from 'node:path';

const CONFIG_DIR = join(homedir(), '.clawket');
const CONFIG_PATH = join(CONFIG_DIR, 'bridge-cli.json');
const PREVIEW_CONFIG_PATH = join(CONFIG_DIR, 'bridge-cli.preview.json');
const CONFIG_DIR_MODE = 0o700;
const CONFIG_FILE_MODE = 0o600;

export interface PairingConfig {
  serverUrl: string;
  gatewayId: string;
  relaySecret: string;
  relayUrl: string;
  instanceId: string;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PairingEnvironment = 'production' | 'preview';

export function getPairingConfigPath(environment: PairingEnvironment = 'production'): string {
  return environment === 'preview' ? PREVIEW_CONFIG_PATH : CONFIG_PATH;
}

export function getPairingConfigDir(): string {
  return CONFIG_DIR;
}

export function readPairingConfig(environment: PairingEnvironment = 'production'): PairingConfig | null {
  const configPath = getPairingConfigPath(environment);
  if (!existsSync(configPath)) return null;
  hardenPairingConfigPermissions(configPath);
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as Partial<PairingConfig>;
    if (!parsed.serverUrl || !parsed.gatewayId || !parsed.relaySecret || !parsed.relayUrl) {
      return null;
    }
    const normalized: PairingConfig = {
      serverUrl: parsed.serverUrl,
      gatewayId: parsed.gatewayId,
      relaySecret: parsed.relaySecret,
      relayUrl: parsed.relayUrl,
      instanceId: parsed.instanceId?.trim() || createInstanceId(),
      displayName: parsed.displayName ?? null,
      createdAt: parsed.createdAt ?? new Date().toISOString(),
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
    if (parsed.instanceId !== normalized.instanceId) {
      writePairingConfig(normalized, environment);
    }
    return normalized;
  } catch {
    return null;
  }
}

export function writePairingConfig(
  config: PairingConfig,
  environment: PairingEnvironment = 'production',
): void {
  const configPath = getPairingConfigPath(environment);
  ensurePairingConfigDir();
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', {
    encoding: 'utf8',
    mode: CONFIG_FILE_MODE,
  });
  safeChmodSync(configPath, CONFIG_FILE_MODE);
}

export function deletePairingConfig(environment: PairingEnvironment = 'production'): void {
  const configPath = getPairingConfigPath(environment);
  if (!existsSync(configPath)) return;
  rmSync(configPath, { force: true });
}

export function getDefaultBridgeDisplayName(): string {
  const openClawName = readOpenClawDefaultAgentName();
  if (openClawName) return openClawName;
  try {
    const username = userInfo().username.trim();
    if (username) return username;
  } catch {
    // Fall through to env/host-based defaults.
  }
  const envName = (process.env.LOGNAME ?? process.env.USER ?? process.env.USERNAME ?? '').trim();
  if (envName) return envName;
  return hostname().trim() || 'Clawket Bridge';
}

export function pickOpenClawDefaultAgentName(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const agents = (value as { agents?: { list?: unknown } }).agents;
  const list = Array.isArray(agents?.list) ? agents.list : [];
  const preferred = list.find((item) => isDefaultAgent(item))
    ?? list.find((item) => hasAgentId(item, 'main'))
    ?? list[0];
  return readAgentName(preferred);
}

function createInstanceId(): string {
  const host = sanitizeId(hostname() || 'host');
  return `inst-${host}-${randomUUID().slice(0, 10)}`;
}

function sanitizeId(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'host';
}

function readOpenClawDefaultAgentName(): string | null {
  const openclawConfigPath = resolveOpenClawConfigPath();
  if (!openclawConfigPath || !existsSync(openclawConfigPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(openclawConfigPath, 'utf8')) as unknown;
    return pickOpenClawDefaultAgentName(parsed);
  } catch {
    return null;
  }
}

function ensurePairingConfigDir(): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: CONFIG_DIR_MODE });
  safeChmodSync(CONFIG_DIR, CONFIG_DIR_MODE);
}

function hardenPairingConfigPermissions(configPath: string): void {
  if (existsSync(CONFIG_DIR)) {
    safeChmodSync(CONFIG_DIR, CONFIG_DIR_MODE);
  }
  safeChmodSync(configPath, CONFIG_FILE_MODE);
}

function safeChmodSync(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {
    // best-effort only; Windows and some filesystems may reject chmod.
  }
}

function resolveOpenClawConfigPath(): string | null {
  const seen = new Set<string>();
  const homes = [homedir(), '/root']
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });

  for (const home of homes) {
    const configPath = join(home, '.openclaw', 'openclaw.json');
    if (existsSync(configPath)) return configPath;
  }
  return homes[0] ? join(homes[0], '.openclaw', 'openclaw.json') : null;
}

function isDefaultAgent(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && (value as { default?: unknown }).default === true);
}

function hasAgentId(value: unknown, id: string): boolean {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as { id?: unknown }).id === 'string'
    && (value as { id: string }).id.trim() === id,
  );
}

function readAgentName(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { name?: unknown; identity?: { name?: unknown } };
  const identityName = typeof record.identity?.name === 'string' ? record.identity.name.trim() : '';
  if (identityName) return identityName;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  return name || null;
}
