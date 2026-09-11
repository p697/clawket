import { X509Certificate } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEVICE_BOOTSTRAP_TOKEN_TTL_MS,
  configureOpenClawLanAccess,
  getOpenClawBootstrapPath,
  getOpenClawConfigCandidates,
  getOpenClawConfigDir,
  getOpenClawConfigPath,
  getOpenClawMediaDir,
  getOpenClawStateDir,
  isOpenClawGatewayAuthConfigured,
  issueOpenClawBootstrapToken,
  issueOpenClawPairingSetupToken,
  readOpenClawPermissions,
  readOpenClawInfo,
  restartOpenClawGateway,
  resolveGatewayUrl,
  runOpenClawDoctor,
  runOpenClawDoctorFix,
  resolveGatewayAuth,
} from './openclaw.js';

const childProcessMock = vi.hoisted(() => ({
  execFile: vi.fn(),
}));

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const fsPromisesMock = vi.hoisted(() => ({
  chmod: vi.fn(),
  mkdir: vi.fn(),
  readFile: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn(),
  writeFile: vi.fn(),
}));

const osMock = vi.hoisted(() => ({
  homedir: vi.fn(() => '/Users/tester'),
}));

vi.mock('node:child_process', () => childProcessMock);
vi.mock('node:fs', () => fsMock);
vi.mock('node:fs/promises', () => fsPromisesMock);
vi.mock('node:os', () => osMock);
// These mocked paths deliberately describe a POSIX host.
vi.mock('node:path', async () => (await vi.importActual<typeof import('node:path')>('node:path')).posix);

