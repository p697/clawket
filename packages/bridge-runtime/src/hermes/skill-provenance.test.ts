import { execFileSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { HermesLocalBridge } from './index.js';
import { cleanupTempDirectories, createTempDirectory } from './test-helpers.js';

afterEach(cleanupTempDirectories);

it.each(['hub', 'manual', 'refused', 'corrupt', 'escape', 'ambiguous'] as const)(
  'preserves native uninstall and registry boundaries for a %s skill', async (mode) => {
    const home = await createTempDirectory();
    const skills = join(home, 'skills');
    const target = join(skills, 'weather');
    await mkdir(target, { recursive: true });
    await mkdir(join(skills, '.hub'));
    await writeFile(join(target, 'SKILL.md'), 'Keep until successful uninstall');
    const registry = join(skills, '.hub', 'lock.json');
    const record = { source: 'clawhub', install_path: mode === 'escape' ? '../outside' : 'weather' };
    const installed = mode === 'manual' ? {} : { 'registry-name': record,
      ...(mode === 'ambiguous' ? { duplicate: record } : {}) };
    const initial = mode === 'corrupt' ? '{' : JSON.stringify({ version: 1, installed });
    await writeFile(registry, initial);
    const bridge = new HermesLocalBridge({ hermesHomePath: home, hermesSourcePath: home, sessionStorePath: join(home, 'sessions.json') });
    const bootstrap = `
import sys, types, pathlib, shutil, json
root = pathlib.Path(${JSON.stringify(skills)})
target = root / 'weather'
registry = root / '.hub' / 'lock.json'
for name in ['hermes_cli', 'hermes_cli.config', 'tools', 'tools.skill_manager_tool', 'tools.skills_tool', 'tools.skills_hub_install', 'tools.skill_usage']:
  sys.modules[name] = types.ModuleType(name)
sys.modules['hermes_cli.config'].load_config = lambda: {}
sys.modules['hermes_cli.config'].save_config = lambda value: None
sys.modules['tools.skills_tool'].SKILLS_DIR = root
sys.modules['tools.skill_manager_tool']._find_skill = lambda name: {'path': target}
def skill_manage(**kwargs):
  assert ${mode === 'manual' ? 'True' : 'False'}, 'Hub removal bypassed native uninstaller'
  shutil.rmtree(target)
  return json.dumps({'success': True})
def uninstall_skill(name):
  assert name == 'registry-name', 'Display name must not replace native registry key'
  if ${mode === 'refused' ? 'True' : 'False'}: return False, 'Native refusal'
  data = json.loads(registry.read_text())
  del data['installed'][name]
  shutil.rmtree(target)
  registry.write_text(json.dumps(data))
  return True, 'Removed'
sys.modules['tools.skill_manager_tool'].skill_manage = skill_manage
sys.modules['tools.skills_hub_install'].uninstall_skill = uninstall_skill
sys.modules['tools.skill_usage'].forget = lambda name: None
`;
    vi.spyOn(bridge, 'runHermesPython').mockImplementation(async (script, payload) => JSON.parse(execFileSync(
      process.platform === 'win32' ? 'python' : 'python3', ['-c', bootstrap + '\n' + script],
      { input: JSON.stringify(payload), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    )));
    const removing = bridge.dispatchRequest('skills.delete', { agentId: 'main', skillKey: 'weather' });
    if (mode === 'hub' || mode === 'manual') {
      await expect(removing).resolves.toEqual({ ok: true, skillKey: 'weather' });
      await expect(stat(target)).rejects.toThrow();
      expect(JSON.parse(await readFile(registry, 'utf8')).installed).toEqual({});
    } else {
      await expect(removing).rejects.toThrow();
      expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe('Keep until successful uninstall');
      expect(await readFile(registry, 'utf8')).toBe(initial);
    }
  },
);

it('rejects an unknown native deletion result', async () => {
  const home = await createTempDirectory();
  const bridge = new HermesLocalBridge({ hermesHomePath: home, hermesSourcePath: home, sessionStorePath: join(home, 'sessions.json') });
  vi.spyOn(bridge, 'runHermesPython').mockResolvedValue({});
  await expect(bridge.dispatchRequest('skills.delete', { skillKey: 'weather' })).rejects.toThrow('Failed to delete');
});
