import { canonicalizeOfficialRelayUrl } from '../../../../packages/bridge-core/src/official-relay';
import type { BackendKind } from '@clawket/agent-protocol';
import { pairingRequest } from './pairing-request';
import { resolveOfficialRelayEnvironment } from './relay-environment';

type PairClaimResponse = {
  gatewayId?: string;
  relayUrl?: string;
  clientToken?: string;
  displayName?: string | null;
  region?: string;
  error?: { code?: string; message?: string };
};

export type RelayPairingClaimResult = {
  gatewayId: string;
  relayUrl: string;
  clientToken: string;
  displayName: string | null;
  region: string | null;
};

export type PairingQrPayload =
  | {
      v: 2;
      k: 'cp';
      s: string;
      g: string;
      a: string;
      n?: string;
      t?: string | null;
      p?: string | null;
    }
  | {
      version: 1;
      kind: 'clawket_pair';
      server: string;
      gatewayId: string;
      accessCode: string;
      relayUrl?: string;
      displayName?: string;
      token?: string | null;
      password?: string | null;
    };

export const RelayPairingService = {
  async claim(input: {
    backendKind?: BackendKind;
    serverUrl: string;
    gatewayId: string;
    accessCode: string;
    clientLabel?: string | null;
  }): Promise<RelayPairingClaimResult> {
    return pairingRequest(async (signal, receivedResponse) => {
      const response = await fetch(`${normalizeHttpBase(input.serverUrl)}/v1/pair/claim`, {
        signal,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          gatewayId: input.gatewayId,
          accessCode: input.accessCode,
          clientLabel: input.clientLabel ?? null,
        }),
      });

      receivedResponse(response.status);
      if (!response.ok) {
        throw await toRelayError(response, 'Failed to claim Relay pairing code.');
      }

      const payload = await response.json() as PairClaimResponse;
      const gatewayId = payload.gatewayId?.trim() ?? '';
      const relayUrl = payload.relayUrl?.trim() ?? '';
      const clientToken = payload.clientToken?.trim() ?? '';
      if (!gatewayId || !relayUrl || !clientToken) {
        throw new Error('Pairing response missing relay connection fields.');
      }

      return {
        gatewayId,
        relayUrl,
        clientToken,
        displayName: typeof payload.displayName === 'string' ? payload.displayName : null,
        region: typeof payload.region === 'string' ? payload.region : null,
      };
    }, { backend: input.backendKind ?? 'unknown', transport: 'relay', operation: 'pair_claim',
      environment: resolveOfficialRelayEnvironment(input.serverUrl) ?? 'custom' });
  },
};

export function normalizeHttpBase(url: string): string {
  const trimmed = canonicalizeOfficialRelayUrl(url.trim());
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed.replace(/\/+$/, '');
  }
  if (trimmed.startsWith('ws://')) return `http://${trimmed.slice('ws://'.length)}`.replace(/\/+$/, '');
  if (trimmed.startsWith('wss://')) return `https://${trimmed.slice('wss://'.length)}`.replace(/\/+$/, '');
  return `https://${trimmed}`.replace(/\/+$/, '');
}

async function toRelayError(response: Response, fallbackMessage: string): Promise<Error> {
  try {
    const payload = await response.json() as { error?: { code?: string; message?: string } };
    const code = payload.error?.code?.trim();
    const message = payload.error?.message?.trim();
    const friendly = code ? toFriendlyPairingMessage(code, message) : null;
    if (friendly) {
      return new Error(friendly);
    }
    if (code || message) {
      return new Error([code, message].filter(Boolean).join(': '));
    }
  } catch {
    // Keep fallback message.
  }
  return new Error(fallbackMessage);
}

function toFriendlyPairingMessage(code: string, message?: string): string | null {
  switch (code) {
    case 'ACCESS_CODE_EXPIRED':
      return 'This QR code has expired. Generate a new QR code in Clawket Bridge and try again.';
    case 'ACCESS_CODE_REQUIRED':
      return 'This QR code has already been used. Generate a new QR code in Clawket Bridge and try again.';
    case 'UNAUTHORIZED':
      if (message?.toLowerCase().includes('access code')) {
        return 'This QR code is invalid. Generate a new QR code in Clawket Bridge and try again.';
      }
      return null;
    default:
      return null;
  }
}
