import { getActiveLeafRouteName, getTrackedScreen } from './posthog-navigation';

describe('posthog navigation tracking', () => {
  it('maps the roster root without a legacy tab dimension', () => {
    const state = {
      index: 0,
      routes: [
        {
          key: 'roster-1',
          name: 'Roster',
        },
      ],
    };

    expect(getActiveLeafRouteName(state as never)).toBe('Roster');
    expect(getTrackedScreen(state as never)).toEqual({
      name: 'Roster',
      routeName: 'Roster',
      area: 'roster',
      kind: 'root',
      uniqueKey: 'roster-1',
      properties: {
        navigation_path: 'Roster',
        screen_area: 'roster',
        screen_kind: 'root',
        screen_route: 'Roster',
      },
    });
  });

  it('maps thread details and only captures param presence', () => {
    const state = {
      index: 1,
      routes: [
        { key: 'roster-1', name: 'Roster' },
        {
          key: 'thread-1',
          name: 'Thread',
          params: { connectionId: 'connection-123', agentId: 'main', sessionKey: 'agent:main:main' },
        },
      ],
    };

    expect(getTrackedScreen(state as never)).toEqual({
      name: 'Thread',
      routeName: 'Thread',
      area: 'thread',
      kind: 'detail',
      uniqueKey: 'thread-1',
      properties: {
        navigation_path: 'Thread',
        screen_area: 'thread',
        screen_kind: 'detail',
        screen_route: 'Thread',
        has_connection_id: true,
        has_agent_id: true,
        has_session_key: true,
      },
    });
  });

  it('returns null for routes that are not part of the tracking catalog', () => {
    const state = {
      index: 0,
      routes: [{ key: 'unknown-1', name: 'UnknownScreen' }],
    };

    expect(getTrackedScreen(state as never)).toBeNull();
  });
});
