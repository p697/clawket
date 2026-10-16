import ClawketCommerce
import ClawketRuntime
import ClawketUI
import SwiftUI
import UIKit
import XCTest
@testable import Clawket

final class NativeSheetHandoffTests: XCTestCase {
    @MainActor func testEmbeddedAddClosesTheOwningSettingsSheetAndOpensConnectAfterDismissal() async throws {
        let client = model(), fixture = try attach(client)
        defer { fixture.close() }
        client.handle(.openDestination(.account, conversation: nil))
        try await waitUntil(fixture, "Settings navigation appears") { fixture.hasNavigationTitle(String(localized: "Settings")) }
        let outgoing = try XCTUnwrap(client.destinationPresentationID)
        // Invoke the actual embedded button action; the fixture never substitutes its own presenter.
        ConnectionsView(client: client, embedded: true).addConnection()
        XCTAssertNil(client.destination, "Add closes the root sheet, rather than popping the embedded navigation page")
        ConnectionsView(client: client, embedded: true).addConnection()
        XCTAssertNil(client.destination, "A repeated Add waits for the same dismissal")
        try await waitUntil(fixture, "Add hands off to Connect") {
            client.destination?.id == "connect" && fixture.hasNavigationTitle(String(localized: "Connect an agent"))
        }
        XCTAssertNotEqual(client.destinationPresentationID, outgoing)
        client.destination = nil
        try await waitUntil(fixture, "Modal dismissal completes") { !fixture.hasPresentation }
        client.handle(.openDestination(.account, conversation: nil))
        try await waitUntil(fixture, "Settings navigation appears") { fixture.hasNavigationTitle(String(localized: "Settings")) }
    }

    @MainActor func testAuthenticationNoticeDuringRealDismissalSurvivesAndSettingsCanOpenAgain() async throws {
        let client = model(), fixture = try attach(client)
        defer { fixture.close() }
        client.destination = .connect
        try await waitUntil(fixture, "Connect navigation appears") { fixture.hasNavigationTitle(String(localized: "Connect an agent")) }
        client.destination = nil
        // Existing connection completion can report authentication failure during this exact transition.
        client.showFailure(RuntimeFailure(.authenticationRequired))
        let notice = try XCTUnwrap(client.notice), noticeID = client.noticeRevision
        XCTAssertNil(fixture.alert, "The retiring sheet still owns presentation until its real onDismiss")
        try await waitUntil(fixture, "Root authentication alert appears") { fixture.alert?.message == notice }
        XCTAssertEqual(client.notice, notice)
        XCTAssertEqual(client.noticeRevision, noticeID, "Automatic binding dismissal did not acknowledge the error")
        // The production OK action uses this same exact-generation acknowledgement.
        try await acknowledge(client, fixture: fixture, noticeID: noticeID)
        try await waitUntil(fixture, "Modal dismissal completes") { !fixture.hasPresentation }
        client.handle(.openDestination(.account, conversation: nil))
        try await waitUntil(fixture, "Settings navigation appears") { fixture.hasNavigationTitle(String(localized: "Settings")) }
        client.showFailure(RuntimeFailure(.authenticationRequired))
        let sheetNotice = try XCTUnwrap(client.notice)
        try await waitUntil(fixture, "Stable Settings authentication alert appears") { fixture.alert?.message == sheetNotice }
        XCTAssertEqual(client.destination?.id, "settings", "An error in a stable sheet keeps its navigation")
        try await acknowledge(client, fixture: fixture, noticeID: client.noticeRevision)
        try await waitUntil(fixture, "Settings alert dismissal completes") { fixture.alert == nil }
        XCTAssertTrue(fixture.hasNavigationTitle(String(localized: "Settings")))
    }

    @MainActor func testHandoffAndNoticeAcknowledgementsCannotConsumeReplacementContexts() throws {
        for changeActivation in [true, false] {
            let client = model()
            client.destination = .settings
            let outgoing = try XCTUnwrap(client.destinationPresentationID)
            ConnectionsView(client: client, embedded: true).addConnection()
            if changeActivation { client.activationRevision = UUID() } else { client.selectionRevision = UUID() }
            client.destinationDidDismiss(presentationID: outgoing)
            XCTAssertNil(client.destination, "A stale Add never opens in a replacement context")
        }
        let client = model()
        client.destination = .settings
        let old = try XCTUnwrap(client.destinationPresentationID)
        client.showConnectAfterDismissal()
        client.destination = .connections
        client.destination = .settings
        let current = try XCTUnwrap(client.destinationPresentationID)
        XCTAssertNotEqual(old, current)
        client.showConnectAfterDismissal()
        client.destinationDidDismiss(presentationID: old)
        XCTAssertNil(client.destination, "An old A callback cannot consume the new A request")
        client.destinationDidDismiss(presentationID: current)
        XCTAssertEqual(client.destination?.id, "connect")
        client.destinationDidDismiss(presentationID: old)
        XCTAssertEqual(client.destination?.id, "connect")

        client.notice = "same fixed error"
        let oldNotice = client.noticeRevision
        client.notice = "same fixed error"
        let currentNotice = client.noticeRevision
        XCTAssertNotEqual(oldNotice, currentNotice)
        client.dismissNotice(id: oldNotice)
        XCTAssertEqual(client.notice, "same fixed error", "An old OK cannot clear a same-text replacement")
        client.dismissNotice(id: currentNotice)
        XCTAssertNil(client.notice)
    }

