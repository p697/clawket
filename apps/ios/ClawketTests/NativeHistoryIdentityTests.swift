import ClawketRuntime
import Foundation
import XCTest
@testable import Clawket

final class NativeHistoryIdentityTests: XCTestCase {
    private func row(_ source: String? = nil, position: RuntimeTranscriptPosition? = nil, key: String? = nil,
                     role: RuntimeMessage.Role = .user, local: Bool = false,
                     author: NativeHistoryIdentity.Author = .direct, epoch: UUID? = nil) -> NativeHistoryIdentity.Row {
        .init(role: role, sourceID: source, position: position, sendKey: key,
              locallyOwned: local, author: author, epoch: epoch)
    }

    func testExactUniqueRemoteSourceMapsInCanonicalIncomingOrder() {
        let stored = [row("oldest"), row("middle"), row("newest")]
        let plan = NativeHistoryIdentity.matches(incoming: [row("middle"), row("newest")], stored: stored)
        XCTAssertEqual(plan, [0: .init(storedIndex: 1, kind: .remoteSource), 1: .init(storedIndex: 2, kind: .remoteSource)])
    }

    func testLocalEchoRequiresUniqueOwnedKeyAndDirectAuthor() {
        let local = row(key: "actual-send", local: true)
        XCTAssertEqual(NativeHistoryIdentity.matches(incoming: [row("wire", key: "actual-send")], stored: [local]),
                       [0: .init(storedIndex: 0, kind: .localEcho)])
        XCTAssertTrue(NativeHistoryIdentity.matches(incoming: [row("wire", key: "actual-send")],
            stored: [row(key: "actual-send")]).isEmpty)
        XCTAssertTrue(NativeHistoryIdentity.matches(incoming: [row("wire", key: "actual-send",
            author: .participant(channel: "slack", account: "a", senderID: "other"))], stored: [local]).isEmpty)
    }

    func testProducerPositionCannotAcknowledgeLocalAndKnownSourceCan() {
        XCTAssertEqual(NativeHistoryIdentity.matches(incoming: [row(position: .init(source: "transcript", rawSequence: 7))], stored: [row(position: .init(source: "transcript", rawSequence: 7))]),
                       [0: .init(storedIndex: 0, kind: .transcriptPosition)])
        XCTAssertTrue(NativeHistoryIdentity.matches(incoming: [row(position: .init(source: "transcript", rawSequence: 7))],
            stored: [row(position: .init(source: "transcript", rawSequence: 7), local: true)]).isEmpty)
        XCTAssertTrue(NativeHistoryIdentity.matches(incoming: [row("same-string")], stored: [row(position: .init(source: "same-string", rawSequence: 1))]).isEmpty)
        XCTAssertTrue(NativeHistoryIdentity.matches(incoming: [row(position: .init(source: "same-string", rawSequence: 1))], stored: [row("same-string")]).isEmpty)
        let collidingBytes = "same-string" + String(repeating: "\u{0}", count: 7) + "\u{1}"
        XCTAssertTrue(NativeHistoryIdentity.matches(incoming: [row(collidingBytes)],
            stored: [row(position: .init(source: "same-string", rawSequence: 1))]).isEmpty)
        for invalid in [Int64(-1), 9_007_199_254_740_992] {
            XCTAssertTrue(NativeHistoryIdentity.matches(incoming: [row(position: .init(source: "s", rawSequence: invalid))],
                stored: [row(position: .init(source: "s", rawSequence: invalid))]).isEmpty)
        }
        XCTAssertEqual(NativeHistoryIdentity.matches(incoming: [row("actual")], stored: [row("actual", local: true)]),
                       [0: .init(storedIndex: 0, kind: .confirmedLocalSource)])
    }

    func testConflictingSourceAndSendKeysNeverChooseOneCopy() {
        let old = [row("source", key: "one", local: true), row("other", key: "two", local: true)]
        XCTAssertTrue(NativeHistoryIdentity.matches(incoming: [row("source", key: "two")], stored: old).isEmpty)
        // Contradictory exact identity remains a conflict even for an unowned cached row.
        XCTAssertTrue(NativeHistoryIdentity.matches(incoming: [row("source", key: "two")],
            stored: [row("source"), row("other", key: "two")]).isEmpty)
    }

    func testConflictingKnownEvidenceOnOneOwnedRowCannotAcknowledgeOrReplaceItsSendKey() {
        let original = row("message", key: "send-one", local: true)
        for incoming in [row("message", key: "send-two"), row("different-message", key: "send-one")] {
            XCTAssertTrue(NativeHistoryIdentity.matches(incoming: [incoming], stored: [original]).isEmpty)
        }
        let composed = "\u{00e9}", decomposed = "e\u{0301}"
        XCTAssertTrue(NativeHistoryIdentity.matches(incoming: [row("message", key: composed)],
            stored: [row("message", key: decomposed, local: true)]).isEmpty)
    }

