/**
 * Deep link URL parser for the `clawket://` scheme.
 *
 * Supported routes:
 *   clawket://agent?message=...&sessionKey=...
 *   clawket://session?key=...
 *   clawket://config
 *   clawket://connect?url=...&token=...
 *   clawket://hermes-pair?payload=...   (AirDrop / share-sheet handoff of a QR JSON payload)
 *   clawket://hermes-pair?url=...&bridgeUrl=...&transport=...&displayName=...
 */

import type { GatewayTransportKind } from '../types';

export type DeepLinkAction =
  | { type: 'agent'; message: string; sessionKey?: string }
  | { type: 'session'; key: string }
  | { type: 'config' }
  | { type: 'connect'; url: string; token?: string; password?: string }
  | {
    type: 'hermes-pair';
    url: string;
    bridgeUrl: string;
    transportKind: GatewayTransportKind;
    displayName?: string;
  };

function normalizeTransport(value: string | null | undefined): GatewayTransportKind {
  switch (value) {
    case 'local':
    case 'tailscale':
    case 'bonjour':
    case 'multipeer':
    case 'cloudflare':
    case 'custom':
    case 'relay':
      return value;
    default:
      return 'local';
  }
}

function parseHermesPairPayload(raw: string): DeepLinkAction | null {
  try {
    const payload = JSON.parse(raw) as Record<string, unknown>;
    if (payload.kind !== 'clawket_hermes_local' || payload.version !== 1) return null;
    const url = typeof payload.url === 'string' ? payload.url.trim() : '';
    const hermes = payload.hermes && typeof payload.hermes === 'object'
      ? payload.hermes as Record<string, unknown>
      : null;
    const bridgeUrl = typeof hermes?.bridgeUrl === 'string' ? hermes.bridgeUrl.trim() : '';
    if (!url || !bridgeUrl) return null;
    const displayName = typeof hermes?.displayName === 'string' ? hermes.displayName.trim() : undefined;
    return {
      type: 'hermes-pair',
      url,
      bridgeUrl,
      transportKind: normalizeTransport(typeof payload.transport === 'string' ? payload.transport : 'local'),
      displayName: displayName || undefined,
    };
  } catch {
    return null;
  }
}

export function parseDeepLink(url: string): DeepLinkAction | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'clawket:') return null;

  const route = parsed.hostname;
  const params = parsed.searchParams;

  switch (route) {
    case 'agent': {
      const message = params.get('message');
      if (!message) return null;
      const sessionKey = params.get('sessionKey') ?? undefined;
      return { type: 'agent', message, sessionKey };
    }
    case 'session': {
      const key = params.get('key');
      if (!key) return null;
      return { type: 'session', key };
    }
    case 'config':
      return { type: 'config' };
    case 'connect': {
      const connectUrl = params.get('url');
      if (!connectUrl) return null;
      const token = params.get('token') ?? undefined;
      const password = params.get('password') ?? undefined;
      return { type: 'connect', url: connectUrl, token, password };
    }
    case 'hermes-pair': {
      const payloadParam = params.get('payload');
      if (payloadParam) {
        return parseHermesPairPayload(payloadParam);
      }
      const pairUrl = (params.get('url') ?? '').trim();
      const bridgeUrl = (params.get('bridgeUrl') ?? '').trim();
      if (!pairUrl || !bridgeUrl) return null;
      const displayName = (params.get('displayName') ?? '').trim() || undefined;
      return {
        type: 'hermes-pair',
        url: pairUrl,
        bridgeUrl,
        transportKind: normalizeTransport(params.get('transport')),
        displayName,
      };
    }
    default:
      return null;
  }
}
