import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HermesLocalBridge } from './index.js';
import { cleanupTempDirectories, createTempDirectory } from './test-helpers.js';

afterEach(cleanupTempDirectories);

describe('Hermes management files', () => {
  it('preserves exact skill source bytes through read and write dispatch', async () => {
    const directory = await createTempDirectory();
    const bridge = new HermesLocalBridge({ hermesHomePath: directory, hermesSourcePath: directory,
      sessionStorePath: join(directory, 'sessions.json') });
    const content = '---\nname: weather\n---\n\n  Indented content.  \n\n';
    const run = vi.spyOn(bridge, 'runHermesPython').mockResolvedValue({ success: true, content });
    await expect(bridge.dispatchRequest('skills.get', { skillKey: 'weather' })).resolves.toMatchObject({ content });
    run.mockResolvedValue({ success: true });
    await bridge.dispatchRequest('skills.content.update', { skillKey: 'weather', content });
    expect(run.mock.calls[1][1]).toEqual({ skillKey: 'weather', content });
  });

  it('reads and writes only supported Hermes memory files', async () => {
    const directory = await createTempDirectory();
    const home = join(directory, 'home');
    await mkdir(join(home, 'memories'), { recursive: true });
    await writeFile(join(home, 'memories', 'MEMORY.md'), 'fact');
    const bridge = new HermesLocalBridge({
      hermesHomePath: home,
      hermesSourcePath: join(directory, 'missing'),
      sessionStorePath: join(directory, 'sessions.json'),
    });
    await expect(bridge.dispatchRequest('agents.files.get', {
      agentId: 'main',
      name: 'MEMORY.md',
    })).resolves.toMatchObject({ file: { content: 'fact' } });
    await bridge.dispatchRequest('agents.files.set', {
      agentId: 'main',
      name: 'USER.md',
      content: 'Lucy',
    });
    await expect(readFile(join(home, 'memories', 'USER.md'), 'utf8')).resolves.toBe('Lucy');
    await expect(bridge.dispatchRequest('agents.files.get', {
      agentId: 'main',
      name: 'OTHER.md',
    })).rejects.toThrow(/Unsupported/);
  });
});


