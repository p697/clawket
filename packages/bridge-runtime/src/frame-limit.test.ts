import { describe, expect, it } from 'vitest';
import {
  FRAME_TOO_LARGE_ERROR_CODE,
  getWebSocketFrameByteLength,
  isWebSocketFrameTooLarge,
  isWebSocketMaxPayloadError,
  WEBSOCKET_FRAME_LIMIT_BYTES,
} from './frame-limit.js';

describe('WebSocket frame limit', () => {
  it('allows exactly 8 MiB and rejects one byte more', () => {
    expect(isWebSocketFrameTooLarge(Buffer.alloc(WEBSOCKET_FRAME_LIMIT_BYTES))).toBe(false);
    expect(isWebSocketFrameTooLarge(Buffer.alloc(WEBSOCKET_FRAME_LIMIT_BYTES + 1))).toBe(true);
  });

  it('counts UTF-8 bytes rather than JavaScript string code units', () => {
    expect(getWebSocketFrameByteLength('a😀界')).toBe(8);
    expect(getWebSocketFrameByteLength('😀'.repeat(WEBSOCKET_FRAME_LIMIT_BYTES / 4))).toBe(
      WEBSOCKET_FRAME_LIMIT_BYTES,
    );
    expect(isWebSocketFrameTooLarge(`😀${'a'.repeat(WEBSOCKET_FRAME_LIMIT_BYTES - 3)}`)).toBe(true);
  });

  it('counts fragmented and contiguous binary frames without decoding them', () => {
    expect(getWebSocketFrameByteLength([
      Buffer.alloc(3),
      new Uint8Array(5),
    ])).toBe(8);
    expect(getWebSocketFrameByteLength(new ArrayBuffer(12))).toBe(12);
  });

  it('uses the stable machine-readable error code', () => {
    expect(FRAME_TOO_LARGE_ERROR_CODE).toBe('frame_too_large');
  });

  it('recognizes ws receiver errors that occur before message delivery', () => {
    expect(isWebSocketMaxPayloadError({
      code: 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH',
    })).toBe(true);
    expect(isWebSocketMaxPayloadError({
      code: 'WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH',
    })).toBe(true);
    expect(isWebSocketMaxPayloadError(new Error('Max payload size exceeded'))).toBe(false);
  });
});
