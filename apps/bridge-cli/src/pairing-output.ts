import type { PairingInfo, ServiceStatus } from '@clawket/bridge-core';

export function buildPairingJson(
  paired: PairingInfo,
  qrImagePath: string,
  service: ServiceStatus,
  message: string,
): Record<string, unknown> {
  return {
    ok: true,
    action: paired.action,
    message,
    gatewayId: paired.config.gatewayId,
    relayUrl: paired.config.relayUrl,
    serverUrl: paired.config.serverUrl,
    instanceId: paired.config.instanceId,
    accessCode: paired.accessCode,
    accessCodeExpiresAt: paired.accessCodeExpiresAt,
    ...(paired.pairingSession ? {
      pairingSession: {
        pairingUrl: paired.pairingSession.pairingUrl,
        pairingCode: paired.pairingSession.pairingCode,
        protocol: paired.pairingSession.protocol,
        expiresAt: paired.pairingSession.expiresAt,
      },
    } : {}),
    qrImagePath,
    service: {
      installed: service.installed,
      running: service.running,
      method: service.method,
      servicePath: service.servicePath,
      logPath: service.logPath,
      errorLogPath: service.errorLogPath,
      pid: service.pid,
    },
  };
}

export function buildLocalPairingJson(input: {
  gatewayUrl: string;
  authMode?: 'token' | 'password';
  expiresAt: number;
  qrImagePath: string;
  message: string;
  configUpdated?: boolean;
  controlUiOrigin?: string | null;
  gatewayRestartAction?: 'restarted' | 'started' | 'unchanged';
  customUrl?: boolean;
}): Record<string, unknown> {
  return {
    ok: true,
    action: 'local',
    message: input.message,
    gatewayUrl: input.gatewayUrl,
    ...(input.authMode ? { authMode: input.authMode } : {}),
    expiresAt: input.expiresAt,
    qrImagePath: input.qrImagePath,
    configUpdated: input.configUpdated ?? false,
    controlUiOrigin: input.controlUiOrigin ?? null,
    gatewayRestartAction: input.gatewayRestartAction ?? 'unchanged',
    customUrl: input.customUrl ?? false,
  };
}
