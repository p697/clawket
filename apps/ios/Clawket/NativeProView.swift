import ClawketCommerce
import ClawketUI
import SwiftUI

struct NativeProView: View {
    @ObservedObject var controller: ProController
    let review: ProReview
    var configuration = NativeProConfiguration()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false
    private let silver = LinearGradient(colors: [.white, Color(red: 0.80, green: 0.84, blue: 0.86),
        Color(red: 0.42, green: 0.47, blue: 0.50), Color(red: 0.90, green: 0.92, blue: 0.94)], startPoint: .topLeading, endPoint: .bottomTrailing)
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 26) {
                    hero
                    VStack(spacing: 10) {
                        Text("Clawket Pro").font(.largeTitle.bold())
                        Text(headline).font(.title3.weight(.medium)).multilineTextAlignment(.center).foregroundStyle(.secondary)
                    }
                    if controller.mode == .community {
                        VStack(spacing: 10) {
                            Label("Community build", systemImage: "heart").font(.headline)
                            Text("Features are available without a store subscription.").foregroundStyle(.secondary).multilineTextAlignment(.center)
                        }.padding(22).frame(maxWidth: .infinity).background(.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 22))
                    } else if controller.phase == .loading { ProgressView("Checking access…").padding(24) }
                    else if [.success, .scheduled, .unconfirmed, .manageRenewal].contains(controller.phase) { result }
                    else {
                        benefits
                        if controller.phase == .unavailable { unavailable }
                        else { plans }
                    }
                    if let failure = controller.failure, controller.phase != .unconfirmed {
                        Text(failureText(failure)).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    }
                    if controller.configured { storeActions }
                    legal
                }
                .frame(maxWidth: 520).padding(.horizontal, 24).padding(.bottom, 30).frame(maxWidth: .infinity)
            }
            .background(Color(red: 0.063, green: 0.067, blue: 0.075))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { controller.close(review.id) } label: {
                        Image(systemName: "xmark").font(.body.weight(.semibold)).frame(width: 44, height: 44).contentShape(Rectangle())
                    }.accessibilityLabel("Close").accessibilityIdentifier("pro-close")
                }
            }
        }
        .tint(.white).preferredColorScheme(.dark)
        .onAppear { if !reduceMotion { appeared = true } }
        .onDisappear { controller.close(review.id) }
    }
    private var headline: String {
        switch review.feature {
        case .gatewayConnections: String(localized: "Connect more computers and servers")
        case .agents, .agentCreation: String(localized: "Start using your other Agents")
        case .messageHistory, .archiveTools: String(localized: "Search and bulk export")
        default: String(localized: "Every conversation, in full")
        }
    }
    private var hero: some View {
        ZStack {
            Circle().stroke(silver.opacity(0.16), lineWidth: 1).frame(width: 210, height: 210)
            Ellipse().stroke(silver.opacity(0.22), lineWidth: 1).frame(width: 250, height: 130).rotationEffect(.degrees(appeared ? 15 : -15))
                .animation(reduceMotion ? nil : .easeInOut(duration: 7).repeatForever(autoreverses: true), value: appeared)
            ClawketMark().foregroundStyle(silver).frame(width: 116, height: 109)
                .shadow(color: .white.opacity(0.12), radius: 25)
        }.frame(height: 230).accessibilityHidden(true)
    }
    private var benefits: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label("Unlimited connections and Agents", systemImage: "point.3.connected.trianglepath.dotted")
            Label("Full chat and task history", systemImage: "bubble.left.and.text.bubble.right")
            Label("Search and bulk export", systemImage: "magnifyingglass")
        }.font(.subheadline).frame(maxWidth: .infinity, alignment: .leading)
    }
    private var plans: some View {
        VStack(spacing: 12) {
            ForEach(displayedPackages) { package in
                let owned = controller.ownedPackage?.id == package.id
                let locked = ProPlans.locked(package, packages: controller.packages, customer: controller.customer, now: controller.now)
                Button { controller.select(package.id, reviewID: review.id) } label: {
                    HStack(spacing: 14) {
                        Image(systemName: controller.selectedID == package.id ? "largecircle.fill.circle" : "circle")
                            .font(.title2).foregroundStyle(locked && !owned ? .secondary : .primary)
                        VStack(alignment: .leading, spacing: 5) {
                            HStack {
                                Text(planName(package)).font(.headline)
                                if owned { Text("Current plan").font(.caption).foregroundStyle(.secondary) }
                            }
                            Text(billing(package)).font(.footnote).foregroundStyle(.secondary)
                            if package.kind == .annual, let monthly = package.monthlyPriceString {
                                Text("Equivalent to \(monthly) / month").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        Spacer(minLength: 0)
                    }.padding(17).frame(maxWidth: .infinity, alignment: .leading)
                    .background(.white.opacity(controller.selectedID == package.id ? 0.10 : 0.035), in: RoundedRectangle(cornerRadius: 18))
                    .overlay(RoundedRectangle(cornerRadius: 18).stroke(.white.opacity(controller.selectedID == package.id ? 0.55 : 0.15), lineWidth: 1))
                }.buttonStyle(.plain).disabled(locked || controller.phase.isWorking)
                    .accessibilityAddTraits(controller.selectedID == package.id ? .isSelected : [])
                    .accessibilityIdentifier("pro-package-\(package.id)")
            }
            if controller.canCheckout && configuration.canPurchase {
                Button { controller.purchase(reviewID: review.id) } label: {
                    Text(checkoutTitle).font(.headline).frame(maxWidth: .infinity).frame(minHeight: 52)
                }.buttonStyle(.borderedProminent).tint(.white).foregroundStyle(.black)
                    .accessibilityIdentifier("pro-purchase")
            } else if controller.phase.isWorking { ProgressView().frame(height: 52).accessibilityLabel("Checking access…") }
            else if !configuration.canPurchase { Text("Purchases are unavailable in this build.").font(.footnote).foregroundStyle(.secondary) }
            if controller.selectedPackage?.kind == .annual || controller.selectedPackage?.kind == .monthly {
                Text("Cancel anytime in App Store").font(.caption).foregroundStyle(.secondary)
            }
        }
    }
    private var displayedPackages: [ProPackage] {
        if controller.customer?.isLifetime(at: controller.now) == true || controller.customer?.isGrandfathered(at: controller.now) == true {
            return controller.packages.filter { $0.kind == .lifetime }
        }
        return controller.packages
    }
    private var checkoutTitle: String {
        guard controller.paid, let selected = controller.selectedPackage else { return String(localized: "Upgrade to Pro") }
        switch selected.kind {
        case .annual: return String(localized: "Change to annual")
        case .monthly: return String(localized: "Change to monthly")
        case .lifetime: return String(localized: "Buy lifetime")
        case .other: return String(localized: "Continue")
        }
    }
    private var unavailable: some View {
        VStack(spacing: 12) {
            if controller.configured {
                Text("Unable to load subscription options right now.").foregroundStyle(.secondary).multilineTextAlignment(.center)
                Button("Try again") { Task { await controller.refresh(reviewID: review.id) } }.frame(minHeight: 44)
            } else {
                Text("Purchases are unavailable in this build.").foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
        }.padding(.vertical, 12)
    }
    private var result: some View {
        VStack(spacing: 14) {
            Image(systemName: controller.phase == .success ? "checkmark.circle" : "clock").font(.system(size: 44, weight: .light))
            Text(resultTitle).font(.title2.bold()).multilineTextAlignment(.center)
            if controller.phase == .scheduled { Text("Your store confirms when the new plan and price take effect.") }
            if controller.phase == .unconfirmed { Text("Your current access is unchanged. Check your store before trying again.") }
            if controller.phase == .manageRenewal {
                Text("Lifetime does not cancel your existing subscription. Turn off its renewal in your store to avoid further charges.")
                Button("Manage subscription") { Task { await controller.manage(reviewID: review.id) } }.frame(minHeight: 44)
            }
            if controller.phase == .success { Text("Everything is unlocked. Picking up where you left off...") }
        }.foregroundStyle(.secondary).multilineTextAlignment(.center).padding(.vertical, 20)
    }
    private var resultTitle: String {
        switch controller.phase {
        case .success: String(localized: "You're Pro")
        case .scheduled: String(localized: "Plan change submitted")
        case .manageRenewal: String(localized: "Lifetime is active")
        default: String(localized: "Purchase is being verified")
        }
    }
    private var storeActions: some View {
        VStack(spacing: 4) {
            HStack {
                Button("Restore Purchases") { controller.restore(reviewID: review.id) }.frame(minHeight: 44)
                Spacer()
                Button("Redeem code") { controller.redeem(reviewID: review.id) }.frame(minHeight: 44)
            }
            .disabled(controller.phase.isWorking)
            if controller.customer?.subscriptions.contains(where: \.isActive) == true {
                Button("Manage subscription") { Task { await controller.manage(reviewID: review.id) } }.frame(minHeight: 44).disabled(controller.phase.isWorking)
            }
            if controller.phase == .redeeming { Text("Complete redemption in the store. Your Pro access will sync here.").font(.footnote).foregroundStyle(.secondary) }
        }.font(.footnote)
    }
    private var legal: some View {
        HStack(spacing: 28) {
            if let url = configuration.termsURL { Link("Terms of Use", destination: url).frame(minHeight: 44) }
            if let url = configuration.privacyURL { Link("Privacy Policy", destination: url).frame(minHeight: 44) }
        }.font(.caption).foregroundStyle(.secondary)
    }
    private func planName(_ value: ProPackage) -> String {
        switch value.kind {
        case .annual: String(localized: "Annual")
        case .monthly: String(localized: "Monthly")
        case .lifetime: String(localized: "Lifetime")
        case .other: value.title
        }
    }
    private func billing(_ value: ProPackage) -> String {
        switch value.kind {
        case .annual: String(localized: "\(value.priceString)/yr · Auto-renews")
        case .monthly: String(localized: "\(value.priceString)/mo · Auto-renews")
        case .lifetime: String(localized: "\(value.priceString) · One-time purchase")
        case .other: value.priceString
        }
    }
    private func failureText(_ value: ProStoreFailure) -> String {
        switch value {
        case .pending: String(localized: "Your purchase is pending approval.")
        case .unconfirmed: String(localized: "No new Pro access confirmed yet. If you redeemed a code, tap Restore.")
        case .unavailable: String(localized: "Unable to complete your purchase right now.")
        case .invalid, .changed, .failed: String(localized: "Your Pro status could not be verified. Try again when you’re online.")
        case .cancelled: ""
        }
    }
}

private struct NativeProPresentation: ViewModifier {
    @ObservedObject var controller: ProController
    let presenterID: UUID
    @State private var presentedID: UUID?
    func body(content: Content) -> some View {
        content.fullScreenCover(item: Binding(get: { controller.review?.presenterID == presenterID ? controller.review : nil },
            set: { if $0 == nil, let review = controller.review, review.presenterID == presenterID { controller.close(review.id) } }), onDismiss: {
                if let id = presentedID { controller.didDismiss(id); presentedID = nil }
            }) { review in
                NativeProView(controller: controller, review: review).onAppear { presentedID = review.id }
            }
    }
}
extension View {
    @ViewBuilder func nativePro(controller: ProController?, presenterID: UUID) -> some View {
        if let controller { modifier(NativeProPresentation(controller: controller, presenterID: presenterID)) }
        else { self }
    }
    func nativePro(controller: ProController, presenterID: UUID) -> some View { modifier(NativeProPresentation(controller: controller, presenterID: presenterID)) }
}
