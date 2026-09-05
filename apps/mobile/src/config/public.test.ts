import {
  buildSupportEmailUrl,
  resolvePublicAnalyticsConfig,
  resolvePublicAppLinks,
  resolvePublicRevenueCatConfig,
  resolvePublicYouMindAuthConfig,
} from './public';

describe('resolvePublicAppLinks', () => {
  it('reads configured public links from env', () => {
    expect(resolvePublicAppLinks({
      EXPO_PUBLIC_DISCORD_INVITE_URL: 'https://discord.gg/example',
      EXPO_PUBLIC_PRIVACY_POLICY_URL: 'https://example.com/privacy',
      EXPO_PUBLIC_TERMS_OF_USE_URL: 'https://example.com/terms',
      EXPO_PUBLIC_SUPPORT_EMAIL: 'support@example.com',
      EXPO_PUBLIC_DOCS_URL: 'https://docs.example.com',
      EXPO_PUBLIC_OPENCLAW_RELEASES_URL: 'https://github.com/example/openclaw/releases',
      EXPO_PUBLIC_OPENCLAW_LATEST_RELEASE_API: 'https://api.github.com/repos/example/openclaw/releases/latest',
      EXPO_PUBLIC_IOS_APP_STORE_ID: '123456',
    } as unknown as NodeJS.ProcessEnv)).toEqual({
      discordInviteUrl: 'https://discord.gg/example',
      privacyPolicyUrl: 'https://example.com/privacy',
      termsOfUseUrl: 'https://example.com/terms',
      supportEmail: 'support@example.com',
      docsUrl: 'https://docs.example.com',
      openClawReleasesUrl: 'https://github.com/example/openclaw/releases',
      openClawLatestReleaseApiUrl: 'https://api.github.com/repos/example/openclaw/releases/latest',
      iosAppStoreId: '123456',
    });
  });

  it('normalizes empty public links to null', () => {
    expect(resolvePublicAppLinks({} as NodeJS.ProcessEnv)).toEqual({
      discordInviteUrl: null,
      privacyPolicyUrl: null,
      termsOfUseUrl: null,
      supportEmail: null,
      docsUrl: null,
      openClawReleasesUrl: null,
      openClawLatestReleaseApiUrl: null,
      iosAppStoreId: null,
    });
  });
});

describe('resolvePublicAnalyticsConfig', () => {
  it('requires both api key and host', () => {
    expect(resolvePublicAnalyticsConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(resolvePublicAnalyticsConfig({
      EXPO_PUBLIC_POSTHOG_API_KEY: 'key',
    } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });

  it('returns analytics config when fully configured', () => {
    expect(resolvePublicAnalyticsConfig({
      EXPO_PUBLIC_POSTHOG_ENABLED: 'true',
      EXPO_PUBLIC_POSTHOG_API_KEY: 'key',
      EXPO_PUBLIC_POSTHOG_HOST: 'https://analytics.example.com',
    } as unknown as NodeJS.ProcessEnv)).toEqual({
      enabled: true,
      apiKey: 'key',
      host: 'https://analytics.example.com',
    });
  });

  it('lets an explicit disable override present values', () => {
    expect(resolvePublicAnalyticsConfig({
      EXPO_PUBLIC_POSTHOG_ENABLED: 'false',
      EXPO_PUBLIC_POSTHOG_API_KEY: 'key',
      EXPO_PUBLIC_POSTHOG_HOST: 'https://analytics.example.com',
    } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe('resolvePublicRevenueCatConfig', () => {
  it('supports explicit enable flags', () => {
    expect(resolvePublicRevenueCatConfig({
      EXPO_PUBLIC_REVENUECAT_ENABLED: 'true',
      EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY: 'appl_key',
      EXPO_PUBLIC_REVENUECAT_PRO_ENTITLEMENT_ID: 'Clawket Pro',
    } as unknown as NodeJS.ProcessEnv)).toEqual({
      enabled: true,
      iosApiKey: 'appl_key',
      androidApiKey: null,
      entitlementId: 'Clawket Pro',
      offeringId: null,
      packageId: null,
      testApiKey: null,
    });
  });

  it('can infer enabled state from populated values', () => {
    expect(resolvePublicRevenueCatConfig({
      EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY: 'goog_key',
    } as unknown as NodeJS.ProcessEnv).enabled).toBe(true);
  });
});

describe('buildSupportEmailUrl', () => {
  it('builds a mailto link when an email is present', () => {
    expect(buildSupportEmailUrl('support@example.com')).toBe('mailto:support@example.com');
    expect(buildSupportEmailUrl(null)).toBeNull();
  });
});

describe('resolvePublicYouMindAuthConfig', () => {
  it('returns null for every field when no env overrides are provided', () => {
    expect(resolvePublicYouMindAuthConfig({} as NodeJS.ProcessEnv)).toEqual({
      appSecret: null,
    });
  });

  it('reads the OTP request signing secret from env', () => {
    expect(resolvePublicYouMindAuthConfig({
      EXPO_PUBLIC_YOUMIND_APP_SECRET: 'app-secret',
    } as unknown as NodeJS.ProcessEnv)).toEqual({
      appSecret: 'app-secret',
    });
  });
});
