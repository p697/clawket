import {
  resolveGatewayDocumentationDescriptor,
  resolveGatewayDocumentationPageUrl,
} from './gateway-doc-links';

describe('gateway-doc-links', () => {
  it('returns Hermes documentation for Hermes configs', () => {
    expect(resolveGatewayDocumentationDescriptor({
      url: 'ws://127.0.0.1:4319/v1/hermes/ws?token=test',
      backendKind: 'hermes',
    })).toEqual({
      url: 'https://hermes-agent.nousresearch.com/docs/getting-started/quickstart',
      source: 'hermes',
    });
  });

  it('returns the default OpenClaw docs source for non-Hermes configs', () => {
    expect(resolveGatewayDocumentationDescriptor({
      url: 'wss://example.com/ws',
      backendKind: 'openclaw',
    }).source).toBe('openclaw');
  });

  it('returns no Nodes documentation page for Hermes', () => {
    expect(resolveGatewayDocumentationPageUrl({
      url: 'ws://127.0.0.1:4319/v1/hermes/ws?token=test',
      backendKind: 'hermes',
    }, 'nodes')).toBeNull();
  });
});
