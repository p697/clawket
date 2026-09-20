import type {
  Capabilities,
  ChannelStatusAccount,
  ChannelSummary,
  ChannelsOperations,
  ChannelsStatusResult,
  DeviceInfo,
  DevicePairRequest,
  ManagementOperations,
  NodeInfo,
  NodePairRequest,
} from '@clawket/agent-protocol';

export type ChannelsDevicesView = 'channels' | 'devices' | 'nodes';
export type ChannelConnectionState =
  | 'connected'
  | 'running'
  | 'linked'
  | 'configured'
  | 'not-configured';

export type ChannelRow = Readonly<{
  id: string;
  label: string;
  detailLabel: string;
  state: ChannelConnectionState;
  accounts: ReadonlyArray<ChannelStatusAccount>;
  defaultAccountId?: string;
}>;

/** The `channelManage` refinement needs every write operation; a partial adapter reads only. */
export type ChannelManageOperations = Required<Pick<
  ChannelsOperations,
  'getRouting' | 'setRouting' | 'setAccountEnabled'
>>;

export function resolveChannelManage(
  capabilities: Capabilities,
  management: ManagementOperations | undefined,
): ChannelManageOperations | null {
  const channels = management?.channels;
  if (
    !capabilities.channels
    || capabilities.channelManage !== true
    || !channels?.getRouting
    || !channels.setRouting
    || !channels.setAccountEnabled
  ) {
    return null;
  }
  return {
    getRouting: channels.getRouting,
    setRouting: channels.setRouting,
    setAccountEnabled: channels.setAccountEnabled,
  };
}

export function channelAccountName(account: ChannelStatusAccount): string {
  return account.name?.trim() || account.accountId;
}

/** `enabled` is absent on Gateways that never wrote the flag; those accounts run. */
export function isChannelAccountEnabled(account: ChannelStatusAccount): boolean {
  return account.enabled !== false;
}

/** Mirrors a confirmed account write locally until the next status refresh lands. */
export function setChannelAccountEnabled(
  status: ChannelsStatusResult,
  channelId: string,
  accountId: string,
  enabled: boolean,
): ChannelsStatusResult {
  const accounts = status.channelAccounts[channelId];
  if (!accounts?.some((account) => account.accountId === accountId)) return status;
  return {
    ...status,
    channelAccounts: {
      ...status.channelAccounts,
      [channelId]: accounts.map((account) => (
        account.accountId === accountId ? { ...account, enabled } : account
      )),
    },
  };
}

export function getChannelsDevicesViews(
  capabilities: Capabilities,
  management: ManagementOperations | undefined,
): ChannelsDevicesView[] {
  return [
    ...(capabilities.channels && management?.channels?.status ? ['channels' as const] : []),
    ...(capabilities.devices && management?.devices?.list ? ['devices' as const] : []),
    ...(capabilities.nodes && management?.nodes?.list ? ['nodes' as const] : []),
  ];
}

export function buildChannelRows(status: ChannelsStatusResult): ChannelRow[] {
  const ids = new Set<string>([
    ...status.channelOrder,
    ...Object.keys(status.channelLabels),
    ...Object.keys(status.channels),
    ...Object.keys(status.channelAccounts),
  ]);
  const order = new Map(status.channelOrder.map((id, index) => [id, index]));
  return [...ids].map((id) => {
    const label = status.channelLabels[id] || fallbackLabel(id);
    const accounts = status.channelAccounts[id] ?? [];
    return {
      id,
      label,
      detailLabel: status.channelDetailLabels[id] || label,
      state: resolveChannelConnectionState(status.channels[id] ?? {}, accounts),
      accounts,
      ...(status.channelDefaultAccountId[id] ? { defaultAccountId: status.channelDefaultAccountId[id] } : {}),
    };
  }).sort((a, b) => {
    const orderDelta = (order.get(a.id) ?? Number.MAX_SAFE_INTEGER)
      - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER);
    return orderDelta || a.label.localeCompare(b.label);
  });
}

export function resolveChannelConnectionState(
  summary: ChannelSummary,
  accounts: ReadonlyArray<ChannelStatusAccount>,
): ChannelConnectionState {
  if (summary.connected || accounts.some((account) => account.connected)) return 'connected';
  if (summary.running || accounts.some((account) => account.running)) return 'running';
  if (summary.linked || accounts.some((account) => account.linked)) return 'linked';
  if (summary.configured || accounts.some((account) => account.configured)) return 'configured';
  return 'not-configured';
}

export function sortDevices(devices: ReadonlyArray<DeviceInfo>): DeviceInfo[] {
  return [...devices].sort((a, b) => (
    (b.pairedAtMs ?? 0) - (a.pairedAtMs ?? 0)
    || deviceLabel(a).localeCompare(deviceLabel(b))
  ));
}

export function sortDeviceRequests(
  requests: ReadonlyArray<DevicePairRequest>,
): DevicePairRequest[] {
  return [...requests].sort((a, b) => (
    (b.requestedAtMs ?? 0) - (a.requestedAtMs ?? 0)
    || deviceRequestLabel(a).localeCompare(deviceRequestLabel(b))
  ));
}

export function sortNodes(nodes: ReadonlyArray<NodeInfo>): NodeInfo[] {
  return [...nodes].sort((a, b) => (
    Number(b.connected) - Number(a.connected)
    || nodeLabel(a).localeCompare(nodeLabel(b))
  ));
}

export function sortNodeRequests(
  requests: ReadonlyArray<NodePairRequest>,
): NodePairRequest[] {
  return [...requests].sort((a, b) => (
    (b.requestedAtMs ?? 0) - (a.requestedAtMs ?? 0)
    || nodeRequestLabel(a).localeCompare(nodeRequestLabel(b))
  ));
}

export function deviceLabel(device: DeviceInfo): string {
  return device.displayName?.trim() || compactIdentifier(device.deviceId);
}

export function deviceRequestLabel(request: DevicePairRequest): string {
  return request.displayName?.trim() || compactIdentifier(request.deviceId);
}

export function nodeLabel(node: NodeInfo): string {
  return node.displayName?.trim() || compactIdentifier(node.nodeId);
}

export function nodeRequestLabel(request: NodePairRequest): string {
  return request.displayName?.trim() || compactIdentifier(request.nodeId);
}

export function compactIdentifier(value: string): string {
  return value.length <= 20 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function fallbackLabel(id: string): string {
  return id ? `${id.charAt(0).toLocaleUpperCase()}${id.slice(1)}` : 'Channel';
}
