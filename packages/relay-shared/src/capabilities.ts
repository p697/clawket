import { SECURE_PAIRING_V2_CAPABILITY } from './protocol';

export const RELAY_CLIENT_PONG_V1_CAPABILITY = 'relay.client-pong.v1';
export const RELAY_FRAME_LIMIT_V2 = 'relay.frame-limit.v2';
export const BRIDGE_CAPABILITIES_V2 = 'bridge.capabilities.v2';
export const HERMES_MULTI_SESSION_V2 = 'hermes.multi-session.v2';

export const KNOWN_HANDSHAKE_CAPABILITIES = Object.freeze([
  RELAY_CLIENT_PONG_V1_CAPABILITY,
  SECURE_PAIRING_V2_CAPABILITY,
  RELAY_FRAME_LIMIT_V2,
  BRIDGE_CAPABILITIES_V2,
  HERMES_MULTI_SESSION_V2,
] as const);

export type HandshakeCapability = (typeof KNOWN_HANDSHAKE_CAPABILITIES)[number];

export interface HandshakeMeta {
  [key: string]: unknown;
  capabilities?: string[];
}

const KNOWN_HANDSHAKE_CAPABILITY_SET = new Set<string>(KNOWN_HANDSHAKE_CAPABILITIES);

/**
 * Read negotiated v2 capabilities without making the handshake itself v2-only.
 * Missing, malformed, and future capability values all degrade to v1 behavior.
 */
export function parseHandshakeMeta(value: unknown): HandshakeMeta {
  if (!isRecord(value)) return {};
  const meta: HandshakeMeta = { ...value };
  const capabilities = normalizeHandshakeCapabilities(value.capabilities);
  if (capabilities.length > 0) {
    meta.capabilities = capabilities;
  } else {
    delete meta.capabilities;
  }
  return meta;
}

/**
 * Produce the optional wire meta shape. Empty or unsupported capability lists
 * omit the field so a caller can preserve the byte shape of a v1 handshake.
 */
export function serializeHandshakeMeta(meta: Readonly<Record<string, unknown>>): HandshakeMeta {
  const serialized: HandshakeMeta = { ...meta };
  const capabilities = normalizeHandshakeCapabilities(meta.capabilities);
  if (capabilities.length > 0) {
    serialized.capabilities = capabilities;
  } else {
    delete serialized.capabilities;
  }
  return serialized;
}

export function normalizeHandshakeCapabilities(value: unknown): HandshakeCapability[] {
  if (!Array.isArray(value)) return [];

  const capabilities: HandshakeCapability[] = [];
  const seen = new Set<HandshakeCapability>();
  for (const candidate of value) {
    if (typeof candidate !== 'string') continue;
    const normalized = candidate.trim();
    if (!KNOWN_HANDSHAKE_CAPABILITY_SET.has(normalized)) continue;
    const capability = normalized as HandshakeCapability;
    if (seen.has(capability)) continue;
    seen.add(capability);
    capabilities.push(capability);
  }
  return capabilities;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
