import { describe, expect, it } from 'vitest';
import { isBridgeUpdateFinished, parseBridgeUpdateStart, parseBridgeUpdateStatus } from './index';

const id = '5b0c7a0e-3c1f-4e8e-9b2a-6f1d2c3b4a59';
describe('phone-started Bridge update status', () => {
  it('keeps only bounded, allowlisted fields', () => {
    expect(parseBridgeUpdateStatus({ id, state: 'failed', startedAt: 1, version: '3.1.14', waitingFor: 'codex', reason: 'not_confirmed', path: '/Users/private', token: 'secret',
      results: [{ backend: 'codex', state: 'failed', reason: 'stop_unverified', version: '3.1.13', message: 'native error' }, { backend: '/tmp/x', state: 'updated' }] }))
      .toEqual({ id, state: 'failed', startedAt: 1, version: '3.1.14', reason: 'not_confirmed', results: [{ backend: 'codex', state: 'failed', reason: 'stop_unverified', version: '3.1.13' }] });
    expect(parseBridgeUpdateStatus({ id, state: 'updated', startedAt: 1, finishedAt: 2, version: 'latest', reason: 'Error: EACCES /Users/private', results: Array(17).fill({ backend: 'pi', state: 'updated' }) }))
      .toEqual({ id, state: 'updated', startedAt: 1, finishedAt: 2 });
  });

  it('rejects malformed status and start replies', () => {
    for (const value of [null, [], { id: 'not-an-id', state: 'updated', startedAt: 1 }, { id, state: 'done', startedAt: 1 }, { id, state: 'updated', startedAt: -1 }]) expect(parseBridgeUpdateStatus(value)).toBeNull();
    // Updates no longer wait for replies, so the retired waiting stage and busy outcome are never shown.
    expect(parseBridgeUpdateStatus({ id, state: 'waiting', startedAt: 1 })).toBeNull();
    expect(parseBridgeUpdateStatus({ id, state: 'failed', startedAt: 1, reason: 'busy', results: [{ backend: 'codex', state: 'failed', reason: 'busy' }] }))
      .toEqual({ id, state: 'failed', startedAt: 1, results: [{ backend: 'codex', state: 'failed' }] });
    expect(parseBridgeUpdateStart({ accepted: true })).toBeNull();
    expect(parseBridgeUpdateStart({ accepted: false, reason: 'whatever' })).toBeNull();
    expect(parseBridgeUpdateStart({ accepted: false, reason: 'disabled' })).toEqual({ accepted: false, reason: 'disabled' });
    expect(parseBridgeUpdateStart({ accepted: true, status: { id, state: 'checking', startedAt: 5 } })).toEqual({ accepted: true, status: { id, state: 'checking', startedAt: 5 } });
  });

  it('drops malformed result rows and fields while keeping the valid ones', () => {
    expect(parseBridgeUpdateStatus({ id, state: 'failed', startedAt: 1, results: [null, 'codex', { backend: 'pi', state: 'restored', reason: 'Error: EACCES /Users/private', version: 3 },
      { backend: 'hermes', state: 'failed', reason: 7, version: 'latest' }] }))
      .toEqual({ id, state: 'failed', startedAt: 1, results: [{ backend: 'pi', state: 'restored' }, { backend: 'hermes', state: 'failed' }] });
  });

  it('keeps the progress of a run that is already in progress', () => {
    const status = { id, state: 'installing', startedAt: 3, version: '3.1.14' };
    for (const value of [null, 'accepted', 1]) expect(parseBridgeUpdateStart(value)).toBeNull();
    expect(parseBridgeUpdateStart({ accepted: false, reason: 'running', status })).toEqual({ accepted: false, reason: 'running', status });
    expect(parseBridgeUpdateStart({ accepted: false, reason: 'running', status: { id: 'bad' } })).toEqual({ accepted: false, reason: 'running' });
  });

  it('treats only updated and failed as finished', () => {
    expect(['checking', 'installing', 'restarting'].some(state => isBridgeUpdateFinished({ id, state: state as any, startedAt: 1 }))).toBe(false);
    expect(isBridgeUpdateFinished({ id, state: 'failed', startedAt: 1, reason: 'download' })).toBe(true);
  });
});
