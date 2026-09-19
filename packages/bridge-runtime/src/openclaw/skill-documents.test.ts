import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenClawSkillDocuments } from './skill-documents.js';

const roots: string[] = [];
const sessions: OpenClawSkillDocuments[] = [];
afterEach(() => {
  sessions.splice(0).forEach(session => session.dispose());
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }));
  vi.useRealTimers();
});

function setup(scopes = ['operator.admin'], nativeMethods: string[] = []) {
  const root = mkdtempSync(join(tmpdir(), 'clawket-skill-'));
  roots.push(root);
  const baseDir = join(root, 'sample');
  mkdirSync(baseDir);
  const filePath = join(baseDir, 'SKILL.md');
  const source = '---\nname: sample\n---\n\n# Sample\n\n你好\n';
  writeFileSync(filePath, source);
  const skill = { skillKey: 'sample-key', name: 'sample', baseDir, filePath, source: 'openclaw-workspace', bundled: false };
  const gateway: any[] = [];
  const client: any[] = [];
  const session = new OpenClawSkillDocuments({ scopes, nativeMethods,
    sendGateway: text => gateway.push(JSON.parse(text)), sendClient: text => client.push(JSON.parse(text)) });
  sessions.push(session);
  const request = (params: object = {}, method = 'skills.get') => session.handleRequest(JSON.stringify({ type: 'req', id: 'mobile', method, params: { skillKey: skill.skillKey, agentId: 'selected-agent', ...params } }));
  const respond = (skills: unknown[] = [skill]) => session.handleResponse(JSON.stringify({ type: 'res', id: gateway.at(-1)?.id, ok: true, payload: { skills } }));
  return { root, filePath, source, skill, gateway, client, session, request, respond };
}

