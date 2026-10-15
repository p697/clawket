import ClawketCommerce
import ClawketUpgrade
import Foundation

struct NativeProConfiguration: Sendable {
    let mode: ProAccessMode
    let sdkKey: String?
    let entitlementID: String?
    let offeringID: String?
    let packageID: String?
    let privacyURL: URL?
    let termsURL: URL?
    var canPurchase: Bool { isConfigured && privacyURL != nil && termsURL != nil }
    var isConfigured: Bool { mode == .store && sdkKey != nil && entitlementID != nil }
    init(info: [String: Any] = Bundle.main.infoDictionary ?? [:], debug: Bool = _isDebugAssertConfiguration()) {
        func string(_ key: String) -> String? {
            guard let value = info[key] as? String else { return nil }
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty, !trimmed.hasPrefix("$("), trimmed.utf8.count <= 512,
                  !trimmed.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { return nil }
            return trimmed
        }
        func link(_ key: String) -> URL? {
            guard let raw = string(key), let value = URL(string: raw), value.scheme == "https",
                  value.host?.isEmpty == false, value.user == nil, value.password == nil else { return nil }
            return value
        }
        privacyURL = link("ClawketPrivacyPolicyURL"); termsURL = link("ClawketTermsOfUseURL")
        let rawKey = string("ClawketRevenueCatKey"), entitlement = string("ClawketRevenueCatEntitlement")
        offeringID = string("ClawketRevenueCatOffering"); packageID = string("ClawketRevenueCatPackage")
        let keys = ["ClawketRevenueCatKey", "ClawketRevenueCatEntitlement", "ClawketRevenueCatOffering", "ClawketRevenueCatPackage"]
        let requested = keys.contains { key in
            guard let value = info[key] else { return false }
            guard let text = value as? String else { return true }
            let normalized = text.trimmingCharacters(in: .whitespacesAndNewlines)
            return !normalized.isEmpty && !normalized.hasPrefix("$(")
        }
        mode = requested ? .store : .community
        sdkKey = rawKey.flatMap { key in
            guard key.hasPrefix("appl_") || debug && key.hasPrefix("test_"),
                  key.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 95 }) else { return nil }
            return key
        }
        entitlementID = entitlement
    }
}

/// Resolve identity before configuring the SDK. QA never receives an imported identity.
struct NativePurchaseIdentity: Sendable {
    let appUserID: String?
    static func qa(bundleID: String?) throws -> Self {
        guard bundleID == "com.p697.clawket.nativeqa" else { throw ProStoreFailure.unavailable }
        return .init(appUserID: nil)
    }
    static func upgraded(_ result: UpgradeResult, bundleID: String?) throws -> Self {
        guard bundleID == "com.p697.clawket", result.manifest.version == 1 else { throw ProStoreFailure.unavailable }
        let value = result.purchaseIdentity.currentAppUserID ?? result.purchaseIdentity.legacyAppUserID
        guard let value, !value.isEmpty, value.utf8.count <= 100,
              !value.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }), !value.contains("/") else { throw ProStoreFailure.invalid }
        return .init(appUserID: value)
    }
}
