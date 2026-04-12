import { publicAppLinks } from '../config/public';
import type { GatewayConfig } from '../types';
import { selectByBackend } from './gateway-backends';

export type GatewayDocumentationDescriptor = {
  url: string | null;
  source: 'openclaw' | 'hermes';
};

const HERMES_DOCUMENTATION_URL = 'https://hermes-agent.nousresearch.com/docs/getting-started/quickstart';
type GatewayDocumentationPage = 'root' | 'nodes';

export function resolveGatewayDocumentationDescriptor(
  config: GatewayConfig | null | undefined,
): GatewayDocumentationDescriptor {
  return selectByBackend<GatewayDocumentationDescriptor>(config, {
    openclaw: {
      url: publicAppLinks.docsUrl,
      source: 'openclaw',
    },
    hermes: {
      url: HERMES_DOCUMENTATION_URL,
      source: 'hermes',
    },
  });
}

export function resolveGatewayDocumentationPageUrl(
  config: GatewayConfig | null | undefined,
  page: GatewayDocumentationPage,
): string | null {
  const descriptor = resolveGatewayDocumentationDescriptor(config);
  if (!descriptor.url) {
    return null;
  }
  if (descriptor.source !== 'openclaw') {
    return page === 'root' ? descriptor.url : null;
  }
  if (page === 'root') {
    return descriptor.url;
  }
  return `${descriptor.url.replace(/\/+$/, '')}/nodes/index#nodes`;
}
