import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBonjourAdvertiser, buildBonjourServiceType, parseBonjourService } from './bonjour-pairing.js';

describe('bonjour-pairing', () => {
  const published: Array<{
    name: string;
    type: string;
    port: number;
    host?: string;
    txt?: Record<string, string>;
  }> = [];
  let stopped = false;

  beforeEach(() => {
    published.length = 0;
    stopped = false;
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  function createMockBonjour() {
    return {
      publish(opts: {
        name: string;
        type: string;
        port: number;
        host?: string;
        txt?: Record<string, string>;
      }) {
        published.push(opts);
        return {
          name: opts.name,
          type: opts.type,
          port: opts.port,
          host: opts.host,
          txt: opts.txt,
          stop(callback?: () => void) {
            stopped = true;
            callback?.();
          },
        };
      },
    };
  }

  it('advertises a Hermes bridge service with correct TXT records', async () => {
    const advertiser = createBonjourAdvertiser(
      {
        host: '192.168.1.42',
        port: 4319,
        wsPath: '/v1/hermes/ws',
        backend: 'hermes',
        transport: 'local',
        token: 'binarybros-hermes-clawket-2026',
        displayName: 'Studio Bridge',
      },
      () => createMockBonjour(),
    );

    await advertiser.start();

    expect(published).toHaveLength(1);
    const [record] = published;
    expect(record.name).toBe('Studio Bridge @ 192.168.1.42:4319');
    expect(record.type).toBe('clawket-hermes');
    expect(record.port).toBe(4319);
    expect(record.host).toBe('192.168.1.42');
    expect(record.txt).toMatchObject({
      backend: 'hermes',
      transport: 'local',
      token: 'binarybros-hermes-clawket-2026',
      displayName: 'Studio Bridge',
      wsPath: '/v1/hermes/ws',
    });
  });

  it('stops the underlying service on stop', async () => {
    const advertiser = createBonjourAdvertiser(
      {
        host: '192.168.1.42',
        port: 4319,
        wsPath: '/v1/hermes/ws',
        backend: 'hermes',
        transport: 'local',
      },
      () => createMockBonjour(),
    );

    await advertiser.start();
    await advertiser.stop();

    expect(stopped).toBe(true);
    expect(advertiser.getService()).toBeNull();
  });

  it('builds a sanitized Bonjour service type for any backend', () => {
    expect(buildBonjourServiceType('hermes')).toBe('clawket-hermes');
    expect(buildBonjourServiceType('openclaw')).toBe('clawket-openclaw');
    expect(buildBonjourServiceType('AgentZero')).toBe('clawket-agentzero');
  });

  it('parses a discovered service into usable fields', () => {
    const parsed = parseBonjourService({
      name: 'Studio Bridge @ 192.168.1.42:4319',
      type: 'clawket-hermes',
      port: 4319,
      host: '192.168.1.42',
      txt: { backend: 'hermes', transport: 'local', wsPath: '/v1/hermes/ws' },
    });
    expect(parsed.host).toBe('192.168.1.42');
    expect(parsed.port).toBe(4319);
    expect(parsed.type).toBe('clawket-hermes');
    expect(parsed.txt.backend).toBe('hermes');
  });

  it('defaults displayName when no name is provided', async () => {
    const advertiser = createBonjourAdvertiser(
      {
        host: '100.89.167.39',
        port: 4319,
        wsPath: '/v1/hermes/ws',
        backend: 'hermes',
        transport: 'tailscale',
        token: 'secret',
      },
      () => createMockBonjour(),
    );

    await advertiser.start();

    expect(published[0].name).toBe('Clawket Hermes @ 100.89.167.39:4319');
    expect(published[0].txt).toMatchObject({
      transport: 'tailscale',
      token: 'secret',
    });
  });
});
