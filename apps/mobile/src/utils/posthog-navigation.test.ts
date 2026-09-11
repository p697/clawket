import {
  getActiveLeafRouteName,
  getManualTrackedScreen,
  getTrackedScreen,
} from './posthog-navigation';

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
    expect(getTrackedScreen(state as never, { backend: 'openclaw' })).toEqual({
      name: 'Roster',
      routeName: 'Roster',
      area: 'roster',
      kind: 'root',
      uniqueKey: 'roster-1:Roster',
      properties: {
        screen_area: 'roster',
        screen_kind: 'root',
        backend: 'openclaw',
      },
    });
  });

  it('maps thread details without exposing route parameters', () => {
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

    expect(getTrackedScreen(state as never, { backend: 'hermes' })).toEqual({
      name: 'Thread',
      routeName: 'Thread',
      area: 'thread',
      kind: 'detail',
      uniqueKey: 'thread-1:Thread',
      properties: {
        screen_area: 'thread',
        screen_kind: 'detail',
        backend: 'hermes',
      },
    });
    expect(JSON.stringify(getTrackedScreen(state as never))).not.toContain('connection-123');
    expect(JSON.stringify(getTrackedScreen(state as never))).not.toContain('agent:main:main');
  });

  it('returns null for routes that are not part of the tracking catalog', () => {
    const state = {
      index: 0,
      routes: [{ key: 'unknown-1', name: 'UnknownScreen' }],
    };

    expect(getTrackedScreen(state as never)).toBeNull();
  });

  it.each([
    ['identity', 'Identity'],
    ['models', 'Models'],
    ['skills', 'Skills'],
    ['cron', 'Cron'],
    ['files', 'Files'],
    ['usage', 'Usage'],
    ['connection', 'ConnectionStatus'],
    ['openclaw', 'OpenClawManage'],
    ['tools', 'Tools'],
    ['channels-devices', 'ChannelsDevices'],
    ['logs', 'Logs'],
  ])('names the %s Agent Settings destination', (section, name) => {
    const state = {
      index: 0,
      routes: [{
        key: `agent-settings-${section}`,
        name: 'AgentSettingsSection',
        params: { section, connectionId: 'private', agentId: 'private' },
      }],
    };

    const tracked = getTrackedScreen(state as never);
    expect(tracked).toMatchObject({
      name,
      area: 'settings',
      kind: 'detail',
      properties: {
        screen_area: 'settings',
        screen_kind: 'detail',
        backend: 'unconfigured',
      },
    });
    expect(JSON.stringify(tracked)).not.toContain('private');
  });

  it('uses the account screen area and a stable section name', () => {
    const state = {
      index: 0,
      routes: [{
        key: 'account-help',
        name: 'AccountSettingsSection',
        params: { section: 'help' },
      }],
    };

    expect(getTrackedScreen(state as never)).toMatchObject({
      name: 'AccountHelp',
      area: 'account',
      properties: {
        screen_area: 'account',
        screen_kind: 'detail',
        backend: 'unconfigured',
      },
    });
  });

  it('tracks the production release-notes detail without route data', () => {
    const state = {
      index: 0,
      routes: [{ key: 'release-notes-1', name: 'ReleaseNotes' }],
    };

    expect(getTrackedScreen(state as never)).toMatchObject({
      name: 'ReleaseNotes',
      routeName: 'ReleaseNotes',
      area: 'account',
      kind: 'detail',
    });
  });

  it('builds the manual Session Panel screen view without manufacturing a route', () => {
    expect(getManualTrackedScreen('SessionPanel', { backend: 'youmind' })).toEqual({
      name: 'SessionPanel',
      routeName: 'SessionPanel',
      area: 'thread',
      kind: 'modal',
      uniqueKey: 'manual:SessionPanel:SessionPanel',
      properties: {
        screen_area: 'thread',
        screen_kind: 'modal',
        backend: 'youmind',
      },
    });
  });

  it('supports the global Paywall overlay as a manual screen view', () => {
    expect(getManualTrackedScreen('Paywall', { backend: 'openclaw' })).toMatchObject({
      name: 'Paywall',
      area: 'paywall',
      kind: 'modal',
      properties: {
        screen_area: 'paywall',
        screen_kind: 'modal',
        backend: 'openclaw',
      },
    });
  });
});
