import { ROOT_ROUTE_NAMES } from './root-stack';

describe('3.0 root navigation', () => {
  it('uses one stack without any legacy tab route', () => {
    expect(ROOT_ROUTE_NAMES).toEqual([
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
    ]);
    expect(ROOT_ROUTE_NAMES).not.toContain('MainTabs');
  });
});
