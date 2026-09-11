const fs = require('fs');
const path = require('path');
const { withAppDelegate, withDangerousMod, IOSConfig } = require('expo/config-plugins');

const BRIDGE_BLOCK_START = '// @generated begin clawket-paste-input-import';
const BRIDGE_BLOCK_END = '// @generated end clawket-paste-input-import';
const SETUP_BLOCK_START = '// @generated begin clawket-paste-input-setup';
const SETUP_BLOCK_END = '// @generated end clawket-paste-input-setup';
const SETUP_ANCHOR = 'launchOptions: launchOptions)';

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
  return upsertBlock(contents, {
    start: SETUP_BLOCK_START,
    end: SETUP_BLOCK_END,
    block: SETUP_BLOCK,
    anchor: SETUP_ANCHOR,
    label: 'AppDelegate',
  });
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

  return withDangerousMod(withSetup, ['ios', (modConfig) => {
    const headerPath = findBridgingHeader(modConfig.modRequest.projectRoot);
    const contents = fs.readFileSync(headerPath, 'utf8');
    fs.writeFileSync(headerPath, applyPasteInputBridgingHeader(contents));
    return modConfig;
  }]);
};

module.exports = withPasteInputSetup;
module.exports.applyPasteInputSetup = applyPasteInputSetup;
module.exports.applyPasteInputBridgingHeader = applyPasteInputBridgingHeader;
