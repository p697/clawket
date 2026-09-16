import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { HermesLocalBridge } from './index.js';
import { cleanupTempDirectories, createTempDirectory } from './test-helpers.js';

const bridges: HermesLocalBridge[] = [];
afterEach(async () => {
  await Promise.all(bridges.splice(0).map(bridge => bridge.stop()));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await cleanupTempDirectories();
});

async function setup() {
  const root = await createTempDirectory();
  const bridge = new HermesLocalBridge({ hermesHomePath: root, hermesSourcePath: root,
    sessionStorePath: join(root, 'sessions.json'), usageLedgerPath: join(root, 'usage.json') });
  bridges.push(bridge);
  const session = bridge.sessionStore.ensureSession('main');
  vi.spyOn(bridge.nativeSessions, 'readHistoryBySessionId').mockResolvedValue(null);
  vi.spyOn(bridge, 'getSafeHermesThinkingLevel').mockResolvedValue('medium');
  vi.spyOn(bridge, 'readHermesSessionUsageSnapshot').mockReturnValue(null);
  vi.spyOn(bridge, 'recordHermesRunUsageDelta').mockImplementation(() => undefined);
  return { bridge, session };
}

it('recovers an actual streaming run after a client leaves, without another send', async () => {
  const { bridge, session } = await setup();
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { source = controller; } });
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json({ run_id: 'live-run' }))
    .mockResolvedValueOnce(new Response(stream));
  vi.stubGlobal('fetch', fetchMock);
  await bridge.handleChatSend({ sessionKey: 'main', message: 'fixture', idempotencyKey: 'once' });
  source.enqueue(new TextEncoder().encode('data: {"event":"message.delta","delta":"still working"}\n\n'));
  await vi.waitFor(() => expect(bridge.activeRuns.get('live-run')?.text).toBe('still working'));
  const timestamp = Date.now();
  source.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ event: 'tool.started',
    tool: 'terminal', timestamp: timestamp / 1000, preview: 'sleep 90' })}\n\n`));
  await vi.waitFor(() => expect(bridge.activeRuns.get('live-run')?.tools?.size).toBe(1));
  vi.mocked(bridge.nativeSessions.readHistoryBySessionId).mockResolvedValue({
    sessionId: session.sessionId, title: 'Main', updatedAt: timestamp, messages: [
      { role: 'assistant', timestamp, content: [{ type: 'toolCall', id: 'native-id', name: 'terminal', arguments: { command: 'sleep 90' } }] },
    ],
  });
  const history = await bridge.dispatchRequest('chat.history', { sessionKey: 'main' });
  expect(history).toMatchObject({ hasActiveRun: true, inFlightRun: {
    runId: 'live-run', text: 'still working', startedAt: expect.any(Number), sessionAbortable: true,
  } });
  expect(history).toMatchObject({ toolCallAliases: { 'native-id': 'live-run:tool:1' } });
  bridge.sessionStore.rememberToolAliases('main', { 'outside-page': { toolCallId: 'other-run:tool:1' } });
  expect((await bridge.getHermesSessionHistory('main', 50)).toolCallAliases)
    .toEqual({ 'native-id': 'live-run:tool:1' });
  expect((await bridge.getHermesSessionHistory('main', 50)).messages
    .find(message => Array.isArray(message.content))?.content).toEqual([
      { type: 'toolCall', id: 'live-run:tool:1', name: 'terminal', arguments: { command: 'sleep 90' } },
    ]);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  source.enqueue(new TextEncoder().encode('data: {"event":"run.failed","error":"fixture failure"}\n\n'));
  source.close();
  await vi.waitFor(() => expect(bridge.activeRuns.size).toBe(0));
  const settled = await bridge.getHermesSessionHistory('main', 50);
  expect(settled.hasActiveRun).toBe(false);
  expect(settled.inFlightRun).toBeUndefined();
  expect(settled.toolCallAliases).toEqual({ 'native-id': 'live-run:tool:1' });
});

it('does not resurrect a run ended during history reads or expose another session run', async () => {
  const { bridge, session } = await setup();
  const active = { runId: 'old', sessionKey: 'main', sessionId: session.sessionId,
    abortController: new AbortController(), startedAt: 1000, text: 'partial' };
  bridge.activeRuns.set('old', active);
  vi.mocked(bridge.getSafeHermesThinkingLevel).mockImplementation(async () => {
    bridge.activeRuns.delete('old');
    bridge.activeRuns.set('other', { ...active, runId: 'other', sessionKey: 'other' });
    return 'medium';
  });
  const history = await bridge.getHermesSessionHistory('main', 50);
  expect(history.hasActiveRun).toBe(false);
  expect(history.inFlightRun).toBeUndefined();
});
