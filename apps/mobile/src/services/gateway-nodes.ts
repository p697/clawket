import type { DevicePairRequest, NodeInfo, NodePairRequest } from '../types';

type GatewayNodesGateway = {
  listNodes(): Promise<{ nodes: NodeInfo[] }>;
  listNodePairRequests(): Promise<{ pending: NodePairRequest[] }>;
  listDevices(): Promise<{ pending: DevicePairRequest[] }>;
};

export type GatewayNodesBundle = {
  nodes: NodeInfo[];
  nodePairRequests: NodePairRequest[];
  devicePairRequests: DevicePairRequest[];
};

export async function loadGatewayNodesBundle(
  gateway: GatewayNodesGateway,
): Promise<GatewayNodesBundle> {
  const [nodeListResult, nodePairListResult, deviceListResult] = await Promise.allSettled([
    gateway.listNodes(),
    gateway.listNodePairRequests(),
    gateway.listDevices(),
  ]);

  const requiredFailure = [nodeListResult, nodePairListResult].find(
    (result) => result.status === 'rejected',
  );
  if (requiredFailure && requiredFailure.status === 'rejected') {
    throw requiredFailure.reason;
  }

  const nodeList = (nodeListResult as PromiseFulfilledResult<Awaited<ReturnType<GatewayNodesGateway['listNodes']>>>).value;
  const nodePairList = (nodePairListResult as PromiseFulfilledResult<Awaited<ReturnType<GatewayNodesGateway['listNodePairRequests']>>>).value;

  return {
    nodes: nodeList.nodes,
    nodePairRequests: nodePairList.pending,
    devicePairRequests: deviceListResult.status === 'fulfilled'
      ? deviceListResult.value.pending
      : [],
  };
}
