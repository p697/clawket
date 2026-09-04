import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HermesLocalBridge as ProductionHermesLocalBridge,
  type HermesLocalBridgeOptions,
} from './index.js';
import { DEFAULT_HERMES_HOME_PATH, DEFAULT_HERMES_SOURCE_PATH } from './internal.js';
import { resolveHermesPythonPath } from './python-runner.js';

const HERMES_INTEGRATION_PYTHON_PATH = resolveHermesPythonPath({
  hermesSourcePath: DEFAULT_HERMES_SOURCE_PATH,
  hermesHomePath: DEFAULT_HERMES_HOME_PATH,
});

class HermesLocalBridge extends ProductionHermesLocalBridge {
  constructor(options: HermesLocalBridgeOptions = {}) {
    super({ ...options, hermesPythonPath: options.hermesPythonPath ?? HERMES_INTEGRATION_PYTHON_PATH });
  }
}

const tempDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

async function createSessionStorePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'clawket-hermes-'));
  tempDirs.push(dir);
  return join(dir, 'sessions.json');
}

async function createUsageLedgerPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'clawket-hermes-usage-'));
  tempDirs.push(dir);
  return join(dir, 'usage-ledger.json');
}

async function createHermesStateDbPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'clawket-hermes-state-'));
  tempDirs.push(dir);
  return join(dir, 'state.db');
}

async function createHermesHomePath(config?: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'clawket-hermes-home-'));
  tempDirs.push(dir);
  if (config) {
    const configJson = JSON.stringify(config);
    execFileSync('python3', [
      '-c',
      [
        'import json, pathlib, sys',
        'home = pathlib.Path(sys.argv[1])',
        'cfg = json.loads(sys.argv[2])',
        'home.mkdir(parents=True, exist_ok=True)',
        'lines = []',
        'def write_mapping(mapping, indent=0):',
        '    for key, value in mapping.items():',
        '        prefix = " " * indent + f"{key}:"',
        '        if isinstance(value, dict):',
        '            lines.append(prefix)',
        '            write_mapping(value, indent + 2)',
        '        elif isinstance(value, list):',
        '            lines.append(prefix)',
        '            for item in value:',
        '                if isinstance(item, dict):',
        '                    lines.append(" " * (indent + 2) + "-")',
        '                    write_mapping(item, indent + 4)',
        '                else:',
        '                    lines.append(" " * (indent + 2) + f"- {json.dumps(item)}")',
        '        else:',
        '            lines.append(prefix + f" {json.dumps(value)}")',
        'write_mapping(cfg)',
        '(home / "config.yaml").write_text("\\n".join(lines) + "\\n", encoding="utf-8")',
      ].join('\n'),
      dir,
      configJson,
    ]);
  }
  return dir;
}


