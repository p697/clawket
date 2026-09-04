import type { AdapterErrorCode, Capabilities } from '@clawket/agent-protocol';
import {
  deriveThreadContentState,
  resolveContextRemainingPercent,
  resolveThreadErrorCode,
  resolveThreadErrorDetail,
  resolveThreadHeaderName,
  resolveThreadHeaderSubtitle,
  THREAD_ERROR_COPY,
} from './model';

const CAPABILITIES = {
  models: true,
} as Capabilities;

const ADAPTER_ERROR_CODES = [
  'unauthorized',
  'pairing_required',
  'pairing_expired',
  'bridge_offline',
  'gateway_offline',
  'network',
  'timeout',
  'rate_limited',
  'frame_too_large',
  'unsupported',
  'server',
] as const satisfies readonly AdapterErrorCode[];

describe('Thread model', () => {
  it('prioritizes locked and actionable error states over runtime content', () => {
    expect(deriveThreadContentState({
      locked: true,
      historyLoaded: true,
      hasMessages: true,
      connectionState: 'ready',
      error: { code: 'network', message: 'No network' },
    })).toEqual({ kind: 'locked' });

    expect(deriveThreadContentState({
      historyLoaded: true,
      hasMessages: true,
      connectionState: 'ready',
      error: { code: 'timeout', message: 'Connection timed out', actionLabel: 'Retry' },
    })).toEqual({
      kind: 'error',
      code: 'timeout',
      message: 'Connection timed out',
      actionLabel: 'Retry',
    });
  });

  it('distinguishes loading, empty, ready, and cache-preserving offline states', () => {
    expect(deriveThreadContentState({
      switching: true,
      historyLoaded: true,
      hasMessages: true,
      connectionState: 'ready',
    })).toEqual({ kind: 'loading' });
    expect(deriveThreadContentState({
      targetSessionReady: false,
      historyLoaded: true,
      hasMessages: true,
      connectionState: 'ready',
    })).toEqual({ kind: 'loading' });
    expect(deriveThreadContentState({
      historyLoaded: true,
      hasMessages: true,
      connectionState: 'connecting',
    })).toEqual({ kind: 'loading' });
    expect(deriveThreadContentState({
      historyLoaded: true,
      hasMessages: false,
      connectionState: 'ready',
    })).toEqual({ kind: 'empty' });
    expect(deriveThreadContentState({
      historyLoaded: true,
      hasMessages: true,
      connectionState: 'ready',
    })).toEqual({ kind: 'ready' });
    expect(deriveThreadContentState({
      historyLoaded: false,
      hasMessages: true,
      connectionState: 'reconnecting',
    })).toEqual({ kind: 'offline' });
  });

  it('clamps context remaining and rejects unusable context windows', () => {
    expect(resolveContextRemainingPercent(46, 100)).toBe(54);
    expect(resolveContextRemainingPercent(-20, 100)).toBe(100);
    expect(resolveContextRemainingPercent(200, 100)).toBe(0);
    expect(resolveContextRemainingPercent(Number.NaN, 100)).toBeNull();
    expect(resolveContextRemainingPercent(20, 0)).toBeNull();
    expect(resolveContextRemainingPercent(undefined, 100)).toBeNull();
  });

  it('uses capability metadata to suppress model copy and prioritizes activity states', () => {
    const base = {
      capabilities: CAPABILITIES,
      state: { kind: 'ready' } as const,
      isRunning: false,
      model: 'Sonnet',
      contextUsed: 46,
      contextWindow: 100,
      offlineLabel: 'Offline · reconnecting',
      thinkingLabel: 'Thinking…',
      formatModelContext: (model: string, remaining: number) => `${model} · ${remaining}% left`,
    };

    expect(resolveThreadHeaderSubtitle(base)).toBe('Sonnet · 54% left');
    expect(resolveThreadHeaderSubtitle({
      ...base,
      capabilities: { ...CAPABILITIES, models: false },
    })).toBe('');
    expect(resolveThreadHeaderSubtitle({
      ...base,
      isRunning: true,
      activityLabel: 'Using exec…',
    })).toBe('Using exec…');
    expect(resolveThreadHeaderSubtitle({
      ...base,
      state: { kind: 'offline' },
      isRunning: true,
    })).toBe('Offline · reconnecting');
  });

  it('adds a session title only for non-main sessions', () => {
    expect(resolveThreadHeaderName('Atlas', 'Main', true)).toBe('Atlas');
    expect(resolveThreadHeaderName('Atlas', 'Build release', false)).toBe('Atlas · Build release');
    expect(resolveThreadHeaderName('Atlas', '  ', false)).toBe('Atlas');
  });

  it('defines product copy for the complete adapter error-code union', () => {
    expect(Object.keys(THREAD_ERROR_COPY).sort()).toEqual([...ADAPTER_ERROR_CODES].sort());
    for (const code of ADAPTER_ERROR_CODES) {
      expect(resolveThreadErrorCode({ code })).toBe(code);
      expect(THREAD_ERROR_COPY[code].messageKey.trim()).not.toBe('');
    }
  });

  it('falls back unknown and string failures to network while retaining useful detail', () => {
    expect(resolveThreadErrorCode({ code: 'future_error' })).toBe('network');
    expect(resolveThreadErrorCode(new Error('socket closed'))).toBe('network');
    expect(resolveThreadErrorDetail('  relay unavailable  ')).toBe('relay unavailable');
    expect(resolveThreadErrorDetail({ message: '  handshake failed  ' }))
      .toBe('handshake failed');
  });
});
