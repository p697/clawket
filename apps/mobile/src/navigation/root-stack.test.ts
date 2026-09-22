import { ROOT_ROUTE_NAMES, findAgentChatReturnIndex } from './root-stack';

describe('3.0 root navigation', () => {
  it('uses one stack without any legacy tab route', () => {
    expect(ROOT_ROUTE_NAMES).toEqual([
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
    ]);
    expect(ROOT_ROUTE_NAMES).not.toContain('MainTabs');
  });
});


it('returns to the nearest matching conversation without changing its task session', () => {
  const routes = [
    { name: 'Roster' },
    { name: 'Thread', params: { connectionId: 'a', agentId: 'lucy', sessionKey: 'main' } },
    { name: 'Thread', params: { connectionId: 'b', agentId: 'lucy', sessionKey: 'main' } },
    { name: 'Thread', params: { connectionId: 'a', agentId: 'lucy', sessionKey: 'task-1' } },
    { name: 'AgentSettings' },
  ];
  expect(findAgentChatReturnIndex({ index: 4, routes }, 'a', 'lucy')).toBe(3);
  expect(findAgentChatReturnIndex({ index: 3, routes }, 'a', 'lucy')).toBe(1);
  expect(findAgentChatReturnIndex({ index: 4, routes }, 'a', 'other')).toBe(-1);
  expect(findAgentChatReturnIndex({ index: 0, routes: [] }, 'a', 'lucy')).toBe(-1);
});
