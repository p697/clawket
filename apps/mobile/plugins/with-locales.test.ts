import { SUPPORTED_LOCALES } from '../src/i18n/supported-locales';

const plugin = require('./with-locales');
const PURPOSES = [
  'NSCameraUsageDescription',
  'NSLocalNetworkUsageDescription',
  'NSLocationAlwaysAndWhenInUseUsageDescription',
  'NSLocationWhenInUseUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSPhotoLibraryAddUsageDescription',
  'NSPhotoLibraryUsageDescription',
];

describe('localized iOS permission purposes', () => {
  it('covers every purpose the app requests in every non-English locale', () => {
    const translated = SUPPORTED_LOCALES.map((locale) => locale.code).filter((code) => code !== 'en');
    expect(Object.keys(plugin.PERMISSION_STRINGS).sort()).toEqual([...translated].sort());
    for (const code of translated) {
      const strings = plugin.PERMISSION_STRINGS[code];
      expect(Object.keys(strings).sort()).toEqual(PURPOSES);
      for (const key of PURPOSES) {
        expect(strings[key].trim().length).toBeGreaterThan(10);
        // Brand names stay untranslated, matching the App's own strings.
        expect(strings[key]).toContain('Clawket');
      }
    }
  });

  it('writes valid strings-file lines and leaves English to the base Info.plist', () => {
    expect(plugin.infoPlistStrings('en')).toBe('/* intentionally empty */\n');
    const lines = plugin.infoPlistStrings('zh-Hans').trimEnd().split('\n');
    expect(lines).toHaveLength(PURPOSES.length);
    for (const line of lines) expect(line).toMatch(/^"NS[A-Za-z]+" = "(?:[^"\\]|\\.)*";$/);
    expect(lines[0]).toBe('"NSCameraUsageDescription" = "允许 Clawket 使用相机扫描二维码，并拍照发送给 AI。";');
  });
});
