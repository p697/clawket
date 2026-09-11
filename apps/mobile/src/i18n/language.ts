import { getLocales } from 'expo-localization';

export const APP_LANGUAGES = ['en', 'zh-Hans', 'ja', 'ko', 'de', 'es'] as const;
export type AppLanguage = 'system' | typeof APP_LANGUAGES[number];

// Autonyms remain recognizable even after accidentally choosing another language.
export const APP_LANGUAGE_NAMES: Record<Exclude<AppLanguage, 'system'>, string> = {
  en: 'English',
  'zh-Hans': '简体中文',
  ja: '日本語',
  ko: '한국어',
  de: 'Deutsch',
  es: 'Español',
};

export function parseAppLanguage(value: string | null): AppLanguage {
  return APP_LANGUAGES.includes(value as typeof APP_LANGUAGES[number])
    ? value as AppLanguage
    : 'system';
}

export function resolveAppLocale(language: AppLanguage): string {
  if (language !== 'system') return language;
  const code = getLocales()[0]?.languageCode ?? 'en';
  if (code.startsWith('zh')) return 'zh-Hans';
  return APP_LANGUAGES.includes(code as typeof APP_LANGUAGES[number]) ? code : 'en';
}
