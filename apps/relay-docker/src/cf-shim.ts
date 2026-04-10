/**
 * cf-shim.ts — Shim layer providing Cloudflare-compatible interfaces
 * backed by Node.js primitives. This allows relay modules to run with
 * minimal source changes.
 */

import type { WebSocket as WsWebSocket } from 'ws';

// ---------- WebSocket Attachment Shim ----------
// CF Durable Objects support ws.serializeAttachment / ws.deserializeAttachment.
// We shim this with a WeakMap.

const wsAttachments = new WeakMap<object, unknown>();

export function serializeAttachment(ws: WsWebSocket, data: unknown): void {
  wsAttachments.set(ws, structuredClone(data));
}

export function deserializeAttachment(ws: WsWebSocket): unknown {
  return wsAttachments.get(ws) ?? null;
}

// ---------- Room Storage Shim ----------
// Replaces DurableObjectState.storage for per-room persistent storage.

export class RoomStorage {
  private readonly data = new Map<string, unknown>();
  private alarmCallback: (() => Promise<void>) | null = null;
  private alarmTimer: ReturnType<typeof setTimeout> | null = null;

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    this.data.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }

  setAlarmHandler(handler: () => Promise<void>): void {
    this.alarmCallback = handler;
  }

  async setAlarm(scheduledTime: number): Promise<void> {
    if (this.alarmTimer) {
      clearTimeout(this.alarmTimer);
    }
    const delay = Math.max(0, scheduledTime - Date.now());
    this.alarmTimer = setTimeout(async () => {
      this.alarmTimer = null;
      if (this.alarmCallback) {
        try {
          await this.alarmCallback();
        } catch (err) {
          console.error('[room-storage] Alarm callback failed:', err);
        }
      }
    }, delay);
  }

  async deleteAlarm(): Promise<void> {
    if (this.alarmTimer) {
      clearTimeout(this.alarmTimer);
      this.alarmTimer = null;
    }
  }

  destroy(): void {
    if (this.alarmTimer) {
      clearTimeout(this.alarmTimer);
      this.alarmTimer = null;
    }
    this.data.clear();
  }
}

// ---------- Room State Shim ----------
// Replaces DurableObjectState for per-room WebSocket tracking + storage.

export class RoomState {
  readonly storage: RoomStorage;
  private readonly sockets = new Set<WsWebSocket>();
  private readonly _id: string;

  constructor(id: string) {
    this._id = id;
    this.storage = new RoomStorage();
  }

  get id(): { toString(): string } {
    return { toString: () => this._id };
  }

  acceptWebSocket(ws: WsWebSocket): void {
    this.sockets.add(ws);
  }

  removeWebSocket(ws: WsWebSocket): void {
    this.sockets.delete(ws);
  }

  getWebSockets(): WsWebSocket[] {
    return Array.from(this.sockets);
  }

  async blockConcurrencyWhile(fn: () => Promise<void>): Promise<void> {
    // In single-threaded Node.js, just await the function.
    await fn();
  }

  destroy(): void {
    this.storage.destroy();
    this.sockets.clear();
  }
}
