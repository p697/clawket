export const WEBSOCKET_FRAME_LIMIT_BYTES = 8 * 1024 * 1024;
export const FRAME_TOO_LARGE_CLOSE_CODE = 1009;
export const FRAME_TOO_LARGE_ERROR_CODE = 'frame_too_large';

const utf8Encoder = new TextEncoder();

export class WebSocketFrameTooLargeError extends Error {
  readonly code = FRAME_TOO_LARGE_ERROR_CODE;

  constructor(
    public readonly byteLength: number,
    public readonly limitBytes = WEBSOCKET_FRAME_LIMIT_BYTES,
  ) {
    super(FRAME_TOO_LARGE_ERROR_CODE);
    this.name = 'WebSocketFrameTooLargeError';
  }
}

export function getWebSocketFrameByteLength(data: unknown): number | null {
  if (typeof data === 'string') return utf8Encoder.encode(data).byteLength;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (
    data !== null
    && typeof data === 'object'
    && typeof (data as { size?: unknown }).size === 'number'
  ) {
    const size = (data as { size: number }).size;
    return Number.isFinite(size) && size >= 0 ? size : null;
  }
  return null;
}

export function assertWebSocketFrameWithinLimit(data: unknown): number {
  const byteLength = getWebSocketFrameByteLength(data);
  if (byteLength == null) {
    throw new TypeError('Unsupported WebSocket frame data');
  }
  if (byteLength > WEBSOCKET_FRAME_LIMIT_BYTES) {
    throw new WebSocketFrameTooLargeError(byteLength);
  }
  return byteLength;
}

export function isWebSocketFrameTooLarge(data: unknown): boolean {
  const byteLength = getWebSocketFrameByteLength(data);
  return byteLength != null && byteLength > WEBSOCKET_FRAME_LIMIT_BYTES;
}
