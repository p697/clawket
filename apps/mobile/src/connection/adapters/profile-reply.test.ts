import { validProfileReply } from './profile-reply';

it('rejects malformed catalogs, duplicate IDs and unsupported replies', () => {
  const projects = [{ id: 'p', name: 'Project', available: true }];
  expect(validProfileReply('profile.projects', projects)).toBe(true);
  expect(validProfileReply('profile.projects', [...projects, ...projects])).toBe(false);
  expect(validProfileReply('profile.projects', [{ ...projects[0], available: 'true' }])).toBe(false);
  expect(validProfileReply('profile.defaults', { model: null, thinking: null, version: 'v', models: [{ id: 'm', name: 'Model', isDefault: true, levels: ['high'] }] })).toBe(true);
  expect(validProfileReply('profile.defaults', { model: null, thinking: null, version: 'v', models: [{ id: 'm', name: 'Model', isDefault: true, levels: [null] }] })).toBe(false);
  expect(validProfileReply('profile.unknown', {})).toBe(false);
});

it('preserves unknown quota and rejects impossible numeric values', () => {
  const usage = { plan: null, quotas: [], lifetimeTokens: null, daily: [] };
  expect(validProfileReply('profile.usage', usage)).toBe(true);
  const quota = { id: 'codex', name: 'Codex', windows: [{ usedPercent: 110, minutes: 300, resetsAt: null }] };
  expect(validProfileReply('profile.usage', { ...usage, quotas: [quota] })).toBe(true);
  for (const window of [{ usedPercent: -1 }, { minutes: 0 }, { resetsAt: 8640000000001 }]) {
    expect(validProfileReply('profile.usage', { ...usage, quotas: [{ ...quota, windows: [{ ...quota.windows[0], ...window }] }] })).toBe(false);
  }
});

it('bounds documents and supports large native MCP catalogs with explicit unavailable tools', () => {
  const doc = { id: 'd', name: 'AGENTS.md', version: 'v', content: '', editable: true, missing: true, size: 0 };
  expect(validProfileReply('profile.document', doc)).toBe(true);
  expect(validProfileReply('profile.document', { ...doc, content: '\0' })).toBe(false);
  expect(validProfileReply('profile.document', { ...doc, size: 131073 })).toBe(false);
  const server = { name: 'server', auth: 'unknown', toolsAvailable: false, tools: Array.from({ length: 522 }, (_, i) => ({ name: `tool${i}`, description: '' })) };
  expect(validProfileReply('profile.mcp', [server])).toBe(true);
  expect(validProfileReply('profile.mcp', [{ ...server, tools: [...server.tools, server.tools[0]] }])).toBe(false);
  expect(validProfileReply('profile.skills', { errorCount: 0, skills: [{ id: 's', name: 'Skill', description: '', scope: 'plugin', enabled: false, editable: false }] })).toBe(true);
});
