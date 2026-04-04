/**
 * server.ts — Main entry point for the Docker self-hosted relay.
 *
 * Starts both the Registry HTTP server and the Relay WebSocket server
 * in a single Node.js process, sharing the same in-memory KV store.
 */

import { MemoryKV } from './kv-store.js';
import { RoomManager } from './room-manager.js';
import { createRegistryServer } from './registry.js';
import { createRelayServer } from './relay-server.js';
import type { Env } from './relay/types.js';

// ---------- Configuration from environment ----------

const REGISTRY_PORT = parseInt(process.env.REGISTRY_PORT ?? '3001', 10);
const RELAY_PORT = parseInt(process.env.RELAY_PORT ?? '3002', 10);
const KV_PERSIST_PATH = process.env.KV_PERSIST_PATH ?? '';
const RELAY_URL = process.env.RELAY_URL ?? `ws://localhost:${RELAY_PORT}/ws`;
const REGISTRY_URL = process.env.REGISTRY_URL ?? `http://localhost:${REGISTRY_PORT}`;
const RELAY_REGION_MAP = process.env.RELAY_REGION_MAP ?? '';
const PAIR_ACCESS_CODE_TTL_SEC = process.env.PAIR_ACCESS_CODE_TTL_SEC ?? '600';
const PAIR_CLIENT_TOKEN_MAX = process.env.PAIR_CLIENT_TOKEN_MAX ?? '8';
const MAX_MESSAGES_PER_10S = process.env.MAX_MESSAGES_PER_10S ?? '120';
const MAX_CLIENT_MESSAGES_PER_10S = process.env.MAX_CLIENT_MESSAGES_PER_10S ?? '300';
const HEARTBEAT_INTERVAL_MS = process.env.HEARTBEAT_INTERVAL_MS ?? '30000';
const AWAITING_CHALLENGE_TTL_MS = process.env.AWAITING_CHALLENGE_TTL_MS ?? '25000';
const CLIENT_IDLE_TIMEOUT_MS = process.env.CLIENT_IDLE_TIMEOUT_MS ?? '600000';
const GATEWAY_OWNER_LEASE_MS = process.env.GATEWAY_OWNER_LEASE_MS ?? '20000';

// ---------- Bootstrap ----------

console.log('╔══════════════════════════════════════════════╗');
console.log('║        Clawket Self-Hosted Relay             ║');
console.log('╠══════════════════════════════════════════════╣');
console.log(`║  Registry port : ${REGISTRY_PORT.toString().padEnd(28)}║`);
console.log(`║  Relay port    : ${RELAY_PORT.toString().padEnd(28)}║`);
console.log(`║  KV persist    : ${(KV_PERSIST_PATH || '(memory only)').padEnd(28)}║`);
console.log(`║  Relay URL     : ${RELAY_URL.substring(0, 28).padEnd(28)}║`);
console.log('╚══════════════════════════════════════════════╝');

if (RELAY_REGION_MAP.trim()) {
  console.warn('[server] RELAY_REGION_MAP is supported only for multiple public URLs that route to this same relay process.');
}

if ((process.env.PAIRING_SYNC_SECRET ?? '').trim()) {
  console.warn('[server] PAIRING_SYNC_SECRET is ignored in relay-docker because registry and relay share the same process-local KV.');
}

// Shared KV store
const kv = new MemoryKV(KV_PERSIST_PATH || undefined);

// Relay environment
const env: Env = {
  ROUTES_KV: kv,
  REGISTRY_VERIFY_URL: REGISTRY_URL,
  MAX_MESSAGES_PER_10S,
  MAX_CLIENT_MESSAGES_PER_10S,
  HEARTBEAT_INTERVAL_MS,
  GATEWAY_OWNER_LEASE_MS,
  AWAITING_CHALLENGE_TTL_MS,
  CLIENT_IDLE_TIMEOUT_MS,
};

// Room Manager
const roomManager = new RoomManager(env);

// Registry HTTP server
const registry = createRegistryServer(
  {
    routesKv: kv,
    relayRegionMap: RELAY_REGION_MAP,
    pairAccessCodeTtlSec: PAIR_ACCESS_CODE_TTL_SEC,
    pairClientTokenMax: PAIR_CLIENT_TOKEN_MAX,
    relayUrl: RELAY_URL,
  },
  REGISTRY_PORT,
);

// Relay WebSocket server
const relay = createRelayServer(
  roomManager,
  RELAY_PORT,
);

// Start both servers
registry.start();
relay.start();

// Graceful shutdown
function shutdown(): void {
  console.log('\n[server] Shutting down...');
  relay.close();
  registry.close();
  roomManager.close();
  kv.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
