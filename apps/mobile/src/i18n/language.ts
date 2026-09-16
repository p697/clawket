import { getLocales } from 'expo-localization';
import { SUPPORTED_LOCALES } from './supported-locales';

export type AppLocale = (typeof SUPPORTED_LOCALES)[number]['code'];
export type AppLanguage = 'system' | AppLocale;

export const APP_LANGUAGES = SUPPORTED_LOCALES.map((locale) => locale.code) as readonly AppLocale[];

// Autonyms remain recognizable even after accidentally choosing another language.
export const APP_LANGUAGE_NAMES = Object.fromEntries(
  SUPPORTED_LOCALES.map((locale) => [locale.code, locale.name]),
) as Record<AppLocale, string>;

const RTL_LOCALES = new Set<string>(
  SUPPORTED_LOCALES.filter((locale) => 'rtl' in locale && locale.rtl).map((locale) => locale.code),
);
const LOCALE_BY_LOWERCASE = new Map<string, AppLocale>(
  SUPPORTED_LOCALES.map((locale) => [locale.code.toLowerCase(), locale.code]),
);

// Regions whose Chinese uses the Traditional script.
const TRADITIONAL_CHINESE_REGIONS = new Set(['tw', 'hk', 'mo']);
// Lusophone regions that read European Portuguese; every other `pt` tag is Brazilian.
const EUROPEAN_PORTUGUESE_REGIONS = new Set(['pt', 'ao', 'cv', 'gw', 'mo', 'mz', 'st', 'tl']);
// Spanish-speaking regions of the Americas; every other `es` tag is Spain Spanish.
const LATIN_AMERICAN_SPANISH_REGIONS = new Set([
  '419', 'ar', 'bo', 'br', 'bz', 'cl', 'co', 'cr', 'cu', 'do', 'ec', 'gt', 'hn', 'mx',
  'ni', 'pa', 'pe', 'pr', 'py', 'sv', 'us', 'uy', 've',
]);

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && APP_LANGUAGES.includes(value as AppLocale);
}

export function parseAppLanguage(value: string | null): AppLanguage {
  return isAppLocale(value) ? value : 'system';
}

export function isRtlLocale(locale: string | null | undefined): boolean {
  return RTL_LOCALES.has(locale ?? '');
}

// Maps a BCP-47 device tag to the closest supported locale.
export function resolveLocaleTag(tag: string | null | undefined): AppLocale {
  const parts = (tag ?? '').trim().toLowerCase().split(/[-_]/).filter(Boolean);
  if (parts.length === 0) return 'en';
  const [language, ...subtags] = parts;
  if (language === 'zh') {
    return subtags.includes('hant') || subtags.some((part) => TRADITIONAL_CHINESE_REGIONS.has(part))
      ? 'zh-Hant'
      : 'zh-Hans';
  }
  const exact = LOCALE_BY_LOWERCASE.get(parts.join('-'));
  if (exact) return exact;
  if (language === 'pt') {
    return subtags.some((part) => EUROPEAN_PORTUGUESE_REGIONS.has(part)) ? 'pt-PT' : 'pt-BR';
  }
  if (language === 'es') {
    return subtags.some((part) => LATIN_AMERICAN_SPANISH_REGIONS.has(part)) ? 'es-419' : 'es';
  }
  return LOCALE_BY_LOWERCASE.get(language) ?? 'en';
}

export function resolveAppLocale(language: AppLanguage): AppLocale {
  if (language !== 'system') return language;
  const device = getLocales()[0];
  return resolveLocaleTag(device?.languageTag ?? device?.languageCode);
}
