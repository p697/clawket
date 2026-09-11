import type { MutableRefObject } from 'react';
import { selectByBackend } from '@clawket/agent-protocol';

import { RelayPairingService } from '../../services/relay-pairing';
import { assessRelayEnvironmentSelection } from '../../services/relay-environment';
import type {
  GatewayBackendKind,
  GatewayConfig,
  GatewayMode,
  GatewayTransportKind,
  RelayServiceEnvironment,
} from '../../types';
import { markHermesConnectTrace, startHermesConnectTrace } from '../hermes-connect-trace';
import { HermesRelayPairingService } from '../registry/hermes-relay-pairing';
import { buildRelayClaimKey } from './connection-form-utils';

export type GatewayScanPayload = {
  url: string;
  token?: string;
  password?: string;
  bootstrap?: GatewayConfig['bootstrap'];
  backendKind?: GatewayBackendKind;
  transportKind?: GatewayTransportKind;
  mode?: GatewayMode;
  hermes?: {
    bridgeUrl: string;
    displayName?: string;
  };
  relay?: {
    serverUrl: string;
    gatewayId: string;
    accessCode?: string;
    clientToken?: string;
    relayUrl?: string;
    displayName?: string;
    protocolVersion?: number;
    supportsBootstrap?: boolean;
  };
};

export type PairingBackendKind = Extract<GatewayBackendKind, 'openclaw' | 'hermes' | 'local-model'>;

export type PairingPayloadAssessment =
  | Readonly<{ kind: 'accepted'; backendKind: PairingBackendKind }>
  | Readonly<{
      kind: 'rejected';
      reason:
        | 'invalid_backend'
        | 'backend_mismatch'
        | 'preview_requires_debug_mode'
        | 'official_environment_mismatch';
      backendKind: PairingBackendKind | null;
    }>;

/**
 * Resolve every backend hint rather than trusting the legacy mode fallback.
 * Conflicting hints are invalid so pairing cannot save one backend while the
 * caller is waiting for another.
 */
export function resolvePairingPayloadBackend(
  payload: GatewayScanPayload,
): PairingBackendKind | null {
  const hints = new Set<PairingBackendKind>();

  if (payload.backendKind !== undefined) {
    if (payload.backendKind !== 'openclaw' && payload.backendKind !== 'hermes' && payload.backendKind !== 'local-model') {
      return null;
    }
    hints.add(payload.backendKind);
  }

  if (payload.mode === 'hermes') {
    hints.add('hermes');
  } else if (payload.mode !== undefined && !(payload.backendKind === 'local-model' && payload.mode === 'relay')) {
    hints.add('openclaw');
  }

  if (payload.hermes) hints.add('hermes');

  if (hints.size === 0) {
    const hasLegacyOpenClawShape = Boolean(
      payload.relay
      || payload.token
      || payload.password
      || payload.bootstrap,
    );
    if (hasLegacyOpenClawShape) hints.add('openclaw');
  }

  return hints.size === 1 ? [...hints][0] : null;
}

export function assessPairingPayload(input: Readonly<{
  payload: GatewayScanPayload;
  expectedBackendKind: PairingBackendKind;
  selectedEnvironment: RelayServiceEnvironment;
  debugMode: boolean;
  /** Registry which supplied an encrypted invitation, when applicable. */
  sourceServerUrl?: string;
}>): PairingPayloadAssessment {
  const backendAssessment = assessPairingPayloadBackend(
    input.payload,
    input.expectedBackendKind,
  );
  if (backendAssessment.kind === 'rejected') return backendAssessment;
  const { backendKind } = backendAssessment;

  const serverUrls = new Set([
    input.sourceServerUrl?.trim(),
    input.payload.relay?.serverUrl.trim(),
  ].filter((value): value is string => Boolean(value)));
  for (const serverUrl of serverUrls) {
    const environmentIssue = assessRelayEnvironmentSelection({
      serverUrl,
      selectedEnvironment: input.selectedEnvironment,
      debugMode: input.debugMode,
    });
    if (environmentIssue) {
      return { kind: 'rejected', reason: environmentIssue, backendKind };
    }
  }

  return { kind: 'accepted', backendKind };
}

