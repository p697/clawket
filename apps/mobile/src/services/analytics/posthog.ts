import PostHog from 'posthog-react-native';
import { publicAnalyticsConfig } from '../../config/public';

export type PostHogConfig = {
  apiKey: string;
  host: string;
};

export const posthogConfig: PostHogConfig | null = publicAnalyticsConfig;

export const posthogClient = posthogConfig
  ? new PostHog(posthogConfig.apiKey, {
    host: posthogConfig.host,
    captureAppLifecycleEvents: true,
    persistence: 'file',
  })
  : null;

export const posthogAutocapture = {
  captureScreens: false,
  captureTouches: false,
} as const;

export type PostHogDiagnostics = {
  enabled: boolean;
  host: string | null;
  apiKeyMasked: string | null;
  clientInitialized: boolean;
  recentEvents: ReadonlyArray<PostHogDiagnosticEvent>;
};

export type PostHogDiagnosticEvent = {
  kind: 'event' | 'screen';
  name: string;
  properties: Readonly<Record<string, boolean | number | string>>;
};

const MAX_DIAGNOSTIC_EVENTS = 20;
const recentEvents: PostHogDiagnosticEvent[] = [];

export function recordPostHogDiagnosticEvent(
  kind: PostHogDiagnosticEvent['kind'],
  name: string,
  properties: Record<string, boolean | number | string>,
): void {
  recentEvents.push({ kind, name, properties: { ...properties } });
  if (recentEvents.length > MAX_DIAGNOSTIC_EVENTS) {
    recentEvents.splice(0, recentEvents.length - MAX_DIAGNOSTIC_EVENTS);
  }
}

export function capturePostHogScreen(
  name: string,
  properties: Record<string, boolean | number | string>,
): Promise<void> {
  recordPostHogDiagnosticEvent('screen', name, properties);
  return posthogClient?.screen(name, properties).then(() => undefined) ?? Promise.resolve();
}

function maskSecret(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 10) return '***';
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

export function getPostHogDiagnostics(): PostHogDiagnostics {
  return {
    enabled: Boolean(posthogConfig),
    host: posthogConfig?.host ?? null,
    apiKeyMasked: maskSecret(posthogConfig?.apiKey),
    clientInitialized: Boolean(posthogClient),
    recentEvents: recentEvents.map((event) => ({
      ...event,
      properties: { ...event.properties },
    })),
  };
}
