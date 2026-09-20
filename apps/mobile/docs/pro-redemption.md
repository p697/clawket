# Store redemption codes

Owner-authorized implementation, September 19, 2026. Codes grant the same `Clawket Pro` entitlement as store purchases; no database, custom code validator or new login is required. The open-source client contains the integration only. Store administration and downloaded codes stay outside Git.

## Product and recovery

The paywall's legal footer has **Redeem code**. iOS opens RevenueCat's native StoreKit redemption sheet; Android opens Google Play's official redemption page. Store UI handles invalid, expired, already-used or ineligible codes. Clawket never receives the entered code.

The provider refreshes CustomerInfo before opening the store and compares subsequent active entitlement state with that baseline. Presentation is not success, nor is an unchanged existing membership. It polls at most 12 times at five-second intervals, skips reads in the background, and invalidates RevenueCat's customer cache on these reads. Normal foreground/listener reconciliation remains available after the bounded operation ends. Close cancels the UI operation; delayed results cannot close a new paywall or resume an abandoned feature action. Checkout and Restore share its operation lock. A confirmed activation persists the normal snapshot and ends simulated-free mode. An unconfirmed result remains neutral and offers Restore. Lifetime activation retains the warning if another subscription still renews.

Codes are bound to the redeeming **store account**, not a hardware identifier. Reinstalling or using another device on the same store can restore the underlying purchase via **Restore**. Clawket currently uses anonymous RevenueCat identities; its project restore policy is **Transfer to new App User ID** (verified live September 19; sandbox uses the same behavior), allowing recovery to a new identity. Native reinstall/restore acceptance is required before claiming this verified. Apple and Google codes are separate; no cross-platform membership transfer is promised.

The redemption deadline is the deadline to use the code. It does not shorten lifetime ownership or the month granted after redemption. Eligibility and overlapping subscriptions are decided by the store. An existing annual subscriber may not be eligible to redeem a monthly offer that would downgrade their subscription. Giving lifetime never cancels an existing recurring subscription.

## Campaigns

| Store | Benefit | Product | Configuration |
| --- | --- | --- | --- |
| Apple | One month | `com.p697.clawket.pro.monthly` | Free for one month; **Don't auto-renew** checked; new, existing and expired subscribers; all 175 storefronts |
| Apple | Lifetime | `com.p697.clawket.pro.buyout` | Free non-consumable offer; all customer eligibility groups |
| Google Play | Lifetime | `com.p697.clawket.pro.lifetime`, option `lifetime` | One-time product promotion; 20 individual codes |

Google subscription promo codes grant an automatically renewing trial, so they are not configured as a no-obligation monthly gift. Apple production one-time batches start at 500; sandbox batches start at 10. Downloaded files are private local assets under `~/Documents/Clawket-redemption-codes/2026-09/` and are never checked in. Do not publish the full batch; send one unused code to each intended recipient.

Verified console changes so far:

- RevenueCat catalog: all six live store products still map to `Clawket Pro`; no product, price or entitlement changes needed.
- Google: accepted promo-code terms under the owner account after explicit user approval. Created `Clawket Lifetime Gift 2026-09` (promotion `130831342`), 20 lifetime codes, Sep 19 2026 12:00 through Dec 18 2026 00:00 as displayed in Play Console. CSV downloaded and checked for 20 rows; activity initially Scheduled. The console time-zone help confirms GMT: activation is Sep 19 at 21:00 Japan time.
- Apple: created `Clawket Gift 1 Month 2026-09` (offer `94f8b369-2e2f-443d-819b-104f734c579b`); detail page confirms Free for first month and no auto-renewal. Production batch `593266` contains 500 codes and sandbox batch `593267` contains 10, both expiring Dec 18, 2026. Both CSV exports were downloaded and row counts verified. Lifetime offer `985d3563-22dd-4776-90fc-f7df39800f28` also created: free offer, all three eligibility groups and 175 storefronts. Production batch `b4d28235-d51b-43c7-b104-823cad1b6847` has 500 codes; sandbox batch `c5858851-59b7-45e4-8f41-9c6cb1537e71` has 10. Both expire Dec 18, 2026 and both CSV exports have verified row counts.

## Administration

Apple: Clawket → Subscriptions → Clawket Pro → Monthly → Offer Codes for monthly gifts; In-App Purchases → approved Buyout → Offer Codes for lifetime. Reopen an existing offer to create/download batches and inspect redemption usage. Do not create a new product or change normal pricing. Keep one-time gift codes separate from sandbox codes. Repeat gifts to the same customer may require a different offer because Apple limits one code per offer per customer.

Google: Clawket → Monetize with Play → Promo codes → `Clawket Lifetime Gift 2026-09`; download codes, inspect usage or pause future redemption. Generated codes cannot have their quantity or product changed. Pausing redemption does not revoke an already-owned lifetime purchase.

Record distribution in a private ledger (platform, campaign, code, recipient alias, sent date). The store's redeemed status is authoritative; a local “sent” entry is not proof of redemption. Keep recipient data out of the repository.

## Acceptance

Use platform RevenueCat API keys and sandbox/license-test store accounts, not RevenueCat Test Store keys. A Test Store CustomerInfo cannot certify an Apple or Google transaction. Automated tests prove UI/service lifecycle only and never redeem a production code.

Before distribution/release, test on both platforms: valid code grants all Pro gates for OpenClaw and Hermes; cancellation/invalid/reused/expired code does not grant access; redemption outside the app refreshes on return; deletion/reinstall + same-store Restore recovers lifetime; monthly expiry removes Pro without charging on the Apple no-renew offer; a lifetime gift alongside an existing subscription shows management guidance. Confirm receipt/transaction and entitlement in RevenueCat. Check large text and all footer actions on a narrow phone. No store release is submitted by this work.

Sources: [Apple offer setup](https://developer.apple.com/help/app-store-connect/manage-subscriptions/set-up-subscription-offer-codes), [Apple non-subscription offers](https://developer.apple.com/help/app-store-connect/manage-in-app-purchases/create-offer-codes-for-in-app-purchases), [StoreKit redemption](https://developer.apple.com/documentation/storekit/supporting-offer-codes-in-your-app), [Google promo codes](https://support.google.com/googleplay/android-developer/answer/6321495?hl=en), [RevenueCat offer-code lifecycle](https://www.revenuecat.com/docs/subscription-guidance/subscription-offers/ios-subscription-offers).
