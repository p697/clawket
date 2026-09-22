# Mobile Localization

Canonical engineering guide for Clawket mobile localization. Product copy rules stay in `AGENTS.md`; this document owns the supported locale set, the sources of truth, the workflows, and the right-to-left rules.

## Supported languages

The app ships 19 locales, the same set as YouMind Mobile. `src/i18n/supported-locales.js` is the only place the list is authored; everything below derives from it.

| Language | Locale | Notes |
| --- | --- | --- |
| English | `en` | Reference catalog; every key's English value is the translation source |
| Simplified Chinese | `zh-Hans` | Default for `zh`, `zh-CN`, `zh-SG` and any `zh` tag without a Traditional script or region |
| Traditional Chinese | `zh-Hant` | `zh-Hant-*`, `zh-TW`, `zh-HK`, `zh-MO`; Taiwan wording |
| Japanese | `ja` | |
| Korean | `ko` | |
| German | `de` | |
| French | `fr` | All `fr-*` regions |
| Spanish (Spain) | `es` | `es`, `es-ES` and non-American regions |
| Spanish (Latin America) | `es-419` | `es-419` and American region tags (`MX`, `AR`, `CO`, `US`, …) |
| Italian | `it` | |
| Portuguese (Brazil) | `pt-BR` | Default for a bare `pt` tag |
| Portuguese (Portugal) | `pt-PT` | `PT`, `AO`, `CV`, `GW`, `MO`, `MZ`, `ST`, `TL` |
| Russian | `ru` | |
| Ukrainian | `uk` | |
| Turkish | `tr` | |
| Vietnamese | `vi` | |
| Thai | `th` | |
| Hindi | `hi` | |
| Arabic | `ar` | Only right-to-left locale |

Unsupported device languages fall back to English. Device tags resolve through `resolveLocaleTag` in `src/i18n/language.ts`; the table above is its contract and `src/i18n/language.test.ts` pins it.

## Sources of truth

- Locale set, autonyms and text direction: `src/i18n/supported-locales.js`
- Translations: `src/i18n/locales/{locale}/{common,chat,config,settings}.json`
- Runtime registration: `src/i18n/index.ts` (one import per locale and namespace; Metro needs static requires)
- Device-locale resolution and RTL detection: `src/i18n/language.ts`
- Persisted app-language choice and layout-direction sync: `src/i18n/AppLanguageProvider.tsx`
- Native registration: `app.json` (`CFBundleLocalizations` and the `expo-localization` plugin's `supportedLocales`) plus `plugins/with-locales.js`, which creates the iOS `.lproj` folders and Known Regions from the shared list
- Gate: `scripts/i18n-prune.mjs` (`npm run i18n:check`, part of the root `check:required`)

`app.json` cannot import the shared list, so the gate verifies that both of its locale arrays equal `supported-locales.js` exactly and rejects static `supportsRTL` / `forcesRTL` options, including `extra` overrides.

## Changing ordinary copy

1. Pick the namespace that owns the screen: `common`, `chat`, `config` or `settings`.
2. Add the same natural-English key to that namespace in every locale directory. The English value equals the key.
3. Translate the English value, keeping every `{{token}}`, intentional line break and inline code span. The gate rejects a locale whose interpolation tokens differ from English.
4. Render through `useTranslation(namespace)` and `t()`; alerts, buttons, empty states and accessibility labels included.
5. Constants with translated labels live inside a component hook or memo so a language switch refreshes them.
6. Run `npm run i18n:check` from `apps/mobile`.

Do not touch `supported-locales.js`, `app.json` or `plugins/with-locales.js` for copy changes.

## The gate

`node scripts/i18n-prune.mjs --strict` fails on any of:

- a locale directory, namespace or key missing or extra anywhere in the matrix;
- a value that is empty or not a string;
- interpolation tokens that differ from the English value;
- a non-English catalog whose values are more than 40% identical to English (an untranslated placeholder; real locales stay near 10%);
- a source `t()` call whose literal key is absent from every namespace its lexical `useTranslation` binding declares;
- a catalog key no source file references (run `npm run i18n:prune:write` to delete such keys);
- a dynamic `t(expression)` call that is not registered in `DYNAMIC_KEY_ORIGINS` inside the script, or a registry entry whose call site or literal key table no longer exists;
- `app.json` locale registration drifting from the shared list.

Template keys such as `` t(`thinking_${level}`) `` are protected by their prefix automatically. Other runtime-selected keys must come from a finite literal table; register the call site and the table file in `DYNAMIC_KEY_ORIGINS` so the gate can prove the table still exists.

## Adding or removing a locale

1. Add the entry to `src/i18n/supported-locales.js` (code, autonym, `rtl: true` when applicable).
2. Add all four namespace files under `src/i18n/locales/{code}/` with exact key parity and real translations.
3. Add the four imports and the resource entry in `src/i18n/index.ts`.
4. Add the code to both locale arrays in `app.json`, in the same order as the shared list.
5. Extend `resolveLocaleTag` when the locale needs region or script rules, and pin them in `src/i18n/language.test.ts`.
6. Run `npm run i18n:check`, `npm run typecheck`, the mobile test suite, and rebuild both native projects (`npm run mobile:sync:native` from the root) so the iOS `.lproj` folders and the Android `locale_config.xml` are regenerated.
7. Prepare App Store Connect and Google Play listing metadata for the new storefront language; it is not generated from the app catalogs. Apple exposes Latin American Spanish as “Spanish (Mexico)”.

## Right-to-left layout

Arabic is the only RTL locale. `with-locales` preserves Android manifest RTL support and iOS locale registration, while React Native's `I18nManager` alone owns the process-wide direction, and `App.tsx` passes the matching `direction` to `NavigationContainer`.

Switching between RTL and LTR is the one language change that reloads the app: `AppLanguageProvider.syncLayoutDirection` calls `I18nManager.allowRTL` / `forceRTL` and then `reloadAppAsync`. Switching among LTR locales stays live, as before. Both direction preferences are persisted even when the current layout already matches, keeping explicit LTR choices stable on RTL devices. A matching cold start does not reload; a saved choice that differs from native direction is reconciled once.

Rules for UI code:

- React Native mirrors `flexDirection: 'row'`, `left`/`right`, `marginLeft`/`marginRight`, `paddingLeft`/`paddingRight` and `textAlign` automatically under RTL. Do not hand-flip them.
- Back/forward glyphs (`ChevronLeft`, `ChevronRight`, `ArrowLeft`, `ArrowRight`) import from `src/components/ui/DirectionalIcon`, never from lucide directly; the wrapper mirrors them under RTL. Media transport, charts, code and artwork keep their physical orientation.
- Gesture math (`translationX`, swipe thresholds) and transforms are not mirrored by React Native. Keep image paging and similar physical gestures physical; mirror only gestures whose meaning is “forward/back”.
- Mixed user content keeps automatic text direction; never force a whole message to RTL.

Do not set Expo Localization's static `supportsRTL` or `forcesRTL` flags. Its native module reapplies them at initialization and can overwrite the in-app choice, causing a reload loop and white screen. `with-locales` removes stale iOS plist flags and Android string resources during incremental prebuild; the module's absent/unset configuration leaves React Native preferences intact. This follows [Expo's dynamic RTL guidance](https://docs.expo.dev/guides/localization/#dynamically-overriding-rtl-settings). No AppleLanguages override is needed.

This configuration fix requires a new native build, not only a JavaScript update. Validate at least: a cold Arabic launch, switching Arabic to and from an LTR locale from Account Settings, root and stack navigation, Roster and Session Panel rows, Thread bubbles and composer, settings sheets and inputs.
