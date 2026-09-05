import {
  buildGatewayDefaultName,
  resolveGatewayBackendKind,
  resolveGatewayTransportKind,
  type ConnectionDescriptor,
} from '@clawket/agent-protocol';
import type { ConnectionCoordinator } from '../index';
import {
  markHermesConnectTrace,
} from '../hermes-connect-trace';
import type { NewConnectionRecord } from '../registry/connection-store';
import { resolveOfficialRelayEnvironment } from '../../services/relay-environment';
import type { GatewayScanPayload } from './gateway-scan-flow';

export type PairingConnectionRuntime = Pick<
  ConnectionCoordinator,
  'activate' | 'getSnapshot' | 'probeActive' | 'upsertConnection'
>;

export type SavePairedConnectionResult = Readonly<{
  connection: ConnectionDescriptor;
  created: boolean;
  probeSucceeded: boolean;
}>;

export function buildPairedConnectionRecord(input: Readonly<{
  payload: GatewayScanPayload;
  debugMode: boolean;
  connectionCount: number;
}>): NewConnectionRecord {
  const url = input.payload.url.trim();
  if (!url) throw new Error('Pairing payload is missing a connection URL.');
  const backendKind = resolveGatewayBackendKind(input.payload);
  const transportKind = resolveGatewayTransportKind(input.payload);
  const relay = transportKind === 'relay' ? buildRelayRecord(input.payload) : undefined;
  if (transportKind === 'relay' && !relay) {
    throw new Error('Relay pairing payload is missing its identity.');
  }
  const hermes = backendKind === 'hermes' && transportKind !== 'relay'
    ? {
      bridgeUrl: input.payload.hermes?.bridgeUrl?.trim() || url,
      ...(input.payload.hermes?.displayName?.trim()
        ? { displayName: input.payload.hermes.displayName.trim() }
        : {}),
    }
    : undefined;
  const label = input.payload.relay?.displayName?.trim()
    || input.payload.hermes?.displayName?.trim()
    || buildGatewayDefaultName({
      backendKind,
      transportKind,
      url,
      index: input.connectionCount + 1,
    });
  const token = input.payload.token?.trim();
  const password = input.payload.password?.trim();
  const auth = token || password
    ? { ...(token ? { token } : {}), ...(password ? { password } : {}) }
    : undefined;
  const environment = relay
    ? resolveOfficialRelayEnvironment(relay.serverUrl) ?? undefined
    : undefined;

  return {
    backendKind,
    transportKind,
    label,
    ...(environment ? { environment } : {}),
    url,
    ...(auth ? { auth } : {}),
    ...(input.payload.bootstrap ? { bootstrap: input.payload.bootstrap } : {}),
    ...(relay ? { relay } : {}),
    ...(hermes ? { hermes } : {}),
    debugMode: input.debugMode,
  };
}

export async function savePairedConnection(input: Readonly<{
  runtime: PairingConnectionRuntime;
  payload: GatewayScanPayload;
  debugMode: boolean;
}>): Promise<SavePairedConnectionResult> {
  const backendKind = resolveGatewayBackendKind(input.payload);
  const transportKind = resolveGatewayTransportKind(input.payload);
  if (backendKind === 'hermes') {
    markHermesConnectTrace('scan_config_save_begin', { transport: transportKind });
  }
  const record = buildPairedConnectionRecord({
    payload: input.payload,
    debugMode: input.debugMode,
    connectionCount: input.runtime.getSnapshot().connections.length,
  });
  const saved = await input.runtime.upsertConnection(record);
  await input.runtime.activate(saved.connection.id);
  const probeSucceeded = await input.runtime.probeActive();
  if (backendKind === 'hermes') {
    markHermesConnectTrace('scan_config_save_done', {
      transport: transportKind,
      configCount: input.runtime.getSnapshot().connections.length,
    });
  }
  return { ...saved, probeSucceeded };
}

function buildRelayRecord(
  payload: GatewayScanPayload,
): NewConnectionRecord['relay'] {
  const serverUrl = payload.relay?.serverUrl?.trim().replace(/\/+$/, '');
  const gatewayId = payload.relay?.gatewayId?.trim();
  if (!serverUrl || !gatewayId) return undefined;
  const clientToken = payload.relay?.clientToken?.trim();
  const displayName = payload.relay?.displayName?.trim();
  return {
    serverUrl,
    gatewayId,
    ...(clientToken ? { clientToken } : {}),
    ...(displayName ? { displayName } : {}),
    ...(payload.relay?.protocolVersion !== undefined
      ? { protocolVersion: payload.relay.protocolVersion }
      : {}),
    ...(payload.relay?.supportsBootstrap !== undefined
      ? { supportsBootstrap: payload.relay.supportsBootstrap }
      : {}),
  };
}
