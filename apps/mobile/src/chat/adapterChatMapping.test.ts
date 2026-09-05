import type { SessionDescriptor } from '@clawket/agent-protocol';
import { mapAdapterSession, mapAdapterSessionPatch } from './adapterChatMapping';

const DESCRIPTOR: SessionDescriptor = {
  connectionId: 'connection-1',
  agentId: 'atlas',
  key: 'agent:atlas:cron:daily-report',
  kind: 'cron',
  title: 'Daily report',
  channel: 'cron',
  updatedAt: 1_780_000_000_000,
  preview: 'Finished report',
  model: 'sonnet',
  modelProvider: 'anthropic',
  sessionId: 'session-1',
  hasActiveRun: false,
  attention: 'cron_failed',
  parentSessionKey: 'agent:atlas:main',
  source: 'bridge',
  allowedActions: {
    rename: true,
    reset: false,
    delete: true,
    pin: false,
  },
};

describe('adapter chat session mapping', () => {
  it('preserves the complete backend-neutral session descriptor', () => {
    expect(mapAdapterSession(DESCRIPTOR)).toEqual({
      connectionId: 'connection-1',
      agentId: 'atlas',
      key: 'agent:atlas:cron:daily-report',
      kind: 'cron',
      label: 'Daily report',
      title: 'Daily report',
      channel: 'cron',
      updatedAt: 1_780_000_000_000,
      lastMessagePreview: 'Finished report',
      model: 'sonnet',
      modelProvider: 'anthropic',
      sessionId: 'session-1',
      hasActiveRun: false,
      attention: 'cron_failed',
      parentSessionKey: 'agent:atlas:main',
      spawnedBy: 'agent:atlas:main',
      source: 'bridge',
      allowedActions: {
        rename: true,
        reset: false,
        delete: true,
        pin: false,
      },
    });
  });

  it('keeps explicit false and null values in additive session patches', () => {
    expect(mapAdapterSessionPatch({
      key: DESCRIPTOR.key,
      kind: 'cron',
      hasActiveRun: false,
      attention: null,
      parentSessionKey: 'agent:atlas:main',
      allowedActions: {
        rename: false,
        reset: false,
        delete: false,
        pin: false,
      },
    })).toEqual({
      key: DESCRIPTOR.key,
      kind: 'cron',
      hasActiveRun: false,
      attention: null,
      parentSessionKey: 'agent:atlas:main',
      spawnedBy: 'agent:atlas:main',
      allowedActions: {
        rename: false,
        reset: false,
        delete: false,
        pin: false,
      },
    });
  });
});
