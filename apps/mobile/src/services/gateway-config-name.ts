import type { GatewayBackendKind, GatewayTransportKind } from '../types';

export function resolveSavedGatewayName(input: {
  name: string;
  backendKind: GatewayBackendKind;
  transportKind: GatewayTransportKind;
  url: string;
  relayDisplayName?: string;
  hermesDisplayName?: string;
}): string {
  const trimmedName = input.name.trim();
  const relayDisplayName = input.relayDisplayName?.trim();
  const hermesDisplayName = input.hermesDisplayName?.trim();
  if (hermesDisplayName && input.backendKind === 'hermes') {
    if (!trimmedName) return hermesDisplayName;
    if (trimmedName === hermesDisplayName) return hermesDisplayName;
    if (trimmedName === 'Gateway') return hermesDisplayName;
    const host = parseHost(input.url);
    if (host && trimmedName === `Hermes (${host})`) return hermesDisplayName;
    return trimmedName;
  }
  if (!relayDisplayName || input.transportKind !== 'relay') return trimmedName;
  if (!trimmedName) return relayDisplayName;
  if (trimmedName === relayDisplayName) return relayDisplayName;
  if (trimmedName === 'Gateway') return relayDisplayName;

  const host = parseHost(input.url);
  if (host && trimmedName === `Relay (${host})`) return relayDisplayName;
  if (/^Relay Gateway \d+$/u.test(trimmedName)) return relayDisplayName;
  return trimmedName;
}

function parseHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}