const TLS_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDCTCCAfGgAwIBAgIUel0Lv05cjrViyI/H3tABBJxM7NgwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MDEyMDEyMjEzMloXDTI2MDEy
MTEyMjEzMlowFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEA67q+QlqeKbDDGw0z2NWjeOhzw8UXIRoIfF3nTZK5XOM9
ShYsi1LF6VSIbsqF6tX35aUw8+/vqRhAyUOaRHQoZ937loIu4Avqb3eVUNXgF/+6
lRO9n4cdeDcYWomVN4Qs14xtkn5UxBBMZFJEE5tK3R0o4C1TIUzNz6puis33YLZv
Wcl8JQLKKxP6b4G1MRt0OMSjQRs24q2ftRMzw8LI3934rTbWpGSZMpruioOZbFIo
UFVzj9FO3/fPRZnr6EzLyZpLyc7KE0Xe7FzUjo8zsCa/HWvAuB5F4ttZndchHHMl
tIkoe7Vrw66VgwIFukTLjBwtLVuG5KQxqxaW0DoM1QIDAQABo1MwUTAdBgNVHQ4E
FgQUwNdNkEQtd0n/aofzN7/EeYPPPbIwHwYDVR0jBBgwFoAUwNdNkEQtd0n/aofz
N7/EeYPPPbIwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAnOnw
o8Az/bL0A6bGHTYra3L9ArIIljMajT6KDHxylR4LhliuVNAznnhP3UkcZbUdjqjp
MNOM0lej2pNioondtQdXUskZtqWy6+dLbTm1RYQh1lbCCZQ26o7o/oENzjPksLAb
jRM47DYxRweTyRWQ5t9wvg/xL0Yi1tWq4u4FCNZlBMgdwAEnXNwVWTzRR9RHwy20
lmUzM8uQ/p42bk4EvPEV4PI1h5G0khQ6x9CtkadCTDs/ZqoUaJMwZBIDSrdJJSLw
4Vh8Lqzia1CFB4um9J4S1Gm/VZMBjjeGGBJk7VSYn4ZmhPlbPM+6z39lpQGEG0x4
r1USnb+wUdA7Zoj/mQ==
-----END CERTIFICATE-----`;

describe('openclaw auth resolution', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('prefers password when auth mode is password', () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(JSON.stringify({
      gateway: {
        port: 18789,
        auth: {
          mode: 'password',
          token: 'legacy-token',
          password: 'gateway-password',
        },
      },
    }));

    expect(readOpenClawInfo()).toMatchObject({
      authMode: 'password',
      token: 'legacy-token',
      password: 'gateway-password',
    });
    expect(resolveGatewayAuth()).toEqual({
      token: null,
      password: 'gateway-password',
      label: 'password',
    });
  });

  it('returns an explicit error when both token and password exist without mode', () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(JSON.stringify({
      gateway: {
        auth: {
          token: 'gateway-token',
          password: 'gateway-password',
        },
      },
    }));

    expect(resolveGatewayAuth()).toMatchObject({
      token: 'gateway-token',
      password: 'gateway-password',
      error: expect.stringContaining('gateway.auth.mode is unset'),
    });
  });

  it('recognizes SecretRef-backed gateway auth without exposing the secret value', () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(JSON.stringify({
      gateway: {
        auth: {
          mode: 'token',
          token: { source: 'env', id: 'OPENCLAW_GATEWAY_TOKEN' },
        },
      },
    }));

    const info = readOpenClawInfo();
    expect(info).toMatchObject({
      authMode: 'token',
      tokenConfigured: true,
      passwordConfigured: false,
      token: null,
      password: null,
    });
    expect(isOpenClawGatewayAuthConfigured(info)).toBe(true);
  });

  it('falls back to env-provided password when config is absent', () => {
    fsMock.existsSync.mockReturnValue(false);
    vi.stubEnv('OPENCLAW_GATEWAY_PASSWORD', 'password-from-env');

    expect(resolveGatewayAuth()).toEqual({
      token: null,
      password: 'password-from-env',
      label: 'password',
    });
  });

  it('prefers env-provided gateway port over config port', () => {
    vi.stubEnv('OPENCLAW_GATEWAY_PORT', '29999');
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(JSON.stringify({
      gateway: {
        port: 18789,
        auth: {
          token: 'gateway-token',
        },
      },
    }));

    expect(readOpenClawInfo()).toMatchObject({
      configFound: true,
      gatewayPort: 29999,
      gatewayTlsEnabled: false,
      token: 'gateway-token',
    });
    expect(resolveGatewayUrl()).toBe('ws://127.0.0.1:29999');
  });

  it('uses env-provided gateway port when config is absent', () => {
    vi.stubEnv('OPENCLAW_GATEWAY_PORT', '29999');
    fsMock.existsSync.mockReturnValue(false);

    expect(readOpenClawInfo()).toMatchObject({
      configFound: false,
      gatewayPort: 29999,
      gatewayTlsEnabled: false,
    });
    expect(resolveGatewayUrl()).toBe('ws://127.0.0.1:29999');
  });

  it('switches the local gateway URL to wss and loads the cert fingerprint when tls is enabled', () => {
    const fingerprint = new X509Certificate(TLS_CERT_PEM).fingerprint256?.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
    fsMock.existsSync.mockImplementation((path) =>
      path === '/Users/tester/.openclaw/openclaw.json'
      || path === '/Users/tester/.openclaw/gateway/tls/gateway-cert.pem',
    );
    fsMock.readFileSync.mockImplementation((path) => {
      if (path === '/Users/tester/.openclaw/openclaw.json') {
        return JSON.stringify({
          gateway: {
            port: 18789,
            tls: {
              enabled: true,
            },
            auth: {
              token: 'gateway-token',
            },
          },
        });
      }
      if (path === '/Users/tester/.openclaw/gateway/tls/gateway-cert.pem') {
        return TLS_CERT_PEM;
      }
      throw new Error(`unexpected path: ${String(path)}`);
    });

    expect(readOpenClawInfo()).toMatchObject({
      gatewayTlsEnabled: true,
      gatewayTlsFingerprint: fingerprint,
    });
    expect(resolveGatewayUrl()).toBe('wss://127.0.0.1:18789');
  });

  it('falls back to the default gateway port when env port is invalid', () => {
    vi.stubEnv('OPENCLAW_GATEWAY_PORT', '0');
    fsMock.existsSync.mockReturnValue(false);

    expect(readOpenClawInfo()).toMatchObject({
      configFound: false,
      gatewayPort: null,
    });
    expect(resolveGatewayUrl()).toBe('ws://127.0.0.1:18789');
  });

  it('falls back to /root/.openclaw when the user home config is absent', () => {
    fsMock.existsSync.mockImplementation((path) => path === '/root/.openclaw/openclaw.json');
    fsMock.readFileSync.mockReturnValue(JSON.stringify({
      gateway: {
        port: 28789,
        auth: {
          token: 'root-token',
        },
      },
    }));

    expect(readOpenClawInfo()).toMatchObject({
      configFound: true,
      gatewayPort: 28789,
      token: 'root-token',
    });
    expect(getOpenClawConfigDir()).toBe('/root/.openclaw');
    expect(getOpenClawConfigPath()).toBe('/root/.openclaw/openclaw.json');
    expect(getOpenClawStateDir()).toBe('/root/.openclaw');
    expect(getOpenClawMediaDir()).toBe('/root/.openclaw/media');
  });

  it('reports both user and root config candidates without duplicates', () => {
    expect(getOpenClawConfigCandidates()).toEqual([
      '/Users/tester/.openclaw',
      '/root/.openclaw',
    ]);
  });

  it('does not let OPENCLAW_CONFIG_PATH override the bootstrap state dir', () => {
    vi.stubEnv('OPENCLAW_CONFIG_PATH', '/opt/openclaw/custom/openclaw.json');
    fsMock.existsSync.mockImplementation((path) => path === '/opt/openclaw/custom/openclaw.json');
    fsMock.readFileSync.mockReturnValue(JSON.stringify({
      gateway: {
        port: 28789,
      },
    }));

    expect(readOpenClawInfo()).toMatchObject({
      configFound: true,
      gatewayPort: 28789,
    });
    expect(getOpenClawConfigDir()).toBe('/opt/openclaw/custom');
    expect(getOpenClawStateDir()).toBe('/Users/tester/.openclaw');
    expect(getOpenClawBootstrapPath()).toBe('/Users/tester/.openclaw/devices/bootstrap.json');
  });

  it('uses OPENCLAW_STATE_DIR as the bootstrap state root when provided', () => {
    vi.stubEnv('OPENCLAW_STATE_DIR', '/srv/openclaw-state');
    fsMock.existsSync.mockReturnValue(false);

    expect(getOpenClawStateDir()).toBe('/srv/openclaw-state');
    expect(getOpenClawBootstrapPath()).toBe('/srv/openclaw-state/devices/bootstrap.json');
  });

  it('writes bound bootstrap tokens to the active state dir and prunes expired entries', async () => {
    const disk = new Map<string, string>();
    const bootstrapPath = '/root/.openclaw/devices/bootstrap.json';
    const nowMs = 1_700_000_000_000;
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowMs);

    fsMock.existsSync.mockImplementation((path) => path === '/root/.openclaw/openclaw.json');
    fsMock.readFileSync.mockReturnValue(JSON.stringify({
      gateway: {
        port: 28789,
        auth: {
          token: 'root-token',
        },
      },
    }));

    disk.set(bootstrapPath, JSON.stringify({
      expired: {
        token: 'expired',
        ts: nowMs - DEVICE_BOOTSTRAP_TOKEN_TTL_MS - 1,
        deviceId: 'old-device',
        publicKey: 'old-public-key',
        roles: ['operator'],
        scopes: ['operator.read'],
        issuedAtMs: nowMs - DEVICE_BOOTSTRAP_TOKEN_TTL_MS - 1,
      },
    }));

    fsPromisesMock.readFile.mockImplementation(async (path) => {
      const key = String(path);
      const existing = disk.get(key);
      if (existing == null) {
        throw new Error('ENOENT');
      }
      return existing;
    });
    fsPromisesMock.writeFile.mockImplementation(async (path, content) => {
      disk.set(String(path), String(content));
    });
    fsPromisesMock.rename.mockImplementation(async (from, to) => {
      const content = disk.get(String(from));
      if (content == null) {
        throw new Error('ENOENT');
      }
      disk.set(String(to), content);
      disk.delete(String(from));
    });
    fsPromisesMock.rm.mockImplementation(async (path) => {
      disk.delete(String(path));
    });
    fsPromisesMock.mkdir.mockResolvedValue(undefined);
    fsPromisesMock.chmod.mockResolvedValue(undefined);
    childProcessMock.execFile.mockImplementation((_command, _args, _options, callback) => {
      const error = new Error('unknown command qr');
      callback(error, '', 'unknown command qr');
    });

    const issued = await issueOpenClawBootstrapToken({
      deviceId: 'device-1',
      publicKey: 'public-key-1',
      role: 'operator',
      scopes: ['operator.write', 'operator.read', 'operator.read'],
    });

    const persisted = JSON.parse(disk.get(bootstrapPath) ?? '{}') as Record<string, {
      token: string;
      ts: number;
      deviceId?: string;
      publicKey?: string;
      roles?: string[];
      scopes?: string[];
      issuedAtMs: number;
    }>;

    expect(issued.statePath).toBe(bootstrapPath);
    expect(issued.expiresAtMs).toBe(nowMs + DEVICE_BOOTSTRAP_TOKEN_TTL_MS);
    expect(Object.keys(persisted)).toHaveLength(1);
    expect(persisted[issued.token]).toEqual({
      token: issued.token,
      ts: nowMs,
      deviceId: 'device-1',
      publicKey: 'public-key-1',
      roles: ['operator'],
      scopes: ['operator.read', 'operator.write'],
      issuedAtMs: nowMs,
    });

    expect(fsPromisesMock.rename).toHaveBeenCalledOnce();
    dateNowSpy.mockRestore();
  });

  it('issues official mobile setup credentials through the current OpenClaw CLI', async () => {
    const expiresAtMs = Date.now() + 60_000;
    const setupCode = Buffer.from(JSON.stringify({
      url: 'wss://relay.example.com/ws',
      bootstrapToken: 'official-bootstrap-token',
      expiresAtMs,
    })).toString('base64url');
    childProcessMock.execFile.mockImplementation((_command, _args, _options, callback) => {
      callback(null, JSON.stringify({ setupCode, access: 'full' }), '');
    });

    await expect(issueOpenClawPairingSetupToken({
      gatewayUrl: 'wss://relay.example.com/ws',
    })).resolves.toEqual({
      token: 'official-bootstrap-token',
      expiresAtMs,
      strategy: 'mobile-setup',
      access: 'full',
    });
    const [command, args, options, callback] = childProcessMock.execFile.mock.calls[0];
    expect(command).toBe('openclaw');
    expect(args).toEqual(['qr', '--json', '--url', 'wss://relay.example.com/ws']);
    expect((options as { env: NodeJS.ProcessEnv }).env.OPENCLAW_STATE_DIR).toBeTruthy();
    expect(callback).toEqual(expect.any(Function));
    expect(fsPromisesMock.writeFile).not.toHaveBeenCalled();
  });

  it('configures LAN bind/origin against the active root-owned config', async () => {
    const calls: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
    fsMock.existsSync.mockImplementation((path) => path === '/root/.openclaw/openclaw.json');
    childProcessMock.execFile.mockImplementation((command, args, options, callback) => {
      calls.push({
        command: String(command),
        args: (args as string[]).slice(),
        env: (options as { env: NodeJS.ProcessEnv }).env,
      });
      const joined = (args as string[]).join(' ');
      if (joined === 'config get gateway.bind') {
        callback(null, 'loopback\n', '');
        return;
      }
      if (joined === 'config get gateway.controlUi.allowedOrigins --json') {
        callback(null, '["http://127.0.0.1:18789"]\n', '');
        return;
      }
      if (joined === 'config set gateway.bind lan') {
        callback(null, 'Updated gateway.bind. Restart the gateway to apply.\n', '');
        return;
      }
      if (
        joined === 'config set gateway.controlUi.allowedOrigins ["http://127.0.0.1:18789","http://192.168.1.12:18789"] --strict-json'
      ) {
        callback(null, 'Updated gateway.controlUi.allowedOrigins. Restart the gateway to apply.\n', '');
        return;
      }
      callback(new Error(`Unexpected command: ${joined}`), '', '');
    });

    const result = await configureOpenClawLanAccess({
      controlUiOrigin: 'http://192.168.1.12:18789',
    });

    expect(result).toEqual({
      configPath: '/root/.openclaw/openclaw.json',
      bindChanged: true,
      allowedOriginAdded: true,
      allowedOrigins: ['http://127.0.0.1:18789', 'http://192.168.1.12:18789'],
      controlUiOrigin: 'http://192.168.1.12:18789',
    });
    expect(calls).toHaveLength(4);
    expect(calls.every((call) => call.command === 'openclaw')).toBe(true);
    expect(calls.every((call) => call.env.OPENCLAW_STATE_DIR === '/root/.openclaw')).toBe(true);
    expect(calls.every((call) => call.env.OPENCLAW_CONFIG_PATH === '/root/.openclaw/openclaw.json')).toBe(true);
  });

  it('reuses an existing allowed origin without rewriting config', async () => {
    fsMock.existsSync.mockImplementation((path) => path === '/Users/tester/.openclaw/openclaw.json');
    childProcessMock.execFile.mockImplementation((_command, args, _options, callback) => {
      const joined = (args as string[]).join(' ');
      if (joined === 'config get gateway.bind') {
        callback(null, 'lan\n', '');
        return;
      }
      if (joined === 'config get gateway.controlUi.allowedOrigins --json') {
        callback(null, '["http://192.168.1.12:18789"]\n[plugins] noisy suffix\n', '');
        return;
      }
      callback(new Error(`Unexpected command: ${joined}`), '', '');
    });

    const result = await configureOpenClawLanAccess({
      controlUiOrigin: 'http://192.168.1.12:18789',
    });

    expect(result.bindChanged).toBe(false);
    expect(result.allowedOriginAdded).toBe(false);
    expect(childProcessMock.execFile).toHaveBeenCalledTimes(2);
  });

  it('treats missing gateway.bind and allowedOrigins as unset config paths', async () => {
    const calls: string[] = [];
    fsMock.existsSync.mockImplementation((path) => path === '/Users/tester/.openclaw/openclaw.json');
    childProcessMock.execFile.mockImplementation((_command, args, _options, callback) => {
      const joined = (args as string[]).join(' ');
      calls.push(joined);
      if (joined === 'config get gateway.bind') {
        const error = new Error('exit 1') as Error & { code?: number };
        error.code = 1;
        callback(error, 'Config path not found: gateway.bind\n', '');
        return;
      }
      if (joined === 'config get gateway.controlUi.allowedOrigins --json') {
        const error = new Error('exit 1') as Error & { code?: number };
        error.code = 1;
        callback(error, 'Config path not found: gateway.controlUi.allowedOrigins\n', '');
        return;
      }
      if (joined === 'config set gateway.bind lan') {
        callback(null, 'Updated gateway.bind. Restart the gateway to apply.\n', '');
        return;
      }
      if (joined === 'config set gateway.controlUi.allowedOrigins ["http://192.168.1.12:18789"] --strict-json') {
        callback(null, 'Updated gateway.controlUi.allowedOrigins. Restart the gateway to apply.\n', '');
        return;
      }
      callback(new Error(`Unexpected command: ${joined}`), '', '');
    });

    const result = await configureOpenClawLanAccess({
      controlUiOrigin: 'http://192.168.1.12:18789',
    });

    expect(result.bindChanged).toBe(true);
    expect(result.allowedOriginAdded).toBe(true);
    expect(result.allowedOrigins).toEqual(['http://192.168.1.12:18789']);
    expect(calls).toEqual([
      'config get gateway.bind',
      'config get gateway.controlUi.allowedOrigins --json',
      'config set gateway.bind lan',
      'config set gateway.controlUi.allowedOrigins ["http://192.168.1.12:18789"] --strict-json',
    ]);
  });

  it('starts the gateway when restart reports service not loaded', async () => {
    fsMock.existsSync.mockImplementation((path) => path === '/Users/tester/.openclaw/openclaw.json');
    childProcessMock.execFile.mockImplementation((_command, args, _options, callback) => {
      const joined = (args as string[]).join(' ');
      if (joined === 'gateway restart --json') {
        callback(null, [
          '[plugins] noisy startup log',
          JSON.stringify({
            ok: true,
            action: 'restart',
            result: 'not-loaded',
            message: 'Gateway service is not loaded.',
          }, null, 2),
        ].join('\n'), '');
        return;
      }
      if (joined === 'gateway start --json') {
        callback(null, JSON.stringify({
          ok: true,
          action: 'start',
          result: 'started',
          message: 'Gateway started.',
        }), '');
        return;
      }
      callback(new Error(`Unexpected command: ${joined}`), '', '');
    });

    await expect(restartOpenClawGateway()).resolves.toEqual({
      action: 'started',
      result: 'started',
      message: 'Gateway started.',
      warnings: [],
    });
  });

  it('parses doctor json output even when the command exits non-zero', async () => {
    fsMock.existsSync.mockImplementation((path) => path === '/Users/tester/.openclaw/openclaw.json');
    childProcessMock.execFile.mockImplementation((_command, args, _options, callback) => {
      const joined = (args as string[]).join(' ');
      if (joined === 'doctor --json') {
        const error = new Error('exit 1') as Error & { code?: number };
        error.code = 1;
        callback(error, JSON.stringify({
          ok: false,
          summary: 'Issues found: 1',
          checks: [
            { name: 'Gateway config', status: 'fail', message: 'Missing auth token' },
          ],
        }), '');
        return;
      }
      callback(new Error(`Unexpected command: ${joined}`), '', '');
    });

    await expect(runOpenClawDoctor()).resolves.toEqual({
      ok: false,
      summary: 'Issues found: 1',
      checks: [
        { name: 'Gateway config', status: 'fail', message: 'Missing auth token' },
      ],
    });
  });

  it.each([false, true])('preserves current doctor findings when CLI failure is %s', async (failed) => {
    fsMock.existsSync.mockImplementation((path) => path === '/Users/tester/.openclaw/openclaw.json');
    childProcessMock.execFile.mockImplementation((_command, _args, _options, callback) => {
      const error = failed ? Object.assign(new Error('exit 1'), { code: 1 }) : null;
      callback(error, JSON.stringify({
        ok: !failed, checksRun: 2, checksSkipped: 0,
        findings: [
          { checkId: 'gateway-auth', severity: 'error', message: 'Missing auth', fixHint: 'Configure auth' },
          { checkId: 'plugin-config', severity: 'warning', message: 'Review plugin' },
        ],
      }), '');
    });
    await expect(runOpenClawDoctor()).resolves.toEqual({
      ok: !failed, summary: '', checks: [
        { name: 'gateway-auth', status: 'fail', message: 'Missing auth\n\nConfigure auth' },
        { name: 'plugin-config', status: 'warn', message: 'Review plugin' },
      ],
    });
  });

  it('falls back to plain doctor output when json mode is unsupported', async () => {
    fsMock.existsSync.mockImplementation((path) => path === '/Users/tester/.openclaw/openclaw.json');
    childProcessMock.execFile.mockImplementation((_command, args, _options, callback) => {
      const joined = (args as string[]).join(' ');
      if (joined === 'doctor --json') {
        const error = new Error('exit 1') as Error & { code?: number };
        error.code = 1;
        callback(error, '', 'unknown option --json');
        return;
      }
      if (joined === 'doctor') {
        const error = new Error('exit 1') as Error & { code?: number };
        error.code = 1;
        callback(error, '\u001b[31mIssues found: 1\u001b[39m\nRun openclaw doctor --fix\n', '');
        return;
      }
      callback(new Error(`Unexpected command: ${joined}`), '', '');
    });

    await expect(runOpenClawDoctor()).resolves.toEqual({
      ok: false,
      summary: '',
      checks: [],
      raw: 'Issues found: 1\nRun openclaw doctor --fix',
    });
  });

  it('includes stderr warnings in plain doctor fallback output', async () => {
    fsMock.existsSync.mockImplementation((path) => path === '/Users/tester/.openclaw/openclaw.json');
    childProcessMock.execFile.mockImplementation((_command, args, _options, callback) => {
      const joined = (args as string[]).join(' ');
      if (joined === 'doctor --json') {
        const error = new Error('exit 1') as Error & { code?: number };
        error.code = 1;
        callback(error, '', 'error: unknown option --json');
        return;
      }
      if (joined === 'doctor') {
        callback(
          null,
          'Doctor warnings\nGateway needs restart\n',
          '[plugins] plugin warning\n',
        );
        return;
      }
      callback(new Error(`Unexpected command: ${joined}`), '', '');
    });

    await expect(runOpenClawDoctor()).resolves.toEqual({
      ok: true,
      summary: '',
      checks: [],
      raw: 'Doctor warnings\nGateway needs restart\n[plugins] plugin warning',
    });
  });

  it('returns doctor --fix output even when the command exits non-zero', async () => {
    fsMock.existsSync.mockImplementation((path) => path === '/Users/tester/.openclaw/openclaw.json');
    childProcessMock.execFile.mockImplementation((_command, args, _options, callback) => {
      const joined = (args as string[]).join(' ');
      if (joined === 'doctor --fix') {
        const error = new Error('exit 1') as Error & { code?: number };
        error.code = 1;
        callback(error, '\u001b[33mRestart required\u001b[39m\nFixed 2 issues\n', '');
        return;
      }
      callback(new Error(`Unexpected command: ${joined}`), '', '');
    });

    await expect(runOpenClawDoctorFix()).resolves.toEqual({
      ok: false,
      summary: '',
      raw: 'Restart required\nFixed 2 issues',
    });
  });

  it('includes stderr output in doctor --fix results', async () => {
    fsMock.existsSync.mockImplementation((path) => path === '/Users/tester/.openclaw/openclaw.json');
    childProcessMock.execFile.mockImplementation((_command, args, _options, callback) => {
      const joined = (args as string[]).join(' ');
      if (joined === 'doctor --fix') {
        callback(null, 'Fixed 2 issues\n', '[plugins] warning\n');
        return;
      }
      callback(new Error(`Unexpected command: ${joined}`), '', '');
    });

    await expect(runOpenClawDoctorFix()).resolves.toEqual({
      ok: true,
      summary: '',
      raw: 'Fixed 2 issues\n[plugins] warning',
    });
  });

  it('reads exec approvals from OPENCLAW_HOME instead of the bridge state dir', async () => {
    vi.stubEnv('OPENCLAW_HOME', '/srv/openclaw-home');
    vi.stubEnv('OPENCLAW_STATE_DIR', '/srv/openclaw-state');
    fsMock.existsSync.mockImplementation((path) => path === '/srv/openclaw-state/openclaw.json');
    fsPromisesMock.readFile.mockImplementation(async (path) => {
      const target = String(path);
      if (target === '/srv/openclaw-state/openclaw.json') {
        return JSON.stringify({
          tools: {
            exec: {
              host: 'gateway',
              security: 'full',
              ask: 'off',
            },
          },
        });
      }
      if (target === '/srv/openclaw-home/.openclaw/exec-approvals.json') {
        return JSON.stringify({
          version: 1,
          defaults: {
            security: 'allowlist',
            ask: 'always',
          },
          agents: {
            main: {
              allowlist: [{ pattern: '/usr/bin/git' }],
            },
          },
        });
      }
      throw new Error(`ENOENT: ${target}`);
    });

    await expect(readOpenClawPermissions()).resolves.toMatchObject({
      configPath: '/srv/openclaw-state/openclaw.json',
      approvalsPath: '/srv/openclaw-home/.openclaw/exec-approvals.json',
      exec: {
        approvalsExists: true,
        approvalsSecurity: 'allowlist',
        approvalsAsk: 'always',
        effectiveSecurity: 'allowlist',
        effectiveAsk: 'always',
        allowlistCount: 1,
      },
    });
  });

  it('counts legacy default agent allowlist entries in exec approvals', async () => {
    vi.stubEnv('HOME', '/Users/tester');
    fsMock.existsSync.mockImplementation((path) => path === '/Users/tester/.openclaw/openclaw.json');
    fsPromisesMock.readFile.mockImplementation(async (path) => {
      const target = String(path);
      if (target === '/Users/tester/.openclaw/openclaw.json') {
        return JSON.stringify({
          tools: {
            exec: {
              host: 'gateway',
              security: 'allowlist',
              ask: 'off',
            },
          },
        });
      }
      if (target === '/Users/tester/.openclaw/exec-approvals.json') {
        return JSON.stringify({
          version: 1,
          agents: {
            default: {
              allowlist: [
                { pattern: '/usr/bin/python3' },
                { pattern: '/usr/bin/python3' },
              ],
            },
          },
        });
      }
      throw new Error(`ENOENT: ${target}`);
    });

    await expect(readOpenClawPermissions()).resolves.toMatchObject({
      approvalsPath: '/Users/tester/.openclaw/exec-approvals.json',
      exec: {
        approvalsExists: true,
        allowlistCount: 1,
        status: 'restricted',
      },
    });
  });

  it('treats config env keys as valid web search credentials', async () => {
    vi.stubEnv('HOME', '/Users/tester');
    fsMock.existsSync.mockImplementation((path) => path === '/Users/tester/.openclaw/openclaw.json');
    fsPromisesMock.readFile.mockImplementation(async (path) => {
      const target = String(path);
      if (target === '/Users/tester/.openclaw/openclaw.json') {
        return JSON.stringify({
          env: {
            OPENROUTER_API_KEY: 'sk-or-v1-test-key',
          },
          tools: {
            web: {
              search: {
                enabled: true,
              },
              fetch: {
                enabled: true,
              },
            },
          },
        });
      }
      throw new Error(`ENOENT: ${target}`);
    });

    await expect(readOpenClawPermissions()).resolves.toMatchObject({
      web: {
        status: 'available',
        searchConfigured: true,
        searchProvider: 'auto',
      },
    });
  });

  it('explains when exec approvals are stricter than tools.exec settings', async () => {
    vi.stubEnv('HOME', '/Users/tester');
    fsMock.existsSync.mockImplementation((path) => path === '/Users/tester/.openclaw/openclaw.json');
    fsPromisesMock.readFile.mockImplementation(async (path) => {
      const target = String(path);
      if (target === '/Users/tester/.openclaw/openclaw.json') {
        return JSON.stringify({
          tools: {
            exec: {
              host: 'gateway',
              security: 'full',
              ask: 'on-miss',
            },
          },
        });
      }
      if (target === '/Users/tester/.openclaw/exec-approvals.json') {
        return JSON.stringify({
          version: 1,
          defaults: {
            security: 'allowlist',
            ask: 'always',
          },
          agents: {
            main: {
              security: 'allowlist',
              ask: 'always',
              allowlist: [],
            },
          },
        });
      }
      throw new Error(`ENOENT: ${target}`);
    });

    await expect(readOpenClawPermissions()).resolves.toMatchObject({
      exec: {
        status: 'needs_approval',
        summary: 'Commands can run, but exec approvals currently require confirmation.',
        reasons: expect.arrayContaining([
          'exec-approvals.json is stricter than tools.exec.security (full -> allowlist).',
          'exec-approvals.json is stricter than tools.exec.ask (on-miss -> always).',
        ]),
      },
      codeExecution: {
        status: 'needs_approval',
        summary: 'Running scripts or code inherits the current exec approval requirement.',
      },
    });
  });

  it('does not apply host approval rules when exec runs in sandbox mode', async () => {
    vi.stubEnv('HOME', '/Users/tester');
    fsMock.existsSync.mockImplementation((path) => path === '/Users/tester/.openclaw/openclaw.json');
    fsPromisesMock.readFile.mockImplementation(async (path) => {
      const target = String(path);
      if (target === '/Users/tester/.openclaw/openclaw.json') {
        return JSON.stringify({
          tools: {
            exec: {
              security: 'full',
              ask: 'on-miss',
            },
          },
        });
      }
      if (target === '/Users/tester/.openclaw/exec-approvals.json') {
        return JSON.stringify({
          version: 1,
          defaults: {
            security: 'allowlist',
            ask: 'always',
          },
          agents: {
            main: {
              security: 'allowlist',
              ask: 'always',
            },
          },
        });
      }
      throw new Error(`ENOENT: ${target}`);
    });

    await expect(readOpenClawPermissions()).resolves.toMatchObject({
      exec: {
        currentAgentId: 'main',
        toolProfile: 'unset',
        execToolAvailable: true,
        hostApprovalsApply: false,
        implicitSandboxFallback: true,
        configuredHost: 'sandbox',
        effectiveHost: 'gateway',
        sandboxMode: 'off',
        status: 'available',
        summary: 'Commands currently run directly on this OpenClaw machine.',
        effectiveSecurity: 'full',
        effectiveAsk: 'off',
        reasons: expect.arrayContaining([
          'Sandbox mode is off, so commands are not running in an isolated sandbox.',
          'OpenClaw is currently falling back to direct host execution on this machine.',
        ]),
      },
      codeExecution: {
        status: 'available',
        summary: 'Scripts follow the same direct command path as command execution on this machine.',
      },
    });
  });

  it('uses the main agent tool profile when that overrides the global profile', async () => {
    vi.stubEnv('HOME', '/Users/tester');
    fsMock.existsSync.mockImplementation((path) => path === '/Users/tester/.openclaw/openclaw.json');
    fsPromisesMock.readFile.mockImplementation(async (path) => {
      const target = String(path);
      if (target === '/Users/tester/.openclaw/openclaw.json') {
        return JSON.stringify({
          agents: {
            list: [
              {
                id: 'main',
                default: true,
                name: 'Lucy',
                tools: {
                  profile: 'full',
                },
              },
            ],
          },
          tools: {
            profile: 'messaging',
            exec: {
              security: 'deny',
              ask: 'always',
            },
          },
        });
      }
      throw new Error(`ENOENT: ${target}`);
    });

    await expect(readOpenClawPermissions()).resolves.toMatchObject({
      exec: {
        currentAgentId: 'main',
        currentAgentName: 'Lucy',
        toolProfile: 'full',
        execToolAvailable: true,
        implicitSandboxFallback: true,
        status: 'available',
        summary: 'Commands currently run directly on this OpenClaw machine.',
      },
      codeExecution: {
        status: 'available',
        summary: 'Scripts follow the same direct command path as command execution on this machine.',
      },
    });
  });

  it('reports sandbox as the effective host when sandbox mode is enabled for the main agent', async () => {
    vi.stubEnv('HOME', '/Users/tester');
    fsMock.existsSync.mockImplementation((path) => path === '/Users/tester/.openclaw/openclaw.json');
    fsPromisesMock.readFile.mockImplementation(async (path) => {
      const target = String(path);
      if (target === '/Users/tester/.openclaw/openclaw.json') {
        return JSON.stringify({
          agents: {
            defaults: {
              sandbox: {
                mode: 'all',
              },
            },
          },
          tools: {
            exec: {
              security: 'full',
              ask: 'on-miss',
            },
          },
        });
      }
      if (target === '/Users/tester/.openclaw/exec-approvals.json') {
        return JSON.stringify({
          version: 1,
          defaults: {
            security: 'allowlist',
            ask: 'always',
          },
        });
      }
      throw new Error(`ENOENT: ${target}`);
    });

    await expect(readOpenClawPermissions()).resolves.toMatchObject({
      exec: {
        configuredHost: 'sandbox',
        effectiveHost: 'sandbox',
        sandboxMode: 'all',
        status: 'available',
        summary: 'Commands run inside OpenClaw\'s sandbox.',
        effectiveSecurity: 'full',
        effectiveAsk: 'off',
      },
      codeExecution: {
        status: 'available',
        summary: 'Code runs inside OpenClaw\'s sandbox.',
      },
    });
  });
});
