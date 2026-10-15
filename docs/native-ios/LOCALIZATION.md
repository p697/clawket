# Native iOS localization

The app owns `apps/ios/Clawket/Localizable.xcstrings` and `InfoPlist.xcstrings` in its main bundle. The 19 locale codes match `apps/mobile/src/i18n/supported-locales.js`; backend identity, transport identity and app language remain separate. Product names, user messages, agent/session/project names, model/provider names, filenames, commands and tool output stay verbatim.

The initial source inventory contains 195 user-facing and accessibility keys from the eight `ClawketUI` sources and the real native host. `localization-inventory.json` records their locations and any reused Mobile term. Catalog entries are manual because most presentation strings originate in a Swift Package while the resource belongs to the app. Do not remove them merely because the app target's extractor does not see a package source.

Current source coverage: all 19 supported locales contain 379/379 UI translations plus all four camera/local-network/Photos/microphone permission purposes (7,277 string units, including the English source). The UI catalog reuses 146 existing Mobile terms; the other 233 native strings were translated for each locale. The catalog preserves queue and consent additions and adds 25 work-inspector labels, including unknown attribution/status and incomplete or unavailable detail content. A further Draft answer label distinguishes retained local editing from an accepted response; the roster Refresh button reuses the existing Mobile term. Device-approval copy separates rejected credentials from computer-side approval, reuses one existing Mobile guidance sentence and preserves the existing re-pair guidance for other backends. Conversation management adds 23 labels and failure states, including four trusted Mobile terms. Model settings add 38 labels and feedback states, including 25 trusted Mobile terms; acknowledgement, unknown outcome and explicit failure remain distinct. Free native appearance/settings adds 21 labels, including 18 actual Mobile terms, while wallpaper/icons and language selection remain pending. Voice adds 25 labels and recovery/failure explanations, reuses existing Mobile speech terms, and localizes the microphone purpose including cloud transcription. Regional Spanish and Portuguese retain their existing terminology, including Settings, pairing and connection labels. Permission descriptions use the separate `InfoPlist` table because `Localizable` does not localize system permission prompts.

No missing translation was filled with English and marked complete. Both catalogs are in the real app's Resources phase with all 19 known regions. The initial localization slice’s unsigned Simulator app build compiled both arm64 and x86_64 successfully; the resource validator read all 19 compiled locale bundles and matched their 3,743 values exactly to the catalogs, including the permission purposes. The later device-approval slice compiled the real generic app/test host for both architectures and verified its current 4,807 exact compiled values across the same 19 locales/two tables. Language selection, device rendering and linguistic acceptance remain separate checks. New source strings must still add real translations before the all-19 validation passes.

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

Host producer bindings integrated in the native app:

| Source | Strings that need localization at their producer |
| --- | --- |
| `NativeAppModel` | App-authored connection phase labels, retry/read-only explanations, model scope labels, save/recovery notices, pairing errors, delivery warnings, `Participant`, `Tool output`, send/queue labels and presentation defaults use localized producers. |
| `ConnectAgentView` | Connection methods have localized display titles; the `Local model` label, conditional section headers and connect/save titles are localized. The five backend product names remain unchanged. |
| `PairingScanner` | App-authored `onFailure` strings and fallback explanations are localized before becoming runtime strings. |
| `ConnectionsView` | `%@ · Native development` localizes the complete format and preserves the version argument. Saved connection labels remain verbatim. |
| App resource setup | Both catalogs are app resources with the same 19 known regions. The package has no separate localization resource bundle. |

Presentation-library bindings keep fixed text localized at its producer:

