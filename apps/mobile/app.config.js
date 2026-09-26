const baseConfig = require('./app.json');
const packageJson = require('./package.json');

function computeAndroidVersionCode(version) {
  const coreVersion = String(version || '0.0.0').split('-')[0];
  const parts = coreVersion.split('.').map((part) => {
    const value = Number.parseInt(part, 10);
    return Number.isFinite(value) ? value : 0;
  });
  while (parts.length < 3) {
    parts.push(0);
  }
  return (parts[0] * 10000) + (parts[1] * 100) + parts[2];
}

function resolveAndroidVersionCode(version) {
  const override = process.env.EXPO_ANDROID_VERSION_CODE?.trim();
  if (override) {
    const parsed = Number.parseInt(override, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }

    throw new Error(`Invalid EXPO_ANDROID_VERSION_CODE: ${override}`);
  }

  return computeAndroidVersionCode(version);
}

module.exports = ({ config }) => {
  const expoConfig = config ?? baseConfig.expo ?? {};
  const version = String(packageJson.version || '0.0.0');
  const appleTeamId = process.env.EXPO_APPLE_TEAM_ID?.trim();
  const easOwner = process.env.EXPO_EAS_OWNER?.trim();
  const easProjectId = process.env.EXPO_EAS_PROJECT_ID?.trim();

  return {
    ...expoConfig,
    version,
    ...(easOwner ? { owner: easOwner } : {}),
    extra: {
      ...expoConfig.extra,
      eas: {
        ...expoConfig.extra?.eas,
        ...(easProjectId ? { projectId: easProjectId } : {}),
      },
    },
    ios: {
      ...expoConfig.ios,
      ...(appleTeamId ? { appleTeamId } : {}),
    },
    android: {
      ...expoConfig.android,
      versionCode: resolveAndroidVersionCode(version),
    },
  };
};
