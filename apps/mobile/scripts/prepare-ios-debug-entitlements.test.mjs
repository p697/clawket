import assert from 'node:assert/strict';
import test from 'node:test';
import {
  removeAssociatedDomainsEntitlement,
  useDebugEntitlementsForDebugConfiguration,
} from './prepare-ios-debug-entitlements.mjs';

test('removes Associated Domains only from the derived Debug plist', () => {
  const source = `<?xml version="1.0"?><plist><dict>
    <key>aps-environment</key><string>development</string>
    <key>com.apple.developer.associated-domains</key>
    <array><string>applinks:registry.clawket.ai</string></array>
  </dict></plist>`;
  const debug = removeAssociatedDomainsEntitlement(source);
  assert.doesNotMatch(debug, /associated-domains/);
  assert.match(debug, /aps-environment/);
  assert.match(source, /associated-domains/);
});

test('changes only the Clawket Debug build setting and is idempotent', () => {
  const source = `
    AAA /* Debug */ = {
      isa = XCBuildConfiguration;
      buildSettings = {
        CODE_SIGN_ENTITLEMENTS = Clawket/Clawket.entitlements;
      };
      name = Debug;
    };
    BBB /* Release */ = {
      isa = XCBuildConfiguration;
      buildSettings = {
        CODE_SIGN_ENTITLEMENTS = Clawket/Clawket.entitlements;
      };
      name = Release;
    };`;
  const debug = useDebugEntitlementsForDebugConfiguration(source);
  assert.equal((debug.match(/Clawket\.debug\.entitlements/g) ?? []).length, 1);
  assert.match(debug, /\/\* Release \*\/[\s\S]*Clawket\/Clawket\.entitlements/);
  assert.equal(useDebugEntitlementsForDebugConfiguration(debug), debug);
});

test('fails loudly when the expected Debug setting is missing', () => {
  assert.throws(
    () => useDebugEntitlementsForDebugConfiguration('/* malformed project */'),
    /Expected one Clawket Debug entitlement setting/,
  );
});
