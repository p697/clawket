/** Synthetic native inputs executed through the actual Bridge history producers.
 * No services, credentials, native sessions or user files are accessed.
 * Node 22.18+: node tests/native-contract/sdk-history.mjs --write|--check
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const fixtureURL = new URL('../../packages/apple/Tests/ClawketRuntimeTests/Fixtures/sdk-history.json', import.meta.url);
const sourcePaths = ['codex/history.ts', 'pi/history.ts', 'claude-code/history.ts', 'claude-code/models.ts'];
const sourceURL = name => new URL('../../packages/bridge-runtime/src/' + name, import.meta.url);
const moduleURL = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');

export function validateProducerImports(source, allowedModels = null) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('Invalid history producer module');
  const expected = allowedModels ? `import { claudeModelId } from ${JSON.stringify(allowedModels)};` : null;
  const remaining = expected ? source.replace(expected, '') : source;
  // Deliberately conservative: even a new import inside a string/comment needs
  // review. This is an allowlist for these modules, not a general JS parser.
  if (/\bimport\b/.test(remaining) || /\bexport[^\n;]*\bfrom\s+['"]/m.test(source)) throw new Error('Unexpected history runtime dependency');
  return source;
}

export async function sdkHistoryFixture() {
  const sources = new Map(await Promise.all(sourcePaths.map(async name => [name, await readFile(sourceURL(name), 'utf8')])));
  const javascript = name => stripTypeScriptTypes(sources.get(name));
  // This is the sole runtime import of these pure modules. Any new dependency
  // needs explicit review rather than silently loading a service from a test.
  const models = moduleURL(validateProducerImports(javascript('claude-code/models.ts')));
  const claude = javascript('claude-code/history.ts').replace(/from\s+(['"])\.\/models\.js\1/g, `from ${JSON.stringify(models)}`);
  const [{ codexMessages }, { piMessages }, { claudeHistory }] = await Promise.all([
    import(moduleURL(validateProducerImports(javascript('codex/history.ts')))),
    import(moduleURL(validateProducerImports(javascript('pi/history.ts')))),
    import(moduleURL(validateProducerImports(claude, models))),
  ]);
  const timestamp = '2026-01-01T00:00:00.000Z';
  const codex = codexMessages([{ id: 'vector-turn', status: 'completed', startedAt: 1767225600, completedAt: 1767225610,
    items: [
      { id: 'vector-human', type: 'userMessage', clientId: 'vector-send-key', content: [{ type: 'text', text: 'Synthetic native history' }] },
      ...['completed', 'failed', 'inProgress', undefined].map((status, index) => ({ id: `vector-command-${index}`, type: 'commandExecution', status,
        command: 'printf native-sdk-vector', aggregatedOutput: 'native-sdk-vector', durationMs: 15 })),
      { id: 'vector-assistant', type: 'agentMessage', text: 'Synthetic completion', phase: 'final_answer' },
    ] }]);
  const pi = piMessages([
    { id: 'pi-human', timestamp, message: { role: 'user', content: [{ type: 'text', text: 'Synthetic Pi history' }] } },
    { id: 'pi-assistant', timestamp, message: { role: 'assistant', content: [
      { type: 'text', text: 'Synthetic commentary' },
      { type: 'toolCall', id: 'pi-call', name: 'exec', arguments: { command: 'printf native-sdk-pi' } },
      { type: 'toolCall', id: 'pi-unsettled', name: 'read', arguments: { path: 'synthetic-fixture' } },
    ] } },
    { id: 'pi-result', timestamp, message: { role: 'toolResult', toolCallId: 'pi-call', isError: false,
      content: [{ type: 'text', text: 'native-sdk-pi' }] } },
  ]);
  const claudeMessages = claudeHistory([
    { type: 'assistant', uuid: 'claude-assistant', timestamp, message: { role: 'assistant', model: 'synthetic-model', content: [
      { type: 'text', text: 'Synthetic commentary' },
      { type: 'tool_use', id: 'claude-call', name: 'Bash', input: { command: 'printf native-sdk-claude' } },
      { type: 'tool_use', id: 'claude-unsettled', name: 'Read', input: { file_path: 'synthetic-fixture' } },
    ] } },
    { type: 'user', uuid: 'claude-result', timestamp, message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'claude-call', content: 'native-sdk-claude', is_error: false },
    ] } },
  ]);
  const value = JSON.parse(JSON.stringify({ version: 1, synthetic: true,
    sourceDigests: Object.fromEntries([...sources].map(([name, source]) => [name, createHash('sha256').update(source).digest('hex')])),
    cases: [{ backend: 'codex', messages: codex }, { backend: 'pi', messages: pi }, { backend: 'claude-code', messages: claudeMessages }],
  }));
  validateSDKHistoryFixture(value);
  return value;
}

export function validateSDKHistoryFixture(value) {
  const require = condition => { if (!condition) throw new Error('Invalid native SDK history fixture'); };
  require(value?.version === 1 && value.synthetic === true);
  require(Object.keys(value.sourceDigests ?? {}).sort().join('|') === [...sourcePaths].sort().join('|'));
  require(Object.values(value.sourceDigests).every(digest => typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest)));
  require(Array.isArray(value.cases) && value.cases.length === 3);
  require(value.cases.map(entry => entry.backend).sort().join('|') === 'claude-code|codex|pi');
  let tools = 0;
  for (const entry of value.cases) {
    require(Array.isArray(entry.messages) && entry.messages.length > 0 && entry.messages.length <= 64);
    const ids = new Set(); let caseTools = 0;
    for (const message of entry.messages) {
      require(typeof message?.id === 'string' && message.id.length > 0 && !ids.has(message.id)); ids.add(message.id);
      require(['user', 'assistant', 'system', 'tool'].includes(message.role) && typeof message.text === 'string');
      if (message.role !== 'tool') continue;
      require(message.tool && typeof message.tool === 'object' && !Array.isArray(message.tool));
      require(typeof message.tool.name === 'string' && message.tool.name.length > 0);
      require(typeof message.tool.callId === 'string' && message.tool.callId.length > 0);
      require(['running', 'success', 'error', 'unknown'].includes(message.tool.status));
      tools++; caseTools++;
    }
    require(caseTools > 0);
  }
  return { backends: value.cases.length, tools };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3 || !['--write', '--check'].includes(process.argv[2])) throw new Error('Supply --write or --check');
  const generated = await sdkHistoryFixture();
  if (process.argv[2] === '--write') await writeFile(fixtureURL, JSON.stringify(generated, null, 2) + '\n');
  else {
    const saved = JSON.parse(await readFile(fixtureURL, 'utf8'));
    validateSDKHistoryFixture(saved);
    if (JSON.stringify(generated) !== JSON.stringify(saved)) throw new Error('Native SDK history fixture drifted');
  }
  const { backends, tools } = validateSDKHistoryFixture(generated);
  console.log(`Verified native history producers: ${backends} backends, ${tools} tool rows`);
}