describe('authenticated OpenClaw skill documents', () => {
  it('reads exact installed source after a scoped status response, with original response identity', () => {
    const h = setup();
    expect(h.request()).toBe(true);
    expect(h.client).toEqual([]);
    expect(h.gateway[0]).toMatchObject({ method: 'skills.status', params: { agentId: 'selected-agent' } });
    expect(h.gateway[0].id).not.toBe('mobile');
    expect(h.respond()).toBe(true);
    expect(h.client[0]).toMatchObject({ id: 'mobile', ok: true, payload: { content: h.source, editable: true, path: realpathSync(h.filePath) } });
  });

  it('lists and reads nested scripts and references, but never writes them', () => {
    const h = setup();
    mkdirSync(join(h.skill.baseDir, 'scripts'));
    writeFileSync(join(h.skill.baseDir, 'scripts/run.py'), 'print("hello")');
    symlinkSync(h.filePath, join(h.skill.baseDir, 'scripts/linked.md'));
    h.request(); h.respond();
    expect(h.client[0].payload.linkedFiles).toEqual({ other: ['scripts/run.py'] });
    h.request({ filePath: 'scripts/run.py' }); h.respond();
    expect(h.client[1].payload).toMatchObject({ content: 'print("hello")', editable: false, filePath: 'scripts/run.py' });
    h.request({ filePath: 'scripts/run.py', content: 'overwrite' }, 'skills.content.update');
    expect(h.client[2].ok).toBe(false);
    h.request({ filePath: 'scripts/linked.md' }); h.respond();
    expect(h.client[3].ok).toBe(false);
    symlinkSync(h.root, join(h.skill.baseDir, 'outside'));
    h.request({ filePath: 'outside/sample/SKILL.md' }); h.respond();
    expect(h.client[4].ok).toBe(false);
  });

  it('preserves a UTF-8 BOM and CRLF source without normalizing the draft', () => {
    const h = setup();
    const source = '\uFEFF---\r\nname: sample\r\n---\r\n';
    writeFileSync(h.filePath, source);
    h.request(); h.respond();
    expect(h.client[0].payload.content).toBe(source);
  });

  it('atomically saves complete UTF-8 source and reads it back', () => {
    const h = setup();
    const content = '---\nname: sample\n---\n\n# Updated 中文\n';
    h.request({ content }, 'skills.content.update');
    h.respond();
    expect(h.client[0]).toMatchObject({ ok: true, payload: { ok: true, skillKey: 'sample-key' } });
    expect(readFileSync(h.filePath, 'utf8')).toBe(content);
    h.request(); h.respond();
    expect(h.client[1].payload.content).toBe(content);
  });

  it.each(['openclaw-bundled', 'openclaw-extra'])('reads %s as protected and preserves source on a rejected write', source => {
    const h = setup();
    h.skill.source = source;
    h.skill.bundled = source === 'openclaw-bundled';
    h.request(); h.respond();
    expect(h.client[0].payload).toMatchObject({ content: h.source, editable: false });
    h.request({ content: 'overwrite' }, 'skills.content.update'); h.respond();
    expect(h.client[1].ok).toBe(false);
    expect(readFileSync(h.filePath, 'utf8')).toBe(h.source);
  });

  it('read-only callers cannot write, and callers without read permission never trigger status', () => {
    const h = setup(['operator.read']);
    h.request(); h.respond();
    expect(h.client[0].payload.editable).toBe(false);
    h.request({ content: 'no' }, 'skills.content.update');
    expect(h.gateway).toHaveLength(1);
    expect(h.client[1].ok).toBe(false);
    const denied = setup([]);
    denied.request();
    expect(denied.gateway).toEqual([]);
    expect(denied.client[0].ok).toBe(false);
  });

  it('preserves Gateway permission failures without reading a local file', () => {
    const h = setup(); h.request();
    h.session.handleResponse(JSON.stringify({ type: 'res', id: h.gateway[0].id, ok: false, error: { code: 'INVALID_REQUEST', message: 'Agent access denied' } }));
    expect(h.client[0]).toEqual({ type: 'res', id: 'mobile', ok: false, error: { code: 'INVALID_REQUEST', message: 'Agent access denied' } });
  });

  it.each([{ skills: [] }, { skills: [{ skillKey: 'other' }] }])('rejects missing keys', ({ skills }) => {
    const h = setup(); h.request(); h.respond(skills);
    expect(h.client[0].ok).toBe(false);
  });

  it('rejects ambiguous keys, arbitrary paths and traversal', () => {
    const h = setup(); h.request(); h.respond([h.skill, h.skill]);
    expect(h.client[0].ok).toBe(false);
    h.request({ filePath: '../secret' });
    expect(h.gateway).toHaveLength(1);
    h.skill.filePath = join(h.root, 'SKILL.md');
    writeFileSync(h.skill.filePath, 'private');
    h.request(); h.respond();
    expect(h.client.at(-1).ok).toBe(false);
    expect(JSON.stringify(h.client)).not.toContain(h.root);
  });

  it('rejects symlink documents without disclosing or changing their targets', () => {
    const h = setup();
    const secret = join(h.root, 'secret'); writeFileSync(secret, 'private');
    rmSync(h.filePath); symlinkSync(secret, h.filePath);
    h.request(); h.respond();
    expect(h.client[0].ok).toBe(false);
    expect(JSON.stringify(h.client)).not.toContain('private');
    expect(readFileSync(secret, 'utf8')).toBe('private');
  });

  it.each([Buffer.from([0xff, 0xfe]), Buffer.from('a\0b'), Buffer.alloc(1024 * 1024 + 1, 65)])('rejects binary, invalid UTF-8 and oversized files', bytes => {
    const h = setup(); writeFileSync(h.filePath, bytes);
    h.request(); h.respond();
    expect(h.client[0].ok).toBe(false);
  });

  it('bounds concurrency and deadlines; disposal cancels pending reads and writes', () => {
    vi.useFakeTimers();
    const h = setup();
    for (let n = 0; n < 5; n++) h.request();
    expect(h.gateway).toHaveLength(4);
    expect(h.client).toHaveLength(1);
    vi.advanceTimersByTime(10_000);
    expect(h.client).toHaveLength(5);
    h.request({ content: 'late write' }, 'skills.content.update');
    h.session.dispose();
    expect(h.respond()).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(h.client).toHaveLength(5);
    expect(readFileSync(h.filePath, 'utf8')).toBe(h.source);
  });

  it('does not intercept native methods or another channel’s responses', () => {
    const h = setup(['operator.admin'], ['skills.get', 'skills.content.update']);
    expect(h.session.methods).toEqual([]);
    expect(h.request()).toBe(false);
    const a = setup(); const b = setup();
    a.request(); b.request();
    expect(b.session.handleResponse(JSON.stringify({ type: 'res', id: a.gateway[0].id, ok: true, payload: { skills: a.skill } }))).toBe(false);
    expect(a.client).toEqual([]); expect(b.client).toEqual([]);
  });
});