| Source | Dynamic defaults/helper arguments requiring explicit localization |
| --- | --- |
| `ClientPresentation` | Default `Agents`, empty-state heading/detail and `Send` resolve at initialization. Caller-supplied presentation strings stay verbatim. |
| `NativeClientView` | The detail welcome sentence and app-owned roster accessibility fragments resolve explicitly. Private action labels accept `LocalizedStringKey`; names/previews stay verbatim. |
| `NativeComposer` | Private action helpers accept localizable label keys. Conditional editor/stop labels resolve before becoming runtime strings; preview/remove/preparing accessibility values use localized `Text` interpolation. The host supplies an already localized `sendLabel`. |
| `ClientSheets` | Conditional empty-state strings and `All projects`/`Conversations` fallbacks resolve explicitly beside real project/catalog names. |
| `MessageContentView` | The `Code` fallback, approval outcomes/decisions and delivery labels use localization APIs. Backend approval text remains verbatim; the host supplies confirmation title/detail. |
| `QuestionContentView` | Required/single/multiple guidance, explicit Yes/No, text-length feedback and action labels use the main catalog. Native question/field/option text and descriptions remain verbatim; custom text stays unchanged. |
| Native media host | System media actions, capability/size feedback, attachment-only prompt text, retry/preview/share/save labels and camera/add-only Photos purposes have actual translations in all 19 locales. Names and filenames remain verbatim. |
| Native model controls | Native scope/current/default, thinking/speed/permission choices, frozen confirmation and precise read/write feedback use the catalog. Model/provider names and alias IDs stay verbatim. |
| `NativeWorkInspector` | Work statuses, content kinds, clocks, empty/unavailable/partial feedback and request-preview accessibility use the main catalog. Host titles, previews and full tool content remain verbatim; opaque lineage IDs stay out of product text. |

These changes localize fixed app text, not arbitrary strings received over the wire. Source additions after this inventory must add an actual catalog entry and update the inventory rather than relying on English fallback.

## Formats, plural forms and RTL

The current inventory uses string arguments (`%@`) and no variable-count sentences. The 32-message queue limit is a fixed product limit, not a runtime count. Do not invent unused plural keys to claim coverage. When exposing a variable count, use a complete interpolated sentence and catalog plural variants; never append an English noun to a number. Preserve argument types and use positional specifiers when a translation reorders arguments. [String catalogs](https://developer.apple.com/documentation/xcode/localizing-and-varying-text-with-a-string-catalog) support language-specific variants without raising the deployment target.

The validator checks placeholder positions/types, actual translated units, inventory coverage and language-specific plural categories, including Arabic zero/one/two/few/many/other. A plural variant may omit its consumed count when grammar expresses it in words, such as “one message” or Arabic's dual form. Other arguments retain their positions and types. The validator rejects unknown variation structures instead of silently counting them as translated. Future multi-substitution formats must extend this validation before use.

Use system leading/trailing layout and native navigation mirroring for Arabic; keep code, addresses and credentials readable in their natural direction. Test Arabic names alongside Latin filenames, model names and URLs, plus both argument orders in accessibility labels. Do not reverse strings or force the entire interface to LTR. Apple's [RTL guidance](https://developer.apple.com/design/human-interface-guidelines/right-to-left) and [localization testing guidance](https://developer.apple.com/documentation/xcode/preparing-your-interface-for-localization) define the relevant system behavior and pseudolanguages.

## Verification

```sh
node --test scripts/native-ios/localization.test.mjs
node scripts/native-ios/localization.mjs
python3 -m unittest discover -s scripts/native-ios -p test_localization_resources.py
python3 scripts/native-ios/localization_resources.py /path/to/Clawket.app
```

The Node tests cover both real catalogs in all 19 locales plus corrupted/missing text, changed permission purposes, empty input, mismatched/reordered placeholders and incomplete Arabic plurals. The source CLI requires all 19 and currently passes for all 295 UI keys and three permission purposes; any missing translation fails it. The optional `--initial-qa` mode retains the earlier explicit four-locale scope for development and prints all 19 counts; CI uses the full default scope.

The four Python resource regressions reject missing locale tables, changed/empty/malformed compiled values, changed permission source text and malformed catalog input. The resource CLI reads the actual app's compiled `Localizable.strings` and `InfoPlist.strings`, comparing every current direct string unit to its catalog and checking the English permission sources in the built `Info.plist`. It rejects unsupported variant structures rather than claiming coverage; future plurals must extend the compiled-resource check before use. Native iOS CI runs it after the real app test build. This verifies resource integration; testing English, Chinese IME, Japanese, long German text, Arabic/RTL, Dynamic Type and VoiceOver on the simulator/device remains necessary.
