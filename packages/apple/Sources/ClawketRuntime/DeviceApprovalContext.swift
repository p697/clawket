import Foundation
import ClawketPairing
import ClawketTransport

/// Product-only public verification information from an actual signed connect attempt.
/// The device ID is SHA-256 of the raw Ed25519 public key: it is also its fingerprint.
/// It is never an approval capability, a credential or a diagnostic identifier.
public struct RuntimeDeviceApprovalContext: Codable, Sendable, Equatable, Identifiable {
    public enum Reason: String, Codable, Sendable {
        case notPaired = "not-paired"
        case roleUpgrade = "role-upgrade"
        case scopeUpgrade = "scope-upgrade"
        case metadataUpgrade = "metadata-upgrade"
        case unknown
    }
    public let id: UUID
    public let connectionID: String
    public let deviceID: String
    public let requestID: String?
    public let reason: Reason
}

extension RuntimeCoordinator {
    /// Captured beside the exact signed params, never reloaded from a credential provider.
    struct SignedConnectIdentity: Sendable {
        let scope: Scope
        let connectionID: String
        let deviceID: String
        let publicKey: Data

        init(scope: Scope, connectionID: String, identity: RuntimeDeviceIdentity) {
            self.scope = scope; self.connectionID = connectionID
            self.deviceID = identity.deviceID; self.publicKey = identity.publicKey
        }

        func approvalContext(for error: any Error) -> RuntimeDeviceApprovalContext? {
            guard let rpc = error as? RPCFailure, rpc.code == .remoteRejection,
                  let remote = rpc.remoteError, remote["code"]?.stringValue == "NOT_PAIRED",
                  let details = remote["details"]?.object, details["code"]?.stringValue == "PAIRING_REQUIRED",
                  let derived = try? PairingCryptography.deviceID(publicKey: publicKey), derived == deviceID,
                  !connectionID.isEmpty else { return nil }
            // Peer metadata can corroborate this installation, never replace its identity.
            if let remoteDevice = details["deviceId"], remoteDevice.stringValue != deviceID { return nil }
            let rawRequest = details["requestId"]?.stringValue
            let requestID = rawRequest.flatMap { value in Self.validRequestID(value) ? value : nil }
            let rawReason = details["reason"]?.stringValue
            let reason = rawReason.flatMap(RuntimeDeviceApprovalContext.Reason.init(rawValue:)) ?? .unknown
            return RuntimeDeviceApprovalContext(id: UUID(), connectionID: connectionID,
                deviceID: deviceID, requestID: requestID, reason: reason)
        }

        private static func validRequestID(_ value: String) -> Bool {
            guard !value.isEmpty, value.utf8.count <= 128 else { return false }
            let bytes = Array(value.utf8)
            func alphanumeric(_ byte: UInt8) -> Bool {
                (48...57).contains(byte) || (65...90).contains(byte) || (97...122).contains(byte)
            }
            guard let first = bytes.first, alphanumeric(first) else { return false }
            return bytes.allSatisfy { alphanumeric($0) || [46, 95, 58, 45].contains($0) }
        }
    }

    func captureDeviceApproval(_ error: any Error, scope: Scope) {
        guard isCurrent(scope), signedConnectIdentity?.scope == scope else { return }
        deviceApproval = signedConnectIdentity?.approvalContext(for: error)
    }
}
