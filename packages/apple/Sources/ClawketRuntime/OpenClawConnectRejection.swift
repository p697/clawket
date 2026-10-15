import ClawketTransport

/// Connect-only interpretation of Gateway error envelopes. Never use peer prose or recovery
/// advice to grant a credential mutation, and never replace the original outer schema code.
struct OpenClawConnectRejection {
    let hasDetailCode: Bool
    let permitsScopedRepair: Bool
    let failure: RuntimeFailure?

    init(_ error: any Error) {
        guard let rpc = error as? RPCFailure, rpc.code == .remoteRejection, let remote = rpc.remoteError else {
            hasDetailCode = false; permitsScopedRepair = false; failure = nil
            return
        }
        let outer = Self.code(remote["code"])?.uppercased()
        let detailValue = remote["details"]?.object?["code"]
        // Presence also vetoes fallback for malformed/oversized codes. Neither known nor
        // unknown structured details are evidence of an old closed connect schema.
        hasDetailCode = detailValue != nil
        let detail = Self.code(detailValue)
        permitsScopedRepair = hasDetailCode
            ? outer == "INVALID_REQUEST" && ["AUTH_DEVICE_TOKEN_MISMATCH", "AUTH_SCOPE_MISMATCH"].contains(detail ?? "")
            : ["AUTH_TOKEN_MISMATCH", "AUTH_DEVICE_TOKEN_MISMATCH", "AUTH_SCOPE_MISMATCH"].contains(outer ?? "")

        let category: RuntimeFailure.Code?
        if hasDetailCode {
            // OpenClaw 2026.10.2 emits failed auth/proof inside INVALID_REQUEST, genuine
            // pairing inside NOT_PAIRED, and operator policy inside FORBIDDEN.
            switch outer {
            case "INVALID_REQUEST": category = Self.invalidRequestAuthCodes.contains(detail ?? "") ? .authenticationRequired : .invalidResponse
            case "NOT_PAIRED":
                switch detail {
                case "PAIRING_REQUIRED": category = .pairingRequired
                case "AUTH_VERIFIED_USER_REQUIRED", "DEVICE_IDENTITY_REQUIRED": category = .authenticationRequired
                default: category = .invalidResponse
                }
            case "FORBIDDEN": category = detail == "OPERATOR_ACCESS_DENIED" ? .authenticationRequired : .invalidResponse
            case "BAD_REQUEST": category = .invalidResponse
            default: category = nil
            }
        } else {
            // Preserve legacy outer-code responses, including older direct/Bridge peers.
            category = Self.invalidRequestAuthCodes.contains(outer ?? "") ? .authenticationRequired : nil
        }
        failure = category.map { RuntimeFailure($0, delivery: runtimeFailure(rpc).delivery) }
    }

    private static func code(_ value: JSONValue?) -> String? {
        guard let code = value?.stringValue, !code.isEmpty, code.utf8.count <= 128 else { return nil }
        return code
    }

    private static let invalidRequestAuthCodes: Set<String> = [
        "AUTH_REQUIRED", "AUTH_UNAUTHORIZED", "AUTH_TOKEN_MISSING", "AUTH_TOKEN_MISMATCH", "AUTH_TOKEN_NOT_CONFIGURED",
        "AUTH_PASSWORD_MISSING", "AUTH_PASSWORD_MISMATCH", "AUTH_PASSWORD_NOT_CONFIGURED", "AUTH_BOOTSTRAP_TOKEN_INVALID",
        "AUTH_DEVICE_TOKEN_MISMATCH", "AUTH_SCOPE_MISMATCH", "AUTH_RATE_LIMITED", "AUTH_TAILSCALE_IDENTITY_MISSING",
        "AUTH_TAILSCALE_PROXY_MISSING", "AUTH_TAILSCALE_WHOIS_FAILED", "AUTH_TAILSCALE_IDENTITY_MISMATCH",
        "AUTH_IDENTITY_HEADER_REQUIRED", "CONTROL_UI_DEVICE_IDENTITY_REQUIRED", "DEVICE_AUTH_INVALID",
        "DEVICE_AUTH_DEVICE_ID_MISMATCH", "DEVICE_AUTH_SIGNATURE_EXPIRED", "DEVICE_AUTH_NONCE_REQUIRED",
        "DEVICE_AUTH_NONCE_MISMATCH", "DEVICE_AUTH_SIGNATURE_INVALID", "DEVICE_AUTH_PUBLIC_KEY_INVALID",
    ]
}
