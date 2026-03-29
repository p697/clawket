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
};

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
  };
}
