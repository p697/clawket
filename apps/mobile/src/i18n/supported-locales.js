// Single source of truth for the app locale set. Consumed by the runtime
// (`language.ts`), the native locale plugin (`plugins/with-locales.js`) and the
// translation gate (`scripts/i18n-prune.mjs`). Codes are BCP-47 tags that also
// name `locales/<code>/` and the iOS `.lproj` folders. Names are autonyms so
// the picker stays readable after choosing the wrong language.
const SUPPORTED_LOCALES = /** @type {const} */ ([
  { code: 'en', name: 'English' },
  { code: 'zh-Hans', name: '简体中文' },
  { code: 'zh-Hant', name: '繁體中文' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' },
  { code: 'es-419', name: 'Español (Latinoamérica)' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'pt-PT', name: 'Português (Portugal)' },
  { code: 'ru', name: 'Русский' },
  { code: 'uk', name: 'Українська' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'th', name: 'ไทย' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'ar', name: 'العربية', rtl: true },
]);

module.exports = { SUPPORTED_LOCALES };
