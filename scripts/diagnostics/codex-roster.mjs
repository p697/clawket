#!/usr/bin/env node
// Standalone Node 22 diagnostic for an existing local Codex Bridge. No native
// startup, lifecycle writes, Relay admission, content output or automatic upload.
import { openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const FRAME_BYTES = 8 * 1024 * 1024, PAGE_BYTES = 64 * 1024, MAX_ROWS = 10_000;
const METHODS = new Set(['connect', 'health', 'agents.list', 'sessions.sync', 'sessions.list']);
const TOKEN = /^[a-f0-9]{32}$/;
const revisionToken = value => typeof value === 'string' && TOKEN.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const timestamp = value => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
const bytes = value => Buffer.byteLength(JSON.stringify(value));

class DiagnosticError extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}
const fail = reason => { throw new DiagnosticError(reason); };
export function classifyFailure(error) {
  if (error instanceof DiagnosticError) return error.reason;
  return 'unknown';
}
function rejected(frame) {
  const known = new Map([
    ['Conversation catalog could not be refreshed completely', 'catalog_refresh_failed'],
    ['Codex conversation catalog could not be refreshed completely', 'catalog_refresh_failed'],
    ['Invalid Codex conversation catalog', 'native_catalog_invalid'],
    ['Invalid Codex catalog cursor', 'native_catalog_cursor_invalid'],
    ['Invalid conversation catalog', 'catalog_invalid'],
    ['Codex catalog exceeds 10,000 conversations; use a project-scoped connection', 'catalog_row_limit'],
    ['Conversation catalog exceeds its size limit', 'catalog_size_limit'],
    ['A conversation catalog entry exceeds its size limit', 'catalog_entry_limit'],
    ['Conversation catalog changed during refresh; try again', 'catalog_changed'],
    ['Codex process is unavailable. Restart the Bridge.', 'native_unavailable'],
  ]);
  const message = frame?.error?.message;
  const native = typeof message === 'string'
    ? /^Codex rejected the operation \((-?\d{1,6})\)\. Check project trust and model configuration on your computer\.$/.exec(message) : null;
  return new DiagnosticError(known.get(message) ?? (native
    ? native[1] === '-32602' ? 'native_rpc_invalid_params'
      : native[1] === '-32601' ? 'native_rpc_method_missing' : 'native_rpc_rejected'
    : 'request_rejected'));
}

/** Field names only; never return row values, identities, titles or paths. */
export function descriptorIssues(row) {
  if (!object(row)) return ['descriptor'];
  const issues = [];
  for (const name of ['key', 'connectionId', 'agentId', 'title']) {
    if (typeof row[name] !== 'string' || (['key', 'agentId'].includes(name) && !row[name])
      || (name === 'key' && row.key.length > 1024)) issues.push(name);
  }
  if (!['main', 'channel', 'direct', 'group', 'subagent', 'cron', 'other'].includes(row.kind)) issues.push('kind');
  if (!timestamp(row.updatedAt)) issues.push('updatedAt');
  if (typeof row.hasActiveRun !== 'boolean') issues.push('hasActiveRun');
  if (!object(row.allowedActions)) issues.push('allowedActions');
  else for (const name of ['rename', 'reset', 'delete', 'pin', 'archive']) {
    if ((name !== 'archive' || row.allowedActions.archive !== undefined)
      && typeof row.allowedActions[name] !== 'boolean') issues.push(`allowedActions.${name}`);
  }
  if (row.lastActivityAt !== undefined && !timestamp(row.lastActivityAt)) issues.push('lastActivityAt');
  for (const name of ['archived', 'canContinue']) {
    if (row[name] !== undefined && typeof row[name] !== 'boolean') issues.push(name);
  }
  if (row.source !== undefined && !['bridge', 'native'].includes(row.source)) issues.push('source');
  if (row.attention !== undefined && row.attention !== null
    && !['input', 'approval', 'error', 'cron_failed'].includes(row.attention)) issues.push('attention');
  if (row.continuationBlockedReason !== undefined
    && !['in_use', 'ownership_unknown', 'project_unavailable'].includes(row.continuationBlockedReason)) issues.push('continuationBlockedReason');
  if (row.project !== undefined && (!object(row.project) || !['id', 'name', 'path'].every(name => typeof row.project[name] === 'string')
    || typeof row.project.available !== 'boolean')) issues.push('project');
  for (const name of ['preview', 'model', 'modelProvider', 'sessionId', 'parentSessionKey', 'channel']) {
    if (row[name] !== undefined && typeof row[name] !== 'string') issues.push(name);
  }
  return issues;
}
export function validateRows(rows) {
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) fail('catalog_rows_invalid');
  const fields = new Set(), keys = new Set();
  let invalidRows = 0;
  for (const row of rows) {
    const issues = descriptorIssues(row);
    if (issues.length) invalidRows++;
    for (const field of issues) fields.add(field);
    if (typeof row?.key === 'string') {
      if (keys.has(row.key)) fields.add('duplicate_keys');
      keys.add(row.key);
    }
  }
  return { rowCount: rows.length, invalidRows, invalidFields: [...fields].sort() };
}