describe('Hermes management integration', () => {
  it('starts in degraded mode when Hermes API is still booting', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    }));

    const logs: string[] = [];
    const bridge = new HermesLocalBridge({
      apiBaseUrl: 'http://127.0.0.1:8642',
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
      onLog: (line) => logs.push(line),
    });

    await bridge.start();

    expect(bridge.getSnapshot()).toMatchObject({
      running: true,
      hermesApiReachable: false,
    });
    expect(bridge.getSnapshot().lastError).toContain('Hermes API is not reachable');
    expect(logs.some((line) => line.includes('degraded'))).toBe(true);

    await bridge.stop();
  });

  it('does not expose a tokenized websocket URL from the unauthenticated health endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    })));

    const bridge = new HermesLocalBridge({
      host: '127.0.0.1',
      port: 4321,
      bridgeToken: 'super-secret-token',
      startHermesIfNeeded: false,
      sessionStorePath: await createSessionStorePath(),
    });

    const headers = new Map<string, string>();
    const end = vi.fn();

    await (bridge as any).handleHttpRequest(
      {
        method: 'GET',
        url: '/health',
      },
      {
        statusCode: 0,
        setHeader: vi.fn((key: string, value: string) => {
          headers.set(key, value);
        }),
        end,
      },
    );

    expect(headers.get('content-type')).toBe('application/json; charset=utf-8');
    const payload = JSON.parse(String(end.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(payload.wsUrl).toBeUndefined();
    expect(payload.wsPath).toBe('/v1/hermes/ws');
    expect(String(payload.bridgeUrl)).not.toContain('super-secret-token');
  });

  it('rejects unsupported Hermes agent files', async () => {
    const hermesHomePath = await createHermesHomePath();
    const bridge = new HermesLocalBridge({
      hermesHomePath,
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    await expect((bridge as any).dispatchRequest('agents.files.get', {
      agentId: 'main',
      name: 'SOUL.md',
    })).rejects.toThrow('Unsupported Hermes agent file');
  });

  it('lists Hermes skills and reflects disabled state without modifying Hermes source', async () => {
    const hermesHomePath = await createHermesHomePath({
      skills: {
        disabled: ['disabled-skill'],
      },
    });
    await mkdir(join(hermesHomePath, 'skills', 'active-skill'), { recursive: true });
    await mkdir(join(hermesHomePath, 'skills', 'disabled-skill'), { recursive: true });
    await writeFile(
      join(hermesHomePath, 'skills', 'active-skill', 'SKILL.md'),
      [
        '---',
        'name: active-skill',
        'description: Active skill description',
        '---',
        '',
        '# Active skill',
        '',
        'Use this skill when needed.',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(hermesHomePath, 'skills', 'disabled-skill', 'SKILL.md'),
      [
        '---',
        'name: disabled-skill',
        'description: Disabled skill description',
        'prerequisites:',
        '  env_vars: [DISABLED_SKILL_TOKEN]',
        '---',
        '',
        '# Disabled skill',
      ].join('\n'),
      'utf8',
    );

    const bridge = new HermesLocalBridge({
      hermesHomePath,
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    await expect((bridge as any).dispatchRequest('skills.status', { agentId: 'main' })).resolves.toEqual({
      workspaceDir: hermesHomePath,
      managedSkillsDir: join(hermesHomePath, 'skills'),
      skills: expect.arrayContaining([
        expect.objectContaining({
          skillKey: 'active-skill',
          disabled: false,
          eligible: true,
          deletable: true,
          createdAtMs: expect.any(Number),
          updatedAtMs: expect.any(Number),
        }),
        expect.objectContaining({
          skillKey: 'disabled-skill',
          disabled: true,
          eligible: false,
          deletable: true,
          createdAtMs: expect.any(Number),
          updatedAtMs: expect.any(Number),
          requirements: expect.objectContaining({
            env: ['DISABLED_SKILL_TOKEN'],
          }),
          missing: expect.objectContaining({
            env: ['DISABLED_SKILL_TOKEN'],
          }),
        }),
      ]),
    });
  });

  it('updates Hermes skill enabled state through config-backed disabled skills', async () => {
    const hermesHomePath = await createHermesHomePath({
      skills: {
        disabled: ['toggle-skill'],
      },
    });
    await mkdir(join(hermesHomePath, 'skills', 'toggle-skill'), { recursive: true });
    await writeFile(
      join(hermesHomePath, 'skills', 'toggle-skill', 'SKILL.md'),
      [
        '---',
        'name: toggle-skill',
        'description: Toggle me',
        '---',
        '',
        '# Toggle skill',
      ].join('\n'),
      'utf8',
    );

    const bridge = new HermesLocalBridge({
      hermesHomePath,
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    await expect((bridge as any).dispatchRequest('skills.update', {
      agentId: 'main',
      skillKey: 'toggle-skill',
      enabled: true,
    })).resolves.toEqual({
      ok: true,
      skillKey: 'toggle-skill',
      config: {
        enabled: true,
      },
    });

    const configText = await readFile(join(hermesHomePath, 'config.yaml'), 'utf8');
    expect(configText).not.toContain('toggle-skill');

    await expect((bridge as any).dispatchRequest('skills.update', {
      agentId: 'main',
      skillKey: 'toggle-skill',
      enabled: false,
    })).resolves.toEqual({
      ok: true,
      skillKey: 'toggle-skill',
      config: {
        enabled: false,
      },
    });

    const nextConfigText = await readFile(join(hermesHomePath, 'config.yaml'), 'utf8');
    expect(nextConfigText).toContain('toggle-skill');
  });

  it('reads and updates Hermes skill content through bridge-owned methods', async () => {
    const hermesHomePath = await createHermesHomePath();
    await mkdir(join(hermesHomePath, 'skills', 'editor-skill', 'references'), { recursive: true });
    await writeFile(
      join(hermesHomePath, 'skills', 'editor-skill', 'SKILL.md'),
      [
        '---',
        'name: editor-skill',
        'description: Editable skill',
        '---',
        '',
        '# Editor skill',
        '',
        'Initial instructions.',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(hermesHomePath, 'skills', 'editor-skill', 'references', 'guide.md'),
      'Reference guide',
      'utf8',
    );

    const bridge = new HermesLocalBridge({
      hermesHomePath,
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    await expect((bridge as any).dispatchRequest('skills.get', {
      agentId: 'main',
      skillKey: 'editor-skill',
    })).resolves.toMatchObject({
      skillKey: 'editor-skill',
      editable: true,
      content: expect.stringContaining('Initial instructions.'),
      linkedFiles: {
        references: ['references/guide.md'],
      },
    });

    await expect((bridge as any).dispatchRequest('skills.get', {
      agentId: 'main',
      skillKey: 'editor-skill',
      filePath: 'references/guide.md',
    })).resolves.toMatchObject({
      skillKey: 'editor-skill',
      editable: false,
      filePath: 'references/guide.md',
      content: 'Reference guide',
    });

    const nextContent = [
      '---',
      'name: editor-skill',
      'description: Editable skill',
      '---',
      '',
      '# Editor skill',
      '',
      'Updated instructions.',
    ].join('\n');
    await expect((bridge as any).dispatchRequest('skills.content.update', {
      agentId: 'main',
      skillKey: 'editor-skill',
      content: nextContent,
    })).resolves.toEqual({
      ok: true,
      skillKey: 'editor-skill',
      path: join(hermesHomePath, 'skills', 'editor-skill'),
    });

    await expect(readFile(join(hermesHomePath, 'skills', 'editor-skill', 'SKILL.md'), 'utf8')).resolves.toContain('Updated instructions.');
  });

  it('deletes managed Hermes skills through bridge-owned methods', async () => {
    const hermesHomePath = await createHermesHomePath({
      skills: {
        disabled: ['delete-me'],
      },
    });
    await mkdir(join(hermesHomePath, 'skills', 'delete-me'), { recursive: true });
    await writeFile(
      join(hermesHomePath, 'skills', 'delete-me', 'SKILL.md'),
      [
        '---',
        'name: delete-me',
        'description: Delete me',
        '---',
        '',
        '# Delete me',
      ].join('\n'),
      'utf8',
    );

    const bridge = new HermesLocalBridge({
      hermesHomePath,
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    await expect((bridge as any).dispatchRequest('skills.delete', {
      agentId: 'main',
      skillKey: 'delete-me',
    })).resolves.toEqual({
      ok: true,
      skillKey: 'delete-me',
    });

    await expect(readFile(join(hermesHomePath, 'config.yaml'), 'utf8')).resolves.not.toContain('delete-me');
    await expect(stat(join(hermesHomePath, 'skills'))).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });
    await expect(readFile(join(hermesHomePath, 'skills', 'delete-me', 'SKILL.md'), 'utf8')).rejects.toThrow();
  });

});
