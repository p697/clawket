import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { buildHermesRelayPairingQrPayload } from './qr.js';

const HERMES_RELAY_CONFIG_PATH = join(homedir(), '.clawket', 'hermes-relay.json');

export interface HermesRelayConfig {
  serverUrl: string;
  bridgeId: string;
  relaySecret: string;
  relayUrl: string;
  instanceId: string;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HermesRelayPairBridgeResult {
  bridgeId: string;
  relaySecret: string;
  relayUrl: string;
  accessCode: string;
  accessCodeExpiresAt: string;
  displayName: string | null;
  region: string;
}

export interface HermesRelayPairingInfo {
  config: HermesRelayConfig;
  accessCode: string;
  accessCodeExpiresAt: string;
  qrPayload: string;
  action: 'registered' | 'refreshed';
}

export function getHermesRelayConfigPath(): string {
  return HERMES_RELAY_CONFIG_PATH;
}

export function readHermesRelayConfig(): HermesRelayConfig | null {
  if (!existsSync(HERMES_RELAY_CONFIG_PATH)) return null;
  try {
    const parsed = JSON.parse(readFileSync(HERMES_RELAY_CONFIG_PATH, 'utf8')) as Partial<HermesRelayConfig>;
    if (!parsed.serverUrl || !parsed.bridgeId || !parsed.relaySecret || !parsed.relayUrl) {
      return null;
    }
    return {
      serverUrl: parsed.serverUrl,
      bridgeId: parsed.bridgeId,
      relaySecret: parsed.relaySecret,
      relayUrl: parsed.relayUrl,
      instanceId: parsed.instanceId?.trim() || createHermesRelayInstanceId(),
      displayName: parsed.displayName ?? null,
      createdAt: parsed.createdAt ?? new Date().toISOString(),
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeHermesRelayConfig(config: HermesRelayConfig): void {
  mkdirSync(join(homedir(), '.clawket'), { recursive: true });
  writeFileSync(HERMES_RELAY_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

export function deleteHermesRelayConfig(): void {
  if (!existsSync(HERMES_RELAY_CONFIG_PATH)) return;
  rmSync(HERMES_RELAY_CONFIG_PATH, { force: true });
}

export async function pairHermesRelay(input: {
  serverUrl: string;
  displayName?: string | null;
}): Promise<HermesRelayPairingInfo> {
  const baseUrl = normalizeHermesRelayHttpBase(input.serverUrl);
  const existing = readHermesRelayConfig();
  const compatibility = assessHermesRelayPairingCompatibility(existing, baseUrl);
  if (compatibility === 'refresh-existing' && existing) {
    try {
      return await refreshHermesRelayAccessCode({
        serverUrl: existing.serverUrl,
        bridgeId: existing.bridgeId,
        relaySecret: existing.relaySecret,
        displayName: input.displayName,
      });
    } catch (error) {
      if (!shouldRetryHermesRelayRegistration(error)) {
        throw error;
      }
    }
  }

  const response = await fetch(`${baseUrl}/v1/hermes/pair/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      displayName: input.displayName?.trim() || null,
    }),
  });
  if (!response.ok) {
    throw new Error(`Hermes pair register failed (${response.status}): ${summarizeFailedResponse(await response.text())}`);
  }

  const payload = await response.json() as HermesRelayPairBridgeResult;
  const now = new Date().toISOString();
  const config: HermesRelayConfig = {
    serverUrl: baseUrl,
    bridgeId: payload.bridgeId,
    relaySecret: payload.relaySecret,
    relayUrl: payload.relayUrl,
    instanceId: existing?.instanceId ?? createHermesRelayInstanceId(),
    displayName: payload.displayName,
    createdAt: now,
    updatedAt: now,
  };
  writeHermesRelayConfig(config);
  return {
    config,
    accessCode: payload.accessCode,
    accessCodeExpiresAt: payload.accessCodeExpiresAt,
    action: 'registered',
    qrPayload: buildHermesRelayPairingQrPayload({
      server: baseUrl,
      bridgeId: payload.bridgeId,
      accessCode: payload.accessCode,
      displayName: payload.displayName,
    }),
  };
}

export async function refreshHermesRelayAccessCode(input?: {
  serverUrl?: string;
  bridgeId?: string;
  relaySecret?: string;
  displayName?: string | null;
}): Promise<HermesRelayPairingInfo> {
  const existing = readHermesRelayConfig();
  const serverUrl = normalizeHermesRelayHttpBase(input?.serverUrl ?? existing?.serverUrl ?? '');
  const bridgeId = input?.bridgeId ?? existing?.bridgeId ?? '';
  const relaySecret = input?.relaySecret ?? existing?.relaySecret ?? '';
  if (!serverUrl || !bridgeId || !relaySecret) {
    throw new Error('Hermes relay pairing config not found. Run Hermes relay pair first.');
  }

  const response = await fetch(`${serverUrl}/v1/hermes/pair/access-code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      bridgeId,
      relaySecret,
      displayName: input?.displayName?.trim() || undefined,
    }),
  });
  if (!response.ok) {
    throw new Error(`Hermes access code refresh failed (${response.status}): ${summarizeFailedResponse(await response.text())}`);
  }

  const payload = await response.json() as {
    bridgeId: string;
    relayUrl: string;
    accessCode: string;
    accessCodeExpiresAt: string;
    displayName: string | null;
  };
  const nextConfig: HermesRelayConfig = {
    serverUrl,
    bridgeId: payload.bridgeId,
    relaySecret,
    relayUrl: payload.relayUrl,
    instanceId: existing?.instanceId ?? createHermesRelayInstanceId(),
    displayName: payload.displayName,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeHermesRelayConfig(nextConfig);
  return {
    config: nextConfig,
    accessCode: payload.accessCode,
    accessCodeExpiresAt: payload.accessCodeExpiresAt,
    action: 'refreshed',
    qrPayload: buildHermesRelayPairingQrPayload({
      server: serverUrl,
      bridgeId: payload.bridgeId,
      accessCode: payload.accessCode,
      displayName: payload.displayName,
    }),
  };
}

export function assessHermesRelayPairingCompatibility(
  existing: HermesRelayConfig | null,
  nextServerUrl: string,
): 'register-new' | 'refresh-existing' | 'server-mismatch' {
  if (!existing) return 'register-new';
  if (existing.serverUrl === nextServerUrl) return 'refresh-existing';
  return 'server-mismatch';
}

export function normalizeHermesRelayHttpBase(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed.replace(/\/+$/, '');
  }
  if (trimmed.startsWith('ws://')) return `http://${trimmed.slice('ws://'.length)}`.replace(/\/+$/, '');
  if (trimmed.startsWith('wss://')) return `https://${trimmed.slice('wss://'.length)}`.replace(/\/+$/, '');
  return `https://${trimmed}`.replace(/\/+$/, '');
}

function createHermesRelayInstanceId(): string {
  const host = hostname().trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'host';
  return `hermes-${host}-${randomUUID().slice(0, 10)}`;
}

function summarizeFailedResponse(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (!collapsed) return 'Empty response body';
  if (collapsed.length <= 240) return collapsed;
  return `${collapsed.slice(0, 237)}...`;
}

function shouldRetryHermesRelayRegistration(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('BRIDGE_NOT_FOUND');
}
