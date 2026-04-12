import { loadGatewayChannelsBundle } from './gateway-channels';

describe('gateway-channels', () => {
  const baseChannelsStatus = {
    ts: 123,
    channelOrder: ['telegram'],
    channelLabels: { telegram: 'Telegram' },
    channelDetailLabels: {},
    channelSystemImages: {},
    channelMeta: [],
    channels: { telegram: { connected: true } },
    channelAccounts: { telegram: [] },
    channelDefaultAccountId: {},
  };

  it('loads channels status and dm scope from config', async () => {
    const gateway = {
      getChannelsStatus: jest.fn().mockResolvedValue(baseChannelsStatus),
      getConfig: jest.fn().mockResolvedValue({
        config: {
          session: {
            dmScope: 'per-channel-peer',
          },
        },
        hash: 'channels_hash',
      }),
    };

    await expect(loadGatewayChannelsBundle(gateway)).resolves.toEqual({
      channelsStatus: baseChannelsStatus,
      config: {
        dmScope: 'per-channel-peer',
        configHash: 'channels_hash',
      },
    });
  });

  it('returns null config when getConfig rejects but keeps channels status', async () => {
    const gateway = {
      getChannelsStatus: jest.fn().mockResolvedValue(baseChannelsStatus),
      getConfig: jest.fn().mockRejectedValue(new Error('config rpc timeout')),
    };

    await expect(loadGatewayChannelsBundle(gateway)).resolves.toEqual({
      channelsStatus: baseChannelsStatus,
      config: null,
    });
  });

  it('rejects when getChannelsStatus rejects', async () => {
    const channelsError = new Error('channels rpc failed');
    const gateway = {
      getChannelsStatus: jest.fn().mockRejectedValue(channelsError),
      getConfig: jest.fn().mockResolvedValue({ config: null, hash: null }),
    };

    await expect(loadGatewayChannelsBundle(gateway)).rejects.toBe(channelsError);
  });
});
