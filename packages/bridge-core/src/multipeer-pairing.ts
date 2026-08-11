/**
 * Apple Multipeer Connectivity pairing scaffold.
 *
 * Multipeer is a native Apple API (iOS + macOS). It lets nearby devices find
 * each other and open encrypted data streams over Bluetooth or Wi-Fi Direct.
 *
 * For the Clawket bridge, Multipeer would act as a transport layer that the
 * mobile app can fall back to when no LAN/Tailscale/cloud path is available.
 * The actual chat protocol still runs over a WebSocket-like framing layer on
 * top of Multipeer data streams.
 */

export type MultipeerTransportState =
  | 'idle'
  | 'advertising'
  | 'invited'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export interface MultipeerPairingOptions {
  /** Display name shown in the Multipeer browser sheet. */
  displayName: string;
  /** Service type (same format as Bonjour, without leading underscore). */
  serviceType: string;
  /** Bridge WebSocket URL to advertise once a peer connects. */
  bridgeWsUrl: string;
  /** Bridge HTTP URL for health checks. */
  bridgeHttpUrl: string;
  /** Auth token included in the advertised payload. */
  token?: string;
}

export interface MultipeerPeerInfo {
  peerId: string;
  displayName: string;
  state: MultipeerTransportState;
  connectedAtMs?: number;
  disconnectedAtMs?: number;
  lastError?: string;
}

export interface MultipeerPairingAdvertiser {
  start(): Promise<void>;
  stop(): Promise<void>;
  getPeers(): MultipeerPeerInfo[];
  onPeerConnected?: (peer: MultipeerPeerInfo) => void;
  onPeerDisconnected?: (peer: MultipeerPeerInfo) => void;
}

/**
 * Placeholder factory for a Multipeer advertiser.
 *
 * The real implementation requires a native module because Node.js cannot
 * directly call `MCNearbyServiceAdvertiser` / `MCSession`. The recommended
 * architecture:
 *
 *   Bridge CLI (Node)  <-- local socket or stdio -->  MultipeerHelper (Swift)
 *                                                           |
 *                                                 MCNearbyServiceAdvertiser
 *                                                           |
 *                                                 iOS Clawket app via MCSession
 *
 * A minimal Swift helper would expose a tiny JSON-RPC over stdin/stdout:
 *   - `advertise { displayName, serviceType, bridgeWsUrl, token }`
 *   - `stop`
 *   - events: `peerConnected`, `peerDisconnected`, `dataReceived`, `error`
 */
export function createMultipeerAdvertiser(options: MultipeerPairingOptions): MultipeerPairingAdvertiser {
  let state: MultipeerTransportState = 'idle';
  const peers: Map<string, MultipeerPeerInfo> = new Map();

  return {
    async start() {
      if (state !== 'idle') return;
      state = 'advertising';
      // Real implementation: spawn Swift helper and forward the bridge URL.
      // For now we keep the bridge side shape valid and ready.
    },

    async stop() {
      state = 'idle';
      peers.clear();
    },

    getPeers() {
      return Array.from(peers.values());
    },
  };
}

/**
 * Service type used by the Multipeer advertiser. Apple requires that the
 * service type be 15 characters max, start with a letter, and contain only
 * lowercase ASCII letters, digits, and hyphens.
 */
export function buildMultipeerServiceType(backend: string): string {
  const normalized = backend.toLowerCase().replace(/[^a-z0-9-]/g, '');
  const short = normalized.slice(0, 9);
  return `clawk-${short || 'hermes'}`;
}

export function buildMultipeerInvitationPayload(options: MultipeerPairingOptions): Record<string, string> {
  return {
    bridgeHttpUrl: options.bridgeHttpUrl,
    bridgeWsUrl: options.bridgeWsUrl,
    ...(options.token ? { token: options.token } : {}),
  };
}
