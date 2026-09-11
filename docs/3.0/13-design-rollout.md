# Design-language rollout

2026-09-06. Owner approved the native component gallery and connection example after visual feedback rounds. No further design-direction approval is required to implement the agreed language across the App. This document authorizes the next implementation phase; it does not mark that phase complete.

## Accepted direction

- Chat is the primary experience. Preserve existing backend capabilities while progressively disclosing management and advanced settings.
- Reuse the reviewed primitives: neutral main actions, plain header icons, quiet standalone circles, native neutral switches, calm recovery feedback, consistent spacing/type, and official platform marks.
- Retain the input fixes: composition-safe value ownership, explicit default tracking, and natural iOS single-line font metrics. Verify focused, placeholder, error, loading, and disabled states as well as the static page.
- Use the shared motion durations and reduced-motion behavior. Immediate visual response must not wait for network work; verify keyboard and sheet transitions in a Release build.
- No new visual approval checkpoint before rollout. Maintain honest per-screen evidence and distinguish automated checks from rendered acceptance.

## Theme decision

Global appearance means light, dark, or follow system. Consolidate the user-facing accent choice and chat appearance into **Chat theme** during rollout. Chat personalization must have one discoverable entry with a real conversation preview; preserve existing saved preferences and reset/save behavior.

Current `accent` is not chat-only: buttons, selections, links, paywall elements, and conversation UI consume it. Decouple those consumers deliberately while applying the accepted neutral navigation/control language. Do not merely rename the global setting while leaving an unexplained global color change. Semantic success/warning/error colors and platform/Agent identity retain their own meanings.

The existing `ChatAppearanceScreen` and `features/chat-appearance/` already contain photo-background, blur, opacity, and solid/soft/glass foundations. Preserve working functionality and evaluate it against the actual thread renderer; its presence in code is not visual or performance acceptance.

### Recorded personalization follow-up

The owner explicitly asked to record these ideas for later implementation rather than expanding the current design-language work:

- User-supplied backgrounds and a small curated preset collection, with Telegram as a reference for usability.
- Bubble colors, transparency, blur, and glass-like materials, evaluated together with text contrast and actual scrolling/streaming performance.
- A single preview-driven chat-theme editor; advanced options should not become another long settings list.

Future acceptance includes large text, light/dark content legibility, keyboard transitions, streaming, background persistence/removal, and reduced-transparency/motion preferences. No decorative material may compromise message readability or input responsiveness.

## Implementation and acceptance order

| Work | Scope | Required evidence | Status |
|---|---|---|---|
| Shared language | Buttons, headers, fields, rows, switches, banners, sheets | Consumer audit; state/theme checks; required gate | Pending rollout |
| Chat core | Roster, thread header/history/composer, sessions, search, message actions | Real navigation and send/stream/stop/retry; keyboard and long-content visual review | Pending |
| Connection and first run | Welcome, platform chooser, pairing, YouMind sign-in, connection lifecycle | Initial/recovery states, all three platform paths, visible disconnect/reconnect | Reference approved; remaining surfaces pending |
| Settings and Agent management | Account categories, Agent profile and capability-gated detail pages | Every reachable page/empty/error state, small screen and translated copy | Pending |
| Theme consolidation | Global appearance versus unified chat-theme entry | Existing preferences preserved; preview agrees with real chat | Pending |
| Finish | Remove temporary review shortcut, keep developer gallery, document exact coverage | Release simulator evidence; appropriate Android checks; full required gate | Pending |

The original engineering acceptance remains open: OpenClaw/Lucy, Hermes, and YouMind functional completeness; reconnect stability; Release responsiveness; and final owner real-device acceptance. UI approval does not replace these gates. Production deployment and store release are not implied by approval of the design reference.

## In-progress implementation checkpoint

- Shared defaults now use monochrome primary/quiet secondary buttons, plain navigation, neutral switches, quiet inputs, and neutral recoverable banners. Legacy ActionButton adopts the canonical press timing/scale and 44 pt target. Header sizes and return spacing are being aligned across older content-owned headers.
- Saved accent is scoped to conversation content. The editor has a local color draft; real Thread now receives the saved background/font/bubble preferences and optional identity labels through the same presentation boundary as its preview. Appearance exposes one Chat theme entry.
- Native review caught an untranslated row due to the explicit translation dispatch; corrected. Removed the onboarding gallery shortcut while preserving developer access.
- Native route review found Help Center incorrectly opening external OpenClaw docs and WeCom having no handler. Added the real HelpCenter route and community entry, consolidated duplicated docs there, and made the Pro release-note entry work for existing members. Advanced settings now pushes its own screen to preserve the About return path.
- Release screenshots are accumulating in local `evidence/rollout/`. Current captures include Welcome, settings root, platform chooser/pairing, notifications, discard sheet, release notes, and before states for help/icons/connection empty state. Before captures are findings, not final acceptance. Full page/backend/theme matrix remains open.
- Live Preview pairing identified an unsigned-QA persistence failure (diagnosed below), false expiry feedback, and a trapped root return path. Root return and handled/cancelled invitation outcomes are corrected; genuine adapter errors retain their recovery path.

### Simulator signing finding

