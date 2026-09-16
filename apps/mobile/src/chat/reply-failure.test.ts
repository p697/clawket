import { describeReplyFailure, sanitizeReplyFailure } from './reply-failure';

describe('reply failure diagnostics', () => {
  it('recognizes the actual Claude OAuth incident and preserves the recovery command', () => {
    const raw = 'Model login expired on the gateway for claude-cli. Re-auth with `claude auth login && openclaw models auth login --agent main --provider anthropic --method cli` in a terminal, then try again.';
    expect(describeReplyFailure(raw)).toEqual({
      summaryKey: 'Model authentication failed. Sign in again on your computer.', details: raw,
    });
    expect(describeReplyFailure('Failed to authenticate: OAuth session expired and could not be refreshed').summaryKey).toContain('authentication');
  });
  it('distinguishes quota and rate limiting without losing unknown backend failures', () => {
    expect(describeReplyFailure('insufficient_quota').summaryKey).toContain('quota');
    expect(describeReplyFailure('429 Too many requests').summaryKey).toContain('rate limited');
    expect(describeReplyFailure('Hermes inference worker exited', 'server').details).toBe('Hermes inference worker exited');
    expect(describeReplyFailure('')).toMatchObject({ details: '', summaryKey: "The agent couldn't complete this reply. Please try again." });
  });
  it('redacts credentials and secret-bearing URL parts before display or copy', () => {
    const result = sanitizeReplyFailure('token refresh failed: access_token="secret1" apiKey=secret2 Authorization: Bearer abc.123 refresh_token=secret3 sk-ant-secret4 https://u:secret5@host/path?token=secret6#secret7 wss://host/ws?clientToken=secret8 token=secret9');
    for (const secret of ['secret1', 'secret2', 'abc.123', 'secret3', 'secret4', 'secret5', 'secret6', 'secret7', 'secret8', 'secret9']) expect(result).not.toContain(secret);
    expect(result).toContain('https://host/path');
    expect(sanitizeReplyFailure('a'.repeat(20_000))).toHaveLength(12_000);
  });
});


it('does not prescribe reauthentication for a network/policy 403 refusal', () => {
  const raw = 'Failed to authenticate. API Error: 403 Request not allowed';
  expect(describeReplyFailure(raw)).toEqual({
    summaryKey: "The agent couldn't complete this reply. Please try again.",
    details: raw,
  });
});