    func testDuplicateSourcesKeysAndAliasConsumersAreAllAmbiguous() {
        XCTAssertTrue(NativeHistoryIdentity.matches(incoming: [row("id"), row("id")], stored: [row("id")]).isEmpty)
        XCTAssertTrue(NativeHistoryIdentity.matches(incoming: [row("id")], stored: [row("id"), row("id")]).isEmpty)
        XCTAssertTrue(NativeHistoryIdentity.matches(incoming: [row(key: "key"), row(key: "key")],
            stored: [row(key: "key", local: true)]).isEmpty)
        XCTAssertTrue(NativeHistoryIdentity.matches(incoming: [row("id"), row(key: "key")],
            stored: [row("id", key: "key", local: true)]).isEmpty)
    }

    func testParticipantIdentityRequiresSameChannelAccountAndExplicitSender() {
        let sender = NativeHistoryIdentity.Author.participant(channel: "slack", account: "a", senderID: "person")
        XCTAssertEqual(NativeHistoryIdentity.matches(incoming: [row("id", author: sender)], stored: [row("id", author: sender)]).count, 1)
        for other in [NativeHistoryIdentity.Author.direct,
            .participant(channel: "slack", account: "b", senderID: "person"),
            .participant(channel: "discord", account: "a", senderID: "person"),
            .participant(channel: "slack", account: "a", senderID: "different"),
            .participant(channel: "slack", account: "a", senderID: nil)] {
            XCTAssertTrue(NativeHistoryIdentity.matches(incoming: [row("id", author: other)], stored: [row("id", author: sender)]).isEmpty)
        }
        let unknown = NativeHistoryIdentity.Author.participant(channel: "slack", account: "a", senderID: nil)
        XCTAssertEqual(NativeHistoryIdentity.matches(incoming: [row("id", author: unknown)], stored: [row("id", author: unknown)]),
                       [0: .init(storedIndex: 0, kind: .remoteSource)])
        XCTAssertTrue(NativeHistoryIdentity.matches(incoming: [row(author: unknown)], stored: [row(author: unknown)]).isEmpty)
        XCTAssertTrue(NativeHistoryIdentity.matches(incoming: [row("id", author: unknown)], stored: [row("id", local: true, author: unknown)]).isEmpty)
        XCTAssertTrue(NativeHistoryIdentity.matches(incoming: [row("id", author: sender)], stored: [row("id", local: true, author: sender)]).isEmpty)
    }

    func testPhysicalEpochAndRoleCannotBeCrossedByMatchingKeys() {
        let first = UUID(), second = UUID()
        XCTAssertTrue(NativeHistoryIdentity.matches(incoming: [row("id", key: "key", epoch: second)],
            stored: [row("id", key: "key", local: true, epoch: first)]).isEmpty)
        XCTAssertTrue(NativeHistoryIdentity.matches(incoming: [row("id", role: .assistant)], stored: [row("id")]).isEmpty)
    }

    func testCanonicallyEquivalentOpaqueSourceAndSendKeysRemainDifferent() {
        let composed = "\u{00e9}", decomposed = "e\u{0301}"
        XCTAssertEqual(composed, decomposed) // Swift text equality is not opaque protocol identity.
        XCTAssertTrue(NativeHistoryIdentity.matches(incoming: [row(composed)], stored: [row(decomposed)]).isEmpty)
        XCTAssertTrue(NativeHistoryIdentity.matches(incoming: [row(position: .init(source: composed, rawSequence: 1))], stored: [row(position: .init(source: decomposed, rawSequence: 1))]).isEmpty)
        XCTAssertTrue(NativeHistoryIdentity.matches(incoming: [row(key: composed)], stored: [row(key: decomposed, local: true)]).isEmpty)
    }

    func testParticipantAccountAndSenderUseOriginalBytes() {
        let composed = "\u{00e9}", decomposed = "e\u{0301}"
        let sender = NativeHistoryIdentity.Author.participant(channel: "custom", account: composed, senderID: composed)
        for other in [NativeHistoryIdentity.Author.participant(channel: "custom", account: decomposed, senderID: composed),
                      .participant(channel: "custom", account: composed, senderID: decomposed)] {
            XCTAssertNotEqual(sender, other)
            XCTAssertTrue(NativeHistoryIdentity.matches(incoming: [row("actual", author: sender)], stored: [row("actual", author: other)]).isEmpty)
        }
    }

    func testEmptyAndOversizedKeysNeverProduceAcknowledgement() {
        for invalid in ["", String(repeating: "a", count: 4_097)] {
            XCTAssertTrue(NativeHistoryIdentity.matches(incoming: [row(invalid, position: .init(source: invalid, rawSequence: 0), key: invalid)],
                stored: [row(invalid, position: .init(source: invalid, rawSequence: 0), key: invalid, local: true)]).isEmpty)
        }
    }
}
