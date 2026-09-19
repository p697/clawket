import {
  AdapterError,
  type BackendKind,
} from '@clawket/agent-protocol';
import { analyticsEvents } from '../../services/analytics/events';
import {
  assessRelayEnvironmentSelection,
  getOfficialHermesRegistryUrl,
  getOfficialRelayRegistryUrl,
  isEnvironmentIndependentRegistry,
  OFFICIAL_LOCAL_MODEL_PREVIEW_REGISTRY_URL,
} from '../../services/relay-environment';
import { parsePairingLink } from '../../services/pairing-session';
import type { RelayServiceEnvironment } from '../../types';
import { HermesRelayPairingService } from '../registry/hermes-relay-pairing';
import {
  savePairedConnection,
  type PairingConnectionRuntime,
} from './save-paired-connection';
import {
  assessPairingPayload,
  claimRelayPairing,
  type GatewayScanPayload,
  type PairingPayloadAssessment,
} from './gateway-scan-flow';

export type PairingBackendKind = Extract<BackendKind, 'openclaw' | 'hermes' | 'local-model'>;

export type BackendPairingResult = Readonly<{
  backendKind: PairingBackendKind;
  connectionId: string;
}>;

type BackendPairingContext = Readonly<{
  backendKind: PairingBackendKind;
  environment: RelayServiceEnvironment;
  debugMode: boolean;
  runtime: PairingConnectionRuntime;
}>;

type BackendPairingInput = BackendPairingContext & Readonly<{
  secureInvitation: Readonly<{
    connectCode(input: {
      serverUrl: string;
      pairingCode: string;
      expectedBackendKind: PairingBackendKind;
      /** Omitted for the environment-independent local-model Registry. */
      environment?: RelayServiceEnvironment;
    }): Promise<boolean>;
    connectLink(url: string, expectation: {
      expectedBackendKind: PairingBackendKind;
      environment?: RelayServiceEnvironment;
    }): Promise<boolean>;
  }>;
}>;

export type BackendCodePairingInput = BackendPairingInput & Readonly<{
  pairingCode: string;
}>;

export type BackendLinkPairingInput = BackendPairingInput & Readonly<{
  url: string;
}>;

export type BackendPairingPayload = GatewayScanPayload;

export type BackendPayloadPairingInput = BackendPairingContext & Readonly<{
  payload: BackendPairingPayload;
  /** Registry which supplied a decrypted invitation, when applicable. */
  sourceServerUrl?: string;
}>;

type BackendPairingProfile = Readonly<{
  connectCode(input: BackendCodePairingInput): Promise<BackendPairingResult | null>;
  connectLink(input: BackendLinkPairingInput): Promise<BackendPairingResult | null>;
  reportsCodeOutcome: boolean;
}>;

const BACKEND_PAIRING_PROFILES: Readonly<Record<PairingBackendKind, BackendPairingProfile>> = {
  // Local model has one dedicated Registry and no Production twin, so pairing
  // ignores the selected environment and Debug Mode (owner decision 2026-09-19).
  'local-model': {
    reportsCodeOutcome: false,
    async connectCode(input) {
      const connected = await input.secureInvitation.connectCode({
        serverUrl: OFFICIAL_LOCAL_MODEL_PREVIEW_REGISTRY_URL, pairingCode: input.pairingCode,
        expectedBackendKind: 'local-model',
      });
      return connected ? requireExpectedActiveConnection('local-model', input.runtime) : null;
    },
    async connectLink(input) {
      const descriptor = parsePairingLink(input.url);
      if (!descriptor || !isEnvironmentIndependentRegistry(descriptor.serverUrl)) {
        throw new AdapterError('unsupported', 'Local model pairing requires the local model Registry');
      }
      const connected = await input.secureInvitation.connectLink(input.url, { expectedBackendKind: 'local-model' });
      return connected ? requireExpectedActiveConnection('local-model', input.runtime) : null;
    },
  },
  openclaw: {
    reportsCodeOutcome: false,
    async connectCode(input) {
      const connected = await input.secureInvitation.connectCode({
        serverUrl: getOfficialRelayRegistryUrl(input.environment),
        pairingCode: input.pairingCode,
        expectedBackendKind: input.backendKind,
        environment: input.environment,
      });
      // The invitation owner has already presented failure feedback, or the user cancelled.
      if (!connected) return null;
      return requireExpectedActiveConnection('openclaw', input.runtime);
    },
    async connectLink(input) {
      const descriptor = parsePairingLink(input.url);
      if (!descriptor) {
        throw new AdapterError('pairing_expired', 'OpenClaw pairing link is invalid or expired.');
      }
      if (assessRelayEnvironmentSelection({
        serverUrl: descriptor.serverUrl,
        selectedEnvironment: input.environment,
        debugMode: input.debugMode,
      })) {
        throw new AdapterError('unsupported', 'Pairing link belongs to another service environment.');
      }
      const connected = await input.secureInvitation.connectLink(input.url, {
        expectedBackendKind: input.backendKind,
        environment: input.environment,
      });
      if (!connected) return null;
      return requireExpectedActiveConnection('openclaw', input.runtime);
    },
  },
  hermes: {
    reportsCodeOutcome: true,
    async connectCode(input) {
      const serverUrl = getOfficialHermesRegistryUrl(input.environment);
      const claimed = await HermesRelayPairingService.claimCode({
        serverUrl,
        pairingCode: input.pairingCode,
      });
      const saved = await savePairedConnection({
        runtime: input.runtime,
        payload: {
          url: claimed.relayUrl,
          backendKind: 'hermes',
          transportKind: 'relay',
          mode: 'hermes',
          relay: {
            serverUrl,
            gatewayId: claimed.bridgeId,
            clientToken: claimed.clientToken,
            relayUrl: claimed.relayUrl,
            displayName: claimed.displayName ?? undefined,
          },
        },
        debugMode: input.debugMode,
        source: 'pairing_code',
      });
      return requireExpectedConnection('hermes', saved.connection);
    },
    async connectLink() {
      throw new AdapterError('unsupported', 'Hermes Relay does not support secure pairing links.');
    },
  },
};

