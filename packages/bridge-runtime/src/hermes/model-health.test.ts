import { describe, expect, it, vi } from 'vitest';
import { readHermesModelHealth, supportsHermesModelHealth, MODEL_HEALTH_SCRIPT } from './model-health.js';

describe('native Hermes model health boundary', () => {
  it('returns only bounded status metadata and explicitly requests native probes', async () => {
    const run = vi.fn().mockResolvedValue({ scope: 'global', model: 'model', provider: 'provider', checkedAtMs: 123,
      apiKey: 'private', providers: [{ id: 'provider', name: 'Provider', credentials: 'configured', token: 'private' }],
      checks: [{ name: 'Provider', status: 'reachable', detail: 'private endpoint' }] });
    expect(await readHermesModelHealth(run, true)).toEqual({ scope: 'global', model: 'model', provider: 'provider', checkedAtMs: 123,
      providers: [{ id: 'provider', name: 'Provider', credentials: 'configured' }], checks: [{ name: 'Provider', status: 'reachable' }] });
    expect(run).toHaveBeenCalledWith(MODEL_HEALTH_SCRIPT, { probe: true });
    await readHermesModelHealth(run, false);
    expect(run).toHaveBeenLastCalledWith(MODEL_HEALTH_SCRIPT, { probe: false });
  });
  it.each([null, {}, { providers: [], checks: [], checkedAtMs: '123' },
    { providers: [{ credentials: 'maybe' }], checks: [], checkedAtMs: 123 },
    { providers: [], checks: [{ status: 'maybe' }], checkedAtMs: 123 },
    { providers: Array(101).fill({ credentials: 'unknown' }), checks: [], checkedAtMs: 123 },
  ])('rejects malformed metadata', async value => {
    await expect(readHermesModelHealth(vi.fn().mockResolvedValue(value), false)).rejects.toThrow();
  });
});


it('negotiates model health only after successful native imports', async () => {
  expect(await supportsHermesModelHealth(vi.fn().mockResolvedValue(true))).toBe(true);
  expect(await supportsHermesModelHealth(vi.fn().mockResolvedValue('true'))).toBe(false);
  expect(await supportsHermesModelHealth(vi.fn().mockRejectedValue(new Error('old version')))).toBe(false);
});