    @MainActor private func acknowledge(_ client: NativeAppModel, fixture: Fixture, noticeID: UUID) async throws {
        let displayed = try XCTUnwrap(fixture.alert)
        client.dismissNotice(id: noticeID)
        XCTAssertNil(client.notice)
        // Calling the production acknowledgement is not tapping system OK. Exercise UIKit's
        // actual dismissal/completion explicitly, rather than assuming a model write closes it.
        await withCheckedContinuation { continuation in
            displayed.dismiss(animated: true) { continuation.resume() }
        }
    }

    @MainActor private func model() -> NativeAppModel {
        let client = NativeAppModel()
        client.pro = ProController(mode: .community, source: nil)
        client.presentation.features = [.account: .available, .addConnection: .available]
        return client
    }

    @MainActor private struct Fixture {
        let window: UIWindow
        let container: UIViewController
        let prior: UIWindow?
        var controllers: [UIViewController] {
            var visited: Set<ObjectIdentifier> = [], result: [UIViewController] = []
            func collect(_ value: UIViewController) {
                guard visited.insert(ObjectIdentifier(value)).inserted else { return }
                result.append(value)
                for child in value.children { collect(child) }
                if let presented = value.presentedViewController { collect(presented) }
            }
            collect(container)
            return result
        }
        var hasPresentation: Bool { controllers.contains { $0.presentingViewController != nil } }
        var alert: UIAlertController? { controllers.compactMap { $0 as? UIAlertController }.first }
        var stable: Bool { controllers.allSatisfy { !$0.isBeingPresented && !$0.isBeingDismissed } }
        func hasNavigationTitle(_ title: String) -> Bool {
            func contains(_ view: UIView) -> Bool {
                if let bar = view as? UINavigationBar, bar.topItem?.title == title, !bar.isHidden { return true }
                return view.subviews.contains(where: contains)
            }
            return controllers.contains { $0.viewIfLoaded.map(contains) ?? false }
        }
        func close() {
            container.dismiss(animated: false)
            window.isHidden = true; window.rootViewController = nil; prior?.makeKeyAndVisible()
        }
    }

    @MainActor private func attach(_ client: NativeAppModel) throws -> Fixture {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive })
        let prior = scene.windows.first { $0.isKeyWindow }, window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
        let container = UIViewController(), host = UIHostingController(rootView: NativeAppRootView(client: client))
        window.rootViewController = container; container.loadViewIfNeeded()
        container.addChild(host); container.view.addSubview(host.view); host.didMove(toParent: container)
        host.view.frame = container.view.bounds; host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        window.makeKeyAndVisible(); container.view.layoutIfNeeded()
        return .init(window: window, container: container, prior: prior)
    }

    @MainActor private func waitUntil(_ fixture: Fixture, _ stage: String,
        file: StaticString = #filePath, line: UInt = #line, _ condition: () -> Bool) async throws {
        print("Modal stage started: \(stage)")
        let deadline = ContinuousClock.now + .seconds(10)
        while !(condition() && fixture.stable) {
            guard ContinuousClock.now < deadline else {
                let state = fixture.controllers.map {
                    "\(type(of: $0)):presenting=\($0.isBeingPresented),dismissing=\($0.isBeingDismissed)"
                }.joined(separator: ";")
                XCTFail("Modal stage \(stage) timed out: condition=\(condition()), stable=\(fixture.stable), alert=\(fixture.alert != nil), presentation=\(fixture.hasPresentation); \(state)", file: file, line: line)
                throw WaitFailure.timeout
            }
            fixture.window.layoutIfNeeded(); CATransaction.flush()
            try await Task.sleep(for: .milliseconds(10))
        }
        print("Modal stage completed: \(stage)")
    }

}

private enum WaitFailure: Error { case timeout }
