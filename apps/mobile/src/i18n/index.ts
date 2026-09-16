import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { resolveAppLocale } from './language';

import en_common from './locales/en/common.json';
import en_chat from './locales/en/chat.json';
import en_config from './locales/en/config.json';
import en_settings from './locales/en/settings.json';

import zh_Hans_common from './locales/zh-Hans/common.json';
import zh_Hans_chat from './locales/zh-Hans/chat.json';
import zh_Hans_config from './locales/zh-Hans/config.json';
import zh_Hans_settings from './locales/zh-Hans/settings.json';

import zh_Hant_common from './locales/zh-Hant/common.json';
import zh_Hant_chat from './locales/zh-Hant/chat.json';
import zh_Hant_config from './locales/zh-Hant/config.json';
import zh_Hant_settings from './locales/zh-Hant/settings.json';

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

import fr_common from './locales/fr/common.json';
import fr_chat from './locales/fr/chat.json';
import fr_config from './locales/fr/config.json';
import fr_settings from './locales/fr/settings.json';

import es_common from './locales/es/common.json';
import es_chat from './locales/es/chat.json';
import es_config from './locales/es/config.json';
import es_settings from './locales/es/settings.json';

import es_419_common from './locales/es-419/common.json';
import es_419_chat from './locales/es-419/chat.json';
import es_419_config from './locales/es-419/config.json';
import es_419_settings from './locales/es-419/settings.json';

import it_common from './locales/it/common.json';
import it_chat from './locales/it/chat.json';
import it_config from './locales/it/config.json';
import it_settings from './locales/it/settings.json';

import pt_BR_common from './locales/pt-BR/common.json';
import pt_BR_chat from './locales/pt-BR/chat.json';
import pt_BR_config from './locales/pt-BR/config.json';
import pt_BR_settings from './locales/pt-BR/settings.json';

import pt_PT_common from './locales/pt-PT/common.json';
import pt_PT_chat from './locales/pt-PT/chat.json';
import pt_PT_config from './locales/pt-PT/config.json';
import pt_PT_settings from './locales/pt-PT/settings.json';

import ru_common from './locales/ru/common.json';
import ru_chat from './locales/ru/chat.json';
import ru_config from './locales/ru/config.json';
import ru_settings from './locales/ru/settings.json';

import uk_common from './locales/uk/common.json';
import uk_chat from './locales/uk/chat.json';
import uk_config from './locales/uk/config.json';
import uk_settings from './locales/uk/settings.json';

import tr_common from './locales/tr/common.json';
import tr_chat from './locales/tr/chat.json';
import tr_config from './locales/tr/config.json';
import tr_settings from './locales/tr/settings.json';

import vi_common from './locales/vi/common.json';
import vi_chat from './locales/vi/chat.json';
import vi_config from './locales/vi/config.json';
import vi_settings from './locales/vi/settings.json';

import th_common from './locales/th/common.json';
import th_chat from './locales/th/chat.json';
import th_config from './locales/th/config.json';
import th_settings from './locales/th/settings.json';

import hi_common from './locales/hi/common.json';
import hi_chat from './locales/hi/chat.json';
import hi_config from './locales/hi/config.json';
import hi_settings from './locales/hi/settings.json';

import ar_common from './locales/ar/common.json';
import ar_chat from './locales/ar/chat.json';
import ar_config from './locales/ar/config.json';
import ar_settings from './locales/ar/settings.json';

// Every locale registers all four namespaces; `npm run i18n:check` enforces
// key parity, so no runtime namespace fallback is configured.
const resources = {
  en: {
    common: en_common,
    chat: en_chat,
    config: en_config,
    settings: en_settings,
  },
  'zh-Hans': {
    common: zh_Hans_common,
    chat: zh_Hans_chat,
    config: zh_Hans_config,
    settings: zh_Hans_settings,
  },
  'zh-Hant': {
    common: zh_Hant_common,
    chat: zh_Hant_chat,
    config: zh_Hant_config,
    settings: zh_Hant_settings,
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
  fr: {
    common: fr_common,
    chat: fr_chat,
    config: fr_config,
    settings: fr_settings,
  },
  es: {
    common: es_common,
    chat: es_chat,
    config: es_config,
    settings: es_settings,
  },
  'es-419': {
    common: es_419_common,
    chat: es_419_chat,
    config: es_419_config,
    settings: es_419_settings,
  },
  it: {
    common: it_common,
    chat: it_chat,
    config: it_config,
    settings: it_settings,
  },
  'pt-BR': {
    common: pt_BR_common,
    chat: pt_BR_chat,
    config: pt_BR_config,
    settings: pt_BR_settings,
  },
  'pt-PT': {
    common: pt_PT_common,
    chat: pt_PT_chat,
    config: pt_PT_config,
    settings: pt_PT_settings,
  },
  ru: {
    common: ru_common,
    chat: ru_chat,
    config: ru_config,
    settings: ru_settings,
  },
  uk: {
    common: uk_common,
    chat: uk_chat,
    config: uk_config,
    settings: uk_settings,
  },
  tr: {
    common: tr_common,
    chat: tr_chat,
    config: tr_config,
    settings: tr_settings,
  },
  vi: {
    common: vi_common,
    chat: vi_chat,
    config: vi_config,
    settings: vi_settings,
  },
  th: {
    common: th_common,
    chat: th_chat,
    config: th_config,
    settings: th_settings,
  },
  hi: {
    common: hi_common,
    chat: hi_chat,
    config: hi_config,
    settings: hi_settings,
  },
  ar: {
    common: ar_common,
    chat: ar_chat,
    config: ar_config,
    settings: ar_settings,
  },
};

i18n.use(initReactI18next).init({
  lng: resolveAppLocale('system'),
  fallbackLng: 'en',
  ns: ['common', 'chat', 'config', 'settings'],
  defaultNS: 'common',
  resources,
  keySeparator: false,
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
