import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeBaseUrl,
  requireOkJson,
} from './preview-hermes-smoke.mjs';

test('normalizes the configured Registry base URL without starting the smoke run', () => {
  assert.equal(
    normalizeBaseUrl('https://registry.example.test/nested?query=1#fragment').href,
    'https://registry.example.test/',
  );
});

test('passes request options and an abort signal to the HTTP client', async () => {
  const calls = [];
  const payload = await requireOkJson(
    new URL('https://registry.example.test/v1/health'),
    { method: 'POST', headers: { accept: 'application/json' } },
    'Registry health',
    {
      fetchImpl: async (url, init) => {
        calls.push({ url: url.href, init });
        return { ok: true, json: async () => ({ ok: true }) };
      },
      timeoutMs: 100,
    },
  );

  assert.deepEqual(payload, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://registry.example.test/v1/health');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.accept, 'application/json');
  assert.equal(calls[0].init.signal instanceof AbortSignal, true);
});

test('times out while waiting for HTTP response headers with a labeled error', async () => {
  await assert.rejects(
    requireOkJson(
      new URL('https://registry.example.test/v1/health'),
      undefined,
      'Registry health',
      {
        fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
        timeoutMs: 5,
      },
    ),
    /Registry health timed out after 5 ms/,
  );
});

test('keeps the HTTP timeout active while parsing the response body', async () => {
  let requestSignal;
  await assert.rejects(
    requireOkJson(
      new URL('https://registry.example.test/v1/health'),
      undefined,
      'Registry health body',
      {
        fetchImpl: async (_url, { signal }) => {
          requestSignal = signal;
          return {
            ok: true,
            json: () => new Promise((_resolve, reject) => {
              requestSignal.addEventListener('abort', () => reject(requestSignal.reason), { once: true });
            }),
          };
        },
        timeoutMs: 5,
      },
    ),
    /Registry health body timed out after 5 ms/,
  );
});

test('reports HTTP status, transport, and JSON failures distinctly', async (t) => {
  await t.test('HTTP status', async () => {
    await assert.rejects(
      requireOkJson(
        new URL('https://registry.example.test/v1/health'),
        undefined,
        'Registry health',
        { fetchImpl: async () => ({ ok: false, status: 503 }), timeoutMs: 100 },
      ),
      /Registry health failed with status 503/,
    );
  });

  await t.test('transport error', async () => {
    await assert.rejects(
      requireOkJson(
        new URL('https://registry.example.test/v1/health'),
        undefined,
        'Registry health',
        { fetchImpl: async () => { throw new Error('connection reset'); }, timeoutMs: 100 },
      ),
      /Registry health request failed: connection reset/,
    );
  });

  await t.test('invalid JSON', async () => {
    await assert.rejects(
      requireOkJson(
        new URL('https://registry.example.test/v1/health'),
        undefined,
        'Registry health',
        {
          fetchImpl: async () => ({
            ok: true,
            json: async () => { throw new SyntaxError('bad JSON'); },
          }),
          timeoutMs: 100,
        },
      ),
      /Registry health returned invalid JSON/,
    );
  });
});
