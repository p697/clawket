const { applyPodDeploymentTarget } = require('./with-ios-pod-deployment-target') as {
  applyPodDeploymentTarget: (contents: string) => string;
};
const PODFILE = `platform :ios, '15.1'
target 'Clawket' do
  post_install do |installer|
    react_native_post_install(
      installer,
      config[:reactNativePath],
      :mac_catalyst_enabled => false,
    )
  end
end
`;

describe('iOS Pod deployment target plugin', () => {
  it('runs after React Native and preserves the surrounding Podfile', () => {
    const output = applyPodDeploymentTarget(PODFILE);
    expect(output.indexOf('installer.pods_project.targets.each')).toBeGreaterThan(output.indexOf(':mac_catalyst_enabled'));
    expect(output).toContain('Gem::Version.new(min_ios_version_supported)');
    expect(output).toContain("podfile_properties['ios.deploymentTarget']");
    expect(output).toContain('Gem::Version.new(current) < clawket_ios_floor');
    expect(output).toContain('next if current.nil?');
    expect(output.endsWith('  end\nend\n')).toBe(true);
  });
  it('does not duplicate the hook on repeated prebuild', () => {
    const once = applyPodDeploymentTarget(PODFILE);
    expect(applyPodDeploymentTarget(once)).toBe(once);
  });
  it.each(['', PODFILE + PODFILE, PODFILE.replace('post_install', 'post_integrate')])(
    'rejects missing or ambiguous templates', (input) => {
      expect(() => applyPodDeploymentTarget(input)).toThrow(/exactly one/);
    },
  );
  it('rejects incomplete and duplicate generated blocks', () => {
    const output = applyPodDeploymentTarget(PODFILE);
    expect(() => applyPodDeploymentTarget(output.replace('# @generated end clawket-pod-deployment-target', ''))).toThrow(/malformed/);
    expect(() => applyPodDeploymentTarget(output + output)).toThrow(/malformed/);
  });
  it('is registered in the durable Expo configuration', () => {
    expect(require('../app.json').expo.plugins).toContain('./plugins/with-ios-pod-deployment-target');
  });
});

const { patchRevenueCat } = require('../scripts/patch-revenuecat-xcode27.cjs');
const RC_INIT = `    /// "Designated" initializer
    private init(stringRepresentation: String, underlyingColor: (any Sendable)?) {
        self.stringRepresentation = stringRepresentation
        self._underlyingColor = underlyingColor
    }`;
const RC_ANCHOR = '    fileprivate var _underlyingColor: (any Sendable)?\n\n';
const RC_SOURCE = `public struct PaywallColor {\n${RC_ANCHOR}}\nprivate extension PaywallColor {\n${RC_INIT}\n\n}\n`;
describe('RevenueCat upstream Xcode 27 backport', () => {
  it('moves the existing initializer into the struct and is idempotent', () => {
    const patched = patchRevenueCat(RC_SOURCE);
    expect(patched).toBe(`public struct PaywallColor {\n${RC_ANCHOR}${RC_INIT}\n}\nprivate extension PaywallColor {\n}\n`);
    expect(patchRevenueCat(patched)).toBe(patched);
    expect(applyPodDeploymentTarget(PODFILE)).toContain('patch-revenuecat-xcode27.cjs');
  });
  it.each(['', RC_SOURCE + RC_SOURCE, RC_SOURCE.replace('fileprivate var', 'private var'), RC_SOURCE.replace(RC_INIT + '\n\n', RC_INIT + '\n')])('rejects source drift', (source) => {
    expect(() => patchRevenueCat(source)).toThrow(/review/);
  });
});
