function trimEnv(value: string | undefined | null): string {
  return value?.trim() ?? '';
}

type PublicEnv = Partial<Record<
  | 'EXPO_PUBLIC_DISCORD_INVITE_URL'
  | 'EXPO_PUBLIC_PRIVACY_POLICY_URL'
  | 'EXPO_PUBLIC_TERMS_OF_USE_URL'
  | 'EXPO_PUBLIC_SUPPORT_EMAIL'
  | 'EXPO_PUBLIC_DOCS_URL'
  | 'EXPO_PUBLIC_OPENCLAW_RELEASES_URL'
  | 'EXPO_PUBLIC_OPENCLAW_LATEST_RELEASE_API'
  | 'EXPO_PUBLIC_IOS_APP_STORE_ID'
  | 'EXPO_PUBLIC_POSTHOG_ENABLED'
  | 'EXPO_PUBLIC_POSTHOG_API_KEY'
  | 'EXPO_PUBLIC_POSTHOG_HOST'
  | 'EXPO_PUBLIC_REVENUECAT_ENABLED'
  | 'EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY'
  | 'EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY'
  | 'EXPO_PUBLIC_REVENUECAT_PRO_ENTITLEMENT_ID'
  | 'EXPO_PUBLIC_REVENUECAT_PRO_OFFERING_ID'
  | 'EXPO_PUBLIC_REVENUECAT_PRO_PACKAGE_ID'
  | 'EXPO_PUBLIC_REVENUECAT_TEST_API_KEY',
  string | undefined
>> & Partial<NodeJS.ProcessEnv>;

const STATIC_PUBLIC_ENV: PublicEnv = {
  EXPO_PUBLIC_DISCORD_INVITE_URL: process.env.EXPO_PUBLIC_DISCORD_INVITE_URL,
  EXPO_PUBLIC_PRIVACY_POLICY_URL: process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL,
  EXPO_PUBLIC_TERMS_OF_USE_URL: process.env.EXPO_PUBLIC_TERMS_OF_USE_URL,
  EXPO_PUBLIC_SUPPORT_EMAIL: process.env.EXPO_PUBLIC_SUPPORT_EMAIL,
  EXPO_PUBLIC_DOCS_URL: process.env.EXPO_PUBLIC_DOCS_URL,
  EXPO_PUBLIC_OPENCLAW_RELEASES_URL: process.env.EXPO_PUBLIC_OPENCLAW_RELEASES_URL,
  EXPO_PUBLIC_OPENCLAW_LATEST_RELEASE_API: process.env.EXPO_PUBLIC_OPENCLAW_LATEST_RELEASE_API,
  EXPO_PUBLIC_IOS_APP_STORE_ID: process.env.EXPO_PUBLIC_IOS_APP_STORE_ID,
  EXPO_PUBLIC_POSTHOG_ENABLED: process.env.EXPO_PUBLIC_POSTHOG_ENABLED,
  EXPO_PUBLIC_POSTHOG_API_KEY: process.env.EXPO_PUBLIC_POSTHOG_API_KEY,
  EXPO_PUBLIC_POSTHOG_HOST: process.env.EXPO_PUBLIC_POSTHOG_HOST,
  EXPO_PUBLIC_REVENUECAT_ENABLED: process.env.EXPO_PUBLIC_REVENUECAT_ENABLED,
  EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY: process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY,
  EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY: process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY,
  EXPO_PUBLIC_REVENUECAT_PRO_ENTITLEMENT_ID: process.env.EXPO_PUBLIC_REVENUECAT_PRO_ENTITLEMENT_ID,
  EXPO_PUBLIC_REVENUECAT_PRO_OFFERING_ID: process.env.EXPO_PUBLIC_REVENUECAT_PRO_OFFERING_ID,
  EXPO_PUBLIC_REVENUECAT_PRO_PACKAGE_ID: process.env.EXPO_PUBLIC_REVENUECAT_PRO_PACKAGE_ID,
  EXPO_PUBLIC_REVENUECAT_TEST_API_KEY: process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY,
};

