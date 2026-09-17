const fs = require('fs');
const path = require('path');
const { withAppDelegate, withInfoPlist, withDangerousMod, IOSConfig } = require('expo/config-plugins');

const BRIDGE_BLOCK_START = '// @generated begin clawket-paste-input-import';
const BRIDGE_BLOCK_END = '// @generated end clawket-paste-input-import';
const SETUP_BLOCK_START = '// @generated begin clawket-paste-input-setup';
const SETUP_BLOCK_END = '// @generated end clawket-paste-input-setup';
const SETUP_ANCHOR = 'launchOptions: launchOptions)';
const SCENE_START = '// @generated begin clawket-paste-input-scene';
const SCENE_END = '// @generated end clawket-paste-input-scene';
const SCENE_CLASS = 'ClawketSceneDelegate';
const SCENE_BLOCK = `${SCENE_START}
@available(iOSApplicationExtension, unavailable)
@objc(${SCENE_CLASS})
class ${SCENE_CLASS}: ExpoAppSceneDelegate {
  override func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    super.scene(scene, willConnectTo: session, options: connectionOptions)
    // Expo creates the React host in super.scene, not in AppDelegate anymore.
    if let provider = UIApplication.shared.delegate as? ExpoReactNativeFactoryProvider,
      let factory = provider.reactNativeFactory {
      PasteInputModule.setup(factory.rootViewFactory)
    }
  }
}
${SCENE_END}`;

const BRIDGE_BLOCK = `${BRIDGE_BLOCK_START}
#import <react-native-paste-input/PasteInputModule.h>
${BRIDGE_BLOCK_END}`;

const SETUP_BLOCK = `${SETUP_BLOCK_START}
    // Register the backing text views that intercept file paste on iOS.
    PasteInputModule.setup(factory.rootViewFactory)
${SETUP_BLOCK_END}`;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function upsertBlock(contents, { start, end, block, anchor, label }) {
  const hasStart = contents.includes(start);
  const hasEnd = contents.includes(end);
  if (hasStart !== hasEnd) {
    throw new Error(`${label} contains an incomplete generated paste-input block (${start}).`);
  }
  if (hasStart) {
    return contents.replace(
      new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`, 'm'),
      block,
    );
  }
  if (anchor === null) return `${contents.trimEnd()}\n\n${block}\n`;

  const anchorIndex = contents.indexOf(anchor);
  if (anchorIndex === -1) {
    throw new Error(`${label} is missing the expected paste-input anchor: ${anchor}`);
  }
  if (contents.indexOf(anchor, anchorIndex + anchor.length) !== -1) {
    throw new Error(`${label} has more than one paste-input anchor: ${anchor}`);
  }
  const insertionPoint = anchorIndex + anchor.length;
  return `${contents.slice(0, insertionPoint)}\n${block}${contents.slice(insertionPoint)}`;
}

function applyPasteInputSetup(contents) {
  if (!contents.includes('ExpoReactNativeFactory') && !contents.includes('RCTReactNativeFactory')) {
    throw new Error('AppDelegate does not create a React Native factory.');
  }
  if (contents.includes('ExpoReactNativeFactoryProvider')) {
    if (contents.includes('factory.startReactNative(') || contents.includes(SETUP_BLOCK_START)) {
      throw new Error('Scene AppDelegate must not retain legacy React Native or paste-input startup.');
    }
    return upsertBlock(contents, {
      start: SCENE_START, end: SCENE_END, block: SCENE_BLOCK, anchor: null, label: 'Scene delegate',
    });
  }
  return upsertBlock(contents, {
    start: SETUP_BLOCK_START,
    end: SETUP_BLOCK_END,
    block: SETUP_BLOCK,
    anchor: SETUP_ANCHOR,
    label: 'AppDelegate',
  });
}

function applyPasteInputSceneManifest(infoPlist) {
  const scenes = infoPlist.UIApplicationSceneManifest?.UISceneConfigurations?.UIWindowSceneSessionRoleApplication;
  if (!Array.isArray(scenes) || scenes.length !== 1 ||
    !['EXExpoAppSceneDelegate', SCENE_CLASS].includes(scenes[0].UISceneDelegateClassName)) {
    throw new Error('Paste input requires the Expo SDK 57 single-scene manifest.');
  }
  scenes[0].UISceneDelegateClassName = SCENE_CLASS;
  return infoPlist;
}

function applyPasteInputBridgingHeader(contents) {
  return upsertBlock(contents, {
    start: BRIDGE_BLOCK_START,
    end: BRIDGE_BLOCK_END,
    block: BRIDGE_BLOCK,
    anchor: null,
    label: 'Bridging header',
  });
}

function findBridgingHeader(projectRoot) {
  const sourceRoot = IOSConfig.Paths.getSourceRoot(projectRoot);
  const match = fs.readdirSync(sourceRoot).find((name) => name.endsWith('-Bridging-Header.h'));
  if (!match) throw new Error(`No *-Bridging-Header.h found in ${sourceRoot}.`);
  return path.join(sourceRoot, match);
}

const withPasteInputSetup = (config) => {
  const withSetup = withAppDelegate(config, (modConfig) => {
    if (modConfig.modResults.language !== 'swift') {
      throw new Error(`Unsupported AppDelegate language: ${modConfig.modResults.language}`);
    }
    modConfig.modResults.contents = applyPasteInputSetup(modConfig.modResults.contents);
    return modConfig;
  });

  const withScene = withInfoPlist(withSetup, (modConfig) => {
    modConfig.modResults = applyPasteInputSceneManifest(modConfig.modResults);
    return modConfig;
  });
  return withDangerousMod(withScene, ['ios', (modConfig) => {
    const headerPath = findBridgingHeader(modConfig.modRequest.projectRoot);
    const contents = fs.readFileSync(headerPath, 'utf8');
    fs.writeFileSync(headerPath, applyPasteInputBridgingHeader(contents));
    return modConfig;
  }]);
};

module.exports = withPasteInputSetup;
module.exports.applyPasteInputSetup = applyPasteInputSetup;
module.exports.applyPasteInputBridgingHeader = applyPasteInputBridgingHeader;
module.exports.applyPasteInputSceneManifest = applyPasteInputSceneManifest;
