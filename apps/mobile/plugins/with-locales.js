// Expo config plugin: creates .lproj directories so iOS shows the per-app
// language picker in Settings.  Works by adding Known Regions to the Xcode
// project and writing empty InfoPlist.strings for each locale.

const { withXcodeProject } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');
const { SUPPORTED_LOCALES } = require('../src/i18n/supported-locales');

const LOCALES = SUPPORTED_LOCALES.map((locale) => locale.code);

function withLocales(config) {
  return withXcodeProject(config, async (cfg) => {
    const project = cfg.modResults;
    const appName = cfg.modRequest.projectName;
    const iosRoot = cfg.modRequest.platformProjectRoot;
    const appDir = path.join(iosRoot, appName);

    // 1. Add each locale as a Known Region in the Xcode project.
    for (const locale of LOCALES) {
      if (!project.hasKnownRegion(locale)) {
        project.addKnownRegion(locale);
      }
    }

    // 2. Create <locale>.lproj/InfoPlist.strings for each locale.
    for (const locale of LOCALES) {
      const lprojDir = path.join(appDir, `${locale}.lproj`);
      if (!fs.existsSync(lprojDir)) {
        fs.mkdirSync(lprojDir, { recursive: true });
      }
      const stringsFile = path.join(lprojDir, 'InfoPlist.strings');
      if (!fs.existsSync(stringsFile)) {
        fs.writeFileSync(stringsFile, '/* intentionally empty */\n');
      }
    }

    // 3. Add a variant group for InfoPlist.strings so Xcode sees the localized files.
    //    addLocalizationVariantGroup already creates the group + resource ref.
    const existingKey = project.findPBXVariantGroupKey({ name: 'InfoPlist.strings' });
    if (!existingKey) {
      project.addLocalizationVariantGroup('InfoPlist.strings');
    }

    return cfg;
  });
}

module.exports = withLocales;
