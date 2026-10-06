import {
  AdapterError, BRIDGE_UPDATE_START_METHOD, BRIDGE_UPDATE_STATUS_METHOD, parseBridgeUpdateStart, parseBridgeUpdateStatus,
  type BridgeUpdateOperations,
} from '@clawket/agent-protocol';

/** Phone-started Bridge update over an adapter's own request path; malformed replies never reach the UI. */
export function bridgeUpdateOperations(request: (method: string) => Promise<unknown>): BridgeUpdateOperations {
  return {
    async start() {
      const result = parseBridgeUpdateStart(await request(BRIDGE_UPDATE_START_METHOD));
      if (!result) throw new AdapterError('unsupported', 'Invalid Bridge update reply');
      return result;
    },
    async status() {
      const reply = await request(BRIDGE_UPDATE_STATUS_METHOD) as { status?: unknown } | null;
      if (reply?.status === null || reply?.status === undefined) return null;
      const status = parseBridgeUpdateStatus(reply.status);
      if (!status) throw new AdapterError('unsupported', 'Invalid Bridge update status');
      return status;
    },
  };
}
