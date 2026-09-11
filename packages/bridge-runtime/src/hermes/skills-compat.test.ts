import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { HermesLocalBridge } from './index.js';
import { cleanupTempDirectories, createTempDirectory } from './test-helpers.js';

afterEach(cleanupTempDirectories);
for (const version of ['legacy', 'split'] as const) {
  it(`lists skill requirements with ${version} Hermes modules`, async () => {
    const root = await createTempDirectory();
    const source = join(root, 'source');
    const home = join(root, 'home');
    for (const folder of ['agent', 'tools']) {
      await mkdir(join(source, folder), { recursive: true });
      await writeFile(join(source, folder, '__init__.py'), '');
    }
    await mkdir(join(home, 'skills', 'sample'), { recursive: true });
    await writeFile(join(home, 'skills', 'sample', 'SKILL.md'), 'sample');
    const parser = 'def parse_frontmatter(content): return ({"name":"sample", "prerequisites":{"env_vars":"SAMPLE_KEY", "commands":"missing-command-for-test"}}, "Sample skill")\n';
    await writeFile(join(source, 'agent', 'skill_utils.py'), [
      'def get_external_skills_dirs(): return []',
      version === 'split' ? parser + 'def skill_matches_platform(fm): return True' : '',
    ].join('\n'));
    await writeFile(join(source, 'tools', 'skills_tool.py'), [
      'import os', 'from pathlib import Path', 'SKILLS_DIR = Path(os.environ["HERMES_HOME"]) / "skills"',
      'def load_env(): return {}',
      version === 'legacy' ? parser.replace('parse_frontmatter', '_parse_frontmatter') + '\ndef skill_matches_platform(fm): return True\ndef _collect_prerequisite_values(fm): return ["SAMPLE_KEY"], ["missing-command-for-test"]' : '',
      version === 'legacy' ? 'def _get_required_environment_variables(fm, legacy): return [{"name": v} for v in legacy]' : 'def _get_required_environment_variables(fm): return [{"name": fm["prerequisites"]["env_vars"]}]',
    ].join('\n'));
    const bridge = new HermesLocalBridge({ hermesSourcePath: source, hermesHomePath: home, hermesPythonPath: (process.platform === 'win32' ? 'python' : 'python3'), sessionStorePath: join(root, 'sessions.json') });
    const report = await bridge.dispatchRequest('skills.status', { agentId: 'main' });
    expect(report).toMatchObject({ skills: [{ name: 'sample', eligible: false, missing: { env: ['SAMPLE_KEY'], bins: ['missing-command-for-test'] } }] });
  });
}