export async function connectBackendPairingCode(
  input: BackendCodePairingInput,
): Promise<BackendPairingResult | null> {
  const profile = BACKEND_PAIRING_PROFILES[input.backendKind];
  try {
    const result = await profile.connectCode(input);
    if (profile.reportsCodeOutcome) {
      analyticsEvents.gatewaySecurePairingFinished({
        method: 'code',
        environment: input.environment,
        connected: true,
      });
    }
    return result;
  } catch (error) {
    if (profile.reportsCodeOutcome) {
      analyticsEvents.gatewaySecurePairingFinished({
        method: 'code',
        environment: input.environment,
        connected: false,
      });
    }
    throw error;
  }
}

export function connectBackendPairingLink(
  input: BackendLinkPairingInput,
): Promise<BackendPairingResult | null> {
  return BACKEND_PAIRING_PROFILES[input.backendKind].connectLink(input);
}

const relayClaimInFlightRef: {
  current: Map<string, Promise<GatewayScanPayload>>;
} = { current: new Map() };

/**
 * Validates, claims, re-validates, saves, and activates a QR payload through
 * one connection-layer path. No caller can persist a mismatched backend or an
 * official Relay payload from the wrong selected environment.
 */
export async function connectBackendPairingPayload(
  input: BackendPayloadPairingInput,
): Promise<BackendPairingResult> {
  assertAcceptedPayload(input, input.payload);
  const resolved = input.payload.relay?.accessCode
    ? await claimRelayPairing(input.payload, relayClaimInFlightRef)
    : input.payload;
  assertAcceptedPayload(input, resolved);
  const saved = await savePairedConnection({
    runtime: input.runtime,
    payload: resolved,
    debugMode: input.debugMode,
    source: 'pairing_qr',
  });
  return requireExpectedConnection(input.backendKind, saved.connection);
}

function assertAcceptedPayload(
  input: BackendPayloadPairingInput,
  payload: GatewayScanPayload,
): void {
  const assessment = assessPairingPayload({
    payload,
    expectedBackendKind: input.backendKind,
    selectedEnvironment: input.environment,
    debugMode: input.debugMode,
    ...(input.sourceServerUrl ? { sourceServerUrl: input.sourceServerUrl } : {}),
  });
  if (assessment.kind === 'accepted') return;
  throw new AdapterError('unsupported', pairingPayloadRejectionMessage(assessment));
}

function pairingPayloadRejectionMessage(
  assessment: Extract<PairingPayloadAssessment, { kind: 'rejected' }>,
): string {
  switch (assessment.reason) {
    case 'backend_mismatch':
      return 'Pairing payload belongs to another backend.';
    case 'preview_requires_debug_mode':
      return 'Enable Debug Mode before pairing with Preview.';
    case 'official_environment_mismatch':
      return 'Pairing payload belongs to another service environment.';
    case 'invalid_backend':
      return 'Pairing payload has invalid backend metadata.';
  }
}

function requireExpectedActiveConnection(
  backendKind: PairingBackendKind,
  runtime: PairingConnectionRuntime,
): BackendPairingResult {
  const snapshot = runtime.getSnapshot();
  const connection = snapshot.connections.find(
    (candidate) => candidate.id === snapshot.activeConnectionId,
  );
  return requireExpectedConnection(backendKind, connection);
}

function requireExpectedConnection(
  backendKind: PairingBackendKind,
  connection: Readonly<{ id: string; backendKind: BackendKind }> | null | undefined,
): BackendPairingResult {
  if (!connection || connection.backendKind !== backendKind) {
    throw new AdapterError('unsupported', 'Pairing did not create the expected backend connection.');
  }
  return { backendKind, connectionId: connection.id };
}
