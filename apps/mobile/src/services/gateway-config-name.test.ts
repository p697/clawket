import { describe, expect, it } from '@jest/globals';
import { resolveSavedGatewayName } from './gateway-config-name';

describe('resolveSavedGatewayName', () => {
  it('prefers relay displayName over generic relay host names', () => {
    expect(resolveSavedGatewayName({
      name: 'Relay (relay.example.com)',
      backendKind: 'openclaw',
      transportKind: 'relay',
      url: 'wss://relay.example.com/ws',
      relayDisplayName: 'Lucy',
    })).toBe('Lucy');
  });

  it('prefers relay displayName over generic relay sequence names', () => {
    expect(resolveSavedGatewayName({
      name: 'Relay Gateway 2',
      backendKind: 'openclaw',
      transportKind: 'relay',
      url: 'wss://relay.example.com/ws',
      relayDisplayName: 'Lucy',
    })).toBe('Lucy');
  });

  it('keeps explicit custom names', () => {
    expect(resolveSavedGatewayName({
      name: 'My Home Mac',
      backendKind: 'openclaw',
      transportKind: 'relay',
      url: 'wss://relay.example.com/ws',
      relayDisplayName: 'Lucy',
    })).toBe('My Home Mac');
  });
});
