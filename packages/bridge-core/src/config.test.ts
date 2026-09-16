import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
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

async function expectPrivate(path: string, mode: number) {
  if (process.platform !== 'win32') {
    expect((await stat(path)).mode & 0o777).toBe(mode);
    return;
  }
  // Windows exposes synthetic POSIX mode bits. Check its actual access rules.
  const broadAccess = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference='Stop'; Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -Force; $rules=(Get-Acl -LiteralPath $env:CLAWKET_TEST_ACL_PATH).Access; @($rules | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -in @('S-1-1-0','S-1-5-11','S-1-5-32-545') }).Count"],
    { env: { ...process.env, CLAWKET_TEST_ACL_PATH: path }, encoding: 'utf8', windowsHide: true, stdio: 'pipe', timeout: 10_000 });
  expect(Number(broadAccess.trim())).toBe(0);
}

describe('pairing config permissions', () => {
  it('does not report an unreadable missing path as private', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'clawket-acl-missing-'));
    tempDirs.push(directory);
    await expect(expectPrivate(join(directory, 'missing'), 0o600)).rejects.toThrow();
  }, 20_000); // PowerShell cold startup on hosted Windows can exceed Vitest's 5s default.
  it('writes the pairing config with user-private directory and file modes', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'clawket-bridge-config-write-'));
    tempDirs.push(homeDir);

    const { getPairingConfigDir, getPairingConfigPath, writePairingConfig } = await loadConfigModule(homeDir);
    writePairingConfig(BASE_CONFIG);


    await expectPrivate(getPairingConfigDir(), 0o700);
    await expectPrivate(getPairingConfigPath(), 0o600);
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

    await expectPrivate(configDir, 0o700);
    await expectPrivate(configPath, 0o600);
  });

  it('keeps Preview pairing state in a separate private config file', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'clawket-bridge-config-preview-'));
    tempDirs.push(homeDir);

    const { getPairingConfigPath, readPairingConfig, writePairingConfig } = await loadConfigModule(homeDir);
    writePairingConfig(BASE_CONFIG, 'preview');

    expect(getPairingConfigPath('preview')).toBe(join(homeDir, '.clawket', 'bridge-cli.preview.json'));
    expect(readPairingConfig()).toBeNull();
    expect(readPairingConfig('preview')).toMatchObject(BASE_CONFIG);
    await expectPrivate(getPairingConfigPath('preview'), 0o600);
  });
});
