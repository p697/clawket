const { applyAndroidDirectNetworking, applyIosDirectNetworking } = require('./with-openclaw-direct-networking');

describe('direct networking native policy', () => {
  it('enables ws in the main Android manifest and is idempotent', () => {
    const manifest = { manifest: { application: [{ $: { 'android:label': 'Clawket' } }] } };
    const once = applyAndroidDirectNetworking(manifest);
    expect(once.manifest.application[0].$['android:usesCleartextTraffic']).toBe('true');
    expect(applyAndroidDirectNetworking(once)).toEqual(once);
  });
  it('rejects missing, ambiguous or overriding Android policy', () => {
    for (const application of [undefined, [], [{ $: {} }, { $: {} }], [{}], [{ $: { 'android:networkSecurityConfig': '@xml/policy' } }]]) {
      expect(() => applyAndroidDirectNetworking({ manifest: { application } })).toThrow();
    }
  });
  it('permits iOS private and Tailnet IPs while retaining public TLS policy and unrelated exceptions', () => {
    const once = applyIosDirectNetworking({ NSAppTransportSecurity: { NSExceptionDomains: { 'example.com': { NSIncludesSubdomains: true } } } });
    expect(once.NSLocalNetworkUsageDescription).toContain('OpenClaw');
    expect(once.NSAppTransportSecurity.NSAllowsArbitraryLoads).toBe(false);
    expect(once.NSAppTransportSecurity.NSAllowsLocalNetworking).toBe(true);
    expect(once.NSAppTransportSecurity.NSExceptionDomains['100.64.0.0/10'].NSExceptionAllowsInsecureHTTPLoads).toBe(true);
    expect(once.NSAppTransportSecurity.NSExceptionDomains['example.com']).toEqual({ NSIncludesSubdomains: true });
    expect(applyIosDirectNetworking(once)).toEqual(once);
  });
  it('fails on corrupted iOS ATS input', () => {
    for (const plist of [null, [], { NSAppTransportSecurity: [] }, { NSAppTransportSecurity: { NSExceptionDomains: [] } }, { NSAppTransportSecurity: { NSExceptionDomains: { '10.0.0.0/8': 'bad' } } }]) {
      expect(() => applyIosDirectNetworking(plist)).toThrow();
    }
  });
});
