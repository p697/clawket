import { expect, it, vi } from 'vitest';
import { activateUpdate, type UpdateTarget } from './update-transaction.js';
function fixture(backend: string, running = true): UpdateTarget {
  return { backend, running, previousEntry: `/old/${backend}`, previousVersion: '3.1.10', preflight: vi.fn(async () => {}), stop: vi.fn(async () => {}), start: vi.fn(async () => {}), verify: vi.fn(async () => {}) };
}
it('preflights all owners before touching any running process', async () => {
  const first = fixture('openclaw'), second = fixture('hermes'); second.preflight = vi.fn(async () => { throw new Error('uncertain'); });
  await expect(activateUpdate([first, second], '/new', '3.1.11')).rejects.toThrow('uncertain'); expect(first.stop).not.toHaveBeenCalled();
});
it('restores Hermes before Relay/watchdog and keeps stopped scopes stopped', async () => {
  const targets = [fixture('openclaw'), fixture('hermes-relay'), fixture('hermes'), fixture('codex', false)], calls: string[] = [];
  for (const t of targets) { t.stop = vi.fn(async () => { calls.push(`stop:${t.backend}`); }); t.start = vi.fn(async () => { calls.push(`start:${t.backend}`); }); }
  const result = await activateUpdate(targets, '/new', '3.1.11');
  expect(calls).toEqual(['stop:openclaw', 'stop:hermes-relay', 'stop:hermes', 'start:hermes', 'start:hermes-relay', 'start:openclaw']); expect(result.at(-1)).toEqual({ backend: 'codex', state: 'stopped' });
});
it('rolls back a partially started replacement to its captured source and verifies the old version', async () => {
  const first = fixture('codex'), second = fixture('pi'); vi.mocked(second.start).mockRejectedValueOnce(new Error('partial start'));
  const result = await activateUpdate([first, second], '/new', '3.1.11');
  expect(first.start).toHaveBeenLastCalledWith('/old/codex'); expect(first.verify).toHaveBeenLastCalledWith('3.1.10'); expect(second.stop).toHaveBeenCalledTimes(2); expect(second.start).toHaveBeenLastCalledWith('/old/pi'); expect(result.every(r => r.state === 'restored')).toBe(true);
});
it('does not create a second owner after an unverified replacement stop, including same-backend scopes', async () => {
  const first = fixture('codex'), second = fixture('codex'); vi.mocked(first.stop).mockResolvedValueOnce().mockRejectedValueOnce(new Error('timeout')); vi.mocked(second.verify).mockRejectedValueOnce(new Error('wrong version'));
  const result = await activateUpdate([first, second], '/new', '3.1.11');
  expect(first.start).toHaveBeenCalledTimes(1); expect(second.start).toHaveBeenCalledTimes(2); expect(result).toContainEqual({ backend: 'codex', state: 'failed', reason: 'replacement_stop_unverified' });
});
it('reports independently supervised installations as manual instead of claiming all updated', async () => {
  const manual = { ...fixture('local-model', false), manual: true }; expect(await activateUpdate([manual], '/new', '3.1.11')).toEqual([{ backend: 'local-model', state: 'manual' }]); expect(manual.start).not.toHaveBeenCalled();
});
it('refreshes stopped registrations without starting them and rolls back if one refresh fails', async () => {
  const stopped = fixture('openclaw', false), restore = vi.fn(); stopped.prepareStopped = vi.fn(async () => restore);
  expect(await activateUpdate([stopped], '/new', '3.1.11')).toEqual([{ backend: 'openclaw', state: 'stopped' }]);
  expect(stopped.start).not.toHaveBeenCalled(); expect(stopped.prepareStopped).toHaveBeenCalledWith('/new');
  const broken = fixture('pi', false); broken.prepareStopped = async () => { throw new Error('failed registration'); };
  const running = fixture('codex');
  const result = await activateUpdate([stopped, running, broken], '/new', '3.1.11');
  expect(restore).toHaveBeenCalledOnce(); expect(running.start).toHaveBeenLastCalledWith('/old/codex');
  expect(result).toContainEqual({ backend: 'pi', state: 'failed', reason: 'registration_update_unverified' });
});
it('verifies legacy restoration through captured ownership instead of assuming success', async () => {
  const legacy = fixture('pi'); delete legacy.previousVersion; legacy.verifyPrevious = vi.fn(async () => { throw new Error('unverified'); });
  vi.mocked(legacy.verify).mockRejectedValueOnce(new Error('failed candidate'));
  expect(await activateUpdate([legacy], '/new', '3.1.11')).toEqual([{ backend: 'pi', state: 'failed', reason: 'restore_unverified' }]);
  expect(legacy.verifyPrevious).toHaveBeenCalledOnce();
});
it('stops independent agents first and names a busy one without touching the shared service', async () => {
  const targets = [fixture('openclaw'), fixture('hermes-relay'), fixture('hermes'), fixture('codex')], calls: string[] = [];
  for (const t of targets) { t.stop = vi.fn(async () => { calls.push(`stop:${t.backend}`); }); t.start = vi.fn(async () => { calls.push(`start:${t.backend}`); }); }
  await activateUpdate(targets, '/new', '3.1.14');
  expect(calls).toEqual(['stop:codex', 'stop:openclaw', 'stop:hermes-relay', 'stop:hermes', 'start:codex', 'start:hermes', 'start:hermes-relay', 'start:openclaw']);
  calls.length = 0;
  vi.mocked(targets[3].stop).mockImplementationOnce(async () => { calls.push('stop:codex'); throw Object.assign(new Error('busy'), { code: 'BRIDGE_BUSY' }); });
  expect(await activateUpdate(targets, '/new', '3.1.14')).toEqual([
    { backend: 'openclaw', state: 'failed', reason: 'update_not_applied' }, { backend: 'hermes-relay', state: 'failed', reason: 'update_not_applied' },
    { backend: 'hermes', state: 'failed', reason: 'update_not_applied' }, { backend: 'codex', state: 'failed', reason: 'busy' },
  ]);
  expect(calls).toEqual(['stop:codex']);
});
it('reports the version a restored source actually runs', async () => {
  const restored = fixture('hermes'); restored.verifyRestored = vi.fn(async () => '3.1.13');
  vi.mocked(restored.verify).mockRejectedValueOnce(new Error('failed candidate'));
  expect(await activateUpdate([restored], '/new', '3.1.14')).toEqual([{ backend: 'hermes', state: 'restored', version: '3.1.13' }]);
  expect(restored.start).toHaveBeenLastCalledWith('/old/hermes'); expect(restored.verify).toHaveBeenCalledOnce();
});