The persistence failure was isolated to the unsigned QA build (`CODE_SIGNING_ALLOWED=NO`). Rebuilding Release with `CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-` embeds Xcode's simulated application identifier; the original OpenClaw/Hermes/YouMind records and preferences immediately return. macOS `codesign` shows an empty entitlement plist for a correctly signed simulator binary because the simulated entitlements are injected into its executable; inspect `Clawket.app-Simulated.xcent` as well. Do not certify Keychain/persistence/connection behavior from unsigned Simulator builds. No production Keychain behavior or external backend source was changed to work around the QA issue.

### Native chat checkpoint and remaining visual work

Signed Release restored all three existing connections. YouMind loaded its real history, sent a Chinese QA prompt, and returned the requested reply. Inspected the conversation with software keyboard, Agent profile, connection page, pause confirmation, and paused state. Saved local screenshots in `evidence/rollout/`. Cold-start persistence and resume were next, but macOS locked before the next observation; YouMind is intentionally paused in the simulator until interactive QA resumes. This is not a completed three-backend acceptance.

The inspection also led to: a smaller keyboard/control gap (home-indicator clearance no longer counted twice), accessible assistant message content, recorded per-message model labels instead of relabeling history with the current model, and shared glass-surface shadow behavior. Wallpaper persistence now awaits storage before replacing live appearance or removing the old image; failed writes preserve the old background and clean up the staged copy. Focused regressions cover these storage and presentation behaviors. The keyboard adjustment still requires its final rendered screenshot.

Still required before owner-wide acceptance: recapture revised Help Center/App icon/theme pages; all Agent management sections and nested sheets; live OpenClaw/Hermes regression, YouMind resume/cold-start; light/dark and small-screen translated/keyboard checks; final performance observations and screenshot matrix. A locked computer must never be replaced with fabricated screenshots or marked as visual acceptance.


### Per-page evidence ledger

All paths below are local `evidence/rollout/` PNGs. A screenshot proves only the state actually shown; it does not cover unlisted themes, sizes, or backend capabilities.

| Surface | Captured state / finding | Remaining native review |
|---|---|---|
| Welcome | `welcome-light`; hierarchy, action priority and spacing reviewed | Small screen / dark |
| Platform chooser | `platform-chooser-light`; official marks and separated setup reviewed | Dark |
| OpenClaw pairing | `pairing-light`; two steps and recovery return reviewed | Signed save, final recovery revision |
| Hermes pairing / YouMind login | Approved shared setup primitives | Current complete native flow |
| Roster | `roster-light`; four real Agents, neutral header and unread badge | Dark, search and add actions |
| YouMind thread | `youmind-chat-keyboard-light`; real history and new Chinese reply | Revised keyboard gap, stop and cold start |
| OpenClaw / Hermes thread | Conversation preferences now share preview implementation | Real send/stream/history/actions regression |
| Session panel | Shared tabs/sheet/header migrated | Groups/list/search/actions |
| Global search / message detail | Shared input, rows and message palette migrated | Native result, empty, favorites and detail |
| YouMind profile | `youmind-profile-light`; identity, chat and connection hierarchy reviewed | Dark |
| OpenClaw / Hermes profile | Stat-card profile (header chat button, Cron jobs / Cost today heroes, Models / Skills / Files tiles) rendered in light/dark render tests | Real counts, heartbeat line and advanced sheet on device |
| Models / providers | Shared search, tabs, settings rows | Both backend sections |
| Skills / discovery / detail | Shared search, lists and sheets | Long content, permissions and search |
| Scheduled tasks / heartbeat / editors / runs | Shared rows, switches and sheets | Native detail/editor/keyboard |
| Files / editor / identity / memory | Shared rows, input and sheets | Native detail/editor/keyboard |
| Usage / export | Shared rows, tabs and poster sheet | Native graph/poster |
| Tools / channels / devices / nodes | Shared controls and capability filtering | Native lists/details |
| Logs | Shared input, filters and rows | Long content, streaming/pause |
| OpenClaw management | Shared navigation and management sections | Configuration/permissions/diagnostics/backup |
| Connections | `connections-empty-before`; empty action added after review | Final populated and empty states |
| Connection lifecycle | `youmind-connection-light`, `connection-pause-confirmation`; pause succeeded | Cold start, resume, reconnect and advanced details |
| Settings root | `settings-light`; categories and quiet navigation reviewed | Final populated / dark |
| Appearance / chat theme | `theme-discard-light`; shared preview, local color draft and save behavior implemented | Saved real thread agreement; small screen / dark |
| Chat and notifications | `chat-notifications-light` | Final dark/language sheets |
| Help / community | `help-list-before`; route and structure corrected after review | New Help Center tabs/topics/community sheet |
| Release notes / membership | `release-notes-light`; paid-member entry fixed | Final membership route and terms layout |
| App icons | `app-icon-before`; actual previews added after review | Final picker |
| About / advanced / design gallery | `about-before`, `developer-light`; return stack corrected | Final navigation and gallery under neutral context |

Build recovery: the final full gates initially hit disk exhaustion. Removed only the obsolete Clawket Xcode DerivedData directory (rebuildable cache), recovering about 5 GiB; retained sources, connection data, and evidence. Android native compilation is scoped to arm64-v8a and a separate Android Hermes JS export verifies current JS packaging.


Automated checkpoint: current required gate passes (228 Mobile suites / 2,092 tests; 148 UI source files; 6,318 translated entries). Signed iOS Release built and installed; Android arm64 Debug build and Android JS/Hermes export passed. These results do not close any pending native-review row above.
