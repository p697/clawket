import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { resolveCapabilities } from '@clawket/agent-protocol';
import type { ConnectionRuntimeSnapshot, RosterConnectionGroup } from '../../connection';
import type { SearchViewProps } from './SearchView';
import {
  resolveSearchCapabilities,
  SearchScreen,
  type SearchScreenProps,
} from './SearchScreen';

let mockSearchViewProps: SearchViewProps | null = null;
let mockRuntime: ConnectionRuntimeSnapshot;
let mockRoster: ReadonlyArray<RosterConnectionGroup> = [];
let mockIsPro = false;

const mockProbeActive = jest.fn(async () => true);
const mockListSessions = jest.fn(async () => [{
  storageKey: 'storage',
  gatewayConfigId: 'connection',
  agentId: 'agent',
  agentName: 'Launch Agent',
  sessionKey: 'session',
  sessionLabel: 'Launch room',
  messageCount: 1,
  updatedAt: 100,
}]);
const mockSearch = jest.fn(async (_query: string) => [{
  meta: (await mockListSessions())[0],
  matches: [{ id: 'message', role: 'assistant', text: 'Launch answer', timestampMs: 200 }],
}]);
const mockListFavorites = jest.fn(async () => []);
const mockLoadRecent = jest.fn(async () => ['Previous query']);
const mockRememberRecent = jest.fn(async (query: string) => [query, 'Previous query']);

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  return {
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => style,
      hairlineWidth: 1,
    },
    View: ({ children, ...props }: { children?: React.ReactNode }) => ReactRuntime.createElement(
      'View',
      props,
      children,
    ),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 16, left: 0 }),
}));

jest.mock('../../connection', () => ({
  getConnectionRuntime: () => ({ probeActive: mockProbeActive }),
  useConnections: () => mockRuntime,
  useRoster: () => mockRoster,
}));

jest.mock('../../contexts/ProPaywallContext', () => ({
  useProPaywall: () => ({ isPro: mockIsPro }),
}));

jest.mock('../../services/chat-cache', () => ({
  ChatCacheService: {
    listSessions: () => mockListSessions(),
    search: (query: string) => mockSearch(query),
  },
}));

jest.mock('../../services/message-favorites', () => ({
  MessageFavoritesService: {
    listFavorites: () => mockListFavorites(),
  },
}));

jest.mock('./recent-searches', () => ({
  loadRecentSearches: () => mockLoadRecent(),
  rememberRecentSearch: (query: string) => mockRememberRecent(query),
}));

jest.mock('./SearchView', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    SearchView: (props: SearchViewProps) => {
      mockSearchViewProps = props;
      return ReactRuntime.createElement(View, { testID: 'connected-search-view' });
    },
  };
});

const connection = {
  id: 'connection',
  backendKind: 'openclaw' as const,
  transportKind: 'relay' as const,
  label: 'Home server',
  createdAt: 1,
  isFreeSlot: true,
};

const capabilities = resolveCapabilities('openclaw');
const adapter = { capabilities } as ConnectionRuntimeSnapshot['activeAdapter'];
const rosterAgent = {
  connectionId: 'connection',
  agentId: 'agent',
  name: 'Launch Agent',
  isMain: true,
  mainSessionKey: 'session',
};
const rosterSession = {
  connectionId: 'connection',
  agentId: 'agent',
  key: 'session',
  kind: 'main' as const,
  title: 'Launch room',
  updatedAt: 100,
  hasActiveRun: false,
  attention: null,
  allowedActions: { rename: true, reset: true, delete: true, pin: true },
};
const rosterGroup: RosterConnectionGroup = {
  connection,
  source: 'live',
  syncedAt: 100,
  agents: [{
    agent: rosterAgent,
    sessions: [rosterSession],
    preview: 'Launch preview',
    updatedAt: 100,
    lastActivityAt: 100,
    unreadCount: 0,
    hasUnread: false,
    attentionCount: 0,
    attention: null,
  }],
  unreadCount: 0,
  attentionCount: 0,
  lastActivityAt: 100,
};

function createProps(query = 'launch'): SearchScreenProps {
  return {
    navigation: {
      goBack: jest.fn(),
      navigate: jest.fn(),
    },
    route: {
      key: 'Search-key',
      name: 'Search',
      params: { query },
    },
  } as unknown as SearchScreenProps;
}

