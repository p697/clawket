import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixtureURL, sdkHistoryFixture, validateSDKHistoryFixture, validateProducerImports, validateTerminalProducer } from './sdk-history.mjs';

test('pure-producer loader rejects empty source and unexpected runtime dependencies', () => {
  assert.equal(validateProducerImports('export const value = 1;'), 'export const value = 1;');
  for (const source of ['', ' ', null, "import 'unexpected';", "import 'unexpected'", "import { readFile } from 'node:fs';",
    "const later = import('unexpected');", "const later = import /* unexpected */ ('unexpected');", "export { value } from 'unexpected';"]) {
    assert.throws(() => validateProducerImports(source));
  }
});

test('checked vectors match actual current Bridge history producers', async () => {
  const saved = JSON.parse(await readFile(fixtureURL, 'utf8'));
  assert.deepEqual(saved, await sdkHistoryFixture());
  assert.deepEqual(validateSDKHistoryFixture(saved), { backends: 3, tools: 8, terminalNotices: 3 });
});

test('empty, corrupt, duplicate and reduced inputs fail validation', async () => {
  const good = JSON.parse(await readFile(fixtureURL, 'utf8'));
  for (const bad of [null, [], {}, { ...good, version: 2 }, { ...good, synthetic: false }, { ...good, sourceDigests: {} },
    { ...good, cases: [] }, { ...good, cases: good.cases.slice(1) }]) assert.throws(() => validateSDKHistoryFixture(bad));
  for (const corrupt of [
    value => { value.cases[0].backend = 'pi'; },
    value => { value.cases[0].messages = []; },
    value => { value.cases[0].messages.push(value.cases[0].messages[0]); },
    value => { value.cases[0].messages.find(message => message.tool).tool = 'not a tool object'; },
    value => { value.cases[0].messages.find(message => message.tool).tool.status = 'completed'; },
    value => { value.cases[0].messages = value.cases[0].messages.filter(message => message.role !== 'tool'); },
    value => { value.sourceDigests['codex/history.ts'] = ''; },
    value => { value.terminalCases = []; },
    value => { value.terminalCases = value.terminalCases.slice(1); },
    value => { value.terminalCases[0].frame.payload.terminalMessage.role = 'assistant'; },
    value => { value.terminalCases[0].frame.payload.terminalMessage.id = ''; },
    value => { value.terminalCases[0].frame.payload.message.content = 'Different compatibility copy'; },
    value => { value.terminalCases[0].historyMessage.text = 'Different history source'; },
  ]) { const bad = structuredClone(good); corrupt(bad); assert.throws(() => validateSDKHistoryFixture(bad)); }
});

test('terminal vectors reject a changed or missing finish producer rather than silently fabricating a wire contract', () => {
  const source = "const terminalMessage = stopReason === 'error' ? codexTurnFailure(turn) : undefined; message: { role: 'assistant', content: terminalMessage.text }";
  assert.doesNotThrow(() => validateTerminalProducer(source));
  for (const bad of [null, '', 'unrelated', source.replace("stopReason === 'error'", 'true'),
    source.replace('terminalMessage.text', 'other.text')]) assert.throws(() => validateTerminalProducer(bad));
});
