import { GatewayConfig } from '../types';
import { resolveGatewayBackendKind, resolveGatewayTransportKind } from './gateway-backends';
import { createCompositeHash, createHash } from './crypto-hash';

function normalizeUrl(url?: string): string {
  const trimmed = url?.trim() ?? '';
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

function normalizeRelayServerUrl(serverUrl?: string): string {
  return (serverUrl ?? '').trim().replace(/\/+$/, '');
}

function resolveCredentialFingerprint(config?: GatewayConfig | null): string {
  const token = config?.token?.trim();
  if (token) return `token:${createHash(token)}`;
  const password = config?.password?.trim();
  if (password) return `password:${createHash(password)}`;
  return 'anonymous';
}

export function resolveGatewayCacheScopeId(params: {
  activeConfigId?: string | null;
  config?: GatewayConfig | null;
}): string {
  const activeConfigId = params.activeConfigId?.trim();
  if (activeConfigId) {
    if (activeConfigId.startsWith('cfg:') || activeConfigId.startsWith('runtime:')) {
      return activeConfigId;
    }
    return `cfg:${activeConfigId}`;
  }

  return `runtime:${createCompositeHash([
    resolveGatewayBackendKind(params.config),
    resolveGatewayTransportKind(params.config),
    normalizeUrl(params.config?.url),
    normalizeRelayServerUrl(params.config?.relay?.serverUrl),
    params.config?.relay?.gatewayId?.trim() || '',
    resolveCredentialFingerprint(params.config),
  ])}`;
}