describe('SearchScreen connection container', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockSearchViewProps = null;
    mockIsPro = false;
    mockRoster = [rosterGroup];
    mockRuntime = {
      revision: 1,
      initialized: true,
      switching: false,
      connectionsRevision: 1,
      connections: [connection],
      activeConnectionId: 'connection',
      freeConnectionId: 'connection',
      activeAdapter: adapter,
      activeState: 'ready',
      roster: mockRoster,
      error: null,
    };
    mockProbeActive.mockClear();
    mockListSessions.mockClear();
    mockSearch.mockClear();
    mockListFavorites.mockClear();
    mockLoadRecent.mockClear();
    mockRememberRecent.mockClear();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('connects roster, local cache, favorites, recent searches, and safe-area state', async () => {
    render(<SearchScreen {...createProps()} />);

    await waitFor(() => expect(mockSearchViewProps?.state).toBe('ready'));
    expect(mockSearchViewProps).toMatchObject({
      query: 'launch',
      topInset: 24,
      bottomInset: 16,
      recentSearches: ['Previous query'],
    });
    expect(mockSearchViewProps?.sections.map((section) => section.kind)).toEqual([
      'agents',
      'sessions',
      'messages',
    ]);
  });

  it('navigates Agent/session rows to Thread and free message rows to the Pro gate', async () => {
    const props = createProps();
    render(<SearchScreen {...props} />);
    await waitFor(() => expect(mockSearchViewProps?.state).toBe('ready'));
    const results = mockSearchViewProps?.sections.flatMap((section) => section.results) ?? [];
    const agentResult = results.find((result) => result.kind === 'agent');
    const messageResult = results.find((result) => result.kind === 'message');

    act(() => mockSearchViewProps?.onSelectResult(agentResult!));
    expect(props.navigation.navigate).toHaveBeenCalledWith('Thread', {
      connectionId: 'connection',
      agentId: 'agent',
      sessionKey: 'session',
      from: 'search',
    });
    act(() => mockSearchViewProps?.onSelectResult(messageResult!));
    expect(props.navigation.navigate).toHaveBeenCalledWith('Paywall', {
      reason: 'messageHistory',
    });
  });

  it('opens Pro message results in MessageDetail and restores recent queries', async () => {
    const props = createProps();
    render(<SearchScreen {...props} isProOverride />);
    await waitFor(() => expect(mockSearchViewProps?.state).toBe('ready'));
    const message = mockSearchViewProps?.sections
      .flatMap((section) => section.results)
      .find((result) => result.kind === 'message');

    act(() => mockSearchViewProps?.onSelectResult(message!));
    expect(props.navigation.navigate).toHaveBeenCalledWith('MessageDetail', {
      connectionId: 'connection',
      sessionKey: 'session',
      messageId: 'message',
    });

    act(() => mockSearchViewProps?.onSelectRecent('Previous query'));
    await waitFor(() => expect(mockSearchViewProps?.query).toBe('Previous query'));
    expect(mockSearchViewProps?.filter).toBe('all');
  });

  it('exposes back, retry, and whole-page permission callbacks', async () => {
    const props = createProps('');
    render(<SearchScreen {...props} permissionGranted={false} />);
    await waitFor(() => expect(mockSearchViewProps?.state).toBe('permission'));

    act(() => mockSearchViewProps?.onBack());
    expect(props.navigation.goBack).toHaveBeenCalledTimes(1);
    act(() => mockSearchViewProps?.onOpenPermission?.());
    expect(props.navigation.navigate).toHaveBeenCalledWith('Paywall', {
      reason: 'messageHistory',
    });
  });

  it('uses active runtime downgrades and baseline capability lookup without backend branches', () => {
    const downgraded = resolveCapabilities('openclaw', { history: false });
    const result = resolveSearchCapabilities([
      connection,
      { ...connection, id: 'hermes', backendKind: 'hermes' },
    ], 'connection', downgraded);

    expect(result.connection.history).toBe(false);
    expect(result.hermes.sessions).toBe(true);
    expect(result.hermes.configManage).toBe(false);
  });
});
