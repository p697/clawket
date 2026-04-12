type HermesPairClaimResponse = {
  bridgeId?: string;
  relayUrl?: string;
  clientToken?: string;
  displayName?: string | null;
  region?: string;
  error?: { code?: string; message?: string };
};

export type HermesRelayPairingClaimResult = {
  bridgeId: string;
  relayUrl: string;
  clientToken: string;
  displayName: string | null;
  region: string | null;
};

export const HermesRelayPairingService = {
  async claim(input: {
    serverUrl: string;
    bridgeId: string;
    accessCode: string;
    clientLabel?: string | null;
  }): Promise<HermesRelayPairingClaimResult> {
    const response = await fetch(`${normalizeHttpBase(input.serverUrl)}/v1/hermes/pair/claim`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        bridgeId: input.bridgeId,
        accessCode: input.accessCode,
        clientLabel: input.clientLabel ?? null,
      }),
    });

    if (!response.ok) {
      throw await toRelayError(response, 'Failed to claim Hermes Relay pairing code.');
    }

    const payload = await response.json() as HermesPairClaimResponse;
    const bridgeId = payload.bridgeId?.trim() ?? '';
    const relayUrl = payload.relayUrl?.trim() ?? '';
    const clientToken = payload.clientToken?.trim() ?? '';
    if (!bridgeId || !relayUrl || !clientToken) {
      throw new Error('Hermes pairing response missing relay connection fields.');
    }

    return {
      bridgeId,
      relayUrl,
      clientToken,
      displayName: typeof payload.displayName === 'string' ? payload.displayName : null,
      region: typeof payload.region === 'string' ? payload.region : null,
    };
  },
};

function normalizeHttpBase(url: string): string {
  const trimmed = url.trim();
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
      return 'This Hermes Relay QR code has expired. Generate a new QR code in Clawket Bridge and try again.';
    case 'ACCESS_CODE_REQUIRED':
      return 'This Hermes Relay QR code has already been used. Generate a new QR code in Clawket Bridge and try again.';
    case 'UNAUTHORIZED':
      if (message?.toLowerCase().includes('access code')) {
        return 'This Hermes Relay QR code is invalid. Generate a new QR code in Clawket Bridge and try again.';
      }
      return null;
    default:
      return null;
  }
}
