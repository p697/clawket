import type { ConnectionDescriptor } from '@clawket/agent-protocol';
import {
  buildAnalyticsSuperProperties,
  REMOVED_ANALYTICS_PERSON_PROPERTIES,
  REMOVED_ANALYTICS_SUPER_PROPERTIES,
} from './super-properties';

function connection(
  id: string,
  backendKind: ConnectionDescriptor['backendKind'],
  transportKind: ConnectionDescriptor['transportKind'],
): ConnectionDescriptor {
  return { id, backendKind, transportKind, label: id } as ConnectionDescriptor;
}

describe('analytics super properties', () => {
  it('builds the 3.0 properties and the two one-release compatibility aliases', () => {
    expect(buildAnalyticsSuperProperties({
      platform: 'android',
      connections: [
        connection('h-1', 'hermes', 'relay'),
        connection('o-1', 'openclaw', 'local'),
        connection('h-2', 'hermes', 'local'),
      ],
      activeConnectionId: 'h-1',
      isPro: true,
      graceActive: false,
      themeMode: 'dark',
      themeAccentId: 'jadeGreen',
    })).toEqual({
      app_platform: 'android',
      connection_count: 3,
      backend_kinds: 'openclaw,hermes',
      active_backend: 'hermes',
      active_transport: 'relay',
      is_pro: true,
      is_premium: true,
      theme_mode: 'dark',
      theme_accent_id: 'jadeGreen',
      grace_active: false,
      gateway_mode: 'hermes:relay',
    });
  });

  it('does not retain a removed current agent or identity property', () => {
    const properties = buildAnalyticsSuperProperties({
      platform: 'ios',
      connections: [],
      activeConnectionId: null,
      isPro: false,
      graceActive: true,
      themeMode: 'system',
      themeAccentId: 'iceBlue',
    });

    expect(properties).toMatchObject({
      app_platform: 'ios',
      connection_count: 0,
      backend_kinds: '',
      active_backend: 'unconfigured',
      active_transport: 'unconfigured',
      gateway_mode: 'unconfigured',
    });
    expect(properties).not.toHaveProperty('current_agent_id');
    expect(properties).not.toHaveProperty('device_id');
    expect(properties).not.toHaveProperty('has_gateway_config');
    expect(REMOVED_ANALYTICS_SUPER_PROPERTIES).toEqual([
      'current_agent_id',
      'has_gateway_config',
      'theme_scheme',
    ]);
    expect(REMOVED_ANALYTICS_PERSON_PROPERTIES).toEqual([
      'device_id',
      'device_identity_created_at',
    ]);
  });
});
