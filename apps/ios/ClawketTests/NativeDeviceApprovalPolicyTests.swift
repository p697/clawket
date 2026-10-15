import Foundation
import XCTest
@testable import Clawket
@testable import ClawketRuntime

final class NativeDeviceApprovalPolicyTests: XCTestCase {
    func testOtherBackendsRetainTheirExistingCredentialRepairGuidance() {
        let existing = String(localized: "Your agent needs to be paired again. Add its current pairing code in Settings.")
        for backend in [BackendKind.hermes, .codex, .claudeCode, .pi, .localModel] {
            XCTAssertEqual(NativeDeviceApprovalPolicy.failureText(.authenticationRequired, backend: backend), existing)
            XCTAssertEqual(NativeDeviceApprovalPolicy.failureText(.pairingRequired, backend: backend), existing)
        }
        XCTAssertEqual(NativeDeviceApprovalPolicy.failureText(.pairingRequired, backend: nil), existing)
    }

    func testOpenClawApprovalIsDistinctFromAuthenticationAndUnrelatedFailures() {
        XCTAssertEqual(NativeDeviceApprovalPolicy.failureText(.pairingRequired, backend: .openclaw),
            String(localized: "Approve this device in OpenClaw on your computer, then connect again."))
        XCTAssertEqual(NativeDeviceApprovalPolicy.failureText(.authenticationRequired, backend: .openclaw),
            String(localized: "Authentication required. Check this connection’s credentials."))
        XCTAssertNil(NativeDeviceApprovalPolicy.failureText(.network, backend: .openclaw))
    }

    func testRetiredOrForeignReviewCannotCopyOrRetryANewActiveConnection() {
        let context = RuntimeDeviceApprovalContext(id: UUID(), connectionID: "a", deviceID: String(repeating: "a", count: 64),
            requestID: "request", reason: .notPaired)
        XCTAssertTrue(NativeDeviceApprovalPolicy.matches(context, connectionID: "a", contextID: context.id, activeConnectionID: "a"))
        XCTAssertFalse(NativeDeviceApprovalPolicy.matches(context, connectionID: "a", contextID: UUID(), activeConnectionID: "a"))
        XCTAssertFalse(NativeDeviceApprovalPolicy.matches(context, connectionID: "b", contextID: context.id, activeConnectionID: "b"))
        XCTAssertFalse(NativeDeviceApprovalPolicy.matches(context, connectionID: "a", contextID: context.id, activeConnectionID: "b"))
        XCTAssertFalse(NativeDeviceApprovalPolicy.matches(nil, connectionID: "a", contextID: context.id, activeConnectionID: "a"))
    }
}