describe('Hermes native skill installation', () => {
  async function fixture(native = true) {
    const directory = await createTempDirectory();
    const source = join(directory, 'source');
    if (native) {
      await mkdir(join(source, 'tools'), { recursive: true });
      await writeFile(join(source, 'tools', 'skills_hub_install.py'), 'def _check_install_target(path): pass\n');
      await writeFile(join(source, 'tools', 'skills_hub_clawhub.py'), '');
    }
    return new HermesLocalBridge({ hermesHomePath: join(directory, 'home'), hermesSourcePath: source, sessionStorePath: join(directory, 'sessions.json') });
  }
  it('does not advertise native installation for old or missing Hermes sources', async () => {
    const bridge = await fixture(false);
    expect(bridge.getBridgeCapabilities()).not.toContain('hermes.skills-install.v1');
    await expect(bridge.dispatchRequest('skills.install', { source: 'clawhub', owner: 'owner', slug: 'weather' })).rejects.toThrow('unavailable');
    const legacy = await fixture();
    await writeFile(join(legacy.hermesSourcePath, 'tools', 'skills_hub_install.py'), 'def install_from_quarantine(): pass\n');
    expect(legacy.getBridgeCapabilities()).not.toContain('hermes.skills-install.v1');
  });
  it('rejects injection and unknown sources before invoking Python', async () => {
    const bridge = await fixture();
    const run = vi.spyOn(bridge, 'runHermesPython');
    for (const input of [
      { source: 'url', owner: 'owner', slug: 'weather' },
      { source: 'clawhub', owner: '../owner', slug: 'weather' },
      { source: 'clawhub', owner: 'owner', slug: 'weather; echo secret' },
    ]) await expect(bridge.dispatchRequest('skills.install', input)).rejects.toThrow('Invalid skill source');
    expect(run).not.toHaveBeenCalled();
  });
  it('does not report success when the native scanner or installer refused the request', async () => {
    const bridge = await fixture();
    const run = vi.spyOn(bridge, 'runHermesPython').mockResolvedValue({ ok: false });
    await expect(bridge.dispatchRequest('skills.install', { source: 'clawhub', owner: 'owner', slug: 'weather' })).rejects.toThrow('did not install');
    const [script, payload] = run.mock.calls[0];
    expect(script).toContain('source_id="clawhub"');
    expect(script).toContain('force=False');
    expect(script).toContain('ClawHubSource().inspect(identifier)');
    expect(payload).toEqual({ owner: 'owner', slug: 'weather' });
  });
  it('requires the installed list to confirm success', async () => {
    const bridge = await fixture();
    vi.spyOn(bridge, 'runHermesPython').mockResolvedValue({ ok: true });
    vi.spyOn(bridge, 'getHermesSkillsStatus').mockResolvedValue({ skills: [], workspaceDir: '', managedSkillsDir: '' });
    await expect(bridge.dispatchRequest('skills.install', { source: 'clawhub', owner: 'owner', slug: 'weather' })).rejects.toThrow('could not be verified');
  });

  it('rejects a concurrent install and releases its guard after failure', async () => {
    const bridge = await fixture();
    let settle!: (value: { ok: boolean }) => void;
    const run = vi.spyOn(bridge, 'runHermesPython').mockImplementation(() => new Promise((resolve) => { settle = resolve; }));
    const payload = { source: 'clawhub', owner: 'owner', slug: 'weather' };
    const first = bridge.installHermesSkill(payload);
    await expect(bridge.installHermesSkill(payload)).rejects.toThrow('already in progress');
    expect(run).toHaveBeenCalledTimes(1);
    settle({ ok: false });
    await expect(first).rejects.toThrow('did not install');
    expect(bridge.skillInstallBusy).toBe(false);
  });

  it.each(['manual', 'registered', 'fresh', 'unknown-owner', 'different-owner'] as const)('executes the installer safety boundary for a %s target', async (mode) => {
    const bridge = await fixture();
    const target = join(bridge.hermesHomePath, 'skills', 'weather');
    if (mode === 'manual' || mode === 'registered') {
      await mkdir(target, { recursive: true });
      await writeFile(join(target, 'SKILL.md'), 'Keep this original');
    }
    // Execute the production Python script against native-shaped modules. The
    // fixture installer deliberately overwrites manual directories unless guarded.
    const bootstrap = `
import sys, types, pathlib, shutil
target = pathlib.Path(${JSON.stringify(target)})
record = {'source':'clawhub','identifier':'weather','install_path':'weather'} if ${mode === 'registered' ? 'True' : 'False'} else None
for name in ['httpx','rich','rich.console','hermes_cli','hermes_cli.skills_hub','tools','tools.skills_hub','tools.skills_hub_clawhub','tools.skills_hub_install']:
  sys.modules[name] = types.ModuleType(name)
sys.modules['httpx'].get = lambda url, **kwargs: kwargs
installer = sys.modules['tools.skills_hub_install']
installer._check_install_target = lambda path: None
sys.modules['rich.console'].Console = lambda **kwargs: None
class HubLockFile:
  def get_installed(self, name): return record
class ClawHubSource:
  def inspect(self, identifier):
    get = sys.modules['httpx'].get
    assert get('https://clawhub.ai/api/v1/skills/weather')['params']['ownerHandle'] == 'owner'
    assert get('https://clawhub.ai/api/v1/skills/weather/versions/1')['params']['ownerHandle'] == 'owner'
    assert get('https://clawhub.ai/api/v1/download', params={'slug':'weather'})['params']['ownerHandle'] == 'owner'
    assert 'params' not in get('https://example.com/')
    assert 'params' not in get('https://clawhub.ai/api/v1/skills/weather-other')
    return types.SimpleNamespace(extra={'owner':${JSON.stringify(mode === 'unknown-owner' ? '' : mode === 'different-owner' ? 'someone-else' : 'owner')}})
def do_install(identifier, **kwargs):
  global record
  if record: return
  try: installer._check_install_target(target)
  except ValueError: return
  if target.exists(): shutil.rmtree(target)
  target.mkdir(parents=True)
  (target / 'SKILL.md').write_text('Installed content')
  record = {'source':'clawhub','identifier':'weather','install_path':'weather'}
sys.modules['tools.skills_hub'].HubLockFile = HubLockFile
sys.modules['tools.skills_hub_clawhub'].ClawHubSource = ClawHubSource
sys.modules['hermes_cli.skills_hub'].do_install = do_install
`;
    vi.spyOn(bridge, 'runHermesPython').mockImplementation(async (script, payload) => JSON.parse(execFileSync(
      process.platform === 'win32' ? 'python' : 'python3', ['-c', bootstrap + '\n' + script],
      { input: JSON.stringify(payload), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    )));
    const report = vi.spyOn(bridge, 'getHermesSkillsStatus').mockResolvedValue({
      skills: [{ name: 'Weather display name', baseDir: target } as any], workspaceDir: '', managedSkillsDir: join(bridge.hermesHomePath, 'skills'),
    });
    const installing = bridge.dispatchRequest('skills.install', { source: 'clawhub', owner: 'owner', slug: 'weather' });
    if (mode === 'fresh') {
      await expect(installing).resolves.toMatchObject({ name: 'Weather display name' });
      expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe('Installed content');
    } else {
      await expect(installing).rejects.toThrow();
      if (mode === 'manual' || mode === 'registered') {
        expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe('Keep this original');
      } else {
        await expect(readFile(join(target, 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
      }
      expect(report).not.toHaveBeenCalled();
    }
    expect(bridge.skillInstallBusy).toBe(false);
  });
});
