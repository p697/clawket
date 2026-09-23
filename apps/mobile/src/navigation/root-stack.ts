import type { BackendKind } from '@clawket/agent-protocol';

export type ThreadOrigin = 'roster' | 'panel' | 'search' | 'deeplink' | 'onboarding';

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

/** Sections with their own Agent Settings page; the connection row opens the shared Connection route. */
export type AgentSettingsDetailSection = Exclude<AgentSettingsSection, 'connection'>;

export type AccountSettingsSection =
  | 'pro'
  | 'connections'
  | 'help'
  | 'community'
  | 'about'
  | 'developer';

/** Sections with their own settings page; connections open the shared Connections route instead. */
export type AccountSettingsDetailSection = Exclude<AccountSettingsSection, 'connections'>;

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
    shareId?: string;
    /** One-shot reviewable input; never submitted automatically. */
    composerDraft?: { id: string; text: string; skill?: { name: string; invocation: string } };
    shortcut?: 'chat' | 'voice' | 'skills' | 'camera' | 'photos';
  };
  AgentSettings: { connectionId: string; agentId: string };
  AgentSettingsSection: {
    connectionId: string;
    agentId: string;
    section: AgentSettingsSection;
    action?: 'create-agent' | 'create-cron' | 'edit-cron' | 'discover-skills' | 'open-file' | 'skill-source';
    cronJobId?: string;
    /** Draft prompt carried from the Thread composer into the new cron job editor. */
    cronPrompt?: string;
    /** Workspace file opened on the full-page document reader (`open-file`). */
    fileName?: string;
    /** Skill whose SKILL.md opens on the document reader (`skill-source`); the name is its header subtitle. */
    skillKey?: string;
    skillName?: string;
    skillFilePath?: string;
  };
  Connections: undefined;
  Connection: { connectionId: string };
  AccountSettings: undefined;
  DesignSystem: undefined;
  AccountSettingsSection: { section: AccountSettingsDetailSection };
  ReleaseNotes: undefined;
  BridgeUpgrade: undefined;
  ChatAppearance: undefined;
  HelpCenter: undefined;
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
  'Connections',
  'Connection',
  'AccountSettings',
  'DesignSystem',
  'AccountSettingsSection',
  'ReleaseNotes',
  'BridgeUpgrade',
  'ChatAppearance',
  'HelpCenter',
  'Search',
  'MessageDetail',
  'Paywall',
] as const satisfies ReadonlyArray<keyof RootStackParamList>;

/** Reuse the owner's current conversation, including a task route and scroll state. */
export function findAgentChatReturnIndex(
  state: { index: number; routes: ReadonlyArray<{ name: string; params?: unknown }> },
  connectionId: string,
  agentId: string,
): number {
  for (let index = Math.min(state.index - 1, state.routes.length - 1); index >= 0; index--) {
    const route = state.routes[index];
    if (route.name !== 'Thread' || !route.params || typeof route.params !== 'object') continue;
    const params = route.params as Partial<RootStackParamList['Thread']>;
    if (params.connectionId === connectionId && params.agentId === agentId) return index;
  }
  return -1;
}
