import { expect, it } from 'vitest';
import { mkdtemp, mkdir, realpath, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexRpc } from './rpc.js';
import { CodexProfile } from './profile.js';

it('persists defaults, skills and instructions through an installed App Server in isolated native state', async () => {
  if (process.env.CLAWKET_CODEX_PROFILE_NATIVE !== '1') throw new Error('Set CLAWKET_CODEX_PROFILE_NATIVE=1 for this explicit native integration');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'clawket-profile-native-')));
  const project = join(root, 'project'); const user = join(root, 'codex');
  await mkdir(join(project, '.agents', 'skills', 'profile-qa'), { recursive: true }); await mkdir(user);
  await writeFile(join(project, '.agents', 'skills', 'profile-qa', 'SKILL.md'), '---\nname: profile-qa\ndescription: Local management acceptance fixture\n---\nReturn a short answer.');
  const rpc = new CodexRpc(process.env.CLAWKET_CODEX_PROFILE_COMMAND ?? 'codex', project, { ...process.env, CODEX_HOME: user });
  const profile = new CodexProfile({ request: (method, params) => rpc.request(method, params), projects: async () => [{ id: 'qa', name: 'QA', path: project, available: true }], models: async () => (await rpc.request('model/list', { limit: 100 })).data });
  try {
    const defaults = await profile.defaults(); const model = defaults.models.find(row => row.isDefault) ?? defaults.models[0]; expect(model).toBeDefined();
    const thinking = model.levels[0] ?? null;
    const saved = await profile.setDefaults({ model: model.id, thinking, version: defaults.version }); expect(saved).toMatchObject({ model: model.id, thinking });
    expect(await readFile(join(user, 'config.toml'), 'utf8')).toContain('model');
    const skill = (await profile.skills('qa', true)).skills.find(row => row.name === 'profile-qa'); expect(skill).toBeDefined();
    expect((await profile.setSkillEnabled(skill!.id, false)).skills.find(row => row.name === 'profile-qa')!.enabled).toBe(false);
    expect((await profile.setSkillEnabled(skill!.id, true)).skills.find(row => row.name === 'profile-qa')!.enabled).toBe(true);
    const file = (await profile.instructions('qa')).find(row => row.scope === 'project')!; const doc = await profile.document(file.id);
    expect((await profile.saveDocument({ id: file.id, content: 'QA instructions\n', version: doc.version })).content).toBe('QA instructions\n');
    const fresh = await profile.defaults(); expect(await profile.setDefaults({ model: null, thinking: null, version: fresh.version })).toMatchObject({ model: null, thinking: null });
  } finally { await rpc.stop(); await rm(root, { recursive: true, force: true }); }
}, 90000);
