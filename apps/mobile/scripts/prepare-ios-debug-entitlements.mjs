import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ASSOCIATED_DOMAINS_KEY = 'com.apple.developer.associated-domains';
const RELEASE_ENTITLEMENTS = 'Clawket/Clawket.entitlements';
const DEBUG_ENTITLEMENTS = 'Clawket/Clawket.debug.entitlements';

export function removeAssociatedDomainsEntitlement(plistSource) {
  const escapedKey = ASSOCIATED_DOMAINS_KEY.replaceAll('.', '\\.');
  const pattern = new RegExp(
    `\\n[ \\t]*<key>${escapedKey}<\\/key>\\s*<array>[\\s\\S]*?<\\/array>`,
  );
  return plistSource.replace(pattern, '');
}

export function useDebugEntitlementsForDebugConfiguration(projectSource) {
  if (projectSource.includes(`CODE_SIGN_ENTITLEMENTS = ${DEBUG_ENTITLEMENTS};`)) {
    return projectSource;
  }

  let replacements = 0;
  const rewritten = projectSource.replace(
    /\/\* Debug \*\/ = \{[\s\S]*?\n\s*name = Debug;\n\s*\};/g,
    (configuration) => {
      const releaseSetting = `CODE_SIGN_ENTITLEMENTS = ${RELEASE_ENTITLEMENTS};`;
      if (!configuration.includes(releaseSetting)) return configuration;
      replacements += 1;
      return configuration.replace(
        releaseSetting,
        `CODE_SIGN_ENTITLEMENTS = ${DEBUG_ENTITLEMENTS};`,
      );
    },
  );
  if (replacements !== 1) {
    throw new Error(`Expected one Clawket Debug entitlement setting, found ${replacements}.`);
  }
  return rewritten;
}

export function prepareIosDebugEntitlements(mobileRoot) {
  const iosRoot = join(mobileRoot, 'ios');
  const releaseEntitlementsPath = join(iosRoot, RELEASE_ENTITLEMENTS);
  const debugEntitlementsPath = join(iosRoot, DEBUG_ENTITLEMENTS);
  const projectPath = join(iosRoot, 'Clawket.xcodeproj', 'project.pbxproj');
  if (!existsSync(releaseEntitlementsPath) || !existsSync(projectPath)) {
    throw new Error('Generated iOS project is missing. Run `npx expo prebuild --platform ios` first.');
  }

  const releaseEntitlements = readFileSync(releaseEntitlementsPath, 'utf8');
  const debugEntitlements = removeAssociatedDomainsEntitlement(releaseEntitlements);
  writeFileSync(debugEntitlementsPath, debugEntitlements, 'utf8');

  const projectSource = readFileSync(projectPath, 'utf8');
  const rewrittenProject = useDebugEntitlementsForDebugConfiguration(projectSource);
  if (rewrittenProject !== projectSource) {
    writeFileSync(projectPath, rewrittenProject, 'utf8');
  }
  return {
    debugEntitlementsPath,
    removedAssociatedDomains: debugEntitlements !== releaseEntitlements,
  };
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  const mobileRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const result = prepareIosDebugEntitlements(mobileRoot);
  process.stdout.write(
    result.removedAssociatedDomains
      ? 'Using local Debug entitlements without Associated Domains; release entitlements remain unchanged.\n'
      : 'Using local Debug entitlements; release entitlements remain unchanged.\n',
  );
}
