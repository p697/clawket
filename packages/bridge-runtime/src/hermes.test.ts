import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HermesLocalBridge } from './hermes.js';

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

describe('HermesLocalBridge history metadata', () => {
  it('exposes Hermes built-in memory files through the bridge', async () => {
    const hermesHomePath = await createHermesHomePath();
    await mkdir(join(hermesHomePath, 'memories'), { recursive: true });
    await writeFile(join(hermesHomePath, 'memories', 'MEMORY.md'), 'Project fact', 'utf8');

    const bridge = new HermesLocalBridge({
      hermesHomePath,
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    await expect((bridge as any).dispatchRequest('agents.files.list', { agentId: 'main' })).resolves.toEqual({
      files: [
        expect.objectContaining({
          name: 'MEMORY.md',
          missing: false,
        }),
        expect.objectContaining({
          name: 'USER.md',
          missing: true,
        }),
      ],
    });

    await expect((bridge as any).dispatchRequest('agents.files.get', {
      agentId: 'main',
      name: 'MEMORY.md',
    })).resolves.toEqual({
      file: expect.objectContaining({
        name: 'MEMORY.md',
        missing: false,
        content: 'Project fact',
      }),
    });
  });

  it('writes Hermes built-in memory files through the bridge', async () => {
    const hermesHomePath = await createHermesHomePath();
    const bridge = new HermesLocalBridge({
      hermesHomePath,
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    await expect((bridge as any).dispatchRequest('agents.files.set', {
      agentId: 'main',
      name: 'USER.md',
      content: 'Name: Lucy',
    })).resolves.toEqual({ ok: true });

    await expect(readFile(join(hermesHomePath, 'memories', 'USER.md'), 'utf8')).resolves.toBe('Name: Lucy');
    await expect(stat(join(hermesHomePath, 'memories', 'USER.md'))).resolves.toMatchObject({
      isFile: expect.any(Function),
    });
  });

  it('loads Hermes model state from config-backed providers', async () => {
    const hermesHomePath = await createHermesHomePath({
      model: {
        default: 'moonshot-v1-8k',
        provider: 'moonshot-local',
      },
      custom_providers: [
        {
          name: 'Moonshot Local',
          base_url: 'http://127.0.0.1:65534/v1',
          model: 'moonshot-v1-8k',
        },
      ],
    });

    const bridge = new HermesLocalBridge({
      hermesHomePath,
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    await expect((bridge as any).dispatchRequest('model.get', {})).resolves.toMatchObject({
      currentModel: 'moonshot-v1-8k',
      currentProvider: 'custom:moonshot-local',
    });

    await expect((bridge as any).dispatchRequest('model.current', {})).resolves.toMatchObject({
      currentModel: 'moonshot-v1-8k',
      currentProvider: 'moonshot-local',
      currentBaseUrl: '',
    });

    await expect((bridge as any).dispatchRequest('models.list', {})).resolves.toEqual({
      models: [
        {
          id: 'moonshot-v1-8k',
          name: 'moonshot-v1-8k',
          provider: 'custom:moonshot-local',
        },
      ],
    });
  }, 20_000);

  it('reads and writes Hermes reasoning state through bridge methods', async () => {
    const hermesHomePath = await createHermesHomePath({
      agent: {
        reasoning_effort: 'low',
      },
      display: {
        show_reasoning: true,
      },
    });

    const bridge = new HermesLocalBridge({
      hermesHomePath,
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    await expect((bridge as any).dispatchRequest('hermes.reasoning.get', {})).resolves.toEqual({
      level: 'low',
      rawLevel: 'low',
      showReasoning: true,
    });

    await expect((bridge as any).dispatchRequest('hermes.reasoning.set', {
      level: 'off',
    })).resolves.toEqual({
      level: 'off',
      rawLevel: 'none',
      showReasoning: true,
    });

    await expect((bridge as any).dispatchRequest('hermes.reasoning.set', {
      showReasoning: false,
    })).resolves.toEqual({
      level: 'off',
      rawLevel: 'none',
      showReasoning: false,
    });
  });

  it('reads and writes Hermes fast mode through bridge methods', async () => {
    const hermesHomePath = await createHermesHomePath({
      agent: {
        service_tier: 'normal',
      },
      model: {
        default: 'gpt-4.1',
        provider: 'openai',
      },
    });

    const bridge = new HermesLocalBridge({
      hermesHomePath,
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    await expect((bridge as any).dispatchRequest('hermes.fast.get', {})).resolves.toEqual({
      enabled: false,
      supported: true,
    });

    await expect((bridge as any).dispatchRequest('hermes.fast.set', {
      enabled: true,
    })).resolves.toEqual({
      enabled: true,
      supported: true,
    });
  });

  it('reuses cached Hermes model state across adjacent dashboard requests', async () => {
    const hermesHomePath = await createHermesHomePath({
      model: {
        default: 'moonshot-v1-8k',
        provider: 'moonshot-local',
      },
      custom_providers: [
        {
          name: 'Moonshot Local',
          base_url: 'http://127.0.0.1:65534/v1',
          model: 'moonshot-v1-8k',
        },
      ],
    });

    const bridge = new HermesLocalBridge({
      hermesHomePath,
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });
    const readStateSpy = vi.spyOn(bridge as any, 'runHermesPython');

    await expect((bridge as any).dispatchRequest('model.get', {})).resolves.toMatchObject({
      currentModel: 'moonshot-v1-8k',
      currentProvider: 'custom:moonshot-local',
    });
    await expect((bridge as any).dispatchRequest('models.list', {})).resolves.toEqual({
      models: [
        {
          id: 'moonshot-v1-8k',
          name: 'moonshot-v1-8k',
          provider: 'custom:moonshot-local',
        },
      ],
    });

    expect(readStateSpy).toHaveBeenCalledTimes(1);
  });

  it('prewarms Hermes model state during bridge startup', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, hermesApiReachable: true }) })));

    const hermesHomePath = await createHermesHomePath({
      model: {
        default: 'moonshot-v1-8k',
        provider: 'moonshot-local',
      },
      custom_providers: [
        {
          name: 'Moonshot Local',
          base_url: 'http://127.0.0.1:65534/v1',
          model: 'moonshot-v1-8k',
        },
      ],
    });

    const bridge = new HermesLocalBridge({
      hermesHomePath,
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });
    const readStateSpy = vi.spyOn(bridge as any, 'runHermesPython');

    await bridge.start();
    await expect((bridge as any).dispatchRequest('model.get', {})).resolves.toMatchObject({
      currentModel: 'moonshot-v1-8k',
      currentProvider: 'custom:moonshot-local',
    });

    expect(readStateSpy).toHaveBeenCalledTimes(2);
    await bridge.stop();
  });

  it('includes credential-pool providers that Hermes upstream provider listing omits', async () => {
    const hermesHomePath = await createHermesHomePath({
      model: {
        default: 'gpt-5.3-codex',
        provider: 'openai-codex',
      },
    });

    await writeFile(join(hermesHomePath, 'auth.json'), JSON.stringify({
      version: 1,
      providers: {
        'openai-codex': {
          tokens: {
            access_token: 'token',
          },
        },
      },
      credential_pool: {
        openrouter: [
          {
            id: 'cred_1',
            access_token: 'or-token',
            base_url: 'https://openrouter.ai/api/v1',
          },
        ],
      },
      updated_at: '2026-04-11T00:00:00Z',
      active_provider: 'openai-codex',
    }), 'utf8');

    const bridge = new HermesLocalBridge({
      hermesHomePath,
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    const state = await (bridge as any).dispatchRequest('model.get', {});
    expect(state).toMatchObject({
      currentModel: 'gpt-5.3-codex',
      currentProvider: 'openai-codex',
    });
    expect(state.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        slug: 'openrouter',
        source: 'credential-pool',
      }),
      expect.objectContaining({
        slug: 'openai-codex',
      }),
    ]));
    const codexProvider = state.providers.find((provider: { slug?: string; models?: string[] }) => provider.slug === 'openai-codex');
    expect(codexProvider?.models).toEqual(expect.arrayContaining(['gpt-5.4']));
    expect(state.models).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: 'openrouter',
      }),
      expect.objectContaining({
        provider: 'openai-codex',
        id: 'gpt-5.4',
      }),
    ]));
  });

  it('persists Hermes global model switches without modifying Hermes source', async () => {
    const hermesHomePath = await createHermesHomePath({
      model: {
        default: 'moonshot-v1-8k',
        provider: 'moonshot-local',
      },
      custom_providers: [
        {
          name: 'Moonshot Local',
          base_url: 'http://127.0.0.1:65534/v1',
          model: 'moonshot-v1-8k',
        },
        {
          name: 'OpenRouter Local',
          base_url: 'http://127.0.0.1:65535/v1',
          model: 'openai/gpt-4.1-mini',
        },
      ],
    });

    const bridge = new HermesLocalBridge({
      hermesHomePath,
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    await expect((bridge as any).dispatchRequest('model.set', {
      model: 'openai/gpt-4.1-mini',
      provider: 'openrouter-local',
      scope: 'global',
    })).resolves.toMatchObject({
      ok: true,
      scope: 'global',
      currentModel: 'openai/gpt-4.1-mini',
      currentProvider: 'custom:openrouter-local',
    });

    const nextState = await (bridge as any).dispatchRequest('model.get', {});
    expect(nextState).toMatchObject({
      currentModel: 'openai/gpt-4.1-mini',
      currentProvider: 'custom:openrouter-local',
    });
  }, 15_000);

  it('intercepts /model chat commands and returns a synthetic final message', async () => {
    const hermesHomePath = await createHermesHomePath({
      model: {
        default: 'moonshot-v1-8k',
        provider: 'moonshot-local',
      },
      custom_providers: [
        {
          name: 'Moonshot Local',
          base_url: 'http://127.0.0.1:65534/v1',
          model: 'moonshot-v1-8k',
        },
        {
          name: 'OpenRouter Local',
          base_url: 'http://127.0.0.1:65535/v1',
          model: 'openai/gpt-4.1-mini',
        },
      ],
    });

    const bridge = new HermesLocalBridge({
      hermesHomePath,
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });
    const broadcastSpy = vi.spyOn(bridge as any, 'broadcastEvent');

    const result = await (bridge as any).handleChatSend({
      sessionKey: 'main',
      message: '/model openai/gpt-4.1-mini --provider openrouter-local',
      idempotencyKey: 'run_model_switch',
    });

    expect(result).toEqual({ runId: 'run_model_switch' });
    const finalEvent = broadcastSpy.mock.calls
      .filter(([eventName]) => eventName === 'chat')
      .map(([, payload]) => payload)
      .find((payload) => (payload as any).state === 'final');
    expect(finalEvent).toMatchObject({
      runId: 'run_model_switch',
      sessionKey: 'main',
      state: 'final',
    });
    expect((finalEvent as any).message.content).toContain('Model switched to openai/gpt-4.1-mini.');
  }, 15_000);

  it('intercepts /think chat commands and exposes Hermes reasoning state through history', async () => {
    const hermesHomePath = await createHermesHomePath({
      agent: {
        reasoning_effort: '',
      },
      display: {
        show_reasoning: false,
      },
    });

    const bridge = new HermesLocalBridge({
      hermesHomePath,
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });
    const broadcastSpy = vi.spyOn(bridge as any, 'broadcastEvent');

    await expect((bridge as any).handleChatSend({
      sessionKey: 'main',
      message: '/think high',
      idempotencyKey: 'run_think_switch',
    })).resolves.toEqual({ runId: 'run_think_switch' });

    const finalEvent = broadcastSpy.mock.calls
      .filter(([eventName]) => eventName === 'chat')
      .map(([, payload]) => payload)
      .find((payload) => (payload as any).runId === 'run_think_switch' && (payload as any).state === 'final');
    expect(finalEvent).toMatchObject({
      runId: 'run_think_switch',
      sessionKey: 'main',
      state: 'final',
    });
    expect((finalEvent as any).message.content).toContain('Current thinking level: high');
    expect((finalEvent as any).message.content).toContain('Options: off, minimal, low, medium, high, xhigh');

    await expect((bridge as any).dispatchRequest('chat.history', {
      sessionKey: 'main',
      limit: 20,
    })).resolves.toMatchObject({
      thinkingLevel: 'high',
    });
  }, 15_000);

  it('intercepts /reasoning chat commands and persists display toggles', async () => {
    const hermesHomePath = await createHermesHomePath({
      agent: {
        reasoning_effort: '',
      },
      display: {
        show_reasoning: false,
      },
    });

    const bridge = new HermesLocalBridge({
      hermesHomePath,
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });
    const broadcastSpy = vi.spyOn(bridge as any, 'broadcastEvent');

    await expect((bridge as any).handleChatSend({
      sessionKey: 'main',
      message: '/reasoning show',
      idempotencyKey: 'run_reasoning_show',
    })).resolves.toEqual({ runId: 'run_reasoning_show' });

    await expect((bridge as any).handleChatSend({
      sessionKey: 'main',
      message: '/reasoning none',
      idempotencyKey: 'run_reasoning_none',
    })).resolves.toEqual({ runId: 'run_reasoning_none' });

    const finalMessages = broadcastSpy.mock.calls
      .filter(([eventName]) => eventName === 'chat')
      .map(([, payload]) => payload)
      .filter((payload) => (payload as any).state === 'final')
      .map((payload) => String((payload as any).message?.content ?? ''));
    expect(finalMessages.some((message) => message.includes('Reasoning display turned on.'))).toBe(true);
    expect(finalMessages.some((message) => message.includes('Current reasoning level: off'))).toBe(true);

    const configText = await readFile(join(hermesHomePath, 'config.yaml'), 'utf8');
    expect(configText).toContain('reasoning_effort: none');
    expect(configText).toContain('show_reasoning: true');

    await expect((bridge as any).dispatchRequest('chat.history', {
      sessionKey: 'main',
      limit: 20,
    })).resolves.toMatchObject({
      thinkingLevel: 'off',
    });
  }, 15_000);

  it('intercepts /fast chat commands for supported Hermes models', async () => {
    const hermesHomePath = await createHermesHomePath({
      agent: {
        service_tier: 'normal',
      },
      model: {
        default: 'openai/gpt-5.4',
        provider: 'openrouter',
      },
    });

    const bridge = new HermesLocalBridge({
      hermesHomePath,
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });
    const broadcastSpy = vi.spyOn(bridge as any, 'broadcastEvent');

    await expect((bridge as any).handleChatSend({
      sessionKey: 'main',
      message: '/fast on',
      idempotencyKey: 'run_fast_on',
    })).resolves.toEqual({ runId: 'run_fast_on' });

    const finalEvent = broadcastSpy.mock.calls
      .filter(([eventName]) => eventName === 'chat')
      .map(([, payload]) => payload)
      .find((payload) => (payload as any).runId === 'run_fast_on' && (payload as any).state === 'final');
    expect((finalEvent as any).message.content).toContain('Current fast mode: on');
    expect((finalEvent as any).message.content).toContain('Options: on, off');

    const configText = await readFile(join(hermesHomePath, 'config.yaml'), 'utf8');
    expect(configText).toContain('service_tier: fast');
  }, 15_000);

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

  it('aggregates Hermes usage and cost from state.db without modifying Hermes source', async () => {
    const hermesStateDbPath = await createHermesStateDbPath();
    execFileSync('python3', [
      '-c',
      [
        'import datetime',
        'import sqlite3, sys',
        'db_path = sys.argv[1]',
        'started_at = datetime.datetime(2026, 4, 10, 12, 0, 0).timestamp()',
        'ended_at = started_at + 60',
        'conn = sqlite3.connect(db_path)',
        'conn.execute("""CREATE TABLE sessions (',
        '  id TEXT PRIMARY KEY, source TEXT NOT NULL, user_id TEXT, model TEXT, model_config TEXT, system_prompt TEXT,',
        '  parent_session_id TEXT, started_at REAL NOT NULL, ended_at REAL, end_reason TEXT,',
        '  message_count INTEGER DEFAULT 0, tool_call_count INTEGER DEFAULT 0,',
        '  input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, cache_read_tokens INTEGER DEFAULT 0, cache_write_tokens INTEGER DEFAULT 0, reasoning_tokens INTEGER DEFAULT 0,',
        '  billing_provider TEXT, billing_base_url TEXT, billing_mode TEXT, estimated_cost_usd REAL, actual_cost_usd REAL, cost_status TEXT, cost_source TEXT, pricing_version TEXT, title TEXT',
        ')""")',
        'conn.execute("""CREATE TABLE messages (',
        '  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT,',
        '  tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL NOT NULL',
        ')""")',
        'conn.execute("INSERT INTO sessions (id, source, model, started_at, ended_at, title, message_count, tool_call_count, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, estimated_cost_usd, actual_cost_usd, cost_status, cost_source, billing_provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ("sess_1", "api_server", "gpt-5.4", started_at, ended_at, "Today Session", 2, 1, 1000, 500, 200, 100, 1.8, None, "estimated", "pricing", "openai"))',
        'conn.execute("INSERT INTO messages (session_id, role, content, tool_calls, timestamp) VALUES (?, ?, ?, ?, ?)", ("sess_1", "user", "hello", None, started_at + 1))',
        'conn.execute("INSERT INTO messages (session_id, role, content, tool_calls, timestamp) VALUES (?, ?, ?, ?, ?)", ("sess_1", "assistant", "working", \'[{\\"id\\":\\"call_1\\",\\"function\\":{\\"name\\":\\"search\\",\\"arguments\\":\\"{}\\"}}]\', started_at + 2))',
        'conn.execute("INSERT INTO messages (session_id, role, content, tool_call_id, tool_name, timestamp) VALUES (?, ?, ?, ?, ?, ?)", ("sess_1", "tool", "{\\"ok\\": true}", "call_1", "search", started_at + 3))',
        'conn.commit()',
        'conn.close()',
      ].join('\n'),
      hermesStateDbPath,
    ]);

    const bridge = new HermesLocalBridge({
      hermesStateDbPath,
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    await expect((bridge as any).dispatchRequest('sessions.usage', {
      startDate: '2026-04-10',
      endDate: '2026-04-10',
    })).resolves.toMatchObject({
      startDate: '2026-04-10',
      endDate: '2026-04-10',
      costPresentation: {
        mode: 'estimated',
      },
      totals: {
        totalTokens: 1800,
        totalCost: 1.8,
      },
      aggregates: {
        messages: {
          total: 3,
          user: 1,
          assistant: 1,
          toolCalls: 1,
          toolResults: 1,
        },
        tools: {
          totalCalls: 1,
          uniqueTools: 1,
          tools: [{ name: 'search', count: 1 }],
        },
      },
      sessions: [
        expect.objectContaining({
          key: 'sess_1',
          label: 'Today Session',
          channel: 'api_server',
          model: 'gpt-5.4',
          modelProvider: 'openai',
          usage: expect.objectContaining({
            totalTokens: 1800,
            totalCost: 1.8,
            costStatus: 'estimated',
          }),
        }),
      ],
    });

    await expect((bridge as any).dispatchRequest('usage.cost', {
      startDate: '2026-04-10',
      endDate: '2026-04-10',
    })).resolves.toMatchObject({
      costPresentation: {
        mode: 'estimated',
      },
      totals: {
        totalTokens: 1800,
        totalCost: 1.8,
      },
      daily: [
        expect.objectContaining({
          date: '2026-04-10',
          totalTokens: 1800,
          totalCost: 1.8,
        }),
      ],
    });
  });

  it('uses the Clawket Hermes usage ledger for long-lived sessions that started before today', async () => {
    const hermesStateDbPath = await createHermesStateDbPath();
    const usageLedgerPath = await createUsageLedgerPath();
    execFileSync('python3', [
      '-c',
      [
        'import datetime',
        'import sqlite3, sys',
        'db_path = sys.argv[1]',
        'started_at = datetime.datetime(2026, 4, 10, 21, 5, 34).timestamp()',
        'conn = sqlite3.connect(db_path)',
        'conn.execute("""CREATE TABLE sessions (',
        '  id TEXT PRIMARY KEY, source TEXT NOT NULL, user_id TEXT, model TEXT, model_config TEXT, system_prompt TEXT,',
        '  parent_session_id TEXT, started_at REAL NOT NULL, ended_at REAL, end_reason TEXT,',
        '  message_count INTEGER DEFAULT 0, tool_call_count INTEGER DEFAULT 0,',
        '  input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, cache_read_tokens INTEGER DEFAULT 0, cache_write_tokens INTEGER DEFAULT 0, reasoning_tokens INTEGER DEFAULT 0,',
        '  billing_provider TEXT, billing_base_url TEXT, billing_mode TEXT, estimated_cost_usd REAL, actual_cost_usd REAL, cost_status TEXT, cost_source TEXT, pricing_version TEXT, title TEXT',
        ')""")',
        'conn.execute("""CREATE TABLE messages (',
        '  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT,',
        '  tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL NOT NULL',
        ')""")',
        'conn.execute("INSERT INTO sessions (id, source, model, started_at, title, input_tokens, output_tokens, cache_read_tokens, estimated_cost_usd, cost_status, cost_source, billing_provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ("clawket-hermes:agent:main:main", "api_server", "gpt-5.4", started_at, "Hermes", 1200, 300, 100, 0.0, "included", "none", "openai-codex"))',
        'conn.execute("INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)", ("clawket-hermes:agent:main:main", "user", "today hello", datetime.datetime(2026, 4, 12, 10, 21, 9).timestamp()))',
        'conn.execute("INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)", ("clawket-hermes:agent:main:main", "assistant", "today reply", datetime.datetime(2026, 4, 12, 10, 21, 15).timestamp()))',
        'conn.commit()',
        'conn.close()',
      ].join('\n'),
      hermesStateDbPath,
    ]);
    await writeFile(usageLedgerPath, JSON.stringify({
      version: 1,
      snapshots: {
        'clawket-hermes:agent:main:main': {
          sessionId: 'clawket-hermes:agent:main:main',
          key: 'main',
          label: 'Hermes',
          agentId: 'main',
          channel: 'api_server',
          model: 'gpt-5.4',
          modelProvider: 'openai-codex',
          costStatus: 'included',
          costSource: 'none',
          updatedAt: 1775962074000,
          startedAtMs: 1775826334000,
          totals: {
            input: 1200,
            output: 300,
            cacheRead: 100,
            cacheWrite: 0,
            totalTokens: 1600,
            totalCost: 0,
            inputCost: 0,
            outputCost: 0,
            cacheReadCost: 0,
            cacheWriteCost: 0,
            missingCostEntries: 0,
          },
        },
      },
      days: {
        '2026-04-12': {
          date: '2026-04-12',
          sessions: {
            'clawket-hermes:agent:main:main': {
              key: 'main',
              label: 'Hermes',
              agentId: 'main',
              channel: 'api_server',
              model: 'gpt-5.4',
              modelProvider: 'openai-codex',
              costStatus: 'included',
              costSource: 'none',
              updatedAt: 1775962074000,
              totals: {
                input: 120,
                output: 30,
                cacheRead: 10,
                cacheWrite: 0,
                totalTokens: 160,
                totalCost: 0,
                inputCost: 0,
                outputCost: 0,
                cacheReadCost: 0,
                cacheWriteCost: 0,
                missingCostEntries: 0,
              },
            },
          },
        },
      },
    }, null, 2), 'utf8');

    const bridge = new HermesLocalBridge({
      hermesStateDbPath,
      usageLedgerPath,
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    await expect((bridge as any).dispatchRequest('sessions.usage', {
      startDate: '2026-04-12',
      endDate: '2026-04-12',
    })).resolves.toMatchObject({
      totals: {
        totalTokens: 160,
        totalCost: 0,
      },
      costPresentation: {
        mode: 'included',
      },
      sessions: [
        expect.objectContaining({
          key: 'clawket-hermes:agent:main:main',
          usage: expect.objectContaining({
            totalTokens: 160,
            totalCost: 0,
            costStatus: 'included',
          }),
        }),
      ],
    });

    await expect((bridge as any).dispatchRequest('usage.cost', {
      startDate: '2026-04-12',
      endDate: '2026-04-12',
    })).resolves.toMatchObject({
      totals: {
        totalTokens: 160,
        totalCost: 0,
      },
      daily: [
        expect.objectContaining({
          date: '2026-04-12',
          totalTokens: 160,
          totalCost: 0,
        }),
      ],
      costPresentation: {
        mode: 'included',
      },
    });
  });

  it('lists Hermes native sessions from state.db and keeps bridge keys stable', async () => {
    const hermesStateDbPath = await createHermesStateDbPath();
    execFileSync('python3', [
      '-c',
      [
        'import sqlite3, sys',
        'db_path = sys.argv[1]',
        'conn = sqlite3.connect(db_path)',
        'conn.execute("""CREATE TABLE sessions (',
        '  id TEXT PRIMARY KEY, source TEXT NOT NULL, user_id TEXT, model TEXT, model_config TEXT, system_prompt TEXT,',
        '  parent_session_id TEXT, started_at REAL NOT NULL, ended_at REAL, end_reason TEXT,',
        '  message_count INTEGER DEFAULT 0, tool_call_count INTEGER DEFAULT 0,',
        '  input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, cache_read_tokens INTEGER DEFAULT 0, cache_write_tokens INTEGER DEFAULT 0, reasoning_tokens INTEGER DEFAULT 0,',
        '  billing_provider TEXT, billing_base_url TEXT, billing_mode TEXT, estimated_cost_usd REAL, actual_cost_usd REAL, cost_status TEXT, cost_source TEXT, pricing_version TEXT, title TEXT',
        ')""")',
        'conn.execute("""CREATE TABLE messages (',
        '  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT,',
        '  tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL NOT NULL, token_count INTEGER, finish_reason TEXT, reasoning TEXT, reasoning_details TEXT, codex_reasoning_items TEXT',
        ')""")',
        'conn.execute("INSERT INTO sessions (id, source, model, billing_provider, started_at, title) VALUES (?, ?, ?, ?, ?, ?)", ("20260411_122441_d40735", "cli", "gpt-5.4", "openai", 1000, "CLI Session"))',
        'conn.execute("INSERT INTO sessions (id, source, model, billing_provider, started_at, title) VALUES (?, ?, ?, ?, ?, ?)", ("clawket-hermes:main", "api_server", "gpt-5.3-codex", "openai-codex", 1100, None))',
        'conn.execute("INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)", ("20260411_122441_d40735", "assistant", "Native CLI reply", 1005))',
        'conn.execute("INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)", ("clawket-hermes:main", "assistant", "Bridge reply", 1110))',
        'conn.commit()',
        'conn.close()',
      ].join('\n'),
      hermesStateDbPath,
    ]);

    const bridge = new HermesLocalBridge({
      hermesStateDbPath,
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    await expect((bridge as any).dispatchRequest('sessions.list', { limit: 10 })).resolves.toMatchObject({
      sessions: [
        expect.objectContaining({
          key: 'main',
          sessionId: 'clawket-hermes:main',
          label: 'Hermes Clawket',
          lastMessagePreview: 'Bridge reply',
        }),
        expect.objectContaining({
          key: '20260411_122441_d40735',
          sessionId: '20260411_122441_d40735',
          label: 'CLI Session',
          lastMessagePreview: 'Native CLI reply',
        }),
      ],
    });
  });

  it('labels Clawket-managed Hermes api_server sessions as Hermes Clawket without renaming unrelated api_server sessions', async () => {
    const hermesStateDbPath = await createHermesStateDbPath();
    execFileSync('python3', [
      '-c',
      [
        'import sqlite3, sys',
        'db_path = sys.argv[1]',
        'conn = sqlite3.connect(db_path)',
        'conn.execute("""CREATE TABLE sessions (',
        '  id TEXT PRIMARY KEY, source TEXT NOT NULL, user_id TEXT, model TEXT, model_config TEXT, system_prompt TEXT,',
        '  parent_session_id TEXT, started_at REAL NOT NULL, ended_at REAL, end_reason TEXT,',
        '  message_count INTEGER DEFAULT 0, tool_call_count INTEGER DEFAULT 0,',
        '  input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, cache_read_tokens INTEGER DEFAULT 0, cache_write_tokens INTEGER DEFAULT 0, reasoning_tokens INTEGER DEFAULT 0,',
        '  billing_provider TEXT, billing_base_url TEXT, billing_mode TEXT, estimated_cost_usd REAL, actual_cost_usd REAL, cost_status TEXT, cost_source TEXT, pricing_version TEXT, title TEXT',
        ')""")',
        'conn.execute("""CREATE TABLE messages (',
        '  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT,',
        '  tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL NOT NULL, token_count INTEGER, finish_reason TEXT, reasoning TEXT, reasoning_details TEXT, codex_reasoning_items TEXT',
        ')""")',
        'conn.execute("INSERT INTO sessions (id, source, model, billing_provider, started_at, title) VALUES (?, ?, ?, ?, ?, ?)", ("clawket-hermes:main", "api_server", "gpt-5.3-codex", "openai-codex", 1100, None))',
        'conn.execute("INSERT INTO sessions (id, source, model, billing_provider, started_at, title) VALUES (?, ?, ?, ?, ?, ?)", ("codex-debug-browser-output", "api_server", "gpt-5.4", "openai-codex", 1200, None))',
        'conn.commit()',
        'conn.close()',
      ].join('\n'),
      hermesStateDbPath,
    ]);

    const bridge = new HermesLocalBridge({
      hermesStateDbPath,
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    await expect((bridge as any).dispatchRequest('sessions.list', { limit: 10 })).resolves.toMatchObject({
      sessions: expect.arrayContaining([
        expect.objectContaining({
          key: 'main',
          sessionId: 'clawket-hermes:main',
          label: 'Hermes Clawket',
        }),
        expect.objectContaining({
          key: 'codex-debug-browser-output',
          sessionId: 'codex-debug-browser-output',
          label: 'codex-debug-browser-output',
        }),
      ]),
    });
  });

  it('returns Hermes session context window as a shared default instead of resolving it per session row', async () => {
    const hermesStateDbPath = await createHermesStateDbPath();
    const hermesHomePath = await createHermesHomePath({
      model: {
        default: 'gpt-5.4',
        provider: 'openai-codex',
        base_url: 'https://chatgpt.com/backend-api/codex',
      },
    });
    execFileSync('python3', [
      '-c',
      [
        'import sqlite3, sys',
        'db_path = sys.argv[1]',
        'conn = sqlite3.connect(db_path)',
        'conn.execute("""CREATE TABLE sessions (',
        '  id TEXT PRIMARY KEY, source TEXT NOT NULL, user_id TEXT, model TEXT, model_config TEXT, system_prompt TEXT,',
        '  parent_session_id TEXT, started_at REAL NOT NULL, ended_at REAL, end_reason TEXT,',
        '  message_count INTEGER DEFAULT 0, tool_call_count INTEGER DEFAULT 0,',
        '  input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, cache_read_tokens INTEGER DEFAULT 0, cache_write_tokens INTEGER DEFAULT 0, reasoning_tokens INTEGER DEFAULT 0,',
        '  billing_provider TEXT, billing_base_url TEXT, billing_mode TEXT, estimated_cost_usd REAL, actual_cost_usd REAL, cost_status TEXT, cost_source TEXT, pricing_version TEXT, title TEXT',
        ')""")',
        'conn.execute("""CREATE TABLE messages (',
        '  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT,',
        '  tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL NOT NULL, token_count INTEGER, finish_reason TEXT, reasoning TEXT, reasoning_details TEXT, codex_reasoning_items TEXT',
        ')""")',
        'conn.execute("INSERT INTO sessions (id, source, model, billing_provider, billing_base_url, started_at, title) VALUES (?, ?, ?, ?, ?, ?, ?)", ("clawket-hermes:main", "api_server", "gpt-5.4", "openai-codex", "https://chatgpt.com/backend-api/codex", 1100, None))',
        'conn.commit()',
        'conn.close()',
      ].join('\n'),
      hermesStateDbPath,
    ]);

    const bridge = new HermesLocalBridge({
      hermesHomePath,
      hermesStateDbPath,
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });
    vi.spyOn(bridge as any, 'resolveHermesContextWindow').mockReturnValue(1_050_000);

    const result = await (bridge as any).dispatchRequest('sessions.list', { limit: 10 });
    expect(result).toMatchObject({
      defaults: { contextTokens: 1_050_000 },
      sessions: [
        {
          key: 'main',
          sessionId: 'clawket-hermes:main',
          model: 'gpt-5.4',
          modelProvider: 'openai-codex',
        },
      ],
    });
    expect(result.sessions[0]).not.toHaveProperty('contextTokens');
  });

  it('loads Hermes native history from state.db and preserves tool calls', async () => {
    const hermesStateDbPath = await createHermesStateDbPath();
    execFileSync('python3', [
      '-c',
      [
        'import sqlite3, sys',
        'db_path = sys.argv[1]',
        'conn = sqlite3.connect(db_path)',
        'conn.execute("""CREATE TABLE sessions (',
        '  id TEXT PRIMARY KEY, source TEXT NOT NULL, user_id TEXT, model TEXT, model_config TEXT, system_prompt TEXT,',
        '  parent_session_id TEXT, started_at REAL NOT NULL, ended_at REAL, end_reason TEXT,',
        '  message_count INTEGER DEFAULT 0, tool_call_count INTEGER DEFAULT 0,',
        '  input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, cache_read_tokens INTEGER DEFAULT 0, cache_write_tokens INTEGER DEFAULT 0, reasoning_tokens INTEGER DEFAULT 0,',
        '  billing_provider TEXT, billing_base_url TEXT, billing_mode TEXT, estimated_cost_usd REAL, actual_cost_usd REAL, cost_status TEXT, cost_source TEXT, pricing_version TEXT, title TEXT',
        ')""")',
        'conn.execute("""CREATE TABLE messages (',
        '  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT,',
        '  tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL NOT NULL, token_count INTEGER, finish_reason TEXT, reasoning TEXT, reasoning_details TEXT, codex_reasoning_items TEXT',
        ')""")',
        'conn.execute("INSERT INTO sessions (id, source, model, billing_provider, started_at, title) VALUES (?, ?, ?, ?, ?, ?)", ("20260411_122441_d40735", "cli", "gpt-5.4", "openai", 1000, "CLI Session"))',
        'conn.execute("INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)", ("20260411_122441_d40735", "user", "hello", 1001))',
        'conn.execute("INSERT INTO messages (session_id, role, content, tool_calls, timestamp) VALUES (?, ?, ?, ?, ?)", ("20260411_122441_d40735", "assistant", "working", \'[{\\"id\\":\\"call_1\\",\\"function\\":{\\"name\\":\\"search\\",\\"arguments\\":{\\"query\\":\\"hermes\\"}}}]\', 1002))',
        'conn.execute("INSERT INTO messages (session_id, role, content, tool_call_id, tool_name, timestamp) VALUES (?, ?, ?, ?, ?, ?)", ("20260411_122441_d40735", "tool", "{\\"ok\\": true}", "call_1", "search", 1003))',
        'conn.commit()',
        'conn.close()',
      ].join('\n'),
      hermesStateDbPath,
    ]);

    const bridge = new HermesLocalBridge({
      hermesStateDbPath,
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    await expect((bridge as any).dispatchRequest('chat.history', {
      sessionKey: '20260411_122441_d40735',
      limit: 50,
    })).resolves.toEqual({
      thinkingLevel: 'medium',
      sessionId: '20260411_122441_d40735',
      messages: [
        expect.objectContaining({
          role: 'user',
          content: 'hello',
        }),
        expect.objectContaining({
          role: 'assistant',
          content: [
            { type: 'text', text: 'working' },
            { type: 'toolCall', id: 'call_1', name: 'search', arguments: { query: 'hermes' } },
          ],
          model: 'gpt-5.4',
          provider: 'openai',
        }),
        expect.objectContaining({
          role: 'toolResult',
          content: '{"ok": true}',
          toolCallId: 'call_1',
          toolName: 'search',
        }),
      ],
    });
  });

  it('deduplicates bridge-appended final assistant replies when native Hermes history already has them', async () => {
    const hermesStateDbPath = await createHermesStateDbPath();
    execFileSync('python3', [
      '-c',
      [
        'import sqlite3, sys',
        'db_path = sys.argv[1]',
        'conn = sqlite3.connect(db_path)',
        'conn.execute("""CREATE TABLE sessions (',
        '  id TEXT PRIMARY KEY, source TEXT NOT NULL, user_id TEXT, model TEXT, model_config TEXT, system_prompt TEXT,',
        '  parent_session_id TEXT, started_at REAL NOT NULL, ended_at REAL, end_reason TEXT,',
        '  message_count INTEGER DEFAULT 0, tool_call_count INTEGER DEFAULT 0,',
        '  input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, cache_read_tokens INTEGER DEFAULT 0, cache_write_tokens INTEGER DEFAULT 0, reasoning_tokens INTEGER DEFAULT 0,',
        '  billing_provider TEXT, billing_base_url TEXT, billing_mode TEXT, estimated_cost_usd REAL, actual_cost_usd REAL, cost_status TEXT, cost_source TEXT, pricing_version TEXT, title TEXT',
        ')""")',
        'conn.execute("""CREATE TABLE messages (',
        '  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT,',
        '  tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL NOT NULL, token_count INTEGER, finish_reason TEXT, reasoning TEXT, reasoning_details TEXT, codex_reasoning_items TEXT',
        ')""")',
        'conn.execute("INSERT INTO sessions (id, source, model, billing_provider, started_at, title) VALUES (?, ?, ?, ?, ?, ?)", ("clawket-hermes:main", "api_server", "gpt-5.3-codex", "openai-codex", 1000, "Hermes"))',
        'conn.execute("INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)", ("clawket-hermes:main", "user", "hello", 1001))',
        'conn.execute("INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)", ("clawket-hermes:main", "assistant", "Same final reply", 1002))',
        'conn.commit()',
        'conn.close()',
      ].join('\n'),
      hermesStateDbPath,
    ]);

    const bridge = new HermesLocalBridge({
      hermesStateDbPath,
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    (bridge as any).sessionStore.appendMessage('main', {
      role: 'assistant',
      content: 'Same final reply',
      ts: 1_500,
      runId: 'run_dup',
    });

    await expect((bridge as any).dispatchRequest('chat.history', {
      sessionKey: 'main',
      limit: 50,
    })).resolves.toEqual({
      thinkingLevel: 'medium',
      sessionId: 'clawket-hermes:main',
      messages: [
        expect.objectContaining({
          role: 'user',
          content: 'hello',
        }),
        expect.objectContaining({
          role: 'assistant',
          content: 'Same final reply',
          model: 'gpt-5.3-codex',
          provider: 'openai-codex',
        }),
      ],
    });
  });

  it('preserves timestamp and idempotencyKey for user history entries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ run_id: 'run_1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ));

    const bridge = new HermesLocalBridge({
      apiBaseUrl: 'http://127.0.0.1:8642',
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    await (bridge as any).handleChatSend({
      sessionKey: 'main',
      message: '你好',
      idempotencyKey: 'idem_123',
    });

    const history = (bridge as any).sessionStore.getHistory('main', 50);
    expect(history.sessionId).toBe('clawket-hermes:main');
    expect(history.messages).toHaveLength(1);
    expect(history.messages[0]).toMatchObject({
      role: 'user',
      content: '你好',
      idempotencyKey: 'idem_123',
    });
    expect(history.messages[0]?.timestamp).toEqual(expect.any(Number));
    expect(history.messages[0]?.timestamp).toBeGreaterThan(0);
  });

  it('persists only Hermes session metadata to disk and never stores chat content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ run_id: 'run_1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ));

    const sessionStorePath = await createSessionStorePath();
    const bridge = new HermesLocalBridge({
      apiBaseUrl: 'http://127.0.0.1:8642',
      sessionStorePath,
      startHermesIfNeeded: false,
    });

    await (bridge as any).handleChatSend({
      sessionKey: 'main',
      message: 'top secret prompt',
      idempotencyKey: 'idem_secret',
    });

    (bridge as any).sessionStore.appendMessage('main', {
      role: 'assistant',
      content: 'top secret reply',
      ts: 2_000,
      runId: 'run_1',
    });

    const persisted = await readFile(sessionStorePath, 'utf8');
    expect(persisted).not.toContain('top secret prompt');
    expect(persisted).not.toContain('top secret reply');
    expect(persisted).not.toContain('idem_secret');

    const parsed = JSON.parse(persisted) as {
      sessions?: Array<Record<string, unknown>>;
    };
    expect(parsed.sessions?.[0]).toMatchObject({
      key: 'main',
      sessionId: 'clawket-hermes:main',
      title: 'Hermes Clawket',
    });
    expect(parsed.sessions?.[0]?.messages).toBeUndefined();

    const inMemoryHistory = (bridge as any).sessionStore.getHistory('main', 50);
    expect(inMemoryHistory.messages).toEqual([
      expect.objectContaining({
        role: 'user',
        content: 'top secret prompt',
      }),
      expect.objectContaining({
        role: 'assistant',
        content: 'top secret reply',
      }),
    ]);
  });

  it('includes assistant timestamps in history responses', async () => {
    const bridge = new HermesLocalBridge({
      apiBaseUrl: 'http://127.0.0.1:8642',
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    (bridge as any).sessionStore.appendMessage('main', {
      role: 'assistant',
      content: 'Hello back',
      ts: 1_234,
      runId: 'run_1',
    });

    const history = (bridge as any).sessionStore.getHistory('main', 50);
    expect(history.messages).toEqual([
      {
        role: 'assistant',
        content: 'Hello back',
        timestamp: 1_234,
        runId: 'run_1',
        idempotencyKey: undefined,
        toolName: undefined,
        toolCallId: undefined,
        isError: undefined,
      },
    ]);
  });

  it('persists tool results in history with a stable toolCallId', async () => {
    const bridge = new HermesLocalBridge({
      apiBaseUrl: 'http://127.0.0.1:8642',
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    const broadcastSpy = vi.spyOn(bridge as any, 'broadcastEvent');
    const sessionStore = (bridge as any).sessionStore;

    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode([
              'data: {"event":"tool.started","timestamp":1000,"tool":"search","preview":"query"}',
              '',
              'data: {"event":"tool.completed","timestamp":1200,"tool":"search","result":{"items":["done"]},"duration":200}',
              '',
              'data: {"event":"run.completed","timestamp":1300,"output":"answer"}',
              '',
            ].join('\n')),
          );
          controller.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )));

    await (bridge as any).streamRunEvents('run_1', 'main');

    const toolEvents = broadcastSpy.mock.calls
      .filter(([eventName]) => eventName === 'agent')
      .map(([, payload]) => payload)
      .filter((payload) => (payload as any).stream === 'tool');
    expect(toolEvents).toHaveLength(2);
    expect((toolEvents[0] as any).data.toolCallId).toBe((toolEvents[1] as any).data.toolCallId);
    expect((toolEvents[1] as any).data.output).toBe('{\n  "items": [\n    "done"\n  ]\n}');

    const history = sessionStore.getHistory('main', 50);
    expect(history.messages).toContainEqual({
      role: 'toolResult',
      content: '{\n  "items": [\n    "done"\n  ]\n}',
      timestamp: 1200,
      runId: 'run_1',
      idempotencyKey: undefined,
      toolName: 'search',
      toolCallId: 'run_1:tool:1',
      isError: false,
      toolArgs: 'query',
      toolDurationMs: 200,
      toolStartedAt: 1000,
      toolFinishedAt: 1200,
    });
  });

  it('hydrates missing tool output from local Hermes state without changing Hermes source', async () => {
    const hermesStateDbPath = await createHermesStateDbPath();
    execFileSync('python3', [
      '-c',
      [
        'import json, sqlite3, sys',
        'db_path = sys.argv[1]',
        'conn = sqlite3.connect(db_path)',
        'conn.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, tool_call_id TEXT, tool_name TEXT, tool_calls TEXT, timestamp REAL)")',
        'tool_calls = json.dumps([{',
        '  "id": "call_123",',
        '  "function": {"name": "browser_navigate", "arguments": "{\\"url\\":\\"https://example.com\\"}"}',
        '}])',
        'conn.execute("INSERT INTO messages (session_id, role, content, tool_call_id, tool_name, tool_calls, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)", ("clawket-hermes:main", "assistant", "", None, None, tool_calls, 1.10))',
        'conn.execute("INSERT INTO messages (session_id, role, content, tool_call_id, tool_name, tool_calls, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)", ("clawket-hermes:main", "tool", "{\\"success\\":true,\\"snapshot\\":\\"Example Domain\\"}", "call_123", None, None, 1.35))',
        'conn.commit()',
        'conn.close()',
      ].join('\n'),
      hermesStateDbPath,
    ]);

    const bridge = new HermesLocalBridge({
      apiBaseUrl: 'http://127.0.0.1:8642',
      sessionStorePath: await createSessionStorePath(),
      hermesStateDbPath,
      startHermesIfNeeded: false,
    });

    const broadcastSpy = vi.spyOn(bridge as any, 'broadcastEvent');
    const sessionStore = (bridge as any).sessionStore;

    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode([
              'data: {"event":"tool.started","timestamp":1000,"tool":"browser_navigate","preview":"https://example.com"}',
              '',
              'data: {"event":"tool.completed","timestamp":1200,"tool":"browser_navigate","duration":200}',
              '',
              'data: {"event":"run.completed","timestamp":1300,"output":"DONE"}',
              '',
            ].join('\n')),
          );
          controller.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )));

    await (bridge as any).streamRunEvents('run_1', 'main', 'clawket-hermes:main', 900);

    const history = sessionStore.getHistory('main', 50);
    expect(history.messages).toContainEqual(expect.objectContaining({
      role: 'toolResult',
      toolName: 'browser_navigate',
      toolCallId: 'run_1:tool:1',
      content: '{"success":true,"snapshot":"Example Domain"}',
    }));

    const hydratedResultEvent = broadcastSpy.mock.calls
      .filter(([eventName]) => eventName === 'agent')
      .map(([, payload]) => payload)
      .find((payload) => (payload as any).stream === 'tool'
        && (payload as any).data.phase === 'result'
        && (payload as any).data.output === '{"success":true,"snapshot":"Example Domain"}');
    expect(hydratedResultEvent).toBeTruthy();
  });

  it('finalizes a run when the Hermes events stream ends after assistant deltas without a terminal event', async () => {
    const bridge = new HermesLocalBridge({
      apiBaseUrl: 'http://127.0.0.1:8642',
      hermesStateDbPath: await createHermesStateDbPath(),
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    const broadcastSpy = vi.spyOn(bridge as any, 'broadcastEvent');

    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode([
              'data: {"event":"message.delta","timestamp":1000,"delta":"Hello"}',
              '',
              'data: {"event":"message.delta","timestamp":1100,"delta":" world"}',
              '',
              '',
            ].join('\n')),
          );
          controller.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )));

    await (bridge as any).streamRunEvents(
      'run_1',
      'main',
      'clawket-hermes:main',
      900,
      new AbortController().signal,
    );

    const chatEvents = broadcastSpy.mock.calls
      .filter(([eventName]) => eventName === 'chat')
      .map(([, payload]) => payload);
    expect(chatEvents).toEqual([
      expect.objectContaining({
        runId: 'run_1',
        sessionKey: 'main',
        seq: 1,
        state: 'delta',
        message: { role: 'assistant', content: 'Hello' },
      }),
      expect.objectContaining({
        runId: 'run_1',
        sessionKey: 'main',
        seq: 2,
        state: 'delta',
        message: { role: 'assistant', content: 'world' },
      }),
      expect.objectContaining({
        runId: 'run_1',
        sessionKey: 'main',
        seq: 3,
        state: 'final',
        message: { role: 'assistant', content: 'Helloworld' },
      }),
    ]);
  });

  it('finalizes a run when the Hermes events stream ends after tool completion without a terminal event', async () => {
    const bridge = new HermesLocalBridge({
      apiBaseUrl: 'http://127.0.0.1:8642',
      hermesStateDbPath: await createHermesStateDbPath(),
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    const broadcastSpy = vi.spyOn(bridge as any, 'broadcastEvent');

    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode([
              'data: {"event":"tool.started","timestamp":1000,"tool":"search","preview":"query"}',
              '',
              'data: {"event":"tool.completed","timestamp":1200,"tool":"search","result":{"items":["done"]},"duration":200}',
              '',
              '',
            ].join('\n')),
          );
          controller.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )));

    await (bridge as any).streamRunEvents(
      'run_1',
      'main',
      'clawket-hermes:main',
      900,
      new AbortController().signal,
    );

    const chatEvents = broadcastSpy.mock.calls
      .filter(([eventName]) => eventName === 'chat')
      .map(([, payload]) => payload);
    expect(chatEvents.at(-1)).toEqual(expect.objectContaining({
      runId: 'run_1',
      sessionKey: 'main',
      seq: 1,
      state: 'final',
    }));
  });

  it('emits an error when the Hermes events stream ends without recoverable output or tool results', async () => {
    const bridge = new HermesLocalBridge({
      apiBaseUrl: 'http://127.0.0.1:8642',
      hermesStateDbPath: await createHermesStateDbPath(),
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    const broadcastSpy = vi.spyOn(bridge as any, 'broadcastEvent');

    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )));

    await (bridge as any).streamRunEvents(
      'run_1',
      'main',
      'clawket-hermes:main',
      900,
      new AbortController().signal,
    );

    const chatEvents = broadcastSpy.mock.calls
      .filter(([eventName]) => eventName === 'chat')
      .map(([, payload]) => payload);
    expect(chatEvents).toEqual([
      expect.objectContaining({
        runId: 'run_1',
        sessionKey: 'main',
        seq: 1,
        state: 'error',
        errorMessage: 'Hermes events stream ended before a terminal event was received.',
      }),
    ]);
  });

  it('aborts active bridge-side Hermes streams for a session', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/v1/runs')) {
        return new Response(JSON.stringify({ run_id: 'run_abort' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/v1/runs/run_abort/events')) {
        return await new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const bridge = new HermesLocalBridge({
      apiBaseUrl: 'http://127.0.0.1:8642',
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    const broadcastSpy = vi.spyOn(bridge as any, 'broadcastEvent');

    await (bridge as any).handleChatSend({
      sessionKey: 'main',
      message: 'abort me',
    });
    await Promise.resolve();

    const abortResult = await (bridge as any).dispatchRequest('chat.abort', { sessionKey: 'main' });
    expect(abortResult).toEqual({
      ok: true,
      abortedRunIds: ['run_abort'],
      upstreamCancelled: false,
    });

    await Promise.resolve();

    const abortedEvent = broadcastSpy.mock.calls.find(([eventName, payload]) =>
      eventName === 'chat'
      && (payload as any).state === 'aborted'
      && (payload as any).runId === 'run_abort',
    );
    expect(abortedEvent).toBeTruthy();
    expect((bridge as any).activeRuns.size).toBe(0);
  });
});
