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
  area: 'chat' | 'discover' | 'live' | 'console' | 'settings';
  kind: 'root' | 'list' | 'detail' | 'editor' | 'webview';
  name: string;
  tab: 'Chat' | 'Live' | 'Console' | 'My';
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
  tab: ScreenDefinition['tab'];
  uniqueKey: string;
  properties: Record<string, boolean | string>;
};

export const TRACKED_SCREEN_DEFINITIONS: Record<string, ScreenDefinition> = {
  ChatMain: { name: 'Chat', area: 'chat', tab: 'Chat', kind: 'root' },
  DiscoverHome: { name: 'Discover', area: 'discover', tab: 'Console', kind: 'root' },
  DiscoverDetail: { name: 'Discover Detail', area: 'discover', tab: 'Console', kind: 'detail' },
  DiscoverClawHubBrowse: { name: 'Discover ClawHub Browse', area: 'discover', tab: 'Console', kind: 'list' },
  DiscoverSkillsShBrowse: { name: 'Discover skills.sh Browse', area: 'discover', tab: 'Console', kind: 'list' },
  Live: { name: 'Live', area: 'live', tab: 'Live', kind: 'root' },
  ConsoleMenu: { name: 'Console', area: 'console', tab: 'Console', kind: 'root' },
  ConfigHome: { name: 'Settings', area: 'settings', tab: 'My', kind: 'root' },
  ChatAppearance: { name: 'Chat Appearance', area: 'settings', tab: 'My', kind: 'editor' },
  OpenClawConfig: { name: 'OpenClaw Config', area: 'settings', tab: 'My', kind: 'list' },
  OpenClawPermissionRepair: { name: 'OpenClaw Permission Repair', area: 'settings', tab: 'My', kind: 'detail' },
  OpenClawReleases: { name: 'OpenClaw Releases', area: 'settings', tab: 'My', kind: 'webview' },
  FileList: { name: 'Files', area: 'console', tab: 'Console', kind: 'list' },
  FileEditor: { name: 'File Editor', area: 'console', tab: 'Console', kind: 'editor' },
  CronList: { name: 'Cron Jobs', area: 'console', tab: 'Console', kind: 'list' },
  CronDetail: { name: 'Cron Detail', area: 'console', tab: 'Console', kind: 'detail' },
  CronEditor: { name: 'Cron Editor', area: 'console', tab: 'Console', kind: 'editor' },
  CronWizard: { name: 'Cron Wizard', area: 'console', tab: 'Console', kind: 'editor' },
  SkillList: { name: 'Skills', area: 'console', tab: 'Console', kind: 'list' },
  SkillDetail: { name: 'Skill Detail', area: 'console', tab: 'Console', kind: 'detail' },
  Logs: { name: 'Logs', area: 'console', tab: 'Console', kind: 'list' },
  Usage: { name: 'Usage', area: 'console', tab: 'Console', kind: 'list' },
  ModelList: { name: 'Models', area: 'console', tab: 'Console', kind: 'list' },
  Channels: { name: 'Channels', area: 'console', tab: 'Console', kind: 'list' },
  Nodes: { name: 'Nodes', area: 'console', tab: 'Console', kind: 'list' },
  Devices: { name: 'Devices', area: 'console', tab: 'Console', kind: 'list' },
  NodeDetail: { name: 'Node Detail', area: 'console', tab: 'Console', kind: 'detail' },
  ToolList: { name: 'Tools', area: 'console', tab: 'Console', kind: 'list' },
  AgentList: { name: 'Agents', area: 'console', tab: 'Console', kind: 'list' },
  AgentDetail: { name: 'Agent Detail', area: 'console', tab: 'Console', kind: 'detail' },
  AgentUserInfo: { name: 'Agent User Info', area: 'console', tab: 'Console', kind: 'editor' },
  ClawHub: { name: 'ClawHub', area: 'console', tab: 'Console', kind: 'webview' },
  Docs: { name: 'Docs', area: 'console', tab: 'Console', kind: 'webview' },
  HeartbeatSettings: { name: 'Heartbeat Settings', area: 'console', tab: 'Console', kind: 'editor' },
  ChatHistory: { name: 'Chat History', area: 'console', tab: 'Console', kind: 'list' },
  SessionsBoard: { name: 'Sessions Board', area: 'console', tab: 'Console', kind: 'list' },
  AgentSessionsBoard: { name: 'Agent & Session Board', area: 'console', tab: 'Console', kind: 'list' },
  ChatHistoryDetail: { name: 'Chat History Detail', area: 'console', tab: 'Console', kind: 'detail' },
  FavoriteMessageDetail: { name: 'Favorite Message Detail', area: 'console', tab: 'Console', kind: 'detail' },
  YouMindBoardDetail: { name: 'YouMind Board Detail', area: 'console', tab: 'Console', kind: 'detail' },
  YouMindBoardItemWebView: { name: 'YouMind Board Item', area: 'console', tab: 'Console', kind: 'webview' },
  YouMindBoardPicker: { name: 'YouMind Board Picker', area: 'console', tab: 'Console', kind: 'list' },
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
    tab: definition.tab,
    uniqueKey: snapshot.leafKey,
    properties: {
      navigation_path: snapshot.chain.join(' > '),
      screen_area: definition.area,
      screen_kind: definition.kind,
      screen_route: snapshot.leafName,
      screen_tab: definition.tab,
      ...buildParamPresenceProperties(snapshot.leafParams),
    },
  };
}
