import type { EventEmitter } from 'node:events';

export interface BonjourService {
  name: string;
  type: string;
  port: number;
  host?: string;
  txt?: Record<string, string>;
  stop: (callback?: () => void) => void;
}

export interface BonjourOptions {
  /** Bridge HTTP host (without scheme). */
  host: string;
  /** Bridge HTTP port. */
  port: number;
  /** Bridge WebSocket path (e.g. `/v1/hermes/ws`). */
  wsPath: string;
  /** Optional auth token advertised in TXT record. */
  token?: string;
  /** Backend kind (e.g. `hermes`, `openclaw`, `agentzero`). */
  backend?: string;
  /** Transport kind (e.g. `local`, `tailscale`, `bonjour`). */
  transport?: string;
  /** Display name shown in discovery browsers. */
  displayName?: string;
  /** Service type override; default `_clawket-hermes._tcp`. */
  serviceType?: string;
  /** How many seconds between mDNS probes; default 5000. */
  probeInterval?: number;
}

export interface BonjourAdvertiser {
  start(): Promise<void>;
  stop(): Promise<void>;
  getService(): BonjourService | null;
}

/**
 * Factory for the mDNS advertiser. Accepts a lazy importer so tests can inject
 * a mock bonjour service without pulling the real dependency.
 */
export function createBonjourAdvertiser(
  options: BonjourOptions,
  bonjourFactory: () => unknown = defaultBonjourFactory,
): BonjourAdvertiser {
  let service: BonjourService | null = null;

  return {
    async start() {
      if (service) return;
      const bonjour = await bonjourFactory() as {
        publish: (opts: {
          name: string;
          type: string;
          port: number;
          host?: string;
          txt?: Record<string, string>;
        }) => BonjourService;
      };
      const type = options.serviceType ?? 'clawket-hermes';
      const txt: Record<string, string> = {
        backend: options.backend ?? 'hermes',
        transport: options.transport ?? 'bonjour',
        ...(options.token ? { token: options.token } : {}),
        ...(options.displayName ? { displayName: options.displayName } : {}),
        ...(options.wsPath ? { wsPath: options.wsPath } : {}),
      };
      service = bonjour.publish({
        name: options.displayName
          ? `${options.displayName} @ ${options.host}:${options.port}`
          : `Clawket Hermes @ ${options.host}:${options.port}`,
        type,
        port: options.port,
        host: options.host,
        txt,
      });
    },

    async stop() {
      if (!service) return;
      const current = service;
      service = null;
      await new Promise<void>((resolve) => current.stop(() => resolve()));
    },

    getService() {
      return service;
    },
  };
}

async function defaultBonjourFactory(): Promise<unknown> {
  const { default: Bonjour } = await import('bonjour-service');
  return new Bonjour();
}

/**
 * Build the canonical Bonjour service type for a backend.
 */
export function buildBonjourServiceType(backend: string): string {
  const normalized = backend.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return `clawket-${normalized}`;
}

/**
 * Parse a discovered Bonjour service into the fields the Clawket app expects.
 */
export function parseBonjourService(service: BonjourService): {
  host: string;
  port: number;
  type: string;
  txt: Record<string, string>;
  displayName: string;
} {
  return {
    host: service.host ?? service.name,
    port: service.port,
    type: service.type,
    txt: service.txt ?? {},
    displayName: service.txt?.displayName ?? service.name,
  };
}