function parseBooleanEnv(value: string | undefined | null): boolean | null {
  const normalized = trimEnv(value).toLowerCase();
  if (!normalized) return null;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function readOptionalEnv(name: string, env: PublicEnv = STATIC_PUBLIC_ENV): string | null {
  const value = trimEnv(env[name]);
  return value ? value : null;
}

function resolveIntegrationEnabled(params: {
  envFlagName: string;
  env: PublicEnv;
  values: Array<string | null>;
}): boolean {
  const explicit = parseBooleanEnv(params.env[params.envFlagName]);
  if (explicit != null) return explicit;
  return params.values.some(Boolean);
}

export type PublicAppLinks = {
  discordInviteUrl: string | null;
  privacyPolicyUrl: string | null;
  termsOfUseUrl: string | null;
  supportEmail: string | null;
  docsUrl: string | null;
  openClawReleasesUrl: string | null;
  openClawLatestReleaseApiUrl: string | null;
  iosAppStoreId: string | null;
};

export type PublicAnalyticsConfig = {
  enabled: true;
  apiKey: string;
  host: string;
};

export type PublicRevenueCatConfig = {
  enabled: boolean;
  iosApiKey: string | null;
  androidApiKey: string | null;
  entitlementId: string | null;
  offeringId: string | null;
  packageId: string | null;
  testApiKey: string | null;
};

export function resolvePublicAppLinks(env: PublicEnv = STATIC_PUBLIC_ENV): PublicAppLinks {
  return {
    discordInviteUrl: readOptionalEnv('EXPO_PUBLIC_DISCORD_INVITE_URL', env),
    privacyPolicyUrl: readOptionalEnv('EXPO_PUBLIC_PRIVACY_POLICY_URL', env),
    termsOfUseUrl: readOptionalEnv('EXPO_PUBLIC_TERMS_OF_USE_URL', env),
    supportEmail: readOptionalEnv('EXPO_PUBLIC_SUPPORT_EMAIL', env),
    docsUrl: readOptionalEnv('EXPO_PUBLIC_DOCS_URL', env),
    openClawReleasesUrl: readOptionalEnv('EXPO_PUBLIC_OPENCLAW_RELEASES_URL', env),
    openClawLatestReleaseApiUrl: readOptionalEnv('EXPO_PUBLIC_OPENCLAW_LATEST_RELEASE_API', env),
    iosAppStoreId: readOptionalEnv('EXPO_PUBLIC_IOS_APP_STORE_ID', env),
  };
}

export function resolvePublicAnalyticsConfig(
  env: PublicEnv = STATIC_PUBLIC_ENV,
): PublicAnalyticsConfig | null {
  const apiKey = readOptionalEnv('EXPO_PUBLIC_POSTHOG_API_KEY', env);
  const host = readOptionalEnv('EXPO_PUBLIC_POSTHOG_HOST', env);
  const enabled = resolveIntegrationEnabled({
    envFlagName: 'EXPO_PUBLIC_POSTHOG_ENABLED',
    env,
    values: [apiKey, host],
  });
  if (!enabled || !apiKey || !host) return null;

  return { enabled: true, apiKey, host };
}

export function resolvePublicRevenueCatConfig(env: PublicEnv = STATIC_PUBLIC_ENV): PublicRevenueCatConfig {
  const iosApiKey = readOptionalEnv('EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY', env);
  const androidApiKey = readOptionalEnv('EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY', env);
  const entitlementId = readOptionalEnv('EXPO_PUBLIC_REVENUECAT_PRO_ENTITLEMENT_ID', env);
  const offeringId = readOptionalEnv('EXPO_PUBLIC_REVENUECAT_PRO_OFFERING_ID', env);
  const packageId = readOptionalEnv('EXPO_PUBLIC_REVENUECAT_PRO_PACKAGE_ID', env);
  const testApiKey = readOptionalEnv('EXPO_PUBLIC_REVENUECAT_TEST_API_KEY', env);
  const enabled = resolveIntegrationEnabled({
    envFlagName: 'EXPO_PUBLIC_REVENUECAT_ENABLED',
    env,
    values: [iosApiKey, androidApiKey, entitlementId, offeringId, packageId, testApiKey],
  });

  return {
    enabled,
    iosApiKey,
    androidApiKey,
    entitlementId,
    offeringId,
    packageId,
    testApiKey,
  };
}

export function buildSupportEmailUrl(email: string | null): string | null {
  if (!email) return null;
  return `mailto:${email}`;
}

export const publicAppLinks = resolvePublicAppLinks();
export const publicAnalyticsConfig = resolvePublicAnalyticsConfig();
export const publicRevenueCatConfig = resolvePublicRevenueCatConfig();
