import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { HermesBridgeSessionStore } from './session-store.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { correlateActiveNativeTools, correlateLateNativeTools } from './tool-history.js';
import { HermesLocalBridge } from './index.js';
import { cleanupTempDirectories, createTempDirectory } from './test-helpers.js';
const bridges: HermesLocalBridge[] = [];

it('aliases active tools before their result exists, but never guesses between repeated calls', () => {
  const call = { role: 'assistant', timestamp: 1000, content: [
    { type: 'toolCall', id: 'native', name: 'terminal', arguments: { command: 'sleep 90' } },
  ] };
  const tool = { toolCallId: 'live', toolName: 'terminal', startedAt: 1001, args: 'sleep 90' };
  expect(correlateActiveNativeTools([call], [tool])).toEqual({ native: { toolCallId: 'live', toolName: 'terminal' } });
  expect(correlateActiveNativeTools([call], [tool, { ...tool, toolCallId: 'other' }])).toEqual({});
  expect(correlateActiveNativeTools([call, { ...call, content: [{ ...call.content[0]!, id: 'other' }] }], [tool])).toEqual({});
  expect(correlateActiveNativeTools([call], [{ ...tool, args: 'sleep...' }])).toEqual({});
  expect(correlateActiveNativeTools([call], [{ ...tool, startedAt: 50_000 }])).toEqual({});
});
afterEach(async () => {
  await Promise.all(bridges.splice(0).map(bridge => bridge.stop()));
  vi.unstubAllGlobals(); vi.restoreAllMocks(); await cleanupTempDirectories();
});
describe('Hermes tool history reconciliation', () => {
  it.each([[1, true], [1000, true], [1, false]] as const)('normalizes tool identity (wire scale %s, native persisted %s)', async (scale, persisted) => {
    const root = await createTempDirectory();
    const bridge = new HermesLocalBridge({ hermesHomePath: root, hermesSourcePath: root,
      sessionStorePath: join(root, 'sessions.json'), usageLedgerPath: join(root, 'usage.json') });
    bridges.push(bridge);
    const session = bridge.sessionStore.createSession({ key: 'main' });
    const seconds = 1789315062, timestamp = seconds * 1000, output = '338350';
    vi.spyOn(bridge, 'readHermesToolOutputsFromLocalState').mockResolvedValue(persisted ? [
      { toolCallId: 'native-call', toolName: 'terminal', content: output, timestampMs: timestamp + 200 },
    ] : []);
    vi.spyOn(bridge, 'getSafeHermesThinkingLevel').mockResolvedValue('medium');
    vi.spyOn(bridge, 'recordHermesRunUsageDelta').mockImplementation(() => undefined);
    const events = vi.spyOn(bridge, 'broadcastEvent');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response([
      { event: 'tool.started', timestamp: seconds * scale, tool: 'terminal', preview: 'python3 -c test' },
      { event: 'tool.completed', timestamp: (seconds + 0.2) * scale, tool: 'terminal', duration: 0.2 },
      { event: 'run.completed', output: 'Done' },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))));
    await bridge.streamRunEvents('run-tools', session.key, session.sessionId, timestamp, new AbortController().signal);
    const local = bridge.sessionStore.getHistory(session.key).messages.find(message => message.role === 'toolResult')!;
    expect(local).toMatchObject({ ts: timestamp + 200, toolDurationMs: 200,
      toolStartedAt: timestamp, toolFinishedAt: timestamp + 200,
      toolCallId: 'run-tools:tool:1', ...(persisted ? { _nativeToolCallId: 'native-call', content: output } : {}) });
    expect(events.mock.calls.filter(([event]) => event === 'agent').every(([, payload]) => (payload as { ts: number }).ts >= timestamp)).toBe(true);
    vi.spyOn(bridge.nativeSessions, 'readHistoryBySessionId').mockResolvedValue({
      sessionId: session.sessionId, title: 'Main', updatedAt: timestamp + 200,
      messages: [
        { role: 'assistant', content: [{ type: 'toolCall', id: 'native-call', name: 'terminal', arguments: 'python3 -c test' }], timestamp, _nativeId: '1' },
        { role: 'toolResult', content: output, toolCallId: 'native-call', timestamp: timestamp + 200, _nativeId: '2' },
      ],
    });
    const history = await bridge.getHermesSessionHistory(session.key, 50);
    expect(history.messages.filter(message => message.role === 'toolResult')).toHaveLength(1);
    expect(history.messages.find(message => Array.isArray(message.content))?.content).toEqual([
      { type: 'toolCall', id: 'run-tools:tool:1', name: 'terminal', arguments: 'python3 -c test' },
    ]);
    expect(history.messages.find(message => message.role === 'toolResult')?.toolCallId).toBe('run-tools:tool:1');
    expect(history.messages.some(message => '_nativeToolCallId' in message)).toBe(false);
    await bridge.sessionStore.flush();
    const storePath = join(root, 'sessions.json');
    const restored = new HermesLocalBridge({ hermesHomePath: root, hermesSourcePath: root, sessionStorePath: storePath, usageLedgerPath: join(root, 'usage-restored.json') });
    bridges.push(restored);
    vi.spyOn(restored.nativeSessions, 'readHistoryBySessionId').mockImplementation(id => bridge.nativeSessions.readHistoryBySessionId(id));
    const restoredHistory = await restored.getHermesSessionHistory(session.key, 50);
    expect(restoredHistory.messages.find(message => message.role === 'toolResult')?.toolCallId).toBe('run-tools:tool:1');
    expect(JSON.parse(readFileSync(storePath, 'utf8')).sessions[0].messages).toBeUndefined();
  });
});

it('bounds alias metadata and rejects corrupt alias records without dropping a session', async () => {
  const root = await createTempDirectory();
  const path = join(root, 'aliases.json');
  const store = new HermesBridgeSessionStore(path);
  store.ensureSession('main');
  store.rememberToolAliases('main', Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`native-${i}`, { toolCallId: `live-${i}` }])));
  await store.flush();
  expect(Object.keys(store.findSession('main')!.toolAliases!)).toHaveLength(512);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  data.sessions[0].toolAliases = { broken: { toolCallId: 42 }, good: { toolCallId: 'live', secret: 'discard' } };
  writeFileSync(path, JSON.stringify(data));
  const loaded = new HermesBridgeSessionStore(path);
  expect(loaded.findSession('main')?.toolAliases).toEqual({ good: { toolCallId: 'live' } });
  loaded.resetSession('main');
  expect(loaded.findSession('main')?.toolAliases).toEqual({});
  await loaded.flush();
});

 it('does not correlate ambiguous repeated commands or truncated previews', () => {
   const native = ['one', 'two'].flatMap(id => [
     { role: 'assistant', timestamp: 1000, content: [{ type: 'toolCall', id, name: 'terminal', arguments: '{"command":"echo test"}' }] },
     { role: 'toolResult', timestamp: 1100, content: 'test', toolCallId: id },
   ]);
   const local = [{ role: 'toolResult', timestamp: 1100, content: '', toolCallId: 'live', toolName: 'terminal', toolArgs: 'echo test' }];
   expect(correlateLateNativeTools(native, local)).toEqual(local);
   const truncated = [{ ...local[0]!, toolArgs: 'echo...' }];
   expect(correlateLateNativeTools(native.slice(0, 2), truncated)).toEqual(truncated);
 });
