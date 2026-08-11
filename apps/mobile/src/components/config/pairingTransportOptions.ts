import type { AnimationObject } from 'lottie-react-native';

export type PairingTransportOptionId =
  | 'relay'
  | 'local'
  | 'tailscale'
  | 'bonjour'
  | 'multipeer'
  | 'airdrop';

export type PairingTransportOption = {
  id: PairingTransportOptionId;
  /** Short label for tabs / chips */
  label: string;
  /** One-line when-to-use copy */
  description: string;
  /** Host CLI command to generate a QR / deep link for this path */
  pairCommand: string;
  /** Optional agent prompt pair command (defaults to pairCommand) */
  agentPairCommand?: string;
  /** Lottie JSON asset (bundled). */
  lottie: AnimationObject | object;
  /** Whether this is a persistent data channel (AirDrop is handoff-only). */
  persistent: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const lottieTailscale = require('../../../assets/lottie/tailscale-connectivity.json');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const lottieBonjour = require('../../../assets/lottie/bonjour-network.json');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const lottieNearby = require('../../../assets/lottie/nearby-pulse.json');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const lottieMultipeer = require('../../../assets/lottie/multipeer-bluetooth.json');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const lottieAirdrop = require('../../../assets/lottie/airdrop-share.json');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const lottieLink = require('../../../assets/lottie/link-vector.json');

/**
 * Canonical pairing-transport chooser used by Clawket mobile onboarding.
 * Multica: HAB-240 (assets) · HAB-241 (mobile UI)
 * Assets harvested via LottieHarvest GraphQL (open CDN) — see docs/pairing-lottie/README.md
 */
export const PAIRING_TRANSPORT_OPTIONS: readonly PairingTransportOption[] = [
  {
    id: 'relay',
    label: 'Remote',
    description: 'Works anywhere via the cloud relay. Best default when you are not on the same network.',
    pairCommand: 'clawket pair',
    lottie: lottieLink,
    persistent: true,
  },
  {
    id: 'local',
    label: 'Same Wi-Fi',
    description: 'Direct LAN pairing when your phone and host share the same Wi-Fi.',
    pairCommand: 'clawket pair --local',
    agentPairCommand: 'clawket pair --local',
    lottie: lottieNearby,
    persistent: true,
  },
  {
    id: 'tailscale',
    label: 'Tailscale',
    description: 'Same tailnet, any network. Run pair with --transport tailscale on the host.',
    pairCommand: 'clawket hermes pair local --transport tailscale',
    lottie: lottieTailscale,
    persistent: true,
  },
  {
    id: 'bonjour',
    label: 'Bonjour',
    description: 'Zero-config discovery on LAN or MagicDNS. Host advertises via mDNS.',
    pairCommand: 'clawket hermes pair local --transport bonjour --advertise-bonjour',
    lottie: lottieBonjour,
    persistent: true,
  },
  {
    id: 'multipeer',
    label: 'Multipeer',
    description: 'Nearby Apple devices over Multipeer Connectivity (proximity / peer-to-peer).',
    pairCommand: 'clawket hermes pair local --transport multipeer',
    lottie: lottieMultipeer,
    persistent: true,
  },
  {
    id: 'airdrop',
    label: 'AirDrop',
    description: 'Share the pairing link from the host share sheet. Not a live tunnel — just the handoff.',
    pairCommand: 'clawket hermes pair local --share-airdrop',
    lottie: lottieAirdrop,
    persistent: false,
  },
] as const;

export function getPairingTransportOption(id: PairingTransportOptionId): PairingTransportOption {
  const found = PAIRING_TRANSPORT_OPTIONS.find((item) => item.id === id);
  if (!found) return PAIRING_TRANSPORT_OPTIONS[0];
  return found;
}
