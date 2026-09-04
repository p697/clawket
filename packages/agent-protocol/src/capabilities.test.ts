import { describe, expect, it } from 'vitest';
import {
  AdapterError,
  CAPABILITY_KEYS,
  CAPABILITY_MATRIX,
  resolveCapabilities,
  type Capability,
} from './index';

function enabled(backend: keyof typeof CAPABILITY_MATRIX): Capability[] {
  return CAPABILITY_KEYS.filter((key) => CAPABILITY_MATRIX[backend][key]);
}

describe('canonical capability contract', () => {
  it('publishes the frozen product matrix without conflating Hermes with legacy UI flags', () => {
    expect(enabled('openclaw')).toEqual(CAPABILITY_KEYS);
    expect(enabled('hermes')).toEqual([
      'chat',
      'abort',
      'history',
      'attachments',
      'sessions',
      'sessionCreate',
      'sessionRename',
      'sessionReset',
      'sessionDelete',
      'agents',
      'models',
      'thinkingLevels',
      'skills',
      'skillDiscover',
      'skillInstall',
      'cron',
      'cronCreate',
      'files',
      'fileEdit',
      'usage',
      'cost',
    ]);
    expect(enabled('youmind')).toEqual(['chat', 'abort', 'history']);
  });

  it('allows runtime evidence to downgrade, never upgrade, backend capability policy', () => {
    expect(resolveCapabilities('openclaw').chat).toBe(true);
    expect(resolveCapabilities('openclaw', { chat: false, logs: false })).toMatchObject({
      chat: false,
      logs: false,
    });
    expect(resolveCapabilities('youmind', { chat: true, files: true })).toMatchObject({
      chat: true,
      files: false,
    });
  });

  it('provides a typed adapter error with a stable code', () => {
    const error = new AdapterError('bridge_offline', 'Bridge unavailable');
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: 'AdapterError',
      code: 'bridge_offline',
      message: 'Bridge unavailable',
    });
  });
});
