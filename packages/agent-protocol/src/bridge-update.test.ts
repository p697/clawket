import { describe, expect, it } from 'vitest';
import { isBridgeUpdateFinished, parseBridgeUpdateStart, parseBridgeUpdateStatus } from './index';

const id = '5b0c7a0e-3c1f-4e8e-9b2a-6f1d2c3b4a59';
describe('phone-started Bridge update status', () => {
  it('keeps only bounded, allowlisted fields', () => {
    expect(parseBridgeUpdateStatus({ id, state: 'waiting', startedAt: 1, version: '3.1.14', waitingFor: 'codex', reason: 'busy', path: '/Users/private', token: 'secret',
      results: [{ backend: 'codex', state: 'failed', reason: 'busy', version: '3.1.13', message: 'native error' }, { backend: '/tmp/x', state: 'updated' }] }))
      .toEqual({ id, state: 'waiting', startedAt: 1, version: '3.1.14', waitingFor: 'codex', reason: 'busy', results: [{ backend: 'codex', state: 'failed', reason: 'busy', version: '3.1.13' }] });
    expect(parseBridgeUpdateStatus({ id, state: 'updated', startedAt: 1, finishedAt: 2, version: 'latest', reason: 'Error: EACCES /Users/private', results: Array(17).fill({ backend: 'pi', state: 'updated' }) }))
      .toEqual({ id, state: 'updated', startedAt: 1, finishedAt: 2 });
  });

  it('rejects malformed status and start replies', () => {
    for (const value of [null, [], { id: 'not-an-id', state: 'updated', startedAt: 1 }, { id, state: 'done', startedAt: 1 }, { id, state: 'updated', startedAt: -1 }]) expect(parseBridgeUpdateStatus(value)).toBeNull();
    expect(parseBridgeUpdateStart({ accepted: true })).toBeNull();
    expect(parseBridgeUpdateStart({ accepted: false, reason: 'whatever' })).toBeNull();
    expect(parseBridgeUpdateStart({ accepted: false, reason: 'disabled' })).toEqual({ accepted: false, reason: 'disabled' });
    expect(parseBridgeUpdateStart({ accepted: true, status: { id, state: 'checking', startedAt: 5 } })).toEqual({ accepted: true, status: { id, state: 'checking', startedAt: 5 } });
  });

  it('treats only updated and failed as finished', () => {
    expect(['checking', 'installing', 'waiting', 'restarting'].some(state => isBridgeUpdateFinished({ id, state: state as any, startedAt: 1 }))).toBe(false);
    expect(isBridgeUpdateFinished({ id, state: 'failed', startedAt: 1, reason: 'busy' })).toBe(true);
  });
});
