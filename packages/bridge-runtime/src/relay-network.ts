import { HttpsProxyAgent } from 'https-proxy-agent';
import type { ClientOptions } from 'ws';

/** Explicitly scoped to cloud Relay sockets; local Gateway/model traffic stays direct. */
export function relayNetworkOptions(env: NodeJS.ProcessEnv = process.env): Pick<ClientOptions, 'agent' | 'handshakeTimeout'> {
  const value = env.CLAWKET_RELAY_PROXY_URL?.trim();
  if (!value) return { handshakeTimeout: 15_000 };
  let proxy: URL;
  try {
    proxy = new URL(value);
    if (!['http:', 'https:'].includes(proxy.protocol)) throw new Error();
  } catch {
    throw new Error('CLAWKET_RELAY_PROXY_URL must be an HTTP or HTTPS proxy URL');
  }
  return { agent: new HttpsProxyAgent(proxy), handshakeTimeout: 15_000 };
}
