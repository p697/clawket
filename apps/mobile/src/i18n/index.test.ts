jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));

import i18n from './index';

describe('i18n namespace lookups', () => {
  const originalLanguage = i18n.language;

  afterEach(async () => {
    await i18n.changeLanguage(originalLanguage);
  });

  it('resolves common namespace keys with explicit ns options', async () => {
    await i18n.changeLanguage('zh-Hans');

    expect(i18n.t('Switching Gateway...', { ns: 'common' })).toBe('正在切换网关…');
  });
});

describe('registered locale resources', () => {
  const originalLanguage = i18n.language;
  afterEach(async () => { await i18n.changeLanguage(originalLanguage); });

  it.each(['zh-Hant', 'es-419', 'pt-BR', 'pt-PT', 'ar', 'uk', 'hi'])('serves %s without falling back to English', async (locale) => {
    await i18n.changeLanguage(locale);
    expect(i18n.resolvedLanguage).toBe(locale);
    expect(i18n.t('Settings', { ns: 'common' })).not.toBe('Settings');
    expect(i18n.t('Pairing code', { ns: 'config' })).not.toBe('Pairing code');
  });
});