/** Assemble the fresh full baseline using Mobile's envelope/row bounds. */
export async function readCatalog(request) {
  let restarts = 0;
  for (;;) {
    let page = await request('sessions.sync', {});
    const epoch = page?.epoch, revision = page?.revision, total = page?.total;
    if (!revisionToken(epoch) || !revisionToken(revision) || !integer(total) || total > MAX_ROWS) fail('catalog_envelope_invalid');
    let count = 0, size = 2, pages = 0, invalidRows = 0;
    const keys = new Set(), fields = new Set();
    for (;;) {
      if (!object(page) || page.kind !== 'full' || page.epoch !== epoch || page.revision !== revision || page.total !== total
        || page.offset !== count || bytes(page) > PAGE_BYTES) fail('catalog_page_invalid');
      const validation = validateRows(page.sessions);
      invalidRows += validation.invalidRows;
      for (const field of validation.invalidFields) fields.add(field);
      pages++;
      for (const row of page.sessions) {
        if (typeof row?.key === 'string') { if (keys.has(row.key)) fields.add('duplicate_keys'); keys.add(row.key); }
        size += bytes(row) + (count > 0 ? 1 : 0);
        if (size > FRAME_BYTES || count >= total) fail('catalog_size_invalid');
        count++;
      }
      if (page.nextOffset === null) {
        if (count !== total) fail('catalog_count_invalid');
        return { rowCount: count, pages, invalidRows, invalidFields: [...fields].sort() };
      }
      if (!integer(page.nextOffset) || page.nextOffset !== count || count >= total || !page.sessions.length) fail('catalog_offset_invalid');
      page = await request('sessions.sync', { page: { epoch, revision, offset: count } });
      if (page?.kind === 'expired') {
        if (!revisionToken(page.epoch) || restarts++ > 0) fail('catalog_expired');
        break;
      }
    }
  }
}

async function connect(config, timeoutMs) {
  if (typeof WebSocket !== 'function') fail('node_22_required');
  const socket = new WebSocket(`ws://127.0.0.1:${config.port}/v1/codex/ws`);
  const pending = new Map();
  let closed = false;
  const rejectPending = reason => {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new DiagnosticError(reason)); }
    pending.clear();
  };
  socket.addEventListener('message', event => {
    if (closed) return;
    if (typeof event.data !== 'string' || Buffer.byteLength(event.data) > FRAME_BYTES) {
      rejectPending('frame_limit'); socket.close(); return;
    }
    let frame;
    try { frame = JSON.parse(event.data); } catch { rejectPending('invalid_frame'); socket.close(); return; }
    if (frame?.type !== 'res') return;
    const call = pending.get(frame.id);
    if (!call) return;
    clearTimeout(call.timer); pending.delete(frame.id);
    if (frame.ok === true) call.resolve(frame.payload);
    else call.reject(rejected(frame));
  });
  socket.addEventListener('close', () => { closed = true; rejectPending('socket_closed'); });
  socket.addEventListener('error', () => rejectPending('socket_error'));
  const close = () => { closed = true; rejectPending('socket_closed'); socket.close(); };
  try {
    await new Promise((resolveOpen, reject) => {
      const timer = setTimeout(() => finish('connect_timeout'), Math.min(timeoutMs, 3000));
      const finish = reason => { clearTimeout(timer); reason ? reject(new DiagnosticError(reason)) : resolveOpen(); };
      socket.addEventListener('open', () => finish(), { once: true });
      socket.addEventListener('error', () => finish('socket_error'), { once: true });
      socket.addEventListener('close', () => finish('socket_closed'), { once: true });
    });
    const request = (method, params = {}) => {
      if (!METHODS.has(method)) return Promise.reject(new DiagnosticError('method_forbidden'));
      if (closed || socket.readyState !== WebSocket.OPEN) return Promise.reject(new DiagnosticError('socket_closed'));
      const id = randomUUID();
      return new Promise((resolveCall, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new DiagnosticError('request_timeout')); }, timeoutMs);
        pending.set(id, { resolve: resolveCall, reject, timer });
        try { socket.send(JSON.stringify({ type: 'req', id, method, params })); }
        catch { clearTimeout(timer); pending.delete(id); reject(new DiagnosticError('socket_error')); }
      });
    };
    const identity = await request('connect', { token: config.token, controlOnly: true });
    if (identity?.backend !== 'codex' || identity.controlReady !== true) fail('identity_invalid');
    return { request, close };
  } catch (error) { close(); throw error; }
}

