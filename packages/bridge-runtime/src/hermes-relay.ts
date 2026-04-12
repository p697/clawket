import WebSocket, { type RawData } from 'ws';
import type { HermesRelayConfig } from '@clawket/bridge-core';

const RELAY_CONTROL_PREFIX = '__clawket_relay_control__:';
const BRIDGE_HEALTH_METHOD = 'health';
const BRIDGE_HEALTH_PARAMS = {};
const DEFAULT_BRIDGE_HEALTH_PROBE_TIMEOUT_MS = 10_000;

export type HermesRelayRuntimeSnapshot = {
  running: boolean;
  relayConnected: boolean;
  bridgeConnected: boolean;
  bridgeId: string;
  instanceId: string;
  relayUrl: string;
  bridgeUrl: string;
  lastError: string | null;
  lastUpdatedMs: number;
};

export type HermesRelayRuntimeOptions = {
  config: HermesRelayConfig;
  bridgeUrl: string;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  bridgeStatusPollIntervalMs?: number;
  bridgeHealthProbeTimeoutMs?: number;
  createWebSocket?: (url: string, options?: { headers?: Record<string, string> }) => WebSocket;
  fetchImpl?: typeof fetch;
  onStatus?: (snapshot: HermesRelayRuntimeSnapshot) => void;
  onLog?: (line: string) => void;
};

export class HermesRelayRuntime {
  private relaySocket: WebSocket | null = null;
  private bridgeSocket: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private bridgeReconnectTimer: NodeJS.Timeout | null = null;
  private bridgeStatusTimer: NodeJS.Timeout | null = null;
  private bridgeHealthProbeTimer: NodeJS.Timeout | null = null;
  private relayAttempt = 0;
  private bridgeAttempt = 0;
  private stopped = true;
  private bridgeStatusProbeInFlight = false;
  private readonly pendingBridgeMessages: Array<{ text?: string; data?: Buffer }> = [];
  private bridgeHealthProbeSeq = 0;
  private pendingBridgeHealthProbe:
    | {
      id: string;
      timeout: NodeJS.Timeout;
    }
    | null = null;
  private readonly snapshot: HermesRelayRuntimeSnapshot;

