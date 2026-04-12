import { loadGatewayNodesBundle } from './gateway-nodes';

describe('gateway-nodes', () => {
  it('loads nodes and tolerates device-pair fetch failures', async () => {
    const gateway = {
      listNodes: jest.fn().mockResolvedValue({
        nodes: [{ nodeId: 'node-1', caps: [], commands: [], paired: true, connected: true }],
      }),
      listNodePairRequests: jest.fn().mockResolvedValue({
        pending: [{ requestId: 'pair-1', nodeId: 'node-2' }],
      }),
      listDevices: jest.fn().mockRejectedValue(new Error('device list failed')),
    };

    await expect(loadGatewayNodesBundle(gateway)).resolves.toEqual({
      nodes: [{ nodeId: 'node-1', caps: [], commands: [], paired: true, connected: true }],
      nodePairRequests: [{ requestId: 'pair-1', nodeId: 'node-2' }],
      devicePairRequests: [],
    });
  });

  it('fails when required node resources cannot be fetched', async () => {
    const gateway = {
      listNodes: jest.fn().mockRejectedValue(new Error('nodes failed')),
      listNodePairRequests: jest.fn().mockResolvedValue({ pending: [] }),
      listDevices: jest.fn().mockResolvedValue({ pending: [] }),
    };

    await expect(loadGatewayNodesBundle(gateway)).rejects.toThrow('nodes failed');
  });
});
