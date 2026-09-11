# Composer upgrade — 2026-09-06

The owner authorized a first complete refinement of composer quality, long-form editing, unified actions, and keyboard behavior. This supersedes the original fixed composer recipe without changing backend scope or transport contracts.

## Implementation

- One native input survives compact/full-screen transitions. Three visual lines expose expansion; compact growth stops at five lines, with scrolling beyond the cap. A bounded native Text measurement avoids the paste input's unreliable Fabric content-size notifications without replacing marked text.
- Full-screen writing has a collapse action, keyboard dismissal, the same model/thinking controls, and visible connection feedback when offline. Its temporary placeholder retains the original timeline geometry, and hidden background content is excluded from accessibility.
- Add, dictation, Send, and Stop share a 40-point visual / 44-point target / 20-point icon recipe. Primary actions have no unrelated floating shadow; empty drafts reserve a disabled Send or available dictation slot. Attachments live inside the composer, and attachment-only drafts can send.
- Existing keyboard-controller 1.20.7 owns iOS keyboard animation; no dependency upgrade. The header remains fixed. The list follows viewport changes only while already following the bottom; reading history and expanding tools must retain position. Android continues to use native adjustResize rather than adding a second keyboard offset.
- Debounced draft persistence now flushes the final edits on scope departure. Clearing a submitted draft also cancels pending saves so cleanup cannot restore stale text.
- Stable native layout hosts and post-layout focus preserve the keyboard through expansion/collapse; compact styles explicitly clear expanded flex properties. The hidden measurement has its own six-line height so it cannot inherit a one-line clipping constraint. Foreground connection recovery no longer forcibly dismisses the editing keyboard.
- iOS native-owned draft text uses the canonical light/dark ink through DynamicColorIOS. A live appearance change must recolor existing attributed text without rewriting the draft or marked text; ordinary static color props only refreshed typing attributes in the installed native input.

Reference: [Keyboard Controller](https://github.com/kirillzyusko/react-native-keyboard-controller/blob/main/docs/docs/api/components/keyboard-sticky-view/index.mdx) documents the distinction between moving an accessory and resizing a container. Implementation was checked against the installed 1.20.7 source; newer chat-scroll APIs were not assumed available. The third-line expansion behavior is the owner's explicit Telegram reference.

## Acceptance results

Signed iPhone 17 Simulator Release built and installed. Native inspection reproduced and corrected constrained multi-line height, lost focus during expansion, and collapsed-mode flex residue. Verified natural Chinese wrapping, four-line compact expansion/collapse with the keyboard retained, seven-line full-screen editing, keyboard hide/show, and a latest reply remaining above the composer. Actual system Pinyin `ni` candidates survived expansion and committed as `你`; the original English keyboard and light appearance were restored. Light/dark screenshots and a keyboard-transition recording are in `evidence/composer-upgrade/`. This is visual/functional acceptance, not a measured frame-rate guarantee.

One respectful message was sent from full-screen editing in the independent Lucy QA session `agent:main:dashboard:dba1e02f-b39d-4eed-8a73-b5552e2743d2`; Lucy replied “输入体验测试完成。” The send cleared the draft and returned to chat, Stop appeared while running, and user/reply messages remained after reinstall/cold re-entry. Extra unsent layout-test text was cleared afterward. Lucy's main conversation was not used for test messages.

Final `npm run check:required` passed: 229 Mobile suites / 2,121 tests, 150 UI source files, design-system documentation, six locales, and repository checks. Regressions cover third-line expansion, native input identity, compact flex restoration, attachment-only sending, viewport follow policy, final draft flush, and cancellation of stale saves. Signed Release passed after the native-layout and dynamic-color corrections; existing draft text was visually checked through a live light-to-dark transition in both editor modes.

Android arm64 Debug native build passed (532 tasks); Android JS/Hermes bundle export passed. This host has no installed Android emulator/runtime image and only about 5 GiB free, so no Android keyboard-motion or device-feel acceptance is claimed.

The saved Hermes QA Preview connection became unavailable during editing checks (`Hermes health frame timed out`). Offline draft editing and disabled send are covered; no live Hermes messaging pass is claimed for this composer iteration. No Hermes source or transport code was changed.
