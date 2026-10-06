import { describe, expect, it, vi } from 'vitest';
import { handleRemoteUpdateRequest, isRemoteUpdateMethod, remoteUpdateHealth, type RemoteUpdateControl } from './remote-update.js';

const status = { id: '5b0c7a0e-3c1f-4e8e-9b2a-6f1d2c3b4a59', state: 'checking' as const, startedAt: 1 };
function fakeRemoteUpdate(available = true): RemoteUpdateControl & { start: ReturnType<typeof vi.fn> } {
  return { available: () => available, start: vi.fn(async () => ({ accepted: true as const, status })), status: () => status };
}

describe('phone-started update requests', () => {
  it('recognizes only the two update methods and ignores their parameters', async () => {
    expect(['bridge.update.start', 'bridge.update.status'].every(isRemoteUpdateMethod)).toBe(true);
    expect(['bridge.stop', 'bridge.update', 'update', undefined].some(isRemoteUpdateMethod)).toBe(false);
    const control = fakeRemoteUpdate();
    expect(await handleRemoteUpdateRequest(control, 'bridge.update.start')).toEqual({ accepted: true, status });
    expect(await handleRemoteUpdateRequest(control, 'bridge.update.status')).toEqual({ status });
    expect(control.start).toHaveBeenCalledWith();
  });

  it('advertises and answers only while the computer allows it', async () => {
    expect(remoteUpdateHealth(fakeRemoteUpdate())).toEqual({ remoteUpdate: 1 });
    expect(remoteUpdateHealth(fakeRemoteUpdate(false))).toEqual({});
    expect(remoteUpdateHealth(undefined)).toEqual({});
    await expect(handleRemoteUpdateRequest(fakeRemoteUpdate(false), 'bridge.update.start')).rejects.toThrow('unavailable');
    await expect(handleRemoteUpdateRequest(undefined, 'bridge.update.status')).rejects.toThrow('unavailable');
  });
});
