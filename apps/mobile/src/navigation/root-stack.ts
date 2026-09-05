import type { BackendKind } from '@clawket/agent-protocol';

export type ThreadOrigin = 'roster' | 'panel' | 'search' | 'notification' | 'deeplink' | 'onboarding';

export type AgentSettingsSection =
  | 'identity'
  | 'models'
  | 'skills'
  | 'cron'
  | 'files'
  | 'usage'
  | 'connection'
  | 'openclaw'
  | 'tools'
  | 'channels-devices'
  | 'logs';

export type AccountSettingsSection =
  | 'pro'
  | 'connections'
  | 'appearance'
  | 'voice'
  | 'notifications'
  | 'help'
  | 'community'
  | 'about'
  | 'developer';

export type RootStackParamList = {
  Onboarding: {
    presentation?: 'root' | 'modal';
    initialBackend?: BackendKind;
    pairingUrl?: string;
  } | undefined;
  Roster: undefined;
  Thread: {
    connectionId: string;
    agentId: string;
    sessionKey: string;
    from: ThreadOrigin;
  };
  AgentSettings: { connectionId: string; agentId: string };
  AgentSettingsSection: {
    connectionId: string;
    agentId: string;
    section: AgentSettingsSection;
    action?: 'create-agent';
  };
  AccountSettings: undefined;
  AccountSettingsSection: { section: AccountSettingsSection };
  ReleaseNotes: undefined;
  ChatAppearance: undefined;
  Search: { query?: string } | undefined;
  MessageDetail: {
    connectionId: string;
    sessionKey: string;
    messageId: string;
  };
  Paywall: { reason: string; resumeActionId?: string } | undefined;
};

export const ROOT_ROUTE_NAMES = [
  'Onboarding',
  'Roster',
  'Thread',
  'AgentSettings',
  'AgentSettingsSection',
  'AccountSettings',
  'AccountSettingsSection',
  'ReleaseNotes',
  'ChatAppearance',
  'Search',
  'MessageDetail',
  'Paywall',
] as const satisfies ReadonlyArray<keyof RootStackParamList>;
