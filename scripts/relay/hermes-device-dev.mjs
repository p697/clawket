import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';

const [, , mode, ...restArgs] = process.argv;

if (!mode || !['registry', 'worker', 'pair'].includes(mode)) {
  console.error('Usage: node scripts/relay/hermes-device-dev.mjs <registry|worker|pair> [--public-host <ip>] [--registry-port <8787>] [--worker-port <8788>]');
  process.exit(1);
}

const workspaceRoot = process.cwd();
const publicHost = readFlag(restArgs, '--public-host') ?? detectLanIp();
const registryPort = Number(readFlag(restArgs, '--registry-port') ?? '8787');
const workerPort = Number(readFlag(restArgs, '--worker-port') ?? '8788');

if (!publicHost) {
  console.error('Failed to determine a LAN IP address. Pass --public-host explicitly.');
  process.exit(1);
}

if (mode === 'pair') {
  const result = spawnSync(
    'npm',
    [
      'run',
      '--workspace',
      '@p697/clawket',
      'hermes:pair:relay',
      '--',
      '--server',
      `http://${publicHost}:${registryPort}`,
    ],
    {
      cwd: workspaceRoot,
      stdio: 'inherit',
      env: process.env,
    },
  );
  process.exit(result.status ?? 1);
}

const wranglerBin = path.join(
  workspaceRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler',
);
const appName = mode === 'registry' ? 'hermes-relay-registry' : 'hermes-relay-worker';
const configPath = writeTempConfig({
  workspaceRoot,
  appName,
  publicHost,
  registryPort,
  workerPort,
});

console.error(`[hermes-device-dev] public host ${publicHost}`);
console.error(`[hermes-device-dev] temp config ${configPath}`);

const args = [
  'dev',
  '--config',
  configPath,
  '--cwd',
  workspaceRoot,
  '--ip',
  '0.0.0.0',
  '--port',
  String(mode === 'registry' ? registryPort : workerPort),
];

const result = spawnSync(wranglerBin, args, {
  cwd: workspaceRoot,
  stdio: 'inherit',
  env: process.env,
});

rmSync(path.dirname(configPath), { recursive: true, force: true });
process.exit(result.status ?? 1);

function writeTempConfig(input) {
  const tempDir = mkdtempSync(path.join(tmpdir(), `clawket-${input.appName}-`));
  const configPath = path.join(tempDir, 'wrangler.toml');

  if (input.appName === 'hermes-relay-registry') {
    writeFileSync(configPath, [
      'name = "clawket-hermes-registry"',
      `main = "${escapeTomlString(path.join(input.workspaceRoot, 'apps', 'hermes-relay-registry', 'src', 'index.ts'))}"`,
      'compatibility_date = "2026-03-03"',
      'workers_dev = true',
      '',
      '[vars]',
      `RELAY_REGION_MAP = "${escapeTomlJson(JSON.stringify({
        cn: `ws://${input.publicHost}:${input.workerPort}/ws`,
        sg: `ws://${input.publicHost}:${input.workerPort}/ws`,
        us: `ws://${input.publicHost}:${input.workerPort}/ws`,
        eu: `ws://${input.publicHost}:${input.workerPort}/ws`,
      }))}"`,
      'PAIR_ACCESS_CODE_TTL_SEC = "600"',
      'PAIR_CLIENT_TOKEN_MAX = "8"',
      '',
      '[[kv_namespaces]]',
      'binding = "HERMES_ROUTES_KV"',
      'id = "00000000000000000000000000000000"',
      'preview_id = "00000000000000000000000000000000"',
      '',
    ].join('\n'), 'utf8');
    return configPath;
  }

  writeFileSync(configPath, [
    'name = "clawket-hermes-relay"',
    `main = "${escapeTomlString(path.join(input.workspaceRoot, 'apps', 'hermes-relay-worker', 'src', 'index.ts'))}"`,
    'compatibility_date = "2026-03-03"',
    'workers_dev = true',
    '',
    '[vars]',
    'MAX_MESSAGES_PER_10S = "120"',
    'MAX_CLIENT_MESSAGES_PER_10S = "300"',
    'HEARTBEAT_INTERVAL_MS = "30000"',
    'AWAITING_CHALLENGE_TTL_MS = "25000"',
    'CLIENT_IDLE_TIMEOUT_MS = "600000"',
    `REGISTRY_VERIFY_URL = "http://${input.publicHost}:${input.registryPort}"`,
    'GATEWAY_OWNER_LEASE_MS = "20000"',
    '',
    '[[durable_objects.bindings]]',
    'name = "HERMES_ROOM"',
    'class_name = "HermesRelayRoom"',
    '',
    '[[kv_namespaces]]',
    'binding = "HERMES_ROUTES_KV"',
    'id = "00000000000000000000000000000000"',
    'preview_id = "00000000000000000000000000000000"',
    '',
    '[[migrations]]',
    'tag = "v1"',
    'new_sqlite_classes = ["HermesRelayRoom"]',
    '',
  ].join('\n'), 'utf8');
  return configPath;
}

function escapeTomlJson(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeTomlString(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function readFlag(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  return value?.trim() ? value.trim() : null;
}

function detectLanIp() {
  const preferredDarwinIp = detectPreferredDarwinLanIp();
  if (preferredDarwinIp) return preferredDarwinIp;
  const interfaces = networkInterfaces();
  let best = null;
  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4') continue;
      const score = scoreLanCandidate(name, address.address);
      if (score === 0) continue;
      if (!best || score > best.score) {
        best = { score, ip: address.address };
      }
    }
  }
  return best?.ip ?? null;
}

function detectPreferredDarwinLanIp() {
  if (process.platform !== 'darwin') return null;
  for (const interfaceName of ['en0', 'en1']) {
    const ip = readInterfaceIpv4(interfaceName);
    if (ip) return ip;
  }
  return null;
}

function readInterfaceIpv4(interfaceName) {
  try {
    const output = execFileSync('ipconfig', ['getifaddr', interfaceName], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return isLanIpv4(output) ? output : null;
  } catch {
    return null;
  }
}

function scoreLanCandidate(name, ip) {
  if (!isLanIpv4(ip)) return 0;
  const lower = name.toLowerCase();
  if (['utun', 'tun', 'tap', 'tailscale', 'wireguard', 'wg', 'vpn', 'docker', 'veth', 'vmnet', 'vbox', 'loopback', 'lo0', 'awdl', 'llw', 'bridge', 'br-', 'ppp']
    .some((token) => lower.includes(token))) {
    return 0;
  }
  let score = isRfc1918(ip) ? 120 : isCgnat(ip) ? 90 : 40;
  if (lower.startsWith('en') || lower.startsWith('eth') || lower.startsWith('wlan') || lower.startsWith('wl') || lower.includes('wifi')) {
    score += 20;
  }
  return score;
}

function isLanIpv4(ip) {
  if (!isValidIpv4(ip)) return false;
  if (ip === '0.0.0.0') return false;
  const [a, b, c, d] = ip.split('.').map(Number);
  if (a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a >= 224 && a <= 239) return false;
  if (a === 255 && b === 255 && c === 255 && d === 255) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  return isRfc1918(ip) || isCgnat(ip);
}

function isRfc1918(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function isCgnat(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 100 && b >= 64 && b <= 127;
}

function isValidIpv4(ip) {
  const parts = ip.split('.');
  return parts.length === 4 && parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}
