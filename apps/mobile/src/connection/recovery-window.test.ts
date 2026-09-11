import { ConnectionRecoveryWindow, requiresConnectionAction } from './recovery-window';

describe('connection recovery presentation deadline', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('gives one outage 20 seconds, without extending it for each retry', () => {
    const expired = jest.fn();
    const recovery = new ConnectionRecoveryWindow(expired);
    recovery.begin();
    jest.advanceTimersByTime(15_000);
    recovery.begin();
    expect(recovery.phase).toBe('recovering');
    jest.advanceTimersByTime(5_000);
    expect(recovery.phase).toBe('failed');
    expect(expired).toHaveBeenCalledTimes(1);
    recovery.begin();
    expect(recovery.phase).toBe('failed');
  });

  it('does not count background suspension and gives foreground a fresh window', () => {
    const expired = jest.fn();
    const recovery = new ConnectionRecoveryWindow(expired);
    recovery.begin();
    jest.advanceTimersByTime(19_000);
    recovery.setActive(false);
    jest.advanceTimersByTime(300_000);
    expect(expired).not.toHaveBeenCalled();
    recovery.setActive(true);
    jest.advanceTimersByTime(19_999);
    expect(recovery.phase).toBe('recovering');
    jest.advanceTimersByTime(1);
    expect(recovery.phase).toBe('failed');
  });

  it('clears pending deadlines on healthy evidence, pause, disposal or connection switch', () => {
    const expired = jest.fn();
    const recovery = new ConnectionRecoveryWindow(expired);
    recovery.begin();
    recovery.finish();
    jest.advanceTimersByTime(30_000);
    expect(recovery.phase).toBeNull();
    expect(expired).not.toHaveBeenCalled();
  });

  it('keeps actionable authentication failures distinct from transient health timeouts', () => {
    expect(requiresConnectionAction('pairing_required')).toBe(true);
    expect(requiresConnectionAction('auth_rejected')).toBe(true);
    expect(requiresConnectionAction('Hermes health frame timed out')).toBe(false);
    const recovery = new ConnectionRecoveryWindow(jest.fn());
    recovery.begin();
    recovery.fail();
    expect(recovery.phase).toBe('failed');
  });
});
