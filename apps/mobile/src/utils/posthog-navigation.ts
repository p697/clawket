import type { NavigationState } from '@react-navigation/native';
import type { BackendKind } from '@clawket/agent-protocol';

type NavigationLikeRoute = {
  key?: string;
  name: string;
  params?: unknown;
  state?: NavigationLikeState | undefined;
};

type NavigationLikeState = {
  index?: number;
  routes: NavigationLikeRoute[];
};

type ScreenDefinition = {
  area:
    | 'onboarding'
    | 'roster'
    | 'thread'
    | 'settings'
    | 'account'
    | 'search'
    | 'paywall';
  kind: 'root' | 'detail' | 'modal';
  name: string;
};

type ActiveRouteSnapshot = {
  leafKey: string;
  leafName: string;
  leafParams: unknown;
};

export type ScreenTrackingContext = {
  backend?: BackendKind | null;
};

export type TrackedScreen = {
  area: ScreenDefinition['area'];
  kind: ScreenDefinition['kind'];
  name: string;
  routeName: string;
  uniqueKey: string;
  properties: {
    screen_area: ScreenDefinition['area'];
    screen_kind: ScreenDefinition['kind'];
    backend: BackendKind | 'unconfigured';
  };
};

export const TRACKED_SCREEN_DEFINITIONS: Record<string, ScreenDefinition> = {
  Onboarding: { name: 'Onboarding', area: 'onboarding', kind: 'root' },
  Roster: { name: 'Roster', area: 'roster', kind: 'root' },
  Thread: { name: 'Thread', area: 'thread', kind: 'detail' },
  SessionPanel: { name: 'SessionPanel', area: 'thread', kind: 'modal' },
  AgentSettings: { name: 'AgentSettings', area: 'settings', kind: 'root' },
  AgentSettingsSection: { name: 'AgentSettings', area: 'settings', kind: 'detail' },
  AccountSettings: { name: 'AccountSettings', area: 'account', kind: 'root' },
  AccountSettingsSection: { name: 'AccountSettings', area: 'account', kind: 'detail' },
  ReleaseNotes: { name: 'ReleaseNotes', area: 'account', kind: 'detail' },
  ChatAppearance: { name: 'ChatAppearance', area: 'account', kind: 'detail' },
  Search: { name: 'Search', area: 'search', kind: 'root' },
  MessageDetail: { name: 'Message Detail', area: 'search', kind: 'detail' },
  Paywall: { name: 'Paywall', area: 'paywall', kind: 'modal' },
};

function isNavigationState(value: unknown): value is NavigationLikeState {
  return Boolean(
    value
      && typeof value === 'object'
      && Array.isArray((value as NavigationLikeState).routes),
  );
}

function getActiveRouteSnapshot(
  state: NavigationLikeState | undefined,
): ActiveRouteSnapshot | null {
  if (!state) return null;
  const activeRoute = state.routes[state.index ?? 0];
  if (!activeRoute) return null;

  const nestedState = isNavigationState(activeRoute.state) ? activeRoute.state : undefined;
  if (nestedState) {
    return getActiveRouteSnapshot(nestedState) ?? {
      leafKey: activeRoute.key ?? activeRoute.name,
      leafName: activeRoute.name,
      leafParams: activeRoute.params,
    };
  }

  return {
    leafKey: activeRoute.key ?? activeRoute.name,
    leafName: activeRoute.name,
    leafParams: activeRoute.params,
  };
}

export function getActiveLeafRouteName(state: NavigationState | undefined): string | undefined {
  return getActiveRouteSnapshot(state as NavigationLikeState | undefined)?.leafName;
}

export function getTrackedScreen(
  state: NavigationState | undefined,
  context: ScreenTrackingContext = {},
): TrackedScreen | null {
  const snapshot = getActiveRouteSnapshot(state as NavigationLikeState | undefined);
  if (!snapshot) return null;

  const baseDefinition = TRACKED_SCREEN_DEFINITIONS[snapshot.leafName];
  if (!baseDefinition) return null;
  const definition = resolveParameterizedDefinition(
    snapshot.leafName,
    snapshot.leafParams,
    baseDefinition,
  );

  return buildTrackedScreen(snapshot.leafName, snapshot.leafKey, definition, context);
}

export function getManualTrackedScreen(
  routeName: 'SessionPanel' | 'Paywall',
  context: ScreenTrackingContext = {},
): TrackedScreen {
  const definition = TRACKED_SCREEN_DEFINITIONS[routeName];
  return buildTrackedScreen(routeName, `manual:${routeName}`, definition, context);
}

function buildTrackedScreen(
  routeName: string,
  routeKey: string,
  definition: ScreenDefinition,
  context: ScreenTrackingContext,
): TrackedScreen {
  return {
    name: definition.name,
    routeName,
    area: definition.area,
    kind: definition.kind,
    uniqueKey: `${routeKey}:${definition.name}`,
    properties: {
      screen_area: definition.area,
      screen_kind: definition.kind,
      backend: context.backend ?? 'unconfigured',
    },
  };
}

const AGENT_SETTINGS_SECTION_NAMES: Readonly<Record<string, string>> = Object.freeze({
  identity: 'Identity',
  models: 'Models',
  skills: 'Skills',
  cron: 'Cron',
  files: 'Files',
  usage: 'Usage',
  connection: 'ConnectionStatus',
  openclaw: 'OpenClawManage',
  tools: 'Tools',
  'channels-devices': 'ChannelsDevices',
  logs: 'Logs',
});

const ACCOUNT_SETTINGS_SECTION_NAMES: Readonly<Record<string, string>> = Object.freeze({
  pro: 'AccountPro',
  connections: 'AccountConnections',
  appearance: 'AccountAppearance',
  voice: 'AccountVoice',
  notifications: 'AccountNotifications',
  help: 'AccountHelp',
  community: 'AccountCommunity',
  about: 'AccountAbout',
  developer: 'AccountDeveloper',
});

function resolveParameterizedDefinition(
  routeName: string,
  params: unknown,
  fallback: ScreenDefinition,
): ScreenDefinition {
  const section = readStringParam(params, 'section');
  if (routeName === 'AgentSettingsSection' && section) {
    return {
      ...fallback,
      name: AGENT_SETTINGS_SECTION_NAMES[section] ?? fallback.name,
    };
  }
  if (routeName === 'AccountSettingsSection' && section) {
    return {
      ...fallback,
      name: ACCOUNT_SETTINGS_SECTION_NAMES[section] ?? fallback.name,
    };
  }
  return fallback;
}

function readStringParam(params: unknown, key: string): string | null {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null;
  const value = (params as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
