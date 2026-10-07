import { describe, expect, it, vi } from 'vitest';
import { authorizeRelayToken } from './auth';
import { policyForBackend } from '../backend-policy';

describe.each(['openclaw', 'hermes', 'local-model', 'codex', 'claude-code', 'pi'].map(policyForBackend))('$backend registry verification lifecycle', policy => {
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

  it('cancels a rejected response body and clears the timeout', async () => {
    vi.useFakeTimers(); const cancel = vi.fn(async () => {});
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 401, body: { cancel } })));
    try {
      await expect(authorizeRelayToken(input())).resolves.toMatchObject({ authorized: false });
      expect(cancel).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
  });

  it('bounds a hung 200 response body, cancels its reader and releases the timer', async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }));
    let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
    vi.stubGlobal('fetch', vi.fn(async () => { started(); return response; }));
    try {
      const pending = authorizeRelayToken(input()); await ready;
      await vi.advanceTimersByTimeAsync(9_999); expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toMatchObject({ authorized: false });
      expect(cancel).toHaveBeenCalledOnce(); expect(response.body?.locked).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
  });

  it.each(['gateway', 'client'] as const)('accepts only the verified %s role with missing or stale KV', async role => {
    vi.useFakeTimers();
    try {
      for (const stale of [false, true]) {
        const routesKv = { get: async () => stale ? JSON.stringify({
          [policy.principalRecordField]: 'test-principal', relaySecretHash: 'stale-hash', clientTokens: [],
        }) : null } as unknown as KVNamespace;
        for (const verifiedRole of ['gateway', 'client'] as const) {
          const response = Response.json({ ok: true, role: verifiedRole });
          vi.stubGlobal('fetch', vi.fn(async () => response));
          await expect(authorizeRelayToken({ ...input(), role, routesKv })).resolves.toMatchObject({
            authorized: role === verifiedRole, path: role === verifiedRole ? 'registry' : 'rejected',
          });
          expect(response.body?.locked).toBe(false); expect(vi.getTimerCount()).toBe(0);
        }
      }
    } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
  });

  it.each(['', 'broken-json', 'null', '[]', '{}', '{"ok":true}', '{"ok":false,"role":"gateway"}',
    '{"ok":true,"role":"bridge"}', ' '.repeat(1025) + '{"ok":true,"role":"gateway"}'])('rejects malformed or oversized verification body #%#', async body => {
    vi.useFakeTimers(); const response = new Response(body);
    vi.stubGlobal('fetch', vi.fn(async () => response));
    try {
      await expect(authorizeRelayToken(input())).resolves.toMatchObject({ authorized: false });
      expect(response.body?.locked).toBe(false); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
  });
});
