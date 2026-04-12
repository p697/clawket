import {
  DEFAULT_GATEWAY_TOOL_SETTINGS,
  loadGatewayToolSettingsBundle,
} from './gateway-tool-settings';

describe('gateway-tool-settings service', () => {
  it('exposes stable default settings', () => {
    expect(DEFAULT_GATEWAY_TOOL_SETTINGS).toEqual({
      webSearchEnabled: true,
      webFetchEnabled: true,
      execSecurity: 'deny',
      execAsk: 'on-miss',
      mediaImageEnabled: true,
      mediaAudioEnabled: true,
      mediaVideoEnabled: true,
      linksEnabled: true,
    });
  });

  it('loads parsed settings and config hash from gateway config', async () => {
    const gateway = {
      getConfig: jest.fn().mockResolvedValue({
        config: {
          tools: {
            web: {
              search: { enabled: false },
              fetch: { enabled: true },
            },
            exec: {
              security: 'allowlist',
              ask: 'always',
            },
            media: {
              image: { enabled: false },
              audio: { enabled: true },
              video: { enabled: false },
            },
            links: { enabled: false },
          },
        },
        hash: 'tool_hash',
      }),
    };

    await expect(loadGatewayToolSettingsBundle(gateway)).resolves.toEqual({
      settings: {
        webSearchEnabled: false,
        webFetchEnabled: true,
        execSecurity: 'allowlist',
        execAsk: 'always',
        mediaImageEnabled: false,
        mediaAudioEnabled: true,
        mediaVideoEnabled: false,
        linksEnabled: false,
      },
      configHash: 'tool_hash',
    });
  });
});
