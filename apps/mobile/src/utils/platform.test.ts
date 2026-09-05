describe('platform utils', () => {
  type MutablePlatform = typeof import('react-native').Platform & {
    isMacCatalyst?: boolean;
    isPad?: boolean;
  };

  afterEach(() => {
    jest.resetModules();
  });

  async function loadPlatformUtils(overrides: Partial<MutablePlatform>) {
    jest.resetModules();
    const mutablePlatform = require('react-native').Platform as MutablePlatform;
    Object.assign(mutablePlatform, overrides);
    return import('./platform');
  }

  it('detects Mac Catalyst as macOS runtime', async () => {
    const platformUtils = await loadPlatformUtils({
      OS: 'ios',
      isMacCatalyst: true,
      isPad: true,
    });

    expect(platformUtils.isMacCatalyst).toBe(true);
    expect(platformUtils.isIPad).toBe(false);
    expect(platformUtils.getRuntimePlatform()).toBe('macos');
    expect(platformUtils.getRuntimeSystemName()).toBe('macOS');
    expect(platformUtils.getRuntimeDeviceFamily()).toBe('mac');
    expect(platformUtils.getRuntimeClientId()).toBe('openclaw-macos');
  });

  it('keeps standard iOS runtime unchanged', async () => {
    const platformUtils = await loadPlatformUtils({
      OS: 'ios',
      isMacCatalyst: false,
      isPad: false,
    });

    expect(platformUtils.isMacCatalyst).toBe(false);
    expect(platformUtils.isIPad).toBe(false);
    expect(platformUtils.getRuntimePlatform()).toBe('ios');
    expect(platformUtils.getRuntimeSystemName()).toBe('iOS');
    expect(platformUtils.getRuntimeDeviceFamily()).toBe('iphone');
    expect(platformUtils.getRuntimeClientId()).toBe('openclaw-ios');
  });

  it('distinguishes iPad presentation from Mac Catalyst', async () => {
    const platformUtils = await loadPlatformUtils({
      OS: 'ios',
      isMacCatalyst: false,
      isPad: true,
    });

    expect(platformUtils.isIPad).toBe(true);
    expect(platformUtils.isMacCatalyst).toBe(false);
    expect(platformUtils.getRuntimePlatform()).toBe('ios');
    expect(platformUtils.getRuntimeSystemName()).toBe('iPadOS');
    expect(platformUtils.getRuntimeDeviceFamily()).toBe('ipad');
    expect(platformUtils.getRuntimeClientId()).toBe('openclaw-ios');
  });
});
