import { SUPPORTED_LOCALES } from './supported-locales';
import { APP_LANGUAGES, APP_LANGUAGE_NAMES, isRtlLocale, resolveLocaleTag } from './language';

describe('app locale catalog', () => {
  it('exposes every supported locale with an autonym', () => {
    expect(APP_LANGUAGES).toHaveLength(19);
    expect(new Set(APP_LANGUAGES).size).toBe(APP_LANGUAGES.length);
    for (const { code, name } of SUPPORTED_LOCALES) {
      expect(APP_LANGUAGE_NAMES[code]).toBe(name);
      expect(name.trim().length).toBeGreaterThan(0);
    }
  });

  it('marks Arabic as the only right-to-left locale', () => {
    expect(APP_LANGUAGES.filter(isRtlLocale)).toEqual(['ar']);
    expect(isRtlLocale(undefined)).toBe(false);
  });

  it.each([
    ['en-US', 'en'],
    ['zh', 'zh-Hans'],
    ['zh-Hans-CN', 'zh-Hans'],
    ['zh-Hant-TW', 'zh-Hant'],
    ['zh-TW', 'zh-Hant'],
    ['zh-HK', 'zh-Hant'],
    ['zh-SG', 'zh-Hans'],
    ['pt', 'pt-BR'],
    ['pt-BR', 'pt-BR'],
    ['pt-PT', 'pt-PT'],
    ['pt-AO', 'pt-PT'],
    ['es', 'es'],
    ['es-ES', 'es'],
    ['es-MX', 'es-419'],
    ['es-419', 'es-419'],
    ['es-US', 'es-419'],
    ['fr-CA', 'fr'],
    ['uk-UA', 'uk'],
    ['hi-IN', 'hi'],
    ['ar-EG', 'ar'],
    ['ES_419', 'es-419'],
    ['sw-KE', 'en'],
    ['', 'en'],
    [null, 'en'],
  ])('resolves device tag %s to %s', (tag, expected) => {
    expect(resolveLocaleTag(tag)).toBe(expected);
  });
});
