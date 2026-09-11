import type { ToolCatalog, ToolPolicy } from '@clawket/agent-protocol';
import {
  activeToolProfile,
  computeToolPolicyDiff,
  countCatalogTools,
  countEnabledTools,
  extractAgentToolPolicy,
  filterToolCatalog,
  isExplicitToolAllowList,
  isToolEnabledForPolicy,
  sameToolPolicy,
  selectToolProfile,
  toggleToolInPolicy,
} from './tools-model';

const catalog: ToolCatalog = {
  agentId: 'main',
  profiles: [
    { id: 'full', label: 'Full' },
    { id: 'coding', label: 'Coding' },
    { id: 'minimal', label: 'Minimal' },
  ],
  groups: [
    {
      id: 'workspace',
      label: 'Workspace',
      source: 'core',
      tools: [
        {
          id: 'read',
          label: 'Read',
          description: 'Read a file',
          source: 'core',
          defaultProfiles: ['coding'],
        },
        {
          id: 'session_status',
          label: 'Session status',
          description: 'Inspect a session',
          source: 'core',
          defaultProfiles: ['coding', 'minimal'],
        },
      ],
    },
    {
      id: 'plugin:weather',
      label: 'Weather',
      source: 'plugin',
      pluginId: 'weather',
      tools: [{
        id: 'weather.lookup',
        label: 'Forecast',
        description: 'Look up the weather',
        source: 'plugin',
        pluginId: 'weather',
        defaultProfiles: [],
      }],
    },
  ],
};

describe('tools model', () => {
  it('extracts and normalizes the selected agent policy', () => {
    expect(extractAgentToolPolicy({
      agents: {
        list: [
          { id: 'other', tools: { profile: 'minimal' } },
          {
            key: 'main',
            tools: {
              profile: ' coding ',
              allow: [' READ ', 1, 'read'],
              alsoAllow: ['weather.lookup'],
              deny: ['EXEC'],
            },
          },
        ],
      },
    }, 'main')).toEqual({
      agentId: 'main',
      profile: 'coding',
      allow: ['read'],
      alsoAllow: ['weather.lookup'],
      deny: ['exec'],
    });
    expect(extractAgentToolPolicy(null, 'main')).toEqual({ agentId: 'main' });
  });

  it('resolves profile defaults and explicit overrides', () => {
    const read = catalog.groups[0].tools[0];
    const weather = catalog.groups[1].tools[0];
    expect(isToolEnabledForPolicy(read, { agentId: 'main', profile: 'coding' })).toBe(true);
    expect(isToolEnabledForPolicy(weather, { agentId: 'main', profile: 'coding' })).toBe(false);
    expect(isToolEnabledForPolicy(weather, {
      agentId: 'main',
      profile: 'coding',
      alsoAllow: ['weather.lookup'],
    })).toBe(true);
    expect(isToolEnabledForPolicy(read, {
      agentId: 'main',
      profile: 'coding',
      deny: ['read'],
    })).toBe(false);
    expect(isToolEnabledForPolicy(read, {
      agentId: 'main',
      allow: ['*'],
      deny: ['read'],
    })).toBe(false);
  });

  it('updates overrides relative to the active profile', () => {
    const read = catalog.groups[0].tools[0];
    const weather = catalog.groups[1].tools[0];
    expect(toggleToolInPolicy(read, false, {
      agentId: 'main',
      profile: 'coding',
    })).toMatchObject({ deny: ['read'], alsoAllow: [] });
    expect(toggleToolInPolicy(weather, true, {
      agentId: 'main',
      profile: 'coding',
    })).toMatchObject({ alsoAllow: ['weather.lookup'], deny: [] });
    expect(toggleToolInPolicy(read, true, {
      agentId: 'main',
      profile: 'coding',
      deny: ['read'],
    })).toMatchObject({ deny: [] });
  });

  it('keeps explicit allow lists read only', () => {
    const policy: ToolPolicy = { agentId: 'main', allow: ['read'] };
    expect(isExplicitToolAllowList(policy)).toBe(true);
    expect(toggleToolInPolicy(catalog.groups[0].tools[0], false, policy)).toBe(policy);
    expect(selectToolProfile(policy, 'full')).toBe(policy);
  });

  it('selects profiles and reports effective changes', () => {
    const coding: ToolPolicy = { agentId: 'main', profile: 'coding' };
    const full = selectToolProfile(coding, 'full');
    expect(full).toEqual({ agentId: 'main', profile: 'full', alsoAllow: [], deny: [] });
    expect(computeToolPolicyDiff(catalog, coding, full)).toEqual({
      enabled: 1,
      disabled: 0,
      totalChanged: 1,
    });
    expect(countCatalogTools(catalog)).toBe(3);
    expect(countEnabledTools(catalog, coding)).toBe(2);
    expect(activeToolProfile(catalog, coding)).toBe('coding');
    expect(activeToolProfile(catalog, { ...coding, deny: ['read'] })).toBeNull();
    expect(sameToolPolicy(coding, { agentId: 'main', profile: 'coding', deny: [] })).toBe(true);
  });

  it('filters groups by group and tool metadata without mutating the catalog', () => {
    expect(filterToolCatalog(catalog, 'forecast')).toEqual([{
      ...catalog.groups[1],
      tools: [catalog.groups[1].tools[0]],
    }]);
    expect(filterToolCatalog(catalog, 'workspace')).toEqual([catalog.groups[0]]);
    expect(filterToolCatalog(catalog, 'missing')).toEqual([]);
    expect(filterToolCatalog(catalog, '')).toEqual(catalog.groups);
  });
});
