const { withAndroidManifest, withDangerousMod, withXcodeProject, AndroidConfig } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');
const TARGET = 'ClawketWidgets';

function normalizeWidgetResources(project) {
  const group = project.pbxGroupByName('Resources');
  // xcode's addPbxGroup serializes a missing path as the literal `undefined`.
  // This logical group lives at project root, not in an on-disk directory.
  if (group && (group.path === undefined || group.path === 'undefined')) delete group.path;
}


module.exports = function withHomeWidgets(config) {
  const bundle = `${config.ios.bundleIdentifier}.widgets`;
  const extensions = config.extra?.eas?.build?.experimental?.ios?.appExtensions;
  if (extensions && !extensions.some((entry) => entry.targetName === TARGET)) extensions.push({ targetName: TARGET, bundleIdentifier: bundle });
  config = withAndroidManifest(config, (mod) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    const name = `${mod.android.package}.widgets.ClawketWidgetProvider`;
    app.receiver = (app.receiver || []).filter((entry) => entry.$['android:name'] !== name);
    app.receiver.push({ $: { 'android:name': name, 'android:exported': 'false', 'android:label': 'Clawket' },
      'intent-filter': [{ action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }] }],
      'meta-data': [{ $: { 'android:name': 'android.appwidget.provider', 'android:resource': '@xml/clawket_widget_info' } }],
    });
    return mod;
  });
  config = withDangerousMod(config, ['android', async (mod) => {
    const source = path.join(mod.modRequest.projectRoot, 'native-widgets/android');
    const main = path.join(mod.modRequest.platformProjectRoot, 'app/src/main');
    // The widget mark is now a theme-aware vector, including on incremental prebuilds.
    fs.rmSync(path.join(main, 'res/drawable-nodpi/widget_mark.png'), { force: true });
    fs.cpSync(path.join(source, 'res'), path.join(main, 'res'), { recursive: true });
    const destination = path.join(main, 'java', ...mod.android.package.split('.'), 'widgets');
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(destination, 'ClawketWidgetProvider.kt'), fs.readFileSync(path.join(source, 'ClawketWidgetProvider.kt'), 'utf8').replaceAll('__PACKAGE__', mod.android.package));
    return mod;
  }]);
  return withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const destination = path.join(mod.modRequest.platformProjectRoot, TARGET);
    fs.mkdirSync(destination, { recursive: true });
    fs.cpSync(path.join(mod.modRequest.projectRoot, 'native-widgets/ios'), destination, { recursive: true });
    fs.writeFileSync(path.join(destination, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleDisplayName</key><string>Clawket</string><key>CFBundleIdentifier</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string><key>CFBundleExecutable</key><string>$(EXECUTABLE_NAME)</string><key>CFBundleName</key><string>$(PRODUCT_NAME)</string><key>CFBundlePackageType</key><string>XPC!</string><key>CFBundleShortVersionString</key><string>$(MARKETING_VERSION)</string><key>CFBundleVersion</key><string>$(CURRENT_PROJECT_VERSION)</string><key>NSExtension</key><dict><key>NSExtensionPointIdentifier</key><string>com.apple.widgetkit-extension</string></dict></dict></plist>`);
    const existing = Object.entries(project.pbxNativeTargetSection()).find(([, target]) => target && typeof target === 'object' && target.name?.replaceAll('"', '') === TARGET);
    const target = existing ? { uuid: existing[0] } : project.addTarget(TARGET, 'app_extension', TARGET, bundle);
    if (!existing) {
      project.addBuildPhase([`${TARGET}/ClawketWidget.swift`], 'PBXSourcesBuildPhase', 'Sources', target.uuid);
      project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
      project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);
      if (!project.pbxGroupByName('Resources')) {
        const group = project.addPbxGroup([], 'Resources');
        project.addToPbxGroup(group.uuid, project.getFirstProject().firstProject.mainGroup);
      }
      const variant = project.pbxCreateVariantGroup('Localizable.strings');
      project.addToPbxGroup(variant, project.getFirstProject().firstProject.mainGroup);
      const resource = { uuid: project.generateUuid(), fileRef: variant, basename: 'Localizable.strings', target: target.uuid };
      project.addToPbxBuildFileSection(resource);
      project.addToPbxResourcesBuildPhase(resource);
      for (const folder of fs.readdirSync(destination).filter((name) => name.endsWith('.lproj'))) {
        project.addKnownRegion(folder.slice(0, -6));
        const file = project.addResourceFile(`${TARGET}/${folder}/Localizable.strings`, { variantGroup: true, target: target.uuid }, variant);
        if (file) project.pbxFileReferenceSection()[file.fileRef].name = `"${folder.slice(0, -6)}"`;
      }
    }
    configureWidgetAssets(project, target.uuid);
    const nativeTarget = project.pbxNativeTargetSection()[target.uuid];
    const configList = project.pbxXCConfigurationList()[nativeTarget.buildConfigurationList];
    const configurationIds = new Set(configList.buildConfigurations.map((entry) => entry.value));
    const settings = project.pbxXCBuildConfigurationSection();
    for (const [id, item] of Object.entries(settings)) {
      if (!configurationIds.has(id) || !item || typeof item !== 'object') continue;
      Object.assign(item.buildSettings, {
        PRODUCT_BUNDLE_IDENTIFIER: `"${bundle}"`,
        INFOPLIST_FILE: `"${TARGET}/Info.plist"`, GENERATE_INFOPLIST_FILE: 'NO', SWIFT_VERSION: '5.0',
        IPHONEOS_DEPLOYMENT_TARGET: '16.4', TARGETED_DEVICE_FAMILY: '"1,2"',
        APPLICATION_EXTENSION_API_ONLY: 'YES', CODE_SIGN_STYLE: 'Automatic',
        DEVELOPMENT_TEAM: mod.ios.appleTeamId, CURRENT_PROJECT_VERSION: mod.ios.buildNumber || '1',
        MARKETING_VERSION: mod.version, SWIFT_EMIT_LOC_STRINGS: 'YES',
      });
    }
    return mod;
  });
};

module.exports.normalizeWidgetResources = normalizeWidgetResources;

function configureWidgetAssets(project, targetId) {
  normalizeWidgetResources(project);
  if (project.hasFile(`${TARGET}/ClawketMark.png`)) project.removeResourceFile(`${TARGET}/ClawketMark.png`, { target: targetId });
  if (!project.hasFile(`${TARGET}/Assets.xcassets`)) {
    project.addResourceFile(`${TARGET}/Assets.xcassets`, { target: targetId }, project.getFirstProject().firstProject.mainGroup);
  }
}
module.exports.configureWidgetAssets = configureWidgetAssets;
