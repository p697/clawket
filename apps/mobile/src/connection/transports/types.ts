export type TransportState =
  | 'idle'
  | 'connecting'
  | 'handshaking'
  | 'ready'
  | 'reconnecting'
  | 'closed';

export type TransportStateChange = {
  state: TransportState;
  reason?: string;
  reconnectAttempt: number;
};

export type TransportError = {
  code: string;
  message: string;
  retryable: boolean;
  cause?: unknown;
};

export type WebSocketCloseEventLike = {
  code?: number;
  reason?: string;
  wasClean?: boolean;
};

export type WebSocketErrorEventLike = {
  message?: string;
  type?: string;
};

export interface WebSocketLike {
  readonly readyState: number;
  onopen: ((event?: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event?: WebSocketErrorEventLike) => void) | null;
  onclose: ((event?: WebSocketCloseEventLike) => void) | null;
  send(data: unknown): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketFactory = (url: string, protocols?: string | string[]) => WebSocketLike;

export const WEB_SOCKET_CONNECTING = 0;
export const WEB_SOCKET_OPEN = 1;

export function createNativeWebSocket(url: string, protocols?: string | string[]): WebSocketLike {
  return new WebSocket(url, protocols) as unknown as WebSocketLike;
}
