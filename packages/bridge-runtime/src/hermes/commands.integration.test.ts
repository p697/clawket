import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HermesLocalBridge as ProductionHermesLocalBridge,
  type HermesLocalBridgeOptions,
} from './index.js';
import { DEFAULT_HERMES_HOME_PATH } from './internal.js';
import { resolveHermesPythonPath } from './python-runner.js';
import { resolveHermesSourcePath } from './installation.js';

const HERMES_INTEGRATION_PYTHON_PATH = resolveHermesPythonPath({
  hermesSourcePath: resolveHermesSourcePath(),
  hermesHomePath: DEFAULT_HERMES_HOME_PATH,
});

class HermesLocalBridge extends ProductionHermesLocalBridge {
  constructor(options: HermesLocalBridgeOptions = {}) {
    super({ ...options, hermesPythonPath: options.hermesPythonPath ?? HERMES_INTEGRATION_PYTHON_PATH });
    integrationBridges.push(this);
  }
}

const tempDirs: string[] = [];
const integrationBridges: ProductionHermesLocalBridge[] = [];

afterEach(async () => {
  await Promise.all(integrationBridges.splice(0).map(bridge => bridge.stop()));
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

async function reserveAvailablePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a test port.');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function createHermesHomePath(config?: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'clawket-hermes-home-'));
  tempDirs.push(dir);
  if (config) {
    const configJson = JSON.stringify(config);
    execFileSync((process.platform === 'win32' ? 'python' : 'python3'), [
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


describe('Hermes commands and files integration', () => {
  it('exposes Hermes built-in memory files through the bridge', async () => {
    const hermesHomePath = await createHermesHomePath();
    await mkdir(join(hermesHomePath, 'memories'), { recursive: true });
    await writeFile(join(hermesHomePath, 'memories', 'MEMORY.md'), 'Project fact', 'utf8');

    const bridge = new HermesLocalBridge({
      hermesHomePath,
      host: '127.0.0.1',
      port: await reserveAvailablePort(),
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
      host: '127.0.0.1',
      port: await reserveAvailablePort(),
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

    // The installed backend can also discover machine-authenticated providers.
    await expect((bridge as any).dispatchRequest('models.list', {})).resolves.toEqual({
      models: expect.arrayContaining([
        {
          id: 'moonshot-v1-8k',
          name: 'moonshot-v1-8k',
          provider: 'custom:moonshot-local',
        },
      ]),
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
    // The installed backend can also discover machine-authenticated providers.
    await expect((bridge as any).dispatchRequest('models.list', {})).resolves.toEqual({
      models: expect.arrayContaining([
        {
          id: 'moonshot-v1-8k',
          name: 'moonshot-v1-8k',
          provider: 'custom:moonshot-local',
        },
      ]),
    });

    expect(readStateSpy).toHaveBeenCalledTimes(1);
  }, 30_000);

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

    expect(readStateSpy).toHaveBeenCalledTimes(1);
    expect((bridge as any).modelStateCache?.value).toMatchObject({
      currentModel: 'moonshot-v1-8k',
      currentProvider: 'custom:moonshot-local',
    });
    await bridge.stop();
  }, 30_000);

  it('preserves credential-pool providers and the installed Hermes model catalog', async () => {
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
      }),
      expect.objectContaining({
        slug: 'openai-codex',
      }),
    ]));
    const codexProvider = state.providers.find((provider: { slug?: string; models?: string[] }) => provider.slug === 'openai-codex');
    // Catalog membership changes upstream; verify complete mapping of the installed catalog.
    expect(codexProvider?.models.length).toBeGreaterThan(0);
    for (const id of codexProvider.models) {
      expect(state.models).toContainEqual(expect.objectContaining({ provider: 'openai-codex', id }));
    }
    expect(state.models).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: 'openrouter',
      }),
      expect.objectContaining({
        provider: 'openai-codex',
        id: 'gpt-5.3-codex',
      }),
    ]));
  }, 30_000);

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

});
