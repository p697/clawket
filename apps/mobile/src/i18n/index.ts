import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';

import en_common from './locales/en/common.json';
import en_chat from './locales/en/chat.json';
import en_config from './locales/en/config.json';
import en_settings from './locales/en/settings.json';

import zh_common from './locales/zh-Hans/common.json';
import zh_chat from './locales/zh-Hans/chat.json';
import zh_config from './locales/zh-Hans/config.json';
import zh_settings from './locales/zh-Hans/settings.json';

import ja_common from './locales/ja/common.json';
import ja_chat from './locales/ja/chat.json';
import ja_config from './locales/ja/config.json';
import ja_settings from './locales/ja/settings.json';

import ko_common from './locales/ko/common.json';
import ko_chat from './locales/ko/chat.json';
import ko_config from './locales/ko/config.json';
import ko_settings from './locales/ko/settings.json';

import de_common from './locales/de/common.json';
import de_chat from './locales/de/chat.json';
import de_config from './locales/de/config.json';
import de_settings from './locales/de/settings.json';

import es_common from './locales/es/common.json';
import es_chat from './locales/es/chat.json';
import es_config from './locales/es/config.json';
import es_settings from './locales/es/settings.json';

const SUPPORTED_LOCALES = ['en', 'zh-Hans', 'ja', 'ko', 'de', 'es'] as const;

const deviceLang = getLocales()[0]?.languageCode ?? 'en';

// Map device language code to our supported locales.
// Chinese variants (zh-Hans, zh-Hant, zh) all resolve to zh-Hans for now.
function resolveLocale(code: string): string {
  if (code.startsWith('zh')) return 'zh-Hans';
  if ((SUPPORTED_LOCALES as readonly string[]).includes(code)) return code;
  return 'en';
}

i18n.use(initReactI18next).init({
  lng: resolveLocale(deviceLang),
  fallbackLng: 'en',
  ns: ['common', 'chat', 'config', 'settings'],
  defaultNS: 'common',
  resources: {
    en: {
      common: en_common,
      chat: en_chat,
      config: en_config,
      settings: en_settings,
    },
    'zh-Hans': {
      common: zh_common,
      chat: zh_chat,
      config: zh_config,
      settings: zh_settings,
    },
    ja: {
      common: ja_common,
      chat: ja_chat,
      config: ja_config,
      settings: ja_settings,
    },
    ko: {
      common: ko_common,
      chat: ko_chat,
      config: ko_config,
      settings: ko_settings,
    },
    de: {
      common: de_common,
      chat: de_chat,
      config: de_config,
      settings: de_settings,
    },
    es: {
      common: es_common,
      chat: es_chat,
      config: es_config,
      settings: es_settings,
    },
  },
  keySeparator: false,
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
