import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HermesPythonRunner } from './python-runner.js';
import { HermesLocalBridge } from './index.js';
import { cleanupTempDirectories, createTempDirectory } from './test-helpers.js';

const runners: HermesPythonRunner[] = [];
const bridges: HermesLocalBridge[] = [];
afterEach(async () => {
  runners.splice(0).forEach(runner => runner.stop());
  await Promise.all(bridges.splice(0).map(bridge => bridge.stop()));
  await cleanupTempDirectories();
  vi.restoreAllMocks();
});
function runner(timeoutMs = 2000) {
  const value = new HermesPythonRunner({ hermesSourcePath: '/nonexistent-fixture',
    hermesHomePath: '/nonexistent-home', hermesPythonPath: (process.platform === 'win32' ? 'python' : 'python3'), timeoutMs });
  runners.push(value);
  return value;
}
async function bridge() {
  const directory = await createTempDirectory();
  const value = new HermesLocalBridge({ hermesSourcePath: directory, hermesHomePath: directory,
    hermesStateDbPath: join(directory, 'missing.db'), hermesPythonPath: (process.platform === 'win32' ? 'python' : 'python3'),
    sessionStorePath: join(directory, 'sessions.json'), usageLedgerPath: join(directory, 'usage.json') });
  bridges.push(value);
  return value;
}

describe('Hermes asynchronous operation lifecycle', () => {
  it('answers health while a real Python operation is still running', async () => {
    const subject = await bridge();
    let done = false;
    const operation = subject.runHermesPython('import time, json; time.sleep(0.3); print(json.dumps({"ok": True}))')
      .then(value => { done = true; return value; });
    await new Promise(resolve => setTimeout(resolve, 20));
    await expect(subject.dispatchRequest('health', {})).resolves.toHaveProperty('ts');
    expect(done).toBe(false);
    await expect(operation).resolves.toEqual({ ok: true });
  });
  it('bounds duration and rejects invalid JSON without exposing its contents', async () => {
    await expect(runner(60).run('import time; time.sleep(5)')).rejects.toThrow('Hermes operation failed');
    await expect(runner().run('print("private-invalid-payload")')).rejects.toThrow('Hermes returned an invalid operation response.');
  });
  it('cancels owned processes across stop/resume and permits subsequent work', async () => {
    const subject = runner();
    const pending = expect(subject.run('import time; time.sleep(5); print("true")')).rejects.toThrow('cancelled');
    subject.stop();
    subject.resume();
    await pending;
    await expect(subject.run('print("true")')).resolves.toBe(true);
  });
  it('bounds concurrent children and restores capacity after cancellation', async () => {
    const subject = runner();
    const pending = Array.from({ length: 8 }, () => expect(subject.run('import time; time.sleep(5)')).rejects.toThrow('cancelled'));
    await expect(subject.run('print("true")')).rejects.toThrow('busy');
    subject.stop();
    await Promise.all(pending);
    subject.resume();
    await expect(subject.run('print("true")')).resolves.toBe(true);
  });
  it('serializes whole configuration changes while health bypasses the queue', async () => {
    const subject = await bridge();
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const calls: number[] = [];
    vi.spyOn(subject, 'setHermesModel').mockImplementation(async payload => {
      calls.push(payload.sequence as number);
      if (payload.sequence === 1) await blocked;
      return {} as Awaited<ReturnType<typeof subject.setHermesModel>>;
    });
    const first = subject.dispatchRequest('model.set', { sequence: 1 });
    const second = subject.dispatchRequest('model.set', { sequence: 2 });
    await subject.dispatchRequest('health', {});
    expect(calls).toEqual([1]);
    release();
    await Promise.all([first, second]);
    expect(calls).toEqual([1, 2]);
  });
  it('aborts during history preparation before starting an upstream run', async () => {
    const subject = await bridge();
    let release!: () => void;
    vi.spyOn(subject, 'getHermesSessionHistory').mockImplementation(async () => {
      await new Promise<void>(resolve => { release = resolve; });
      return { messages: [], sessionId: 'main', thinkingLevel: 'medium' };
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const sending = subject.handleChatSend({ sessionKey: 'main', message: 'fixture' });
    subject.handleChatAbort({ sessionKey: 'main' });
    release();
    await expect(sending).rejects.toThrow('aborted');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(subject.sessionStore.findSession('main')?.messages).toEqual([]);
  });
  it('does not restore a final reply after cancellation during tool hydration', async () => {
    const subject = await bridge();
    const session = subject.sessionStore.ensureSession('main');
    const controller = new AbortController();
    subject.activeRuns.set('run-fixture', { runId: 'run-fixture', sessionKey: 'main',
      sessionId: session.sessionId, abortController: controller, usageBaseline: null });
    let release!: () => void;
    let entered!: () => void;
    const hydrationStarted = new Promise<void>(resolve => { entered = resolve; });
    vi.spyOn(subject, 'hydrateToolOutputsFromHermesState').mockImplementation(async () => {
      entered();
      await new Promise<void>(resolve => { release = resolve; });
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('data: {"event":"run.completed","output":"stale"}\n\n'));
    const broadcast = vi.spyOn(subject, 'broadcastEvent');
    const streaming = subject.streamRunEvents('run-fixture', 'main', session.sessionId, Date.now(), controller.signal);
    await hydrationStarted;
    subject.handleChatAbort({ sessionKey: 'main' });
    release();
    await streaming;
    expect(subject.sessionStore.findSession('main')?.messages).toEqual([]);
    expect(broadcast.mock.calls.filter(([event, payload]) => event === 'chat' && (payload as {state?: string}).state === 'final')).toEqual([]);
  });

});
