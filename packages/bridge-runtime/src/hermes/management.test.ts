import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HermesLocalBridge } from './index.js';
import { cleanupTempDirectories, createTempDirectory } from './test-helpers.js';

afterEach(cleanupTempDirectories);

describe('Hermes management files', () => {
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
