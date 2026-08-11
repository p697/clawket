import { describe, expect, it } from 'vitest';
import {
  createMultipeerAdvertiser,
  buildMultipeerServiceType,
  buildMultipeerInvitationPayload,
} from './multipeer-pairing.js';

describe('multipeer-pairing scaffold', () => {
  it('builds a valid Apple Multipeer service type', () => {
    expect(buildMultipeerServiceType('hermes')).toBe('clawk-hermes');
    expect(buildMultipeerServiceType('openclaw')).toBe('clawk-openclaw');
    expect(buildMultipeerServiceType('AgentZero')).toBe('clawk-agentzero');
    // Apple limits service types to 15 chars.
    expect(buildMultipeerServiceType('some-really-long-name').length).toBeLessThanOrEqual(15);
  });

  it('builds an invitation payload containing bridge URLs', () => {
    const payload = buildMultipeerInvitationPayload({
      displayName: 'Studio Bridge',
      serviceType: 'clawk-hermes',
      bridgeWsUrl: 'ws://100.89.167.39:4319/v1/hermes/ws?token=secret',
      bridgeHttpUrl: 'http://100.89.167.39:4319',
      token: 'secret',
    });
    expect(payload.bridgeWsUrl).toBe('ws://100.89.167.39:4319/v1/hermes/ws?token=secret');
    expect(payload.bridgeHttpUrl).toBe('http://100.89.167.39:4319');
    expect(payload.token).toBe('secret');
  });

  it('starts and stops a placeholder advertiser without native dependencies', async () => {
    const advertiser = createMultipeerAdvertiser({
      displayName: 'Studio Bridge',
      serviceType: 'clawk-hermes',
      bridgeWsUrl: 'ws://100.89.167.39:4319/v1/hermes/ws?token=secret',
      bridgeHttpUrl: 'http://100.89.167.39:4319',
    });

    await advertiser.start();
    expect(advertiser.getPeers()).toEqual([]);
    await advertiser.stop();
  });
});
