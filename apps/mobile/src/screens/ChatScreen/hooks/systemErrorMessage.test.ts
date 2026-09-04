import { formatSystemErrorMessage } from './systemErrorMessage';

describe('formatSystemErrorMessage', () => {
  it('appends the raw error on a new line', () => {
    expect(formatSystemErrorMessage(
      'Connection Error: Check your network connection and that OpenClaw is running.',
      'WebSocket open timed out',
    )).toBe(
      'Connection Error: Check your network connection and that OpenClaw is running.\nRaw Error: WebSocket open timed out',
    );
  });

  it('returns the primary message when the raw error is empty', () => {
    expect(formatSystemErrorMessage('Connection Error', '   ')).toBe('Connection Error');
  });
});
