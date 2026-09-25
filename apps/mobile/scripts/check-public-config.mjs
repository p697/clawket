#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const XCODE_ENV_BLOCK_START = '# @generated begin clawket-xcode-env';
const XCODE_ENV_BLOCK_END = '# @generated end clawket-xcode-env';

function trim(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    if (!key || process.env[key] != null) continue;
    const value = line.slice(separatorIndex + 1).trim();
    process.env[key] = value;
  }
}

export function parseBoolean(value) {
  const normalized = trim(value).toLowerCase();
  if (!normalized) return null;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

export function buildConfig(env = process.env) {
  const readEnv = (name) => trim(env[name]) || null;
  const posthogApiKey = readEnv('EXPO_PUBLIC_POSTHOG_API_KEY');
  const posthogHost = readEnv('EXPO_PUBLIC_POSTHOG_HOST');
  const revenueCatAppleApiKey = readEnv('EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY');
  const revenueCatGoogleApiKey = readEnv('EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY');
  const revenueCatEntitlementId = readEnv('EXPO_PUBLIC_REVENUECAT_PRO_ENTITLEMENT_ID');
  const revenueCatOfferingId = readEnv('EXPO_PUBLIC_REVENUECAT_PRO_OFFERING_ID');
  const revenueCatPackageId = readEnv('EXPO_PUBLIC_REVENUECAT_PRO_PACKAGE_ID');
  const revenueCatTestApiKey = readEnv('EXPO_PUBLIC_REVENUECAT_TEST_API_KEY');
  const unlockProEnabled = parseBoolean(env.EXPO_PUBLIC_UNLOCK_PRO) === true;

  const enabledForEnv = (flagName, values) => {
    const explicit = parseBoolean(env[flagName]);
    if (explicit != null) return explicit;
    return values.some(Boolean);
  };
  const posthogEnabled = enabledForEnv('EXPO_PUBLIC_POSTHOG_ENABLED', [posthogApiKey, posthogHost]);
  const revenueCatEnabled = enabledForEnv('EXPO_PUBLIC_REVENUECAT_ENABLED', [
    revenueCatAppleApiKey,
    revenueCatGoogleApiKey,
    revenueCatEntitlementId,
    revenueCatOfferingId,
    revenueCatPackageId,
    revenueCatTestApiKey,
  ]);

  return {
    speech: { url: readEnv('EXPO_PUBLIC_SPEECH_URL') },
    posthog: {
      enabled: posthogEnabled,
      host: posthogHost,
      apiKeyConfigured: Boolean(posthogApiKey),
    },
    revenueCat: {
      enabled: revenueCatEnabled,
      appleApiKeyConfigured: Boolean(revenueCatAppleApiKey),
      googleApiKeyConfigured: Boolean(revenueCatGoogleApiKey),
      entitlementId: revenueCatEntitlementId,
      offeringId: revenueCatOfferingId,
      packageId: revenueCatPackageId,
      testApiKeyConfigured: Boolean(revenueCatTestApiKey),
    },
    debugOverrides: {
      unlockProEnabled,
    },
  };
}

const appRoot = resolve(import.meta.dirname, '..');
loadEnvFile(resolve(appRoot, '.env.local'));
loadEnvFile(resolve(appRoot, '.env'));

export function validateConfig(config, platform, env = process.env, root = appRoot) {
  const errors = [];
  const booleanFlags = [
    'CLAWKET_REQUIRE_POSTHOG',
    'CLAWKET_REQUIRE_REVENUECAT',
    'EXPO_PUBLIC_POSTHOG_ENABLED',
    'EXPO_PUBLIC_REVENUECAT_ENABLED',
    'EXPO_PUBLIC_UNLOCK_PRO',
    'CLAWKET_REQUIRE_SPEECH',
  ];

  for (const flagName of booleanFlags) {
    const rawValue = trim(env[flagName]);
    if (rawValue && parseBoolean(rawValue) == null) {
      errors.push(`${flagName} must be a boolean value (true/false or 1/0).`);
    }
  }

  const requirePostHog = parseBoolean(env.CLAWKET_REQUIRE_POSTHOG) === true;
  const requireRevenueCat = parseBoolean(env.CLAWKET_REQUIRE_REVENUECAT) === true;
  const requireSpeech = parseBoolean(env.CLAWKET_REQUIRE_SPEECH) === true;

  if (requirePostHog && !config.posthog.enabled) {
    errors.push('PostHog must be enabled for this build, but no EXPO_PUBLIC_POSTHOG_* configuration was found.');
  }

  if (config.posthog.enabled) {
    if (!config.posthog.host) errors.push('PostHog is enabled but EXPO_PUBLIC_POSTHOG_HOST is missing.');
    if (!config.posthog.apiKeyConfigured) errors.push('PostHog is enabled but EXPO_PUBLIC_POSTHOG_API_KEY is missing.');
  }

  if (requireRevenueCat && !config.revenueCat.enabled) {
    errors.push(`RevenueCat must be enabled for ${platform} store builds, but no EXPO_PUBLIC_REVENUECAT_* configuration was found.`);
  }

  if (requireSpeech && config.speech.url !== 'wss://speech.clawket.ai/v1/speech') {
    errors.push('Store builds require EXPO_PUBLIC_SPEECH_URL=wss://speech.clawket.ai/v1/speech.');
  }

  if (config.revenueCat.enabled) {
    if (!config.revenueCat.entitlementId) {
      errors.push('RevenueCat is enabled but EXPO_PUBLIC_REVENUECAT_PRO_ENTITLEMENT_ID is missing.');
    }
    if (platform === 'ios' && !config.revenueCat.appleApiKeyConfigured) {
      errors.push('RevenueCat is enabled for iOS but EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY is missing.');
    }
    if (platform === 'android' && !config.revenueCat.googleApiKeyConfigured) {
      errors.push('RevenueCat is enabled for Android but EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY is missing.');
    }
    if (platform === 'all' && !config.revenueCat.appleApiKeyConfigured && !config.revenueCat.googleApiKeyConfigured) {
      errors.push('RevenueCat is enabled but no platform API key is configured.');
    }
  }

  if ((platform === 'ios' || platform === 'android' || platform === 'all') && config.revenueCat.testApiKeyConfigured) {
    errors.push('EXPO_PUBLIC_REVENUECAT_TEST_API_KEY must not be set for store-distribution builds.');
  }

  if ((platform === 'ios' || platform === 'android' || platform === 'all') && config.debugOverrides.unlockProEnabled) {
    errors.push('EXPO_PUBLIC_UNLOCK_PRO must not be enabled for store-distribution builds.');
  }

  if (platform === 'ios' || platform === 'all') {
    const iosRoot = resolve(root, 'ios');
    const xcodeEnvPath = resolve(iosRoot, '.xcode.env');

    if (existsSync(iosRoot)) {
      if (!existsSync(xcodeEnvPath)) {
        errors.push('iOS project exists but ios/.xcode.env is missing. Run `npm run mobile:sync:native`.');
      } else {
        const xcodeEnvContent = readFileSync(xcodeEnvPath, 'utf8');
        const hasGeneratedBlock =
          xcodeEnvContent.includes(XCODE_ENV_BLOCK_START) && xcodeEnvContent.includes(XCODE_ENV_BLOCK_END);

        if (!hasGeneratedBlock) {
          errors.push(
            'iOS project exists but ios/.xcode.env does not source app env files. Run `npm run mobile:sync:native` to restore Xcode env wiring.',
          );
        }
      }
    }
  }

  return errors;
}

export function runCli(argv = process.argv.slice(2)) {
  const args = new Set(argv);
  const json = args.has('--json');
  const platform = args.has('--platform=ios')
    ? 'ios'
    : args.has('--platform=android')
      ? 'android'
      : 'all';

  const config = buildConfig();
  const errors = validateConfig(config, platform);

  if (json) {
    console.log(JSON.stringify({ platform, config, errors }, null, 2));
  } else {
    console.log(`Public config check (${platform})`);
    console.log(`- PostHog: ${config.posthog.enabled ? 'enabled' : 'disabled'}`);
    console.log(`- RevenueCat: ${config.revenueCat.enabled ? 'enabled' : 'disabled'}`);
    console.log(`- Speech: ${config.speech.url ?? 'disabled'}`);
    if (errors.length > 0) {
      console.log('');
      for (const error of errors) {
        console.log(`ERROR: ${error}`);
      }
    }
  }

  return errors.length === 0 ? 0 : 1;
}

const isMain = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMain) {
  process.exitCode = runCli();
}
