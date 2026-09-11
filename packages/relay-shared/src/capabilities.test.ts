import { describe, expect, it } from 'vitest';
import {
  BRIDGE_CAPABILITIES_V2,
  HERMES_MULTI_SESSION_V2,
  KNOWN_HANDSHAKE_CAPABILITIES,
  RELAY_CLIENT_PONG_V1_CAPABILITY,
  RELAY_FRAME_LIMIT_V2,
  normalizeHandshakeCapabilities,
  parseHandshakeMeta,
  serializeHandshakeMeta,
} from './capabilities';
import { SECURE_PAIRING_V2_CAPABILITY } from './protocol';

describe('handshake capabilities', () => {
  it('exports the frozen protocol strings in their canonical order', () => {
    expect(KNOWN_HANDSHAKE_CAPABILITIES).toEqual([
      RELAY_CLIENT_PONG_V1_CAPABILITY,
      SECURE_PAIRING_V2_CAPABILITY,
      RELAY_FRAME_LIMIT_V2,
      BRIDGE_CAPABILITIES_V2,
      HERMES_MULTI_SESSION_V2,
    ]);
    expect(RELAY_CLIENT_PONG_V1_CAPABILITY).toBe('relay.client-pong.v1');
    expect(SECURE_PAIRING_V2_CAPABILITY).toBe('pairing.secure-short-code.v2');
    expect(RELAY_FRAME_LIMIT_V2).toBe('relay.frame-limit.v2');
    expect(BRIDGE_CAPABILITIES_V2).toBe('bridge.capabilities.v2');
    expect(HERMES_MULTI_SESSION_V2).toBe('hermes.multi-session.v2');
  });

  it.each([
    undefined,
    null,
    'relay.frame-limit.v2',
    2,
    { capabilities: 'relay.frame-limit.v2' },
    { capabilities: null },
    { capabilities: { value: RELAY_FRAME_LIMIT_V2 } },
  ])('treats missing or malformed meta as a v1 handshake: %j', (value) => {
    expect(parseHandshakeMeta(value)).toEqual({});
  });

  it('ignores unknown and malformed capability entries', () => {
    expect(parseHandshakeMeta({
      capabilities: [
        'future.capability.v9',
        42,
        null,
        RELAY_FRAME_LIMIT_V2,
      ],
    })).toEqual({
      capabilities: [RELAY_FRAME_LIMIT_V2],
    });
    expect(parseHandshakeMeta({ capabilities: ['future.capability.v9'] })).toEqual({});
  });

  it('preserves existing pong and secure-pairing capabilities', () => {
    const parsed = parseHandshakeMeta({
      capabilities: [
        RELAY_CLIENT_PONG_V1_CAPABILITY,
        SECURE_PAIRING_V2_CAPABILITY,
      ],
    });

    expect(parsed).toEqual({
      capabilities: [
        RELAY_CLIENT_PONG_V1_CAPABILITY,
        SECURE_PAIRING_V2_CAPABILITY,
      ],
    });
    expect(serializeHandshakeMeta(parsed)).toEqual(parsed);
  });

  it('preserves sibling handshake metadata while normalizing capabilities', () => {
    const meta = {
      id: 'req_1',
      method: 'connect.start',
      minProtocol: 3,
      capabilities: [
        ` ${RELAY_CLIENT_PONG_V1_CAPABILITY} `,
        'future.capability.v9',
      ],
      device: { nonce: 'nonce-1' },
    };

    const parsed = parseHandshakeMeta(meta);
    expect(parsed).toEqual({
      id: 'req_1',
      method: 'connect.start',
      minProtocol: 3,
      capabilities: [RELAY_CLIENT_PONG_V1_CAPABILITY],
      device: { nonce: 'nonce-1' },
    });
    expect(serializeHandshakeMeta(parsed)).toEqual(parsed);
  });

  it('removes malformed capabilities without deleting sibling metadata', () => {
    const meta = {
      id: 'req_1',
      method: 'connect',
      capabilities: RELAY_CLIENT_PONG_V1_CAPABILITY,
      auth: { token: 'secret' },
    };

    expect(parseHandshakeMeta(meta)).toEqual({
      id: 'req_1',
      method: 'connect',
      auth: { token: 'secret' },
    });
    expect(serializeHandshakeMeta(meta)).toEqual({
      id: 'req_1',
      method: 'connect',
      auth: { token: 'secret' },
    });
  });

  it('normalizes whitespace and removes duplicate known capabilities', () => {
    expect(normalizeHandshakeCapabilities([
      ` ${BRIDGE_CAPABILITIES_V2} `,
      BRIDGE_CAPABILITIES_V2,
      HERMES_MULTI_SESSION_V2,
    ])).toEqual([
      BRIDGE_CAPABILITIES_V2,
      HERMES_MULTI_SESSION_V2,
    ]);
  });

  it('round-trips the supported handshake meta without adding v2 data to v1', () => {
    const parsed = parseHandshakeMeta({
      capabilities: [
        HERMES_MULTI_SESSION_V2,
        'future.capability.v9',
        BRIDGE_CAPABILITIES_V2,
      ],
    });

    expect(serializeHandshakeMeta(parsed)).toEqual({
      capabilities: [HERMES_MULTI_SESSION_V2, BRIDGE_CAPABILITIES_V2],
    });
    expect(serializeHandshakeMeta({})).toEqual({});
    expect(serializeHandshakeMeta({ capabilities: ['future.capability.v9'] })).toEqual({});
  });

  it('keeps a v1 handshake meta byte-identical when capabilities are absent', () => {
    const v1Meta = {
      id: 'req_v1',
      method: 'connect.start',
      minProtocol: 3,
      maxProtocol: 3,
      auth: { token: 'legacy-token' },
      device: { nonce: 'legacy-nonce' },
    };

    expect(JSON.stringify(parseHandshakeMeta(v1Meta))).toBe(JSON.stringify(v1Meta));
    expect(JSON.stringify(serializeHandshakeMeta(v1Meta))).toBe(JSON.stringify(v1Meta));
  });
});
