import { describe, expect, it, vi } from 'vitest';
import { authorizeRelayToken } from './auth';
import { HERMES_BACKEND_POLICY, OPENCLAW_BACKEND_POLICY } from '../backend-policy';

describe.each([OPENCLAW_BACKEND_POLICY, HERMES_BACKEND_POLICY])('$backend registry verification lifecycle', policy => {
  const input = () => ({ routesKv: { get: async () => null } as unknown as KVNamespace,
    registryVerifyUrl: 'https://registry.example', principalId: 'test-principal',
    policy, role: 'gateway' as const, token: 'test-secret' });

  it('bounds a hung verification and releases its timer', async () => {
    vi.useFakeTimers();
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('test aborted')), { once: true });
      started();
    })));
    try {
      const pending = authorizeRelayToken(input()); await ready;
      await vi.advanceTimersByTimeAsync(9_999);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toMatchObject({ authorized: false, path: 'rejected' });
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
  });

  it.each([200, 401])('cancels the unused %s response body and clears the timeout', async status => {
    vi.useFakeTimers(); const cancel = vi.fn(async () => {});
    vi.stubGlobal('fetch', vi.fn(async () => ({ status, body: { cancel } })));
    try {
      await expect(authorizeRelayToken(input())).resolves.toMatchObject({ authorized: status === 200 });
      expect(cancel).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
  });
});
