export const WEBSOCKET_FRAME_LIMIT_BYTES = 8 * 1024 * 1024;
export const FRAME_TOO_LARGE_CLOSE_CODE = 1009;
export const FRAME_TOO_LARGE_ERROR_CODE = 'frame_too_large';

export type WebSocketFrameData =
  | string
  | ArrayBuffer
  | ArrayBufferView
  | ArrayBufferView[];

export function getWebSocketFrameByteLength(data: WebSocketFrameData): number {
  if (typeof data === 'string') return Buffer.byteLength(data, 'utf8');
  if (Array.isArray(data)) {
    return data.reduce((total, part) => total + part.byteLength, 0);
  }
  return data.byteLength;
}

export function isWebSocketFrameTooLarge(data: WebSocketFrameData): boolean {
  return getWebSocketFrameByteLength(data) > WEBSOCKET_FRAME_LIMIT_BYTES;
}

export function isWebSocketMaxPayloadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH'
    || code === 'WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH';
}
