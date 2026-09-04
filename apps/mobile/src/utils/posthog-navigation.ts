import type { NavigationState } from '@react-navigation/native';

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
    | 'agent_settings'
    | 'account_settings'
    | 'search'
    | 'paywall';
  kind: 'root' | 'detail' | 'modal';
  name: string;
};

type ActiveRouteSnapshot = {
  chain: string[];
  leafKey: string;
  leafName: string;
  leafParams: unknown;
};

export type TrackedScreen = {
  area: ScreenDefinition['area'];
  kind: ScreenDefinition['kind'];
  name: string;
  routeName: string;
  uniqueKey: string;
  properties: Record<string, boolean | string>;
};

export const TRACKED_SCREEN_DEFINITIONS: Record<string, ScreenDefinition> = {
  Onboarding: { name: 'Onboarding', area: 'onboarding', kind: 'root' },
  Roster: { name: 'Roster', area: 'roster', kind: 'root' },
  Thread: { name: 'Thread', area: 'thread', kind: 'detail' },
  AgentSettings: { name: 'Agent Settings', area: 'agent_settings', kind: 'root' },
  AgentSettingsSection: { name: 'Agent Settings Section', area: 'agent_settings', kind: 'detail' },
  AccountSettings: { name: 'Account Settings', area: 'account_settings', kind: 'root' },
  AccountSettingsSection: { name: 'Account Settings Section', area: 'account_settings', kind: 'detail' },
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

function isParamPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function toSnakeCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[\s-]+/g, '_').toLowerCase();
}

function buildParamPresenceProperties(params: unknown): Record<string, boolean> {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return {};
  return Object.entries(params).reduce<Record<string, boolean>>((acc, [key, value]) => {
    acc[`has_${toSnakeCase(key)}`] = isParamPresent(value);
    return acc;
  }, {});
}

function getActiveRouteSnapshot(
  state: NavigationLikeState | undefined,
  parentChain: string[] = [],
): ActiveRouteSnapshot | null {
  if (!state) return null;
  const activeRoute = state.routes[state.index ?? 0];
  if (!activeRoute) return null;

  const nextChain = [...parentChain, activeRoute.name];
  const nestedState = isNavigationState(activeRoute.state) ? activeRoute.state : undefined;
  if (nestedState) {
    return getActiveRouteSnapshot(nestedState, nextChain) ?? {
      chain: nextChain,
      leafKey: activeRoute.key ?? activeRoute.name,
      leafName: activeRoute.name,
      leafParams: activeRoute.params,
    };
  }

  return {
    chain: nextChain,
    leafKey: activeRoute.key ?? activeRoute.name,
    leafName: activeRoute.name,
    leafParams: activeRoute.params,
  };
}

export function getActiveLeafRouteName(state: NavigationState | undefined): string | undefined {
  return getActiveRouteSnapshot(state as NavigationLikeState | undefined)?.leafName;
}

export function getTrackedScreen(state: NavigationState | undefined): TrackedScreen | null {
  const snapshot = getActiveRouteSnapshot(state as NavigationLikeState | undefined);
  if (!snapshot) return null;

  const definition = TRACKED_SCREEN_DEFINITIONS[snapshot.leafName];
  if (!definition) return null;

  return {
    name: definition.name,
    routeName: snapshot.leafName,
    area: definition.area,
    kind: definition.kind,
    uniqueKey: snapshot.leafKey,
    properties: {
      navigation_path: snapshot.chain.join(' > '),
      screen_area: definition.area,
      screen_kind: definition.kind,
      screen_route: snapshot.leafName,
      ...buildParamPresenceProperties(snapshot.leafParams),
    },
  };
}
