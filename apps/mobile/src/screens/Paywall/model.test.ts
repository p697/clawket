import type { ProPaywallPackage } from '../../services/pro-subscription';
import {
  orderPaywallPackages,
  paywallFailureMessageKey,
  resolvePaywallContent,
} from './model';

function paywallPackage(
  packageType: 'MONTHLY' | 'ANNUAL' | 'LIFETIME',
  price: number,
  socialProof = true,
): ProPaywallPackage {
  return {
    offeringIdentifier: 'pro',
    packageIdentifier: packageType.toLowerCase(),
    packageType,
    productIdentifier: packageType.toLowerCase(),
    title: packageType,
    description: packageType,
    price,
    priceString: `$${price}`,
    pricePerMonth: packageType === 'ANNUAL' ? price / 12 : packageType === 'MONTHLY' ? price : null,
    pricePerMonthString: packageType === 'ANNUAL' ? `$${(price / 12).toFixed(2)}` : null,
    offeringMetadata: { defaultPackage: 'annual', socialProof },
    package: {} as ProPaywallPackage['package'],
  };
}

describe('Paywall model', () => {
  it.each([
    ['gatewayConnections', 'connections'],
    ['agents', 'agents'],
    ['openclawPermissions', 'manage'],
    ['configBackups', 'manage'],
    ['coreFileEditing', 'logsFiles'],
    ['modelManage', 'manage'],
    ['logs', 'logsFiles'],
    ['messageHistory', 'search'],
    ['archiveTools', 'search'],
    ['documentVersions', 'logsFiles'],
    ['appIcons', 'generic'],
    ['usage', 'generic'],
    ['launch', 'generic'],
  ] as const)('maps %s to the %s hero', (feature, hero) => {
    expect(resolvePaywallContent(feature).hero).toBe(hero);
  });

  it('describes the paid archive/version action without locking free reading or memory corrections', () => {
    expect(resolvePaywallContent('archiveTools')).toMatchObject({
      titleKey: 'Search and bulk export', subtitleKey: null, actionKey: null,
    });
    expect(resolvePaywallContent('documentVersions')).toMatchObject({
      titleKey: 'Skill and memory versions', subtitleKey: null, actionKey: null,
    });
    expect(resolvePaywallContent(null).benefits.map(benefit => benefit.labelKey)).toContain('Skill and memory versions');
  });

  it('lists only the supporting benefits the saved backends offer', () => {
    const labels = (feature: Parameters<typeof resolvePaywallContent>[0], backends?: ReadonlyArray<string>) => (
      resolvePaywallContent(feature, { backends: backends as never }).benefits.map((item) => item.labelKey)
    );
    const everything = [
      'Conversations across channels and tasks',
      'More Agents, unlimited connections',
      'Skill and memory versions',
      'Configure, back up and diagnose your Agents',
    ];
    // Nothing saved yet, OpenClaw among the connections, or a backend this build does not know: the full list.
    expect(labels(null)).toEqual(everything);
    expect(labels(null, [])).toEqual(everything);
    expect(labels(null, ['codex', 'openclaw'])).toEqual(everything);
    expect(labels(null, ['future-backend'])).toEqual(everything);

    // Product review 2026-11-11: a Codex-only user read "manage OpenClaw config, backups and logs".
    expect(labels(null, ['codex'])).toEqual([
      'Continue the conversations on your computer',
      'Unlimited connections',
    ]);
    expect(labels('settingsMembershipPreview', ['claude-code', 'pi', 'codex'])).toEqual([
      'Continue the conversations on your computer',
      'Unlimited connections',
    ]);
    // Hermes has Agents, files and scheduled tasks, but no OpenClaw management.
    expect(labels(null, ['hermes'])).toEqual([
      'Conversations across channels and tasks',
      'More Agents, unlimited connections',
      'Skill and memory versions',
    ]);
    // A local model has one conversation and nothing to manage.
    expect(labels(null, ['local-model'])).toEqual(['Unlimited connections']);

    // The line the user reached for always leads, whatever the backends.
    expect(labels('gatewayConnections', ['codex', 'claude-code'])).toEqual([
      'Unlimited connections',
      'Continue the conversations on your computer',
    ]);
    expect(labels('sessionHistory', ['claude-code'])).toEqual([
      'Continue the conversations on your computer',
      'Unlimited connections',
    ]);
    expect(labels('coreFileEditing', ['codex'])[0]).toBe('Skill and memory versions');
    for (const backends of [['codex'], ['hermes'], ['local-model'], ['pi', 'claude-code']]) {
      for (const feature of [null, 'gatewayConnections', 'sessionHistory', 'usage', 'logs'] as const) {
        const benefits = resolvePaywallContent(feature, { backends: backends as never }).benefits;
        expect(benefits.length).toBeGreaterThan(0);
        expect(new Set(benefits.map((item) => item.kind)).size).toBe(benefits.length);
      }
    }
  });

  it('returns exactly four contextual benefits without a duplicate category', () => {
    for (const feature of ['gatewayConnections', 'agents', 'configBackups', 'logs', 'messageHistory'] as const) {
      const benefits = resolvePaywallContent(feature).benefits;
      expect(benefits).toHaveLength(4);
      expect(new Set(benefits.map((item) => item.kind)).size).toBe(4);
    }
    expect(resolvePaywallContent('messageHistory').benefits.map((item) => item.kind)).toEqual([
      'search',
      'combined',
      'sessions',
      'memory',
    ]);
  });

  it('orders plans annual, lifetime, monthly', () => {
    const packages = [
      paywallPackage('MONTHLY', 3),
      paywallPackage('LIFETIME', 49.99),
      paywallPackage('ANNUAL', 24),
    ];
    expect(orderPaywallPackages(packages).map((item) => item.packageType)).toEqual([
      'ANNUAL',
      'LIFETIME',
      'MONTHLY',
    ]);
  });

  it('keeps cancellation silent and maps other failure states to one line', () => {
    expect(paywallFailureMessageKey('cancelled', 'purchase')).toBeNull();
    expect(paywallFailureMessageKey('pending', 'purchase')).toBe('Your purchase is pending approval.');
    expect(paywallFailureMessageKey('offerings_unavailable', 'purchase')).toBe('Unable to load subscription options right now.');
    expect(paywallFailureMessageKey('store_error:ITEM_UNAVAILABLE', 'purchase')).toBe('Unable to complete your purchase right now.');
    expect(paywallFailureMessageKey('store_error:NETWORK_ERROR', 'restore')).toBe('Unable to restore your purchases right now.');
  });
});

it('explains full session access instead of generic message search at the session gate', () => {
  expect(resolvePaywallContent('sessionHistory')).toMatchObject({
    titleKey: 'Explore your Agent conversations',
    subtitleKey: 'Read complete channel, task and subagent conversations, and reply where supported.',
    actionKey: null,
  });
});


it('keeps file editing separate from OpenClaw logs and preserves continuation actions', () => {
  expect(resolvePaywallContent('coreFileEditing')).toMatchObject({
    titleKey: 'Edit your Agent’s memory and files',
    actionKey: 'editing this file',
    benefits: [expect.objectContaining({ kind: 'memory' }), expect.anything(), expect.anything(), expect.anything()],
  });
  expect(resolvePaywallContent('logs')).toMatchObject({
    actionKey: 'viewing logs',
    benefits: [expect.objectContaining({ kind: 'logsFiles' }), expect.anything(), expect.anything(), expect.anything()],
  });
  expect(resolvePaywallContent('agents').benefits.map(item => item.kind)).toEqual([
    'agents', 'connections', 'sessions', 'memory',
  ]);
});
