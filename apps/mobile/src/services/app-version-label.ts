import * as Application from 'expo-application';
import { APP_PACKAGE_VERSION } from '../constants/app-version';

/** Settings "Version" value: marketing version plus the native build number, e.g. `3.1.0 (30101)`. */
export function formatAppVersionLabel(version: string, buildNumber?: string | null): string {
  const build = buildNumber?.trim();
  return build && build !== version ? `${version} (${build})` : version;
}

/** Reads the installed binary: iOS CFBundleVersion / Android versionCode as the build number. */
export function getAppVersionLabel(): string {
  return formatAppVersionLabel(
    Application.nativeApplicationVersion?.trim() || APP_PACKAGE_VERSION,
    Application.nativeBuildVersion,
  );
}
