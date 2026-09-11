# Email sign-in and theme review — 2026-09-07

## Findings

The owner screenshots show a deterministic rendering defect, not merely a preference migration issue. `theme.ts` produces `accentSoft` at 10% in light mode / 16% in dark mode. `chat-appearance/resolver.ts` previously parsed its RGB channels but discarded that alpha, replacing it with 78–100% for soft or 72–90% for glass. Dark saturated purple/pink surfaces then retained ordinary ink text. The same resolver serves OpenClaw, Hermes and YouMind, and both actual messages and preview.

Fresh defaults are system appearance, iceBlue, solid, opacity 1, wallpaper disabled. Purple + soft is a saved preference, not the new-install default. Resetting everybody to blue would conceal the defect and discard intentional personalization. This change keeps IDs/defaults and repairs all saved combinations in rendering.

The app already has a useful separation: `buildInterfaceTheme` makes global controls neutral; `resolveChatTheme` / `ChatPresentationProvider` supplies conversation colors and editor drafts. Structural tokens and shared controls exist. The remaining weakness is consistent recipes and composition, rather than a missing theme framework.

The previous login used a centered gray card, nearly identical field/card surfaces, two overlapping back affordances and a plain code field. Compared with the read-only YouMind Mobile reference (`components/youmind/OneTimePasswordInput.tsx`, `YouMindSignInCard.tsx`), it omitted six-cell entry, autofill metadata, automatic completion, destination email and resend cooldown.

## Implemented

- Borderless login with left-aligned title/guidance, quiet email field and canonical primary action; no copied hero illustration.
- OTP has one native composition-safe field and six flexible visual cells. Digit paste/autofill completes verification with the submitted value directly, avoiding stale React state. In-flight requests are synchronously guarded; failed verification remains editable and has an explicit retry. A successful submission cannot be duplicated while navigation settles.
- Resend uses a 60-second wall-clock deadline, resets the code after successful delivery, and preserves email on edit. Errors remain inline; all new copy has six translations. One screen-level keyboard/scroll container replaces nested scrolling.
- Bubble tint resolves onto a stable theme canvas before material opacity. Solid remains opaque even on wallpapers; soft/glass preserve bounded translucency. No backend, credential, connection, storage or wire changes.

## Further unification priorities

1. Keep appearance preview and real chat on the same renderer, and expand visual acceptance to rich links, code, attachments, quote blocks and metadata on wallpaper. Body contrast tests alone do not certify every rich-content color.
2. Make type defaults consistent: chat settings reset currently chooses 16 while the shared body token is 17. Treat a future default adjustment separately from existing user font-size preferences.
3. Clarify material labels: “solid” means an opaque pale surface, not saturated accent. “Glass” currently means translucent surface plus border/shadow, not actual blur. Preserve stored IDs if simplifying the product labels or options.
4. Continue replacing card-within-card setup forms with the shared canvas/field/action recipe. Audit inactive/placeholder text separately from readable content; `inkTertiary` is intentionally weak and must not carry essential text.
5. Keep global appearance and chat personalization separate; avoid an unrelated all-app palette rewrite. Prioritize contrast, input flow and surface hierarchy before decorative effects.

## Validation

The recovered repository required gate passed (233 Mobile suites / 2,159 tests plus workspace/type/design/i18n/docs checks). The final native-input normalization refinement then passed TypeScript and 5 focused suites / 32 tests. Automated body contrast covers 648 combinations (six accents × two schemes × three materials × three opacity samples × two roles × three backdrop extremes), including saved soft/glass settings. OTP tests cover normalized paste, repeated completion, correction and busy state; panel tests cover stale-value submission, concurrent requests, cooldown, failure recovery and email editing.

Native email delivery/system autofill, Android keyboard behavior and broad rich-content wallpaper acceptance require separate evidence; do not infer those from unit tests.


Signed iOS Release initially built and was installed with original data preserved. A separate fresh simulator showed the new email layout and exposed missing localized guidance, corrected in source afterward. CUA then returned `noWindowsAvailable`; no OTP email was sent. Disk exhaustion interrupted the next build/gate attempt; deleting only the newly created empty QA simulator recovered space and the full required gate passed. A final incremental build encountered another task holding the shared Xcode build database; that task was not interrupted. Thus the final translation/input refinement is verified by tests/typecheck, not a newly installed native build. OTP and keyboard visuals, dark login, native autofill and updated chat screenshots remain open.