export function assessPairingPayloadBackend(
  payload: GatewayScanPayload,
  expectedBackendKind: PairingBackendKind,
): PairingPayloadAssessment {
  const backendKind = resolvePairingPayloadBackend(payload);
  if (!backendKind) {
    return { kind: 'rejected', reason: 'invalid_backend', backendKind: null };
  }
  if (backendKind !== expectedBackendKind) {
    return { kind: 'rejected', reason: 'backend_mismatch', backendKind };
  }
  return { kind: 'accepted', backendKind };
}

type RelayClaimInput = NonNullable<GatewayScanPayload['relay']> & {
  accessCode: string;
};

type RelayClaimHandler = (
  payload: GatewayScanPayload,
  relay: RelayClaimInput,
) => Promise<GatewayScanPayload>;

export async function claimRelayPairing(
  payload: GatewayScanPayload,
  inFlightRef: MutableRefObject<Map<string, Promise<GatewayScanPayload>>>,
): Promise<GatewayScanPayload> {
  const relay = payload.relay;
  const accessCode = relay?.accessCode;
  if (!relay || !accessCode) return payload;

  const claimKey = buildRelayClaimKey(relay.serverUrl, relay.gatewayId, accessCode);
  const existing = inFlightRef.current.get(claimKey);
  if (existing) return existing;

  const claimableRelay: RelayClaimInput = { ...relay, accessCode };
  const handler = selectByBackend<RelayClaimHandler>(payload, {
    openclaw: claimOpenClawRelay,
    hermes: claimHermesRelay,
    // Relay pairing is not a YouMind flow. Retaining the historical OpenClaw
    // fallback keeps malformed legacy payload handling backward compatible.
    youmind: claimOpenClawRelay,
  });
  const task = handler(payload, claimableRelay).finally(() => {
    inFlightRef.current.delete(claimKey);
  });

  inFlightRef.current.set(claimKey, task);
  return task;
}

async function claimOpenClawRelay(
  payload: GatewayScanPayload,
  relay: RelayClaimInput,
): Promise<GatewayScanPayload> {
  const claimed = await RelayPairingService.claim({
    serverUrl: relay.serverUrl,
    gatewayId: relay.gatewayId,
    accessCode: relay.accessCode,
  });
  const relayUrl = claimed.relayUrl.trim();
  return {
    url: relayUrl,
    backendKind: payload.backendKind === 'local-model' ? 'local-model' : 'openclaw',
    transportKind: 'relay',
    token: payload.token,
    password: payload.password,
    bootstrap: payload.bootstrap,
    mode: 'relay',
    relay: {
      serverUrl: relay.serverUrl,
      gatewayId: claimed.gatewayId,
      clientToken: claimed.clientToken,
      relayUrl,
      displayName: claimed.displayName ?? relay.displayName,
      protocolVersion: relay.protocolVersion,
      supportsBootstrap: relay.supportsBootstrap,
    },
  };
}

async function claimHermesRelay(
  _payload: GatewayScanPayload,
  relay: RelayClaimInput,
): Promise<GatewayScanPayload> {
  startHermesConnectTrace('scan_claim_begin', { transport: 'relay' });
  const claimed = await HermesRelayPairingService.claim({
    serverUrl: relay.serverUrl,
    bridgeId: relay.gatewayId,
    accessCode: relay.accessCode,
  });
  const relayUrl = claimed.relayUrl.trim();
  markHermesConnectTrace('scan_claim_done', { transport: 'relay' });
  return {
    url: relayUrl,
    backendKind: 'hermes',
    transportKind: 'relay',
    mode: 'hermes',
    relay: {
      serverUrl: relay.serverUrl,
      gatewayId: claimed.bridgeId,
      clientToken: claimed.clientToken,
      relayUrl,
      displayName: claimed.displayName ?? relay.displayName,
      protocolVersion: relay.protocolVersion,
      supportsBootstrap: relay.supportsBootstrap,
    },
  };
}
