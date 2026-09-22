/**
 * Deep link URL parser for the `clawket://` scheme.
 *
 * Supported routes:
 *   clawket://agent?message=...&sessionKey=...
 *   clawket://session?key=...
 *   clawket://config
 *   clawket://connect?url=...&token=...
 *   clawket://pair?server=...&session=...&key=...
 *   https://registry.clawket.ai/pair/...#k=...
 */

import { parsePairingLink } from './pairing-session';

export type DeepLinkAction =
  | { type: 'agent'; message: string; sessionKey?: string }
  | { type: 'session'; key: string }
  | { type: 'widget'; action: 'chat' | 'voice' | 'skills' | 'camera' | 'photos' }
  | { type: 'config' }
  | { type: 'connect'; url: string; token?: string; password?: string }
  | { type: 'pair'; url: string };

export function parseDeepLink(url: string): DeepLinkAction | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsePairingLink(url)) return { type: 'pair', url };
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
    case 'widget': {
      const action = params.get('action');
      return action === 'chat' || action === 'voice' || action === 'skills' || action === 'camera' || action === 'photos' ? { type: 'widget', action } : null;
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
    default:
      return null;
  }
}

export function isClawketHandledDeepLink(url: string): boolean {
  return parseDeepLink(url) !== null;
}
