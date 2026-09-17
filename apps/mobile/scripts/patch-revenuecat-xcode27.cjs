const fs = require('node:fs');
const path = require('node:path');

// Backport RevenueCat/purchases-ios@870899891ac9a05118ae6ee16d4ae189b2c1eac2.
const INITIALIZER = `    /// "Designated" initializer
    private init(stringRepresentation: String, underlyingColor: (any Sendable)?) {
        self.stringRepresentation = stringRepresentation
        self._underlyingColor = underlyingColor
    }`;
const ANCHOR = '    fileprivate var _underlyingColor: (any Sendable)?\n\n';

function patchRevenueCat(contents) {
  if (contents.split(INITIALIZER).length !== 2 || contents.split(ANCHOR).length !== 2) {
    throw new Error('RevenueCat PaywallColor changed; review the Xcode 27 upstream backport.');
  }
  if (contents.includes(ANCHOR + INITIALIZER)) return contents;
  const extension = contents.indexOf('private extension PaywallColor {');
  if (extension < 0 || contents.indexOf(INITIALIZER) < extension || !contents.includes(INITIALIZER + '\n\n')) {
    throw new Error('RevenueCat initializer is outside its reviewed extension.');
  }
  return contents.replace(INITIALIZER + '\n\n', '').replace(ANCHOR, ANCHOR + INITIALIZER + '\n');
}

if (require.main === module) {
  const podsRoot = process.argv[2];
  if (!podsRoot) throw new Error('Expected the CocoaPods sandbox root.');
  const file = path.join(podsRoot, 'RevenueCat/Sources/Paywalls/PaywallColor.swift');
  const original = fs.readFileSync(file, 'utf8');
  const patched = patchRevenueCat(original);
  if (patched !== original) {
    const mode = fs.statSync(file).mode;
    fs.chmodSync(file, mode | 0o200);
    try { fs.writeFileSync(file, patched); } finally { fs.chmodSync(file, mode); }
  }
  console.log('Verified RevenueCat Xcode 27 initializer compatibility (1 source).');
}
module.exports = { patchRevenueCat };
