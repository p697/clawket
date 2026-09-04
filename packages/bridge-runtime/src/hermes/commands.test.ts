import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HermesLocalBridge } from './index.js';
import { cleanupTempDirectories, createTempDirectory } from './test-helpers.js';

afterEach(cleanupTempDirectories);

describe('Hermes model API signature compatibility', () => {
  for (const signature of ['legacy', 'custom-providers'] as const) {
    it(`switches a custom provider with the ${signature} switch_model signature`, async () => {
      const root = await createTempDirectory();
      const source = join(root, 'source');
      const home = join(root, 'home');
      await writeFakeHermesModules(source, signature);
      const bridge = new HermesLocalBridge({
        hermesSourcePath: source,
        hermesHomePath: home,
        hermesPythonPath: 'python3',
        sessionStorePath: join(root, 'sessions.json'),
        usageLedgerPath: join(root, 'usage.json'),
      });

      expect(bridge.executeModelCommand(
        '/model next-model --provider custom:fake-provider --global',
      )).toContain('Model switched to next-model.');
    });
  }
});

async function writeFakeHermesModules(
  source: string,
  signature: 'legacy' | 'custom-providers',
): Promise<void> {
  const packageDir = join(source, 'hermes_cli');
  await mkdir(packageDir, { recursive: true });
  await Promise.all([
    writeFile(join(packageDir, '__init__.py'), ''),
    writeFile(join(packageDir, 'config.py'), [
      'CONFIG = {',
      '  "model": {"default": "old-model", "provider": "custom:fake-provider"},',
      '  "custom_providers": [{"name": "Fake Provider", "base_url": "http://127.0.0.1:9/v1", "model": "old-model"}],',
      '}',
      'def load_config(): return CONFIG',
      'def save_config(cfg): pass',
    ].join('\n')),
    writeFile(join(packageDir, 'auth.py'), 'def _load_auth_store(): return {}\n'),
    writeFile(join(packageDir, 'models.py'), [
      'OPENROUTER_MODELS = []',
      '_PROVIDER_MODELS = {}',
      'def provider_model_ids(slug): return []',
    ].join('\n')),
    writeFile(join(packageDir, 'model_switch.py'), buildFakeModelSwitchModule(signature)),
  ]);
}

function buildFakeModelSwitchModule(signature: 'legacy' | 'custom-providers'): string {
  const listSignature = signature === 'legacy'
    ? 'current_provider, user_providers=None, max_models=50'
    : 'current_provider, user_providers=None, custom_providers=None, max_models=50';
  const switchSignature = signature === 'legacy'
    ? 'raw_input, current_provider, current_model, current_base_url="", current_api_key="", is_global=False, explicit_provider="", user_providers=None'
    : 'raw_input, current_provider, current_model, current_base_url="", current_api_key="", is_global=False, explicit_provider="", user_providers=None, custom_providers=None';
  const compatibilityAssertion = signature === 'legacy'
    ? 'assert "custom:fake-provider" in (user_providers or {})'
    : 'assert isinstance(custom_providers, list) and custom_providers';
  return [
    'from types import SimpleNamespace',
    `def list_authenticated_providers(${listSignature}): return []`,
    'def parse_model_flags(raw_args):',
    '  parts = raw_args.split(" --provider ", 1)',
    '  model = parts[0].replace(" --global", "").strip()',
    '  provider = parts[1].split()[0] if len(parts) > 1 else ""',
    '  return model, provider, True',
    `def switch_model(${switchSignature}):`,
    `  ${compatibilityAssertion}`,
    '  return SimpleNamespace(',
    '    success=True, new_model=raw_input, target_provider=explicit_provider,',
    '    base_url="http://127.0.0.1:9/v1", provider_label="Fake Provider", error_message="",',
    '  )',
  ].join('\n');
}
