import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverPairChoices, promptPairChoice, type PairChoice } from './pair-choose.js';

const roots: string[] = [];
afterEach(async () => {
  const { rmSync } = await import('node:fs');
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('pair choose', () => {
  it('discovers native backends without changing pairing state and uses saved executable choices', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clawket-choose-')); roots.push(root);
    const project = join(root, 'project'); mkdirSync(project);
    const codex = join(root, '.clawket', 'codex', 'device', 'production'); mkdirSync(codex, { recursive: true });
    writeFileSync(join(codex, 'runtime.json'), JSON.stringify({ command: '/custom/codex', token: 'do-not-print' }));
    const piId = createHash('sha256').update(realpathSync(project)).digest('hex').slice(0, 16);
    const pi = join(root, '.clawket', 'pi', piId); mkdirSync(pi, { recursive: true });
    writeFileSync(join(pi, 'runtime.json'), JSON.stringify({ command: '/custom/pi', token: 'do-not-print' }));
    const inspect = { codex: vi.fn(async () => ({})), claude: vi.fn(async () => { throw Error('missing'); }), pi: vi.fn(async () => ({})) };
    const choices = await discoverPairChoices({ home: root, cwd: project,
      openclaw: { available: true, configured: true }, hermes: { available: true, configured: false }, inspect });

    expect(choices.map(({ backend, available, configured }) => ({ backend, available, configured }))).toEqual([
      { backend: 'openclaw', available: true, configured: true },
      { backend: 'hermes', available: true, configured: false },
      { backend: 'codex', available: true, configured: true },
      { backend: 'claude-code', available: false, configured: false },
      { backend: 'pi', available: true, configured: true },
    ]);
    expect(inspect.codex).toHaveBeenCalledWith('/custom/codex');
    expect(inspect.pi).toHaveBeenCalledWith('/custom/pi');
    expect(inspect.claude).toHaveBeenCalledWith('claude');
    expect(choices.find(choice => choice.backend === 'claude-code')?.detail).toBe('Claude Desktop runtime or CLI unavailable or unsupported');
    expect(JSON.stringify(choices)).not.toContain('do-not-print');
  });

  it('accepts a detected Desktop runtime and preserves an explicit saved Claude command', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clawket-choose-')); roots.push(root);
    const inspect = { codex: vi.fn(async () => ({})), claude: vi.fn(async () => ({ executable: '/desktop/claude' })), pi: vi.fn(async () => ({})) };
    const input = { home: root, cwd: root, openclaw: { available: false, configured: false }, hermes: { available: false, configured: false }, inspect };
    const choices = await discoverPairChoices(input);
    expect(choices.find(choice => choice.backend === 'claude-code')).toMatchObject({ available: true, configured: false });
    expect(inspect.claude).toHaveBeenLastCalledWith('claude');
    const directory = join(root, '.clawket', 'claude-code', 'device', 'production'); mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'runtime.json'), JSON.stringify({ command: '/custom/claude', token: 'do-not-print' }));
    const saved = await discoverPairChoices(input);
    expect(inspect.claude).toHaveBeenLastCalledWith('/custom/claude');
    expect(saved.find(choice => choice.backend === 'claude-code')).toMatchObject({ available: true, configured: true });
    expect(JSON.stringify(saved)).not.toContain('do-not-print');
  });

  it('rejects unavailable choices, then returns only the selected backend', async () => {
    const choices: PairChoice[] = [
      { backend: 'openclaw', name: 'OpenClaw', available: false, configured: false, detail: 'Gateway' },
      { backend: 'hermes', name: 'Hermes', available: true, configured: false, detail: 'Agent' },
    ];
    const answers = ['1', '2']; const output: string[] = [];
    const chosen = await promptPairChoice(choices, { ask: async () => answers.shift()!, write: line => output.push(line) });
    expect(chosen).toEqual({ backend: 'hermes' });
    expect(output.join('\n')).toContain('OpenClaw is not ready');
    expect(output.join('\n')).toContain('does not mean this phone is paired');
  });

  it('requires a real Pi project folder and supports a quiet cancellation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clawket-choose-')); roots.push(root);
    const choices: PairChoice[] = [{ backend: 'pi', name: 'Pi', available: true, configured: false, detail: 'Choose a project' }];
    const answers = ['1', 'missing', '1', '.']; const output: string[] = [];
    const chosen = await promptPairChoice(choices, { ask: async () => answers.shift()!, write: line => output.push(line) }, root);
    expect(chosen).toEqual({ backend: 'pi', project: realpathSync(root) });
    expect(output.join('\n')).toContain('does not exist');
    expect(await promptPairChoice(choices, { ask: async () => 'q', write: () => {} }, root)).toBeNull();
  });
});
