import type { AgentDescriptor, ConnectionDescriptor } from '@clawket/agent-protocol';

import {
  DEFAULT_FREE_AGENT_ID,
  FIRST_3_0_GRACE_PERIOD_MS,
  FREE_CONNECTION_LIMIT,
  FREE_CONNECTION_SWITCH_INTERVAL_MS,
  SETTINGS_MEMBERSHIP_PREVIEW_FEATURE,
  canAddAgent,
  canAddGatewayConnection,
  canCreateAgent,
  canUseAgent,
  canUseConnection,
  isGraceActive,
  normalizeAccessibleAgentId,
  normalizeProFeature,
  resolvePreviewPaywallFeature,
  resolveProAccessEnabled,
  type Entitlement,
  type ProFeature,
} from './pro';

const homeConnection = { id: 'home' } as Pick<ConnectionDescriptor, 'id'>;
const workConnection = { id: 'work' } as Pick<ConnectionDescriptor, 'id'>;
const mainAgent = { agentId: 'main', isMain: true } as Pick<AgentDescriptor, 'agentId' | 'isMain'>;
const secondaryAgent = { agentId: 'researcher', isMain: false } as Pick<AgentDescriptor, 'agentId' | 'isMain'>;

function entitlement(overrides: Partial<Entitlement> = {}): Entitlement {
  return {
    isPro: false,
    graceUntil: null,
    now: 1_000,
    freeConnectionId: 'home',
    ...overrides,
  };
}

describe('resolveProAccessEnabled', () => {
  it('returns true when RevenueCat is not configured for the build', () => {
    expect(resolveProAccessEnabled(undefined, {} as NodeJS.ProcessEnv)).toBe(true);
  });

  it('returns true for supported truthy flags', () => {
    const env = {
      EXPO_PUBLIC_REVENUECAT_ENABLED: 'true',
      EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY: 'appl_test',
      EXPO_PUBLIC_REVENUECAT_PRO_ENTITLEMENT_ID: 'pro',
    } as unknown as NodeJS.ProcessEnv;
    expect(resolveProAccessEnabled('1', env)).toBe(true);
    expect(resolveProAccessEnabled('true', env)).toBe(true);
    expect(resolveProAccessEnabled('YES', env)).toBe(true);
  });

  it('returns false for missing or falsy values when RevenueCat is configured', () => {
    const env = {
      EXPO_PUBLIC_REVENUECAT_ENABLED: 'true',
      EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY: 'appl_test',
      EXPO_PUBLIC_REVENUECAT_PRO_ENTITLEMENT_ID: 'pro',
    } as unknown as NodeJS.ProcessEnv;
    expect(resolveProAccessEnabled(undefined, env)).toBe(false);
    expect(resolveProAccessEnabled('0', env)).toBe(false);
    expect(resolveProAccessEnabled('false', env)).toBe(false);
  });

  it('can resolve against the build-time public config', () => {
    expect(typeof resolveProAccessEnabled('true')).toBe('boolean');
  });
});

