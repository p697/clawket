import {
  CAPABILITY_MATRIX,
  type ChannelsStatusResult,
  type ManagementOperations,
} from '@clawket/agent-protocol';
import {
  buildChannelRows,
  channelAccountName,
  compactIdentifier,
  getChannelsDevicesViews,
  isChannelAccountEnabled,
  resolveChannelManage,
  setChannelAccountEnabled,
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
  channelDefaultAccountId: { telegram: 'work' },
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
      defaultAccountId: row.defaultAccountId,
    }))).toEqual([
      { id: 'telegram', state: 'connected', detail: 'Telegram bot', defaultAccountId: 'work' },
      { id: 'discord', state: 'running', detail: 'Discord', defaultAccountId: undefined },
      { id: 'slack', state: 'linked', detail: 'Slack', defaultAccountId: undefined },
    ]);
  });

  it('exposes channel writes only behind channelManage with every operation present', () => {
    const writes = {
      getRouting: jest.fn(),
      setRouting: jest.fn(),
      setAccountEnabled: jest.fn(),
    };
    const management: ManagementOperations = { channels: { status: jest.fn(), ...writes } };
    expect(resolveChannelManage(CAPABILITY_MATRIX.openclaw, management)).toEqual(writes);
    expect(resolveChannelManage(CAPABILITY_MATRIX.hermes, management)).toBeNull();
    expect(resolveChannelManage({ ...CAPABILITY_MATRIX.openclaw, channelManage: false }, management)).toBeNull();
    expect(resolveChannelManage(CAPABILITY_MATRIX.openclaw, { channels: { status: jest.fn(), getRouting: jest.fn() } })).toBeNull();
    expect(resolveChannelManage(CAPABILITY_MATRIX.openclaw, undefined)).toBeNull();
  });

  it('mirrors a confirmed account write without touching other accounts or unknown ids', () => {
    const next = setChannelAccountEnabled(status, 'telegram', 'work', false);
    expect(next.channelAccounts.telegram).toEqual([{ accountId: 'work', connected: true, enabled: false }]);
    expect(next.channelAccounts.discord).toBe(status.channelAccounts.discord);
    expect(status.channelAccounts.telegram[0].enabled).toBeUndefined();
    expect(setChannelAccountEnabled(status, 'telegram', 'missing', false)).toBe(status);
    expect(setChannelAccountEnabled(status, 'slack', 'work', false)).toBe(status);
  });

  it('names accounts and treats a missing enabled flag as running', () => {
    expect(channelAccountName({ accountId: 'work', name: ' Work bot ' })).toBe('Work bot');
    expect(channelAccountName({ accountId: 'work', name: '  ' })).toBe('work');
    expect(isChannelAccountEnabled({ accountId: 'work' })).toBe(true);
    expect(isChannelAccountEnabled({ accountId: 'work', enabled: true })).toBe(true);
    expect(isChannelAccountEnabled({ accountId: 'work', enabled: false })).toBe(false);
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
