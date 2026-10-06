const { withAndroidManifest, withInfoPlist } = require('expo/config-plugins');

const LOCAL_RANGES = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '::1', 'fc00::/7', 'fe80::/10'];
function applyAndroidDirectNetworking(manifest) {
  const applications = manifest?.manifest?.application;
  if (!Array.isArray(applications) || applications.length !== 1 || !applications[0].$) {
    throw new Error('Direct networking requires one Android application.');
  }
  const attributes = applications[0].$;
  if (attributes['android:networkSecurityConfig']) {
    throw new Error('Review networkSecurityConfig before enabling direct networking.');
  }
  // Gateway hosts are user supplied; Android domain exceptions cannot describe arbitrary LAN IPs.
  attributes['android:usesCleartextTraffic'] = 'true';
  return manifest;
}
function applyIosDirectNetworking(plist) {
  if (!plist || typeof plist !== 'object' || Array.isArray(plist)) throw new Error('Missing iOS Info.plist.');
  const ats = plist.NSAppTransportSecurity ?? {};
  if (!ats || typeof ats !== 'object' || Array.isArray(ats)) throw new Error('Malformed iOS ATS settings.');
  const domains = ats.NSExceptionDomains ?? {};
  if (!domains || typeof domains !== 'object' || Array.isArray(domains)) throw new Error('Malformed iOS ATS exceptions.');
  for (const range of LOCAL_RANGES) {
    if (domains[range] !== undefined && (!domains[range] || typeof domains[range] !== 'object' || Array.isArray(domains[range]))) {
      throw new Error('Malformed iOS local network exception.');
    }
    domains[range] = { ...domains[range], NSExceptionAllowsInsecureHTTPLoads: true };
  }
  plist.NSAppTransportSecurity = { ...ats, NSAllowsLocalNetworking: true, NSAllowsArbitraryLoads: false, NSExceptionDomains: domains };
  plist.NSLocalNetworkUsageDescription = 'Allow Clawket to connect directly to your OpenClaw Gateway on your local network.';
  return plist;
}
module.exports = function withOpenClawDirectNetworking(config) {
  config = withAndroidManifest(config, (mod) => { mod.modResults = applyAndroidDirectNetworking(mod.modResults); return mod; });
  return withInfoPlist(config, (mod) => { mod.modResults = applyIosDirectNetworking(mod.modResults); return mod; });
};
module.exports.applyAndroidDirectNetworking = applyAndroidDirectNetworking;
module.exports.applyIosDirectNetworking = applyIosDirectNetworking;
