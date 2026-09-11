import type { AgentAdapter } from '@clawket/agent-protocol';

export type ConnectionAdapterRuntimeMetadata = Readonly<{
  bridgeVersion?: string;
  bridgeCapabilities?: ReadonlyArray<string>;
}>;

export type ConnectionRuntimeDetails = Readonly<{
  lastReadyAt: number | null;
  bridgeVersion: string | null;
  bridgeCapabilities: ReadonlyArray<string>;
}>;

type RuntimeMetadataAdapter = AgentAdapter & Readonly<{
  getConnectionRuntimeMetadata?: () => ConnectionAdapterRuntimeMetadata;
}>;

export function readConnectionRuntimeMetadata(
  adapter: AgentAdapter,
): Omit<ConnectionRuntimeDetails, 'lastReadyAt'> {
  const metadata = (adapter as RuntimeMetadataAdapter).getConnectionRuntimeMetadata?.();
  const bridgeVersion = cleanString(metadata?.bridgeVersion);
  const bridgeCapabilities = Object.freeze(Array.from(new Set(
    (metadata?.bridgeCapabilities ?? [])
      .map(cleanString)
      .filter((value): value is string => value !== null),
  )));
  return Object.freeze({ bridgeVersion, bridgeCapabilities });
}

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
