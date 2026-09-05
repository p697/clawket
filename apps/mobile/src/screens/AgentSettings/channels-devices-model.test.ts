import {
  CAPABILITY_MATRIX,
  type ChannelsStatusResult,
  type ManagementOperations,
} from '@clawket/agent-protocol';
import {
  buildChannelRows,
  compactIdentifier,
  getChannelsDevicesViews,
  sortDeviceRequests,
  sortDevices,
  sortNodeRequests,
  sortNodes,
} from './channels-devices-model';

const status: ChannelsStatusResult = {
  ts: 1,
  channelOrder: ['telegram', 'discord'],
  channelLabels: { telegram: 'Telegram', discord: 'Discord', slack: 'Slack' },
  channelDetailLabels: { telegram: 'Telegram bot' },
  channelSystemImages: {},
  channelMeta: [],
  channels: {
    telegram: { configured: true },
    discord: {},
    slack: { linked: true },
  },
  channelAccounts: {
    telegram: [{ accountId: 'work', connected: true }],
    discord: [{ accountId: 'main', running: true }],
  },
  channelDefaultAccountId: {},
};

describe('channels and devices model', () => {
  it('exposes only capability-backed management views', () => {
    const management: ManagementOperations = {
      channels: { status: jest.fn() },
      devices: { list: jest.fn() },
      nodes: { list: jest.fn() },
    };
    expect(getChannelsDevicesViews(CAPABILITY_MATRIX.openclaw, management)).toEqual([
      'channels',
      'devices',
      'nodes',
    ]);
    expect(getChannelsDevicesViews({
      ...CAPABILITY_MATRIX.openclaw,
      channels: false,
      nodes: false,
    }, management)).toEqual(['devices']);
    expect(getChannelsDevicesViews(CAPABILITY_MATRIX.openclaw, {})).toEqual([]);
  });

  it('builds ordered channel rows and resolves aggregate status', () => {
    expect(buildChannelRows(status).map((row) => ({
      id: row.id,
      state: row.state,
      detail: row.detailLabel,
    }))).toEqual([
      { id: 'telegram', state: 'connected', detail: 'Telegram bot' },
      { id: 'discord', state: 'running', detail: 'Discord' },
      { id: 'slack', state: 'linked', detail: 'Slack' },
    ]);
  });

  it('sorts devices by pairing time and pending requests by request time', () => {
    const devices = [
      { deviceId: 'a', displayName: 'Alpha', pairedAtMs: 1 },
      { deviceId: 'z', displayName: 'Zulu', pairedAtMs: 5 },
    ];
    expect(sortDevices(devices).map((device) => device.deviceId)).toEqual(['z', 'a']);
    expect(sortDeviceRequests([
      { requestId: 'old', deviceId: 'a', requestedAtMs: 1 },
      { requestId: 'new', deviceId: 'z', requestedAtMs: 5 },
    ]).map((request) => request.requestId)).toEqual(['new', 'old']);
  });

  it('sorts connected nodes first and node requests by request time', () => {
    const base = { caps: [], commands: [], paired: true };
    expect(sortNodes([
      { ...base, nodeId: 'z', displayName: 'Zulu', connected: false },
      { ...base, nodeId: 'a', displayName: 'Alpha', connected: true },
    ]).map((node) => node.nodeId)).toEqual(['a', 'z']);
    expect(sortNodeRequests([
      { requestId: 'old', nodeId: 'a', requestedAtMs: 1 },
      { requestId: 'new', nodeId: 'z', requestedAtMs: 5 },
    ]).map((request) => request.requestId)).toEqual(['new', 'old']);
  });

  it('compacts long identifiers while keeping short ones intact', () => {
    expect(compactIdentifier('short-id')).toBe('short-id');
    expect(compactIdentifier('1234567890abcdefghijklmnop')).toBe('12345678…klmnop');
  });
});
