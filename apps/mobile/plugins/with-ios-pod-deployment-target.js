const { withPodfile } = require('expo/config-plugins');

const START = '    # @generated begin clawket-pod-deployment-target';
const END = '    # @generated end clawket-pod-deployment-target';
const BLOCK = `${START}
    # Apply the reviewed upstream Swift compiler fix on every pod install.
    system('node', File.join(__dir__, '..', 'scripts', 'patch-revenuecat-xcode27.cjs'), installer.sandbox.root.to_s) ||
      raise('RevenueCat Xcode 27 compatibility patch failed')
    # Resource bundles retain podspec minima even after React Native's post-install.
    clawket_ios_floor = [Gem::Version.new(min_ios_version_supported),
      Gem::Version.new(podfile_properties['ios.deploymentTarget'] || min_ios_version_supported)].max
    installer.pods_project.targets.each do |pod_target|
      pod_target.build_configurations.each do |build_config|
        current = build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        next if current.nil?
        if Gem::Version.new(current) < clawket_ios_floor
          build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = clawket_ios_floor.to_s
        end
      end
    end
${END}`;

function applyPodDeploymentTarget(contents) {
  const starts = contents.split(START).length - 1;
  const ends = contents.split(END).length - 1;
  if (starts !== ends || starts > 1 || (starts && contents.indexOf(END) < contents.indexOf(START))) {
    throw new Error('Podfile has malformed deployment-target generated markers.');
  }
  const clean = starts ? contents.replace(new RegExp(`${START}[\\s\\S]*?${END}\\n?`), '') : contents;
  const anchor = /(^  post_install do \|installer\|\s*\n    react_native_post_install\([\s\S]*?^    \)\n)/gm;
  if ([...clean.matchAll(anchor)].length !== 1) {
    throw new Error('Podfile must contain exactly one supported React Native post_install hook.');
  }
  return clean.replace(anchor, `$1${BLOCK}\n`);
}

module.exports = (config) => withPodfile(config, (mod) => {
  mod.modResults.contents = applyPodDeploymentTarget(mod.modResults.contents);
  return mod;
});
module.exports.applyPodDeploymentTarget = applyPodDeploymentTarget;
