import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { descriptorIssues, readCatalog, validateRows, diagnose, loadConfig, main } from './codex-roster.mjs';

const secret = 'PRIVATE-CONTENT-CANARY';
const row = (key = 'native-test') => ({ connectionId: '', agentId: 'codex', key, title: secret,
  kind: 'direct', updatedAt: 123, lastActivityAt: null, hasActiveRun: false, preview: secret,
  project: { id: secret, name: secret, path: secret, available: true }, modelProvider: secret,
  allowedActions: { rename: true, reset: false, delete: false, pin: true } });
const full = (sessions = [row()], extra = {}) => ({ kind: 'full', epoch: 'a'.repeat(32), revision: 'b'.repeat(32),
  total: sessions.length, offset: 0, sessions, nextOffset: null, ...extra });
async function server(handler, work) {
  const ws = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(resolve => ws.once('listening', resolve));
  const methods = [];
  ws.on('connection', socket => socket.on('message', raw => {
    const frame = JSON.parse(raw.toString()); methods.push(frame.method);
    const response = handler(frame, socket);
    if (response !== undefined) socket.send(JSON.stringify({ type: 'res', id: frame.id, ok: true, payload: response }));
  }));
  try { await work({ port: ws.address().port, token: 'x'.repeat(64) }, methods); }
  finally { for (const socket of ws.clients) socket.terminate(); await new Promise(resolve => ws.close(resolve)); }
}
function base(frame) {
  if (frame.method === 'connect') return { backend: 'codex', controlReady: true };
  if (frame.method === 'health') return { backend: 'codex', sessionCatalogSync: 1, modelReady: true };
  if (frame.method === 'agents.list') return [{ agentId: 'codex', name: secret, mainSessionKey: '' }];
}

test('field validation mirrors the Mobile descriptor boundary without exposing values', () => {
  assert.deepEqual(descriptorIssues(row()), []);
  for (const [field, value] of [['updatedAt', -1], ['model', null], ['preview', {}], ['kind', secret], ['attention', secret],
    ['canContinue', secret], ['source', secret], ['continuationBlockedReason', secret], ['title', null]]) {
    assert.ok(descriptorIssues({ ...row(), [field]: value }).includes(field));
  }
  const metadata = validateRows([{ ...row(), model: null }, row()]);
  assert.deepEqual(metadata, { rowCount: 2, invalidRows: 1, invalidFields: ['duplicate_keys', 'model'] });
  assert.ok(!JSON.stringify(metadata).includes(secret));
});

test('assembles full frozen pages and counts only metadata', async () => {
  const calls = [];
  const report = await readCatalog(async (method, params) => {
    calls.push({ method, params });
    return params.page ? full([row('second')], { total: 2, offset: 1 }) : full([row()], { total: 2, nextOffset: 1 });
  });
  assert.deepEqual(report, { rowCount: 2, pages: 2, invalidRows: 0, invalidFields: [] });
  assert.equal(calls[1].params.page.offset, 1);
  assert.ok(!JSON.stringify(report).includes(secret));
});

test('fails closed on corrupt envelopes, offsets, oversized pages, repeated expiry and excess totals', async () => {
  for (const page of [full([], { epoch: ['a'.repeat(32)] }), full([], { kind: 'delta' }), full([], { total: 10001 }),
    full([row()], { offset: 1 }), full([row()], { nextOffset: 0 }), full([row()], { total: 2 }),
    full([{ ...row(), preview: 'x'.repeat(65536) }])]) {
    await assert.rejects(readCatalog(async () => page));
  }
  let count = 0;
  await assert.rejects(readCatalog(async () => ++count % 2 ? full([row()], { total: 2, nextOffset: 1 }) : { kind: 'expired', epoch: 'a'.repeat(32) }),
    error => error.reason === 'catalog_expired');
});

test('success uses one local socket and only allowlisted reads, with no content or token output', async () => {
  await server(frame => base(frame) ?? full(), async (config, methods) => {
    const report = await diagnose(config);
    assert.equal(report.status, 'ok');
    assert.equal(report.transport, 'local');
    assert.deepEqual(methods, ['connect', 'health', 'agents.list', 'sessions.sync']);
    assert.ok(!JSON.stringify(report).includes(secret));
    assert.ok(!JSON.stringify(report).includes(config.token));
  });
});

test('a malformed descriptor identifies the exact field and checks legacy listing without treating it as recovery', async () => {
  await server(frame => base(frame) ?? (frame.method === 'sessions.list' ? [row()] : full([{ ...row(), model: null }])), async (config, methods) => {
    const report = await diagnose(config);
    assert.equal(report.status, 'error');
    assert.deepEqual(report.checks.find(check => check.step === 'catalog_sync').invalidFields, ['model']);
    assert.equal(report.checks.at(-1).step, 'legacy_catalog');
    assert.equal(report.checks.at(-1).status, 'ok');
    assert.equal(methods.at(-1), 'sessions.list');
    assert.ok(!JSON.stringify(report).includes(secret));
  });
});

test('unknown backend errors stay fixed categories; known native parameter rejection is distinguished', async () => {
  for (const [message, reason] of [[secret, 'request_rejected'],
    ['Codex rejected the operation (-32602). Check project trust and model configuration on your computer.', 'native_rpc_invalid_params'],
    ['Conversation catalog could not be refreshed completely', 'catalog_refresh_failed']]) {
    await server((frame, socket) => {
      if (base(frame)) return base(frame);
      socket.send(JSON.stringify({ type: 'res', id: frame.id, ok: false, error: { code: secret, message } }));
    }, async config => {
      const report = await diagnose(config);
      assert.equal(report.checks.find(check => check.step === 'catalog_sync').reason, reason);
      assert.ok(!JSON.stringify(report).includes(secret));
    });
  }
});

test('wrong authenticated identity aborts further reads and a stalled read has a bounded timeout', async () => {
  await server(() => ({ backend: 'other', controlReady: true }), async (config, methods) => {
    const report = await diagnose(config);
    assert.equal(report.checks[0].reason, 'identity_invalid');
    assert.deepEqual(methods, ['connect']);
  });
  await server(frame => base(frame), async config => {
    const report = await diagnose(config, { timeoutMs: 20, overallMs: 100 });
    assert.equal(report.checks.find(check => check.step === 'catalog_sync').reason, 'request_timeout');
  });
});

test('missing, corrupt and oversized configuration and invalid arguments fail without echoing paths or secrets', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'clawket-roster-test-'));
  const path = join(directory, secret + '.json');
  try {
    assert.throws(() => loadConfig(path), error => error.reason === 'config_unavailable');
    for (const value of ['', '{', JSON.stringify({ port: 0, token: secret }), 'x'.repeat(256 * 1024 + 1)]) {
      writeFileSync(path, value);
      assert.throws(() => loadConfig(path));
    }
    const outputs = [];
    assert.equal(await main(['--unknown', secret], value => outputs.push(value)), 1);
    assert.ok(!JSON.stringify(outputs).includes(secret));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
