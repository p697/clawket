# Native iOS localization

The app owns `apps/ios/Clawket/Localizable.xcstrings` in its main bundle. The 19 locale codes match `apps/mobile/src/i18n/supported-locales.js`; backend identity, transport identity and app language remain separate. Product names, user messages, agent/session/project names, model/provider names, filenames, commands and tool output stay verbatim.

The initial source inventory contains 195 user-facing and accessibility keys from the eight `ClawketUI` sources and the real native host. `localization-inventory.json` records their locations and any reused Mobile term. Catalog entries are manual because most presentation strings originate in a Swift Package while the resource belongs to the app. Do not remove them merely because the app target's extractor does not see a package source.

Current source coverage:

| Locales | Actual translations |
| --- | --- |
| English, Simplified Chinese, Traditional Chinese, Japanese, German, French, Italian, Spanish, Latin American Spanish, Brazilian Portuguese, European Portuguese | 195/195 each |
| Korean, Russian, Ukrainian, Turkish, Vietnamese, Thai, Hindi, Arabic | 64/195 each; 131 new native strings still pending |

The 64 reused terms come from the existing locale files, with their origin recorded per key. New translations are written for the actual native flows. Missing translations are omitted, never represented by copied English with a completed state. This is initial QA coverage, not completion of the final 19-language parity gate. Resource compilation, language selection, device rendering and linguistic acceptance remain separate checks.

## Binding text to the catalog

Apple distinguishes localizable literals from runtime strings. `Text("Settings")` is localizable, while `Text(someString)` displays the supplied value. Create app-owned presentation strings with `String(localized:)` at their producer; do not wrap every rendered `String` in `LocalizedStringKey`, which would also reinterpret user and backend content. See [Preparing your app's text for translation](https://developer.apple.com/documentation/xcode/preparing-your-apps-text-for-translation).

Prefer direct calls with literal keys and complete sentences:

```swift
let sendLabel = isRunning
    ? String(localized: "Add to queue")
    : String(localized: "Send")
let placeholder = String(localized: "Message \(agentName)")
```

If a helper is useful, accept a `LocalizedStringResource` and resolve it to `String` with `String(localized: resource)`. Keep the main-bundle resource owner explicit. Never construct a localized key by concatenating words or inserting the final user value into a dynamic lookup key. For SwiftUI accessibility interpolation, `Text("Model: \(modelTitle)")` preserves the catalog key `Model: %@` and the untranslated argument. See [String's localized initializer](https://developer.apple.com/documentation/swift/string/init(localized:options:table:bundle:locale:comment:)).

Host changes required at the current source snapshot:

| Source | Strings that need localization at their producer |
| --- | --- |
| `NativeAppModel` | All app-authored connection phase labels, retry/read-only explanations, model scope labels, save/recovery notices, pairing errors, delivery warnings, `Participant`, `Tool output`, and send/queue labels. Initialize the presentation's title/empty title/empty detail with localized defaults. |
| `ConnectAgentView` | Give each connection method a localized display title instead of showing its English raw value. Localize the `Local model` backend label, conditional section headers and conditional connect/save button titles. Keep the five backend product names unchanged. |
| `PairingScanner` | Localize the strings passed to `onFailure`, and localize the fallback explanation before placing it in a runtime `String`. |
| `ConnectionsView` | Use the catalog format `%@ · Native development` for the version value, with the version as an untranslated argument. Keep saved connection labels unchanged. |
| App resource setup | Add the catalog to the app's Resources phase and declare the same 19 known regions. The package has no separate localization resource bundle. |

Presentation-library binding applied in this branch (public types unchanged; app integration and iOS compilation are separate checks):

| Source | Dynamic defaults/helper arguments requiring explicit localization |
| --- | --- |
| `ClientPresentation` | Default `Agents`, empty-state heading/detail and `Send` resolve at initialization. Caller-supplied presentation strings stay verbatim. |
| `NativeClientView` | The detail welcome sentence and app-owned roster accessibility fragments resolve explicitly. Private action labels accept `LocalizedStringKey`; names/previews stay verbatim. |
| `NativeComposer` | Private action helpers accept localizable label keys. Conditional editor/stop labels resolve before becoming runtime strings; preview/remove/preparing accessibility values use localized `Text` interpolation. The host supplies an already localized `sendLabel`. |
| `ClientSheets` | Conditional empty-state strings and `All projects`/`Conversations` fallbacks resolve explicitly beside real project/catalog names. |
| `MessageContentView` | Only `Code`, question-placeholder and permission-scope fallbacks are translated; outcomes and decision labels are localizable. Backend question/approval text remains verbatim. Existing action/delivery labels already used localization APIs. |

These changes localize fixed app text, not arbitrary strings received over the wire. Source additions after this inventory must add an actual catalog entry and update the inventory rather than relying on English fallback.

## Formats, plural forms and RTL

The current inventory uses string arguments (`%@`) and no variable-count sentences. The 32-message queue limit is a fixed product limit, not a runtime count. Do not invent unused plural keys to claim coverage. When exposing a variable count, use a complete interpolated sentence and catalog plural variants; never append an English noun to a number. Preserve argument types and use positional specifiers when a translation reorders arguments. [String catalogs](https://developer.apple.com/documentation/xcode/localizing-and-varying-text-with-a-string-catalog) support language-specific variants without raising the deployment target.

The validator checks placeholder positions/types, actual translated units, inventory coverage and language-specific plural categories, including Arabic zero/one/two/few/many/other. A plural variant may omit its consumed count when grammar expresses it in words, such as “one message” or Arabic's dual form. Other arguments retain their positions and types. The validator rejects unknown variation structures instead of silently counting them as translated. Future multi-substitution formats must extend this validation before use.

Use system leading/trailing layout and native navigation mirroring for Arabic; keep code, addresses and credentials readable in their natural direction. Test Arabic names alongside Latin filenames, model names and URLs, plus both argument orders in accessibility labels. Do not reverse strings or force the entire interface to LTR. Apple's [RTL guidance](https://developer.apple.com/design/human-interface-guidelines/right-to-left) and [localization testing guidance](https://developer.apple.com/documentation/xcode/preparing-your-interface-for-localization) define the relevant system behavior and pseudolanguages.

## Verification

```sh
node --test scripts/native-ios/localization.test.mjs
node scripts/native-ios/localization.mjs --initial-qa
node scripts/native-ios/localization.mjs
```

The first command checks real initial-QA coverage plus corrupted/missing text, empty input, mismatched/reordered placeholders and incomplete Arabic plurals. The second explicitly requires the four initial-QA locales and prints coverage for all 19. The final command requires all 19 and must remain red while translations are pending. None substitutes for compiling the catalog in the real app and testing English, Chinese IME, Japanese, long German text, Arabic/RTL, Dynamic Type and VoiceOver on the simulator/device.
