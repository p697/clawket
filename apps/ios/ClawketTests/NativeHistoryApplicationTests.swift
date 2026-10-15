import ClawketRuntime
import ClawketTransport
import ClawketUI
import Foundation
import XCTest
@testable import Clawket

final class NativeHistoryApplicationTests: XCTestCase {
    func testLegacyCachedIDsNeverBecomeSourceIdentityByTheirSpelling() throws {
        let row = try JSONDecoder().decode(NativeMessage.self,
            from: Data(#"{"id":"remote-real-looking","remoteID":"actual-looking","role":"user","text":"old"}"#.utf8))
        XCTAssertNil(row.idSource); XCTAssertNil(row.providedID); XCTAssertNil(row.historyEpoch)
        XCTAssertNil(NativeHistoryIdentity.stored(row).sourceID)
        XCTAssertFalse(row.isOwnedUser)
        let encoded = try JSONEncoder().encode(row)
        XCTAssertEqual(try JSONDecoder().decode(NativeMessage.self, from: encoded), row)
    }

    private let route = ConversationID(connectionID: "qa", agentID: "agent", sessionID: "session")
    private let epoch = UUID()
    private func message(_ id: String, text: String = "text", key: String? = nil,
                         provenance: RuntimeMessageIDSource = .provided,
                         attribution: RuntimeMessageAttribution? = nil, image: String? = nil) -> RuntimeMessage {
        var raw: [String: JSONValue] = ["id": .string(id), "text": .string(text)]
        if let image {
            raw["content"] = .array([.object(["type": .string("image"), "source": .object([
                "type": .string("base64"), "media_type": .string("image/png"), "data": .string(image)])])])
        }
        return .init(id: "presentation-" + id, role: .user, text: text, timestampMs: nil, runID: nil,
                     turnID: nil, idempotencyKey: key, sentLocally: true, raw: .object(raw),
                     providedID: id, idSource: provenance, attribution: attribution)
    }
    private func history(_ values: [RuntimeMessage]) -> RuntimeHistory {
        .init(key: route.sessionID, messages: values, nextCursor: nil, hasMore: false,
              pagination: .limit, hasActiveRun: false, activeRun: nil)
    }
    private func snapshot(_ rows: [NativeMessage]) -> [String: NativeMessage] {
        Dictionary(uniqueKeysWithValues: rows.map { ($0.id, $0) })
    }
    private func apply(_ values: [RuntimeMessage], stored: [NativeMessage] = [],
                       read: [String: NativeMessage]? = nil) throws -> NativeHistoryApplication.Projection {
        try NativeHistoryApplication.prepare(history(values), stored: stored, readSnapshot: read ?? snapshot(stored),
                                             epoch: epoch, route: route, earlier: false)
    }

    func testCanonicalHistoryKeepsIndependentRenderIDsAndActualSourceOrder() throws {
        let first = try apply([message("a"), message("b")])
        XCTAssertEqual(first.messages.count, 2)
        XCTAssertNotEqual(first.messages[0].id, "presentation-a")
        XCTAssertNotEqual(first.messages[0].id, "a")
        let next = try apply([message("b", text: "updated"), message("a")], stored: first.messages)
        XCTAssertEqual(next.messages.map(\.id), first.messages.reversed().map(\.id))
        XCTAssertEqual(next.messages.map(\.text), ["updated", "text"])
        XCTAssertTrue(next.messages.allSatisfy { !$0.local && $0.delivery == nil && $0.historyEpoch == epoch })
    }

    func testAmbiguousProducerIDsAndForgedLocalFlagsCannotAcknowledgeOwnedSend() throws {
        let owned = NativeMessage(id: "owned", role: .user, local: true, text: "mine",
                                  idempotencyKey: "send", delivery: .uncertain, historyEpoch: epoch)
        let incoming = [message("reused", key: "send", provenance: .ambiguousProvided),
                        message("reused", key: "send", provenance: .ambiguousProvided)]
        let result = try apply(incoming, stored: [owned])
        XCTAssertEqual(result.messages.count, 3)
        XCTAssertEqual(Set(result.messages.map(\.id)).count, 3)
        XCTAssertEqual(result.messages.filter(\.local).count, 1)
        XCTAssertEqual(result.messages.first(where: { $0.id == "owned" })?.delivery, .uncertain)
        XCTAssertEqual(Set(result.acceptedHistoryIDs.values).count, 2)
    }

    func testExplicitParticipantWithOwnedKeyStaysIncomingAndRetainsOriginalQueue() throws {
        let owned = NativeMessage(id: "owned", role: .user, local: true, text: "same",
                                  idempotencyKey: "send", delivery: .held, historyEpoch: epoch)
        let participant = RuntimeMessageAttribution(channel: "slack", accountID: "workspace", sender: .init(id: "person", name: "Name"))
        let result = try apply([message("participant", text: "same", key: "send", attribution: participant)], stored: [owned])
        XCTAssertEqual(result.messages.count, 2)
        let other = try XCTUnwrap(result.messages.first { $0.providedID == "participant" })
        XCTAssertFalse(other.local); XCTAssertNil(other.delivery); XCTAssertEqual(other.attribution, participant)
        XCTAssertEqual(result.messages.first { $0.id == "owned" }?.delivery, .held)
    }

    func testInlineContentRefreshUsesExactSourceHashAndDistinctDisplayReferences() throws {
        let first = try apply([message("one", image: "AA==")])
        var ownedPixels = first.messages
        let resource = UUID(); ownedPixels[0].media[0].resourceID = resource
        let unchanged = try apply([message("one", image: "AA==")], stored: ownedPixels)
        XCTAssertEqual(unchanged.messages[0].media[0].resourceID, resource)
        let changed = try apply([message("one", image: "AQ==")], stored: ownedPixels)
        XCTAssertEqual(changed.messages[0].id, ownedPixels[0].id)
        XCTAssertNil(changed.messages[0].media[0].resourceID)
        XCTAssertEqual(changed.retiringResources, [resource])
        let duplicates = try apply([message("same", provenance: .ambiguousProvided, image: "AA=="),
                                    message("same", provenance: .ambiguousProvided, image: "AQ==")])
        XCTAssertNotEqual(duplicates.messages[0].media[0].id, duplicates.messages[1].media[0].id)
    }

    func testProvenLocalEchoRetainsOriginalFilesWhenBackendReencodesOrOmitsThem() throws {
        var media = NativeMediaReference(id: "original-input", attachment: try XCTUnwrap(message("input", image: "AA==").attachments.first))
        media.resourceID = UUID()
        let owned = NativeMessage(id: "owned", role: .user, local: true, text: "mine", idempotencyKey: "send",
                                  delivery: .uncertain, media: [media], historyEpoch: epoch)
        let result = try apply([message("echo", key: "send")], stored: [owned])
        XCTAssertEqual(result.messages.count, 1); XCTAssertEqual(result.messages[0].id, "owned")
        XCTAssertTrue(result.messages[0].local); XCTAssertEqual(result.messages[0].delivery, .delivered)
        XCTAssertEqual(result.messages[0].media, [media]); XCTAssertTrue(result.retiringResources.isEmpty)
    }

    func testReadSnapshotUsesOriginalPayloadBytesAndCannotHydrateAStaleRow() throws {
        let first = try apply([message("source", text: "\u{00e9}")])
        var current = first.messages; current[0].text = "e\u{0301}"
        XCTAssertEqual(current[0].text, first.messages[0].text)
        XCTAssertNotEqual(current[0], first.messages[0])
        let result = try apply([message("source", text: "older response", image: "AA==")],
                               stored: current, read: snapshot(first.messages))
        XCTAssertEqual(result.messages, current); XCTAssertTrue(result.acceptedHistoryIDs.isEmpty)
        XCTAssertTrue(result.retiringResources.isEmpty)
    }
}
