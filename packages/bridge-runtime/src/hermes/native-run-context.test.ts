import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { supportsNativeRunContext } from './native-run-context.js';
import { HermesPythonRunner } from './python-runner.js';
import { cleanupTempDirectories, createTempDirectory } from './test-helpers.js';

afterEach(cleanupTempDirectories);
describe('native run context negotiation', () => {
  it.each([true, false])('checks the actual native fallback (present=%s)', async present => {
    const root = await createTempDirectory();
    const directory = join(root, 'gateway', 'platforms'); await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'api_server_runs.py'), present
      ? 'async def _handle_runs(self):\n    if not conversation_history and session_id and not previous_response_id:\n        conversation_history = await self._conversation_history_for_session(str(session_id))\n'
      : 'async def _handle_runs(self):\n    return None\n');
    const runner = new HermesPythonRunner({ hermesSourcePath: root, hermesHomePath: root, hermesPythonPath: process.platform === 'win32' ? 'python' : 'python3' });
    expect(await supportsNativeRunContext(runner.run.bind(runner))).toBe(present);
  });
});
