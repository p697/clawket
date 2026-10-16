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
        client.handle(.openDestination(.account, nil))
        try await waitUntil(fixture) { fixture.hasNavigationTitle(String(localized: "Settings")) }
        let outgoing = try XCTUnwrap(client.destinationPresentationID)
        // Invoke the actual embedded button action; the fixture never substitutes its own presenter.
        ConnectionsView(client: client, embedded: true).addConnection()
        XCTAssertNil(client.destination, "Add closes the root sheet, rather than popping the embedded navigation page")
        ConnectionsView(client: client, embedded: true).addConnection()
        XCTAssertNil(client.destination, "A repeated Add waits for the same dismissal")
        try await waitUntil(fixture) {
            client.destination?.id == "connect" && fixture.hasNavigationTitle(String(localized: "Connect an agent"))
        }
        XCTAssertNotEqual(client.destinationPresentationID, outgoing)
        client.destination = nil
        try await waitUntil(fixture) { !fixture.hasPresentation }
        client.handle(.openDestination(.account, nil))
        try await waitUntil(fixture) { fixture.hasNavigationTitle(String(localized: "Settings")) }
    }

    @MainActor func testAuthenticationNoticeDuringRealDismissalSurvivesAndSettingsCanOpenAgain() async throws {
        let client = model(), fixture = try attach(client)
        defer { fixture.close() }
        client.destination = .connect
        try await waitUntil(fixture) { fixture.hasNavigationTitle(String(localized: "Connect an agent")) }
        client.destination = nil
        // Existing connection completion can report authentication failure during this exact transition.
        client.showFailure(RuntimeFailure(.authenticationRequired))
        let notice = try XCTUnwrap(client.notice), noticeID = client.noticeRevision
        XCTAssertNil(fixture.alert, "The retiring sheet still owns presentation until its real onDismiss")
        try await waitUntil(fixture) { fixture.alert?.message == notice }
        XCTAssertEqual(client.notice, notice)
        XCTAssertEqual(client.noticeRevision, noticeID, "Automatic binding dismissal did not acknowledge the error")
        // The production OK action uses this same exact-generation acknowledgement.
        client.dismissNotice(id: noticeID)
        try await waitUntil(fixture) { !fixture.hasPresentation }
        client.handle(.openDestination(.account, nil))
        try await waitUntil(fixture) { fixture.hasNavigationTitle(String(localized: "Settings")) }
        client.showFailure(RuntimeFailure(.authenticationRequired))
        try await waitUntil(fixture) { fixture.alert?.message == client.notice }
        XCTAssertEqual(client.destination?.id, "settings", "An error in a stable sheet keeps its navigation")
        client.dismissNotice(id: client.noticeRevision)
        try await waitUntil(fixture) { fixture.alert == nil }
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
            func collect(_ value: UIViewController) -> [UIViewController] {
                [value] + value.children.flatMap(collect) + (value.presentedViewController.map(collect) ?? [])
            }
            return collect(container)
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

    @MainActor private func waitUntil(_ fixture: Fixture, _ condition: () -> Bool) async throws {
        let deadline = ContinuousClock.now + .seconds(10)
        while !(condition() && fixture.stable) {
            guard ContinuousClock.now < deadline else { XCTFail("The production modal presenter did not settle"); throw WaitFailure.timeout }
            fixture.window.layoutIfNeeded(); CATransaction.flush()
            try await Task.sleep(for: .milliseconds(10))
        }
    }
}

private enum WaitFailure: Error { case timeout }
