# iOS App Store review invitations

Owner decision 2026-10-13: improve App Store review volume and rating through appropriate native invitations. No custom star survey or sentiment filtering. This replaces the first-send/third-cold-start rule; Android's existing manual behavior is unchanged.

## Qualification and timing

- Three phone-initiated conversation turns completed normally across at least two local calendar dates. Count live `end_turn` with a visible reply or attachment, while the app is active; no send acknowledgements, slash commands, failed/cancelled/truncated/empty/silent/mirrored replies, foreign runs, history replay or duplicate terminal events. Adapter/session scope retirement invalidates the candidate. A completion seen before its send acknowledgement is still eligible through the existing optimistic-run adoption fence. Only dates/counts/timestamps are persisted, never run/session IDs or content.
- A return from Thread to Roster creates one opportunity. Wait two quiet seconds; cancel on touches, navigation, unmount or background. Startup and foreground alone never invite. Defer while connection/roster health, subscription/bootstrap, approval/input, live runs or modal state is unresolved. Revalidate after asynchronous availability/storage calls. Debug/development mode does not invite.
- Require a completion in the last seven days. Invite at most once per process, once per recorded app version, every 60 days, and three times per rolling 365 days. Every attempt resets the experience counters, requiring new usage. These are initial product thresholds, not guaranteed optimal or Apple's display quota.

## Persistence and manual entry

Keep the existing AsyncStorage key with a v3 schema: capped completed-turn count, at most two dates, last completion time, at most three attempt dates/versions, last manual invitation date. Legacy v1/v2 attempt timestamps remain cooldown/year evidence; old sends, launch counters and pending flags do not prove completed usage. Corrupt state and failed reads/writes fail closed, without blocking conversations. Native unavailability does not spend an attempt; native errors/no-op calls do. Cancellation during the pre-dispatch persistence retains a conservative attempt record.

The iOS settings action opens the App Store `action=write-review` link directly. It suppresses automatic requests for this process and persists a 60-day cooldown, best effort; persistence failure does not break the manual link. It never claims the user submitted a review.

## Measurement and acceptance

`app_review_request` reports only fixed outcome/reason enums; `app_rating_tapped` retains manual entry outcomes. No API result establishes actual display, stars, or submission. Compare weekly new iOS ratings per active iOS device and the distribution/average of newly received ratings against a pre-release baseline, separating versions/territories and noting acquisition changes. Existing cumulative average changes slowly; request counts alone cannot establish success. Do not filter invitations by reported satisfaction or payment tier.

Tests cover policy boundaries, corrupt state, legacy migration, concurrent persistence, availability/storage/native failures, cancellation across async boundaries, manual links, both OpenClaw/Hermes completion consumers and lifecycle quiet windows. Live presentation requires an authorized iOS build/device check; TestFlight does not display StoreKit review requests. Store submission/release and later metric assessment remain owner steps, separate from code merge.

Sources: [Apple review guidelines §5.6.1](https://developer.apple.com/app-store/review/guidelines/#app-store-reviews), [StoreKit request semantics](https://developer.apple.com/documentation/storekit/appstore/requestreview(in:)-1q8qs/), [Expo StoreReview](https://docs.expo.dev/versions/latest/sdk/storereview/).