describe('3.0 quota policy', () => {
  it('limits free users to one connection even during grace', () => {
    expect(FREE_CONNECTION_LIMIT).toBe(1);
    expect(canAddGatewayConnection(0, entitlement())).toBe(true);
    expect(canAddGatewayConnection(1, entitlement({ graceUntil: 2_000 }))).toBe(false);
    expect(canAddGatewayConnection(7, entitlement({ isPro: true }))).toBe(true);
  });

  it('keeps the boolean connection overload during App migration', () => {
    expect(canAddGatewayConnection(0, false)).toBe(true);
    expect(canAddGatewayConnection(1, false)).toBe(false);
    expect(canAddGatewayConnection(2, true)).toBe(true);
  });

  it('allows only the selected free connection outside grace', () => {
    const free = entitlement();
    expect(canUseConnection(homeConnection, free)).toBe(true);
    expect(canUseConnection(workConnection, free)).toBe(false);
    expect(canUseConnection(workConnection, entitlement({ isPro: true }))).toBe(true);
  });

  it('unlocks all existing connections during grace and locks at the exact deadline', () => {
    expect(isGraceActive(entitlement({ now: 1_999, graceUntil: 2_000 }))).toBe(true);
    expect(canUseConnection(workConnection, entitlement({ now: 1_999, graceUntil: 2_000 }))).toBe(true);
    expect(isGraceActive(entitlement({ now: 2_000, graceUntil: 2_000 }))).toBe(false);
    expect(canUseConnection(workConnection, entitlement({ now: 2_000, graceUntil: 2_000 }))).toBe(false);
    expect(isGraceActive(entitlement())).toBe(false);
  });

  it('allows main on the free connection and locks every other free-user agent', () => {
    const free = entitlement();
    expect(canUseAgent(mainAgent, homeConnection, free)).toBe(true);
    expect(canUseAgent(secondaryAgent, homeConnection, free)).toBe(false);
    expect(canUseAgent(mainAgent, workConnection, free)).toBe(false);
  });

  it('uses descriptor isMain for Hermes and YouMind instead of backend branches', () => {
    expect(canUseAgent(
      { agentId: 'hermes', isMain: true },
      homeConnection,
      entitlement(),
    )).toBe(true);
    expect(canUseAgent(
      { agentId: 'sprite', isMain: true },
      homeConnection,
      entitlement(),
    )).toBe(true);
  });

  it('unlocks secondary agents during grace and for Pro', () => {
    expect(canUseAgent(
      secondaryAgent,
      homeConnection,
      entitlement({ now: 1_999, graceUntil: 2_000 }),
    )).toBe(true);
    expect(canUseAgent(
      secondaryAgent,
      homeConnection,
      entitlement({ now: 2_000, graceUntil: 2_000 }),
    )).toBe(false);
    expect(canUseAgent(secondaryAgent, workConnection, entitlement({ isPro: true }))).toBe(true);
  });

  it('keeps the old two-argument agent helper conservative during migration', () => {
    expect(canUseAgent(DEFAULT_FREE_AGENT_ID, false)).toBe(true);
    expect(canUseAgent('researcher', false)).toBe(false);
    expect(canUseAgent('researcher', true)).toBe(true);
  });

  it('fails closed for an invalid mixed overload call', () => {
    const unsafeCanUseAgent = canUseAgent as unknown as (...args: unknown[]) => boolean;
    expect(unsafeCanUseAgent(mainAgent, false, entitlement())).toBe(false);
  });

  it('makes agent creation Pro-only, including the legacy count helper', () => {
    expect(canCreateAgent(entitlement())).toBe(false);
    expect(canCreateAgent(entitlement({ isPro: true }))).toBe(true);
    expect(canAddAgent(0, false)).toBe(false);
    expect(canAddAgent(100, true)).toBe(true);
    expect(canAddAgent(0, entitlement({ isPro: true }))).toBe(true);
  });

  it('exports the frozen timing constants', () => {
    expect(FREE_CONNECTION_SWITCH_INTERVAL_MS).toBe(86_400_000);
    expect(FIRST_3_0_GRACE_PERIOD_MS).toBe(1_209_600_000);
  });
});

describe('Pro feature compatibility', () => {
  it('includes launch and canonical management features', () => {
    const features: ProFeature[] = ['launch', 'configBackups', 'configManage'];
    expect(features.map(normalizeProFeature)).toEqual(features);
  });

  it('maps the one-release backup aliases to configBackups', () => {
    expect(normalizeProFeature('configBackupCreate')).toBe('configBackups');
    expect(normalizeProFeature('configBackupRestore')).toBe('configBackups');
  });

  it('returns the stable blocked feature for settings membership previews', () => {
    expect(resolvePreviewPaywallFeature()).toBe('settingsMembershipPreview');
    expect(resolvePreviewPaywallFeature()).toBe(SETTINGS_MEMBERSHIP_PREVIEW_FEATURE);
  });
});

describe('normalizeAccessibleAgentId', () => {
  it('falls back to the default free agent when empty', () => {
    expect(normalizeAccessibleAgentId(null, false)).toBe(DEFAULT_FREE_AGENT_ID);
    expect(normalizeAccessibleAgentId('', false)).toBe(DEFAULT_FREE_AGENT_ID);
  });

  it('leaves descriptor-aware access enforcement to canUseAgent', () => {
    expect(normalizeAccessibleAgentId(' researcher ', false)).toBe('researcher');
    expect(normalizeAccessibleAgentId(DEFAULT_FREE_AGENT_ID, false)).toBe(DEFAULT_FREE_AGENT_ID);
    expect(normalizeAccessibleAgentId('researcher', true)).toBe('researcher');
  });
});
