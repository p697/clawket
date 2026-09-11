import {
  assertWebSocketFrameWithinLimit,
  FRAME_TOO_LARGE_ERROR_CODE,
  getWebSocketFrameByteLength,
  isWebSocketFrameTooLarge,
  WEBSOCKET_FRAME_LIMIT_BYTES,
  WebSocketFrameTooLargeError,
} from './websocket-frame-limit';

describe('mobile WebSocket frame limit', () => {
  it('allows exactly 8 MiB and rejects one byte more', () => {
    expect(assertWebSocketFrameWithinLimit('a'.repeat(WEBSOCKET_FRAME_LIMIT_BYTES))).toBe(
      WEBSOCKET_FRAME_LIMIT_BYTES,
    );
    expect(() => assertWebSocketFrameWithinLimit(
      'a'.repeat(WEBSOCKET_FRAME_LIMIT_BYTES + 1),
    )).toThrow(WebSocketFrameTooLargeError);
  });

  it('counts UTF-8 bytes rather than JavaScript string code units', () => {
    expect(getWebSocketFrameByteLength('a😀界')).toBe(8);
    expect(isWebSocketFrameTooLarge('😀'.repeat(WEBSOCKET_FRAME_LIMIT_BYTES / 4))).toBe(false);
    expect(isWebSocketFrameTooLarge(
      `😀${'a'.repeat(WEBSOCKET_FRAME_LIMIT_BYTES - 3)}`,
    )).toBe(true);
  });

  it('preserves the measured M0 payload headroom', () => {
    expect(assertWebSocketFrameWithinLimit('a'.repeat(6_990_768))).toBe(6_990_768);
  });

  it('reports a stable machine-readable error code', () => {
    try {
      assertWebSocketFrameWithinLimit(new Uint8Array(WEBSOCKET_FRAME_LIMIT_BYTES + 1));
      throw new Error('expected oversized frame rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(WebSocketFrameTooLargeError);
      expect((error as WebSocketFrameTooLargeError).code).toBe(FRAME_TOO_LARGE_ERROR_CODE);
    }
  });
});
