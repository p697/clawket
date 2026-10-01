import { execFileSync } from 'node:child_process';
import { hostname, platform } from 'node:os';

function cleanDeviceName(value: string): string {
  return Array.from(value.normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/gu, ' ').trim()).slice(0, 96).join('');
}

/** Product metadata for new pairings only; never use this label as an identity or diagnostic field. */
export function defaultDeviceConnectionName(product: 'Codex' | 'Claude Code'): string {
  let deviceName = '';
  if (platform() === 'darwin') {
    try {
      deviceName = cleanDeviceName(execFileSync('/usr/sbin/scutil', ['--get', 'ComputerName'], {
        encoding: 'utf8', timeout: 1_000, maxBuffer: 4_096, stdio: ['ignore', 'pipe', 'ignore'],
      }));
    } catch { /* Missing or unavailable system names fall back to the hostname. */ }
  }
  if (!deviceName) {
    try { deviceName = cleanDeviceName(hostname().replace(/\.local$/i, '')); }
    catch { /* Pairing remains usable when the host cannot provide a name. */ }
  }
  return deviceName ? `${product} · ${deviceName}` : product;
}
