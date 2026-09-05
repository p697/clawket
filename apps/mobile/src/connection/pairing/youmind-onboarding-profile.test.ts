import type { ConnectionDescriptor } from '@clawket/agent-protocol';

import type { YouMindSpriteApiClient } from '../adapters/youmind-sprite-api';
import { createYouMindOnboardingConnection } from './youmind-onboarding-profile';

const mockGatewayConnectSaved = jest.fn();

jest.mock('../../services/analytics/events', () => ({
  analyticsEvents: {
    gatewayConnectSaved: (...args: unknown[]) => mockGatewayConnectSaved(...args),
  },
}));

const session = {
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresIn: 3600,
  createdAtMs: 1,
  user: { id: 'user-1', email: ' lucy@example.com ' },
};

function descriptor(): ConnectionDescriptor {
  return {
    id: 'youmind-connection',
    backendKind: 'youmind',
    transportKind: 'https',
    label: 'YouMind (lucy@example.com)',
    createdAt: 1,
    isFreeSlot: true,
  };
}

function client() {
  return {
    sendOtp: jest.fn(async () => undefined),
    verifyOtp: jest.fn(async () => session),
    clearSession: jest.fn(async () => undefined),
  } as unknown as YouMindSpriteApiClient;
}

function runtime() {
  const connection = descriptor();
  return {
    upsertConnection: jest.fn(async () => ({ connection, created: true })),
    activate: jest.fn(async () => ({
      activeState: 'ready' as 'ready' | 'offline',
      error: null as { message: string } | null,
    })),
    removeConnection: jest.fn(async () => true),
  };
}

describe('YouMind onboarding connection profile', () => {
  beforeEach(() => jest.clearAllMocks());

  it('owns record creation, activation, and repeated completion inside the connection layer', async () => {
    const api = client();
    const coordinator = runtime();
    const flow = createYouMindOnboardingConnection({
      runtime: coordinator as never,
      debugMode: true,
    }, {
      baseUrl: 'https://youmind.com',
      connectionId: 'youmind-connection',
      client: api,
    });

    await expect(Promise.all([flow.finish(session), flow.finish(session)])).resolves.toEqual([
      { connectionId: 'youmind-connection', backendKind: 'youmind' },
      { connectionId: 'youmind-connection', backendKind: 'youmind' },
    ]);
    expect(coordinator.upsertConnection).toHaveBeenCalledTimes(1);
    expect(coordinator.upsertConnection).toHaveBeenCalledWith({
      id: 'youmind-connection',
      backendKind: 'youmind',
      transportKind: 'https',
      label: 'YouMind (lucy@example.com)',
      url: 'https://youmind.com',
      youmind: { authScopeKey: 'youmind-connection' },
      debugMode: true,
    });
    expect(coordinator.activate).toHaveBeenCalledWith('youmind-connection');
    expect(api.clearSession).not.toHaveBeenCalled();
    expect(mockGatewayConnectSaved).toHaveBeenCalledWith({
      is_editing: false,
      mode: 'https',
      has_password: false,
      has_token: false,
      source: 'onboarding_youmind',
    });
  });

  it('clears an abandoned auth scope without writing a connection', async () => {
    const api = client();
    const coordinator = runtime();
    const flow = createYouMindOnboardingConnection({
      runtime: coordinator as never,
      debugMode: false,
    }, {
      connectionId: 'youmind-connection',
      client: api,
    });

    await flow.discard();
    await expect(flow.finish(session)).rejects.toThrow('no longer active');
    expect(coordinator.upsertConnection).not.toHaveBeenCalled();
    expect(api.clearSession).toHaveBeenCalledTimes(2);
  });

  it('rolls back a write that finishes after the flow was discarded', async () => {
    const api = client();
    const coordinator = runtime();
    let resolveWrite: ((value: {
      connection: ConnectionDescriptor;
      created: boolean;
    }) => void) | undefined;
    coordinator.upsertConnection.mockImplementationOnce(() => new Promise((resolve) => {
      resolveWrite = resolve;
    }));
    const flow = createYouMindOnboardingConnection({
      runtime: coordinator as never,
      debugMode: false,
    }, {
      connectionId: 'youmind-connection',
      client: api,
    });

    const finish = flow.finish(session);
    await flow.discard();
    resolveWrite?.({ connection: descriptor(), created: true });

    await expect(finish).rejects.toThrow('no longer active');
    expect(coordinator.activate).not.toHaveBeenCalled();
    expect(coordinator.removeConnection).toHaveBeenCalledWith('youmind-connection');
    expect(api.clearSession).toHaveBeenCalledTimes(2);
  });

  it('rolls back the record and auth scope when activation does not become ready', async () => {
    const api = client();
    const coordinator = runtime();
    coordinator.activate.mockResolvedValueOnce({
      activeState: 'offline',
      error: { message: 'YouMind is offline' },
    });
    const flow = createYouMindOnboardingConnection({
      runtime: coordinator as never,
      debugMode: false,
    }, {
      connectionId: 'youmind-connection',
      client: api,
    });

    await expect(flow.finish(session)).rejects.toThrow('YouMind is offline');
    expect(coordinator.removeConnection).toHaveBeenCalledWith('youmind-connection');
    expect(api.clearSession).toHaveBeenCalledTimes(1);
  });
});