  constructor(private readonly options: HermesRelayRuntimeOptions) {
    this.snapshot = {
      running: false,
      relayConnected: false,
      bridgeConnected: false,
      bridgeId: options.config.bridgeId,
      instanceId: options.config.instanceId,
      relayUrl: options.config.relayUrl,
      bridgeUrl: options.bridgeUrl,
      lastError: null,
      lastUpdatedMs: Date.now(),
    };
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.updateSnapshot({ running: true, bridgeUrl: this.options.bridgeUrl });
    this.log(`hermes relay runtime starting bridgeId=${this.options.config.bridgeId}`);
    this.connectRelay();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.bridgeReconnectTimer) clearTimeout(this.bridgeReconnectTimer);
    if (this.bridgeStatusTimer) clearTimeout(this.bridgeStatusTimer);
    if (this.bridgeHealthProbeTimer) clearTimeout(this.bridgeHealthProbeTimer);
    this.reconnectTimer = null;
    this.bridgeReconnectTimer = null;
    this.bridgeStatusTimer = null;
    this.bridgeHealthProbeTimer = null;
    this.bridgeStatusProbeInFlight = false;
    this.clearPendingBridgeHealthProbe();
    this.relaySocket?.close();
    this.bridgeSocket?.close();
    this.relaySocket = null;
    this.bridgeSocket = null;
    this.pendingBridgeMessages.length = 0;
    this.updateSnapshot({
      running: false,
      relayConnected: false,
      bridgeConnected: false,
      lastError: null,
    });
  }

  getSnapshot(): HermesRelayRuntimeSnapshot {
    return { ...this.snapshot };
  }

  private connectRelay(): void {
    if (this.stopped || this.relaySocket?.readyState === WebSocket.OPEN || this.relaySocket?.readyState === WebSocket.CONNECTING) {
      return;
    }
    this.relayAttempt += 1;
    const attempt = this.relayAttempt;
    const relay = this.createWebSocket(buildHermesRelayWsUrl(this.options.config), {
      headers: buildHermesRelayWsHeaders(this.options.config),
    });
    this.relaySocket = relay;
    this.log(`relay connect attempt=${attempt}`);

    relay.once('open', () => {
      if (this.stopped || this.relaySocket !== relay) {
        relay.close();
        return;
      }
      this.updateSnapshot({ relayConnected: true, lastError: null });
      this.log(`relay connected attempt=${attempt}`);
      this.connectBridge();
      this.scheduleBridgeStatusProbe();
    });

    relay.on('message', (data: RawData, isBinary: boolean) => {
      this.handleRelayMessage(data, isBinary);
    });

    relay.once('error', (error) => {
      this.log(`relay error: ${String(error)}`);
    });

    relay.once('close', (code, reason) => {
      if (this.relaySocket !== relay) {
        return;
      }
      this.relaySocket = null;
      this.updateSnapshot({
        relayConnected: false,
        bridgeConnected: false,
        lastError: code === 1000 ? null : `relay closed: ${reason.toString() || code}`,
      });
      this.log(`relay disconnected code=${code} reason=${reason.toString() || '<none>'}`);
      if (this.bridgeSocket) {
        this.bridgeSocket.close();
        this.bridgeSocket = null;
      }
      this.clearBridgeStatusProbe();
      this.clearBridgeHealthProbeSchedule();
      this.clearPendingBridgeHealthProbe();
      this.scheduleRelayReconnect();
    });
  }

  private connectBridge(): void {
    if (this.stopped || !this.isRelayOpen()) return;
    if (this.bridgeSocket?.readyState === WebSocket.OPEN || this.bridgeSocket?.readyState === WebSocket.CONNECTING) {
      return;
    }
    this.bridgeAttempt += 1;
    const attempt = this.bridgeAttempt;
    const bridge = this.createWebSocket(this.options.bridgeUrl);
    this.bridgeSocket = bridge;
    this.log(`bridge connect attempt=${attempt}`);

    bridge.once('open', () => {
      if (this.stopped || this.bridgeSocket !== bridge) {
        bridge.close();
        return;
      }
      this.updateSnapshot({ bridgeConnected: true, lastError: null });
      this.log(`bridge connected attempt=${attempt}`);
      this.flushPendingBridgeMessages();
      this.scheduleBridgeStatusProbe();
      this.scheduleBridgeHealthProbe();
    });

    bridge.on('message', (data: RawData, isBinary: boolean) => {
      this.handleBridgeMessage(data, isBinary);
    });

    bridge.once('error', (error) => {
      this.log(`bridge error: ${String(error)}`);
    });

    bridge.once('close', (code, reason) => {
      if (this.bridgeSocket !== bridge) {
        return;
      }
      this.bridgeSocket = null;
      this.updateSnapshot({
        bridgeConnected: false,
        lastError: code === 1000 ? this.snapshot.lastError : `bridge closed: ${reason.toString() || code}`,
      });
      this.log(`bridge disconnected code=${code} reason=${reason.toString() || '<none>'}`);
      this.clearBridgeStatusProbe();
      this.clearBridgeHealthProbeSchedule();
      this.clearPendingBridgeHealthProbe();
      if (!this.stopped && this.isRelayOpen()) {
        this.scheduleBridgeReconnect();
      }
    });
  }

  private handleRelayMessage(data: RawData, isBinary: boolean): void {
    if (isBinary) {
      this.forwardOrQueueBridgeMessage({ data: normalizeBinary(data) });
      return;
    }
    const text = normalizeText(data);
    if (text == null) return;
    if (text.startsWith(RELAY_CONTROL_PREFIX)) {
      return;
    }
    this.forwardOrQueueBridgeMessage({ text });
  }

  private handleBridgeMessage(data: RawData, isBinary: boolean): void {
    const relay = this.relaySocket;
    if (isBinary) {
      if (!relay || relay.readyState !== WebSocket.OPEN) return;
      relay.send(normalizeBinary(data));
      return;
    }
    const text = normalizeText(data);
    if (text == null) return;
    if (this.handleBridgeHealthProbeResponse(text)) {
      return;
    }
    if (!relay || relay.readyState !== WebSocket.OPEN) return;
    relay.send(text);
  }

  private forwardOrQueueBridgeMessage(message: { text?: string; data?: Buffer }): void {
    const bridge = this.bridgeSocket;
    if (!bridge || bridge.readyState !== WebSocket.OPEN) {
      if (this.pendingBridgeMessages.length < 256) {
        this.pendingBridgeMessages.push(message);
      }
      this.connectBridge();
      return;
    }
    if (message.text !== undefined) {
      bridge.send(message.text);
      return;
    }
    if (message.data) {
      bridge.send(message.data);
    }
  }

  private flushPendingBridgeMessages(): void {
    const bridge = this.bridgeSocket;
    if (!bridge || bridge.readyState !== WebSocket.OPEN) return;
    while (this.pendingBridgeMessages.length > 0) {
      const next = this.pendingBridgeMessages.shift();
      if (!next) break;
      if (next.text !== undefined) {
        bridge.send(next.text);
      } else if (next.data) {
        bridge.send(next.data);
      }
    }
  }

  private scheduleRelayReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delayMs = computeBackoff(this.relayAttempt, this.options.reconnectBaseDelayMs ?? 1_000, this.options.reconnectMaxDelayMs ?? 15_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectRelay();
    }, delayMs);
  }

  private scheduleBridgeReconnect(): void {
    if (this.stopped || this.bridgeReconnectTimer) return;
    const delayMs = computeBackoff(this.bridgeAttempt, 500, 5_000);
    this.bridgeReconnectTimer = setTimeout(() => {
      this.bridgeReconnectTimer = null;
      this.connectBridge();
    }, delayMs);
  }

  private scheduleBridgeStatusProbe(): void {
    if (this.stopped || this.bridgeStatusTimer) return;
    const intervalMs = this.options.bridgeStatusPollIntervalMs ?? 5_000;
    this.bridgeStatusTimer = setTimeout(() => {
      this.bridgeStatusTimer = null;
      void this.runBridgeStatusProbe();
    }, intervalMs);
  }

  private clearBridgeStatusProbe(): void {
    if (this.bridgeStatusTimer) {
      clearTimeout(this.bridgeStatusTimer);
      this.bridgeStatusTimer = null;
    }
  }

  private scheduleBridgeHealthProbe(): void {
    if (this.stopped || this.bridgeHealthProbeTimer) return;
    const intervalMs = this.options.bridgeStatusPollIntervalMs ?? 5_000;
    this.bridgeHealthProbeTimer = setTimeout(() => {
      this.bridgeHealthProbeTimer = null;
      this.runBridgeHealthProbe();
    }, intervalMs);
  }

  private clearBridgeHealthProbeSchedule(): void {
    if (this.bridgeHealthProbeTimer) {
      clearTimeout(this.bridgeHealthProbeTimer);
      this.bridgeHealthProbeTimer = null;
    }
  }

  private async runBridgeStatusProbe(): Promise<void> {
    if (this.stopped) return;
    if (!this.isRelayOpen() || this.bridgeSocket?.readyState !== WebSocket.OPEN) return;
    if (this.bridgeStatusProbeInFlight) return;
    this.bridgeStatusProbeInFlight = true;
    try {
      const response = await (this.options.fetchImpl ?? fetch)(buildHermesRelayBridgeStatusUrl(this.options.config), {
        headers: {
          authorization: `Bearer ${this.options.config.relaySecret}`,
          accept: 'application/json',
        },
      });
      if (!response.ok) {
        this.log(`bridge status probe failed status=${response.status}`);
      } else {
        const payload = await response.json() as { hasBridge?: boolean };
        if (!payload?.hasBridge) {
          this.log('bridge status probe reported hasBridge=false; restarting relay socket');
          this.relaySocket?.close();
          this.bridgeSocket?.close();
          return;
        }
      }
    } catch (error) {
      this.log(`bridge status probe error: ${String(error)}`);
    } finally {
      this.bridgeStatusProbeInFlight = false;
      this.scheduleBridgeStatusProbe();
    }
  }

  private runBridgeHealthProbe(): void {
    if (this.stopped) return;
    const bridge = this.bridgeSocket;
    if (!this.isRelayOpen() || !bridge || bridge.readyState !== WebSocket.OPEN) return;
    if (this.pendingBridgeHealthProbe) return;

    const probeId = `bridge_probe_${Date.now()}_${++this.bridgeHealthProbeSeq}`;
    const timeoutMs = this.options.bridgeHealthProbeTimeoutMs ?? DEFAULT_BRIDGE_HEALTH_PROBE_TIMEOUT_MS;
    const timeout = setTimeout(() => {
      if (!this.pendingBridgeHealthProbe || this.pendingBridgeHealthProbe.id !== probeId) return;
      this.pendingBridgeHealthProbe = null;
      this.log(`bridge health probe timed out; restarting bridge socket`);
      try {
        bridge.close();
      } catch {
        // Ignore close errors; reconnect path below still applies.
      }
      this.bridgeSocket = null;
      this.updateSnapshot({
        bridgeConnected: false,
        lastError: 'bridge health probe timed out',
      });
      this.clearBridgeStatusProbe();
      this.clearBridgeHealthProbeSchedule();
      if (!this.stopped && this.isRelayOpen()) {
        this.scheduleBridgeReconnect();
      }
    }, timeoutMs);

    this.pendingBridgeHealthProbe = { id: probeId, timeout };
    try {
      bridge.send(JSON.stringify({
        type: 'req',
        id: probeId,
        method: BRIDGE_HEALTH_METHOD,
        params: BRIDGE_HEALTH_PARAMS,
      }));
    } catch (error) {
      this.clearPendingBridgeHealthProbe();
      this.log(`bridge health probe send failed: ${String(error)}`);
      try {
        bridge.close();
      } catch {
        // Ignore close errors; reconnect path below still applies.
      }
    } finally {
      this.scheduleBridgeHealthProbe();
    }
  }

  private handleBridgeHealthProbeResponse(text: string): boolean {
    const pending = this.pendingBridgeHealthProbe;
    if (!pending) return false;
    try {
      const parsed = JSON.parse(text) as { type?: unknown; id?: unknown; ok?: unknown };
      if (parsed?.type !== 'res' || parsed?.id !== pending.id) {
        return false;
      }
      if (parsed?.ok === false) {
        this.log('bridge health probe failed with an error response; restarting bridge socket');
        this.clearPendingBridgeHealthProbe();
        try {
          this.bridgeSocket?.close();
        } catch {
          // Ignore close errors; reconnect path below still applies.
        }
        return true;
      }
      this.clearPendingBridgeHealthProbe();
      return true;
    } catch {
      return false;
    }
  }

  private clearPendingBridgeHealthProbe(): void {
    if (!this.pendingBridgeHealthProbe) return;
    clearTimeout(this.pendingBridgeHealthProbe.timeout);
    this.pendingBridgeHealthProbe = null;
  }

  private isRelayOpen(): boolean {
    return this.relaySocket?.readyState === WebSocket.OPEN;
  }

  private createWebSocket(url: string, options?: { headers?: Record<string, string> }): WebSocket {
    return this.options.createWebSocket
      ? this.options.createWebSocket(url, options)
      : new WebSocket(url, options);
  }

  private updateSnapshot(patch: Partial<HermesRelayRuntimeSnapshot>): void {
    Object.assign(this.snapshot, patch, { lastUpdatedMs: Date.now() });
    this.options.onStatus?.(this.getSnapshot());
  }

  private log(line: string): void {
    this.options.onLog?.(line);
  }
}

export function buildHermesRelayWsUrl(config: HermesRelayConfig): string {
  const base = new URL(config.relayUrl);
  if (!base.pathname || base.pathname === '/') {
    base.pathname = '/ws';
  }
  base.searchParams.delete('token');
  base.searchParams.set('bridgeId', config.bridgeId);
  base.searchParams.set('role', 'gateway');
  base.searchParams.set('clientId', config.instanceId);
  return base.toString();
}

export function buildHermesRelayWsHeaders(config: Pick<HermesRelayConfig, 'relaySecret'>): Record<string, string> {
  return {
    Authorization: `Bearer ${config.relaySecret}`,
  };
}

function computeBackoff(attempt: number, base: number, max: number): number {
  return Math.min(max, base * Math.max(1, 2 ** Math.max(0, attempt - 1)));
}

function buildHermesRelayBridgeStatusUrl(config: HermesRelayConfig): string {
  const url = new URL(config.relayUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '/v1/internal/hermes/bridge-status';
  url.search = '';
  url.hash = '';
  url.searchParams.set('bridgeId', config.bridgeId);
  return url.toString();
}

function normalizeText(data: RawData): string | null {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return null;
}

function normalizeBinary(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}
