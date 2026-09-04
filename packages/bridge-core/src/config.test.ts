import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PairingConfig } from './config.js';

const tempDirs: string[] = [];

const BASE_CONFIG: PairingConfig = {
  serverUrl: 'https://registry.example.com',
  gatewayId: 'gw_test',
  relaySecret: 'secret_test',
  relayUrl: 'wss://relay.example.com/ws',
  instanceId: 'inst_test',
  displayName: 'Lucy',
  createdAt: '2026-03-11T00:00:00.000Z',
  updatedAt: '2026-03-11T00:00:00.000Z',
};

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

async function loadConfigModule(homeDir: string) {
  vi.stubEnv('HOME', homeDir);
  vi.resetModules();
  return import('./config.js');
}

describe('pairing config permissions', () => {
  it('writes the pairing config with user-private directory and file modes', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'clawket-bridge-config-write-'));
    tempDirs.push(homeDir);

    const { getPairingConfigDir, getPairingConfigPath, writePairingConfig } = await loadConfigModule(homeDir);
    writePairingConfig(BASE_CONFIG);

    const dirStat = await stat(getPairingConfigDir());
    const fileStat = await stat(getPairingConfigPath());

    expect(dirStat.mode & 0o777).toBe(0o700);
    expect(fileStat.mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(getPairingConfigPath(), 'utf8'))).toMatchObject(BASE_CONFIG);
  });

  it('hardens legacy pairing config permissions during reads without breaking compatibility', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'clawket-bridge-config-read-'));
    tempDirs.push(homeDir);
    const configDir = join(homeDir, '.clawket');
    const configPath = join(configDir, 'bridge-cli.json');

    await mkdir(configDir, { recursive: true, mode: 0o755 });
    await writeFile(configPath, JSON.stringify(BASE_CONFIG, null, 2) + '\n', {
      encoding: 'utf8',
      mode: 0o644,
    });

    const { readPairingConfig } = await loadConfigModule(homeDir);
    expect(readPairingConfig()).toMatchObject(BASE_CONFIG);

    const dirStat = await stat(configDir);
    const fileStat = await stat(configPath);
    expect(dirStat.mode & 0o777).toBe(0o700);
    expect(fileStat.mode & 0o777).toBe(0o600);
  });

  it('keeps Preview pairing state in a separate private config file', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'clawket-bridge-config-preview-'));
    tempDirs.push(homeDir);

    const { getPairingConfigPath, readPairingConfig, writePairingConfig } = await loadConfigModule(homeDir);
    writePairingConfig(BASE_CONFIG, 'preview');

    expect(getPairingConfigPath('preview')).toBe(join(homeDir, '.clawket', 'bridge-cli.preview.json'));
    expect(readPairingConfig()).toBeNull();
    expect(readPairingConfig('preview')).toMatchObject(BASE_CONFIG);
    expect((await stat(getPairingConfigPath('preview'))).mode & 0o777).toBe(0o600);
  });
});
