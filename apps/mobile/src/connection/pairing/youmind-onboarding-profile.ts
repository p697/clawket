import type { ConnectionDescriptor } from '@clawket/agent-protocol';

import { analyticsEvents } from '../../services/analytics/events';
import type { YouMindAuthSession } from '../../services/storage';
import { YouMindSpriteApiClient } from '../adapters/youmind-sprite-api';
import type { ConnectionCoordinator } from '../index';
import { createConnectionId } from '../registry/connection-store';

const YOUMIND_BASE_URL = 'https://youmind.com';

export type YouMindOnboardingAuthSession = YouMindAuthSession;

export type YouMindEmailAuthClient = Readonly<{
  sendOtp(email: string): Promise<void>;
  verifyOtp(email: string, code: string): Promise<YouMindOnboardingAuthSession>;
}>;

export type YouMindOnboardingResult = Readonly<{
  backendKind: 'youmind';
  connectionId: string;
}>;

export type YouMindOnboardingConnection = Readonly<{
  client: YouMindEmailAuthClient;
  discard(): Promise<void>;
  finish(session: YouMindOnboardingAuthSession): Promise<YouMindOnboardingResult>;
}>;

type YouMindOnboardingRuntime = Pick<
  ConnectionCoordinator,
  'activate' | 'removeConnection' | 'upsertConnection'
>;

type YouMindOnboardingDependencies = Readonly<{
  baseUrl: string;
  connectionId: string;
  client: YouMindSpriteApiClient;
}>;

export function createYouMindOnboardingConnection(
  input: Readonly<{
    runtime: YouMindOnboardingRuntime;
    debugMode: boolean;
  }>,
  dependencies?: Partial<YouMindOnboardingDependencies>,
): YouMindOnboardingConnection {
  const baseUrl = dependencies?.baseUrl ?? YOUMIND_BASE_URL;
  const connectionId = dependencies?.connectionId ?? createConnectionId(Date.now(), Math.random());
  const client = dependencies?.client ?? new YouMindSpriteApiClient(baseUrl, connectionId);
  let discarded = false;
  let completed: YouMindOnboardingResult | null = null;
  let finishInFlight: Promise<YouMindOnboardingResult> | null = null;

  const discard = async (): Promise<void> => {
    if (discarded || completed) return;
    discarded = true;
    await client.clearSession();
  };

  const finishOnce = async (
    session: YouMindOnboardingAuthSession,
  ): Promise<YouMindOnboardingResult> => {
    if (discarded) {
      await client.clearSession();
      throw new Error('YouMind sign-in session is no longer active.');
    }
    let savedConnection: ConnectionDescriptor | null = null;
    try {
      const saved = await input.runtime.upsertConnection({
        id: connectionId,
        backendKind: 'youmind',
        transportKind: 'https',
        label: 'YouMind',
        url: baseUrl,
        youmind: { authScopeKey: connectionId },
        debugMode: input.debugMode,
      });
      savedConnection = saved.connection;
      if (discarded) {
        throw new Error('YouMind sign-in session is no longer active.');
      }
      const snapshot = await input.runtime.activate(saved.connection.id);
      if (discarded) {
        throw new Error('YouMind sign-in session is no longer active.');
      }
      if (snapshot.activeState !== 'ready') {
        throw new Error(snapshot.error?.message ?? 'YouMind Sprite is not responding.');
      }
      analyticsEvents.gatewayConnectSaved({
        is_editing: !saved.created,
        mode: 'https',
        has_password: false,
        has_token: false,
        source: 'onboarding_youmind',
      });
      completed = { connectionId: saved.connection.id, backendKind: 'youmind' };
      return completed;
    } catch (error) {
      await Promise.allSettled([
        ...(savedConnection ? [input.runtime.removeConnection(savedConnection.id)] : []),
        client.clearSession(),
      ]);
      throw error;
    }
  };

  return Object.freeze({
    client,
    discard,
    finish(session) {
      if (completed) return Promise.resolve(completed);
      if (finishInFlight) return finishInFlight;
      finishInFlight = finishOnce(session).finally(() => {
        finishInFlight = null;
      });
      return finishInFlight;
    },
  });
}