export function loadConfig(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 256 * 1024) fail('config_invalid');
    const buffer = Buffer.alloc(256 * 1024 + 1);
    const count = readSync(fd, buffer, 0, buffer.length, 0);
    if (count > 256 * 1024) fail('config_invalid');
    const value = JSON.parse(buffer.subarray(0, count).toString('utf8'));
    if (!object(value) || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535
      || typeof value.token !== 'string' || Buffer.byteLength(value.token) < 32 || Buffer.byteLength(value.token) > 1024) fail('config_invalid');
    return { port: value.port, token: value.token };
  } catch (error) { throw new DiagnosticError(error instanceof DiagnosticError ? error.reason : 'config_unavailable'); }
  finally { if (fd !== undefined) closeSync(fd); }
}

export async function diagnose(config, { timeoutMs = 20_000, overallMs = 90_000 } = {}) {
  const checks = [], started = performance.now();
  let client, deadline;
  const check = async (step, work) => {
    const begin = performance.now();
    try {
      const metadata = await work();
      const invalid = metadata?.invalidFields?.length > 0;
      const result = { step, status: invalid ? 'error' : 'ok', ...(invalid ? { reason: 'descriptor_invalid' } : {}),
        elapsedMs: Math.min(90_000, Math.max(0, Math.round(performance.now() - begin))), ...metadata };
      checks.push(result); return result;
    } catch (error) {
      const result = { step, status: 'error', reason: classifyFailure(error), elapsedMs: Math.min(90_000, Math.max(0, Math.round(performance.now() - begin))) };
      checks.push(result); return result;
    }
  };
  try {
    const auth = await check('local_auth', async () => { client = await connect(config, timeoutMs); return {}; });
    if (auth.status === 'ok') {
      deadline = setTimeout(() => client.close(), Math.max(1, overallMs - (performance.now() - started)));
      await check('health', async () => {
        const health = await client.request('health');
        if (health?.backend !== 'codex') fail('identity_invalid');
        return { catalogSync: health.sessionCatalogSync === 1,
          modelReady: typeof health.modelReady === 'boolean' ? health.modelReady : null };
      });
      await check('agents', async () => {
        const agents = await client.request('agents.list');
        if (!Array.isArray(agents) || agents.length !== 1 || agents[0]?.agentId !== 'codex'
          || typeof agents[0].name !== 'string' || typeof agents[0].mainSessionKey !== 'string') fail('agents_invalid');
        return { agentCount: agents.length };
      });
      const catalog = await check('catalog_sync', () => readCatalog(client.request));
      if (catalog.status !== 'ok') await check('legacy_catalog', async () => {
        const rows = await client.request('sessions.list');
        if (bytes(rows) > FRAME_BYTES) fail('catalog_size_invalid');
        return validateRows(rows);
      });
    }
  } finally { clearTimeout(deadline); client?.close(); }
  return { diagnostic: 'codex_roster_v1', transport: 'local', timestamp: new Date().toISOString(),
    status: checks.every(check => check.status === 'ok') ? 'ok' : 'error', checks };
}

export async function main(args = process.argv.slice(2), output = value => console.log(JSON.stringify(value, null, 2))) {
  try {
    if (args.length && !(args.length === 2 && args[0] === '--config' && args[1])) fail('arguments_invalid');
    const path = args[1] ?? join(homedir(), '.clawket', 'codex', 'device', 'production', 'runtime.json');
    const report = await diagnose(loadConfig(path));
    output(report); return report.status === 'ok' ? 0 : 1;
  } catch (error) {
    output({ diagnostic: 'codex_roster_v1', transport: 'local', status: 'error', reason: classifyFailure(error) }); return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
