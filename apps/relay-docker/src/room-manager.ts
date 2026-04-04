/**
 * room-manager.ts — Manages DockerRelayRoom instances.
 *
 * Replaces Cloudflare DurableObjectNamespace routing.
 * Each gatewayId maps to exactly one DockerRelayRoom in memory.
 */

import { DockerRelayRoom } from './relay-room.js';
import type { Env } from './relay/types.js';

export class RoomManager {
  private readonly rooms = new Map<string, DockerRelayRoom>();
  private readonly gcTimer: ReturnType<typeof setInterval>;

  constructor(private readonly env: Env) {
    // GC idle rooms every 5 minutes
    this.gcTimer = setInterval(() => this.gc(), 5 * 60_000);
  }

  getRoom(gatewayId: string): DockerRelayRoom {
    const existing = this.rooms.get(gatewayId);
    if (existing) return existing;

    const room = new DockerRelayRoom(gatewayId, this.env);
    this.rooms.set(gatewayId, room);
    return room;
  }

  private gc(): void {
    for (const [gatewayId, room] of this.rooms.entries()) {
      if (!room.hasConnections) {
        room.destroy();
        this.rooms.delete(gatewayId);
      }
    }
    if (this.rooms.size > 0) {
      console.log(`[room-manager] Active rooms: ${this.rooms.size}`);
    }
  }

  close(): void {
    clearInterval(this.gcTimer);
    for (const [, room] of this.rooms.entries()) {
      room.destroy();
    }
    this.rooms.clear();
  }
}
