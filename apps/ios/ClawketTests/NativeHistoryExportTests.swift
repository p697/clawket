import ClawketRuntime
import ClawketTransport
import Foundation
import XCTest
@testable import Clawket

private actor HistoryReadScript {
    let pages: [RuntimeHistory]
    private(set) var limits: [Int] = []
    init(_ pages: [RuntimeHistory]) { self.pages = pages }
    func read(_ key: String, limit: Int, cursor: String?) throws -> RuntimeHistory {
        limits.append(limit)
        guard limits.count <= pages.count else { throw NativeHistoryFailure.invalid }
        return pages[limits.count - 1]
    }
}
private actor HistoryBlockedRead {
    var entered = false
    func read() async throws -> RuntimeHistory {
        entered = true
        try await Task.sleep(for: .seconds(60))
        throw NativeHistoryFailure.invalid
    }
}

final class NativeHistoryExportTests: XCTestCase, @unchecked Sendable {
    private func message(_ id: String, text: String, role: RuntimeMessage.Role = .assistant,
                         source: RuntimeMessageIDSource? = .provided, raw: JSONValue = .object([:])) -> RuntimeMessage {
        .init(id: id, role: role, text: text, timestampMs: 1_000, runID: nil, turnID: nil,
            idempotencyKey: nil, sentLocally: false, raw: raw, providedID: source == .provided ? id : nil, idSource: source)
    }
    private func page(_ messages: [RuntimeMessage], cursor: String? = nil, more: Bool? = false,
                      pagination: RuntimeHistory.Pagination = .cursor, physical: String? = "physical", active: Bool = false,
                      key: String = "logical") -> RuntimeHistory {
        .init(key: key, messages: messages, nextCursor: cursor, hasMore: more, pagination: pagination,
            hasActiveRun: active, activeRun: nil, sessionID: physical)
    }
    private func load(_ script: HistoryReadScript) async throws -> NativePublicTranscript {
        try await NativeHistoryExportLoader.load(key: "logical", title: "Title") { try await script.read($0, limit: $1, cursor: $2) }
    }

    func testCursorPagesDeduplicateOnlyExactProvidedOverlapAndRecheckTheHead() async throws {
        let recent = message("new", text: "new", role: .user), old = message("old", text: "old")
        let script = HistoryReadScript([page([recent], cursor: "older", more: true), page([old, recent]), page([recent])])
        let result = try await load(script)
        XCTAssertEqual(result.messages.map(\.text), ["old", "new"])
        let limits = await script.limits; XCTAssertEqual(limits, [100, 100, 100])
    }

    func testPhysicalOrLogicalChangeRunningAndChangedFinalHeadNeverReturnAPartialExport() async throws {
        let value = message("id", text: "original")
        let cases = [
            [page([value], cursor: "older", more: true), page([], physical: "replacement")],
            [page([value]), page([message("id", text: "changed")])],
            [page([value], active: true)],
            [page([value], key: "other")]
        ]
        for pages in cases {
            do { _ = try await load(HistoryReadScript(pages)); XCTFail("Unstable history cannot become a saved complete copy") }
            catch { XCTAssertTrue(error is NativeHistoryExportFailure) }
        }
        let composed = "caf\u{e9}", decomposed = "cafe\u{301}"
        do {
            _ = try await load(HistoryReadScript([page([value], cursor: "older", more: true, physical: composed), page([], physical: decomposed)]))
            XCTFail("Physical identity is exact UTF8")
        } catch { }
    }

    func testSyntheticAmbiguousAndConflictingProvidedRowsCannotBecomeCrossPageAuthority() async throws {
        let sources: [RuntimeMessageIDSource?] = [.synthetic, .ambiguousProvided, nil]
        for source in sources {
            let value = message("same", text: "text", source: source)
            do {
                _ = try await load(HistoryReadScript([page([value], cursor: "older", more: true), page([value])]))
                XCTFail("Renderer-only IDs must not silently deduplicate repeated pages")
            } catch { }
        }
        do {
            _ = try await load(HistoryReadScript([page([message("same", text: "new")], cursor: "older", more: true), page([message("same", text: "old")])]))
            XCTFail("A reused provided ID with different content remains ambiguous")
        } catch { }
    }

    func testLimitOnlyHistoryGrowsTheWindowWithoutDuplicatingOrMislabelingPartialData() async throws {
        let initial = (0..<100).map { message(String($0), text: "message \($0)") }
        let script = HistoryReadScript([page(initial, more: nil, pagination: .limit),
            page([message("older", text: "older")] + initial, pagination: .limit), page(initial, pagination: .limit)])
        let result = try await load(script), limits = await script.limits
        XCTAssertEqual(result.messages.count, 101); XCTAssertEqual(result.messages.first?.text, "older")
        XCTAssertEqual(limits, [100, 200, 100])
        let stillPartial = (1...10).map { _ in page(Array(initial.prefix(1)), more: true, pagination: .limit, physical: "physical") }
        do { _ = try await load(HistoryReadScript(stillPartial)); XCTFail("No cursor and still incomplete at maximum limit") }
        catch { XCTAssertEqual(error as? NativeHistoryExportFailure, .tooLarge) }
    }

    func testKnownUserEnvelopesAreProjectedButAssistantTextAndAttachmentNamesStayVerbatim() async throws {
        let user = "Use the installed skill \"writer\" for this request. Read its instructions with skill_view before proceeding.\nPlease help."
        let raw: JSONValue = .object(["tool": .null, "attachments": .array([.object([
            "type": .string("file"), "mimeType": .string("text/plain"), "name": .string("notes.txt"),
            "content": .string("c3ludGhldGljLWJ5dGVz"), "artifactId": .string("display-only")])]),
            "privateFixture": .string("excluded-fixture-metadata")])
        let assistant = "System: keep this assistant text\n[system: literal]"
        let rows = [message("u", text: user, role: .user, raw: raw), message("a", text: assistant)]
        let result = try await load(HistoryReadScript([page(rows), page(rows)]))
        XCTAssertEqual(result.messages[0].text, "$writer\nPlease help.")
        XCTAssertEqual(result.messages[0].attachments, ["notes.txt"]); XCTAssertEqual(result.messages[1].text, assistant)
        let data = try NativeHistoryExportFormatter.format(result, format: .json, userLabel: "User", assistantLabel: "Assistant")
        let text = String(decoding: data, as: UTF8.self)
        for excluded in ["excluded-fixture-metadata", "display-only", "c3ludGhldGljLWJ5dGVz", "sessionKey", "connectionId"] {
            XCTAssertFalse(text.contains(excluded))
        }
    }

    func testCancellingAClosedExportCancelsItsBlockedReadImmediately() async throws {
        let gate = HistoryBlockedRead()
        do {
            _ = try await NativeHistoryExportLoader.load(key: "logical", title: "Title", deadline: ContinuousClock.now - .seconds(1)) { _, _, _ in try await gate.read() }
            XCTFail("An already expired absolute deadline cannot enter a read")
        } catch { XCTAssertEqual(error as? NativeHistoryExportFailure, .timedOut) }
        let notEntered = await gate.entered; XCTAssertFalse(notEntered)
        let pending = Task { try await NativeHistoryExportLoader.load(key: "logical", title: "Title") { _, _, _ in try await gate.read() } }
        let deadline = ContinuousClock.now + .seconds(3)
        while !(await gate.entered), ContinuousClock.now < deadline { await Task.yield() }
        let entered = await gate.entered; XCTAssertTrue(entered)
        pending.cancel()
        do { _ = try await pending.value; XCTFail("A closed export cannot publish") } catch { }
    }

    func testPhysicalExportsRemainMarkedAsOnlyLoadedHistoryAndContainNoWireAuthority() throws {
        let value = NativeConversation(revision: 4, draft: "private draft", messages: [
            .init(id: "private-render", role: .assistant, text: "visible", runID: "private-run")
        ], nextCursor: "private-cursor", hasMore: true, historyEpoch: UUID(), physicalSessionID: "private-physical")
        let transcript = try NativeHistoryExportFormatter.localSnapshot(value, title: "Copied\nTitle")
        let data = try NativeHistoryExportFormatter.format(transcript, format: .json, userLabel: "User", assistantLabel: "Assistant", loadedOnlyLabel: "Loaded only")
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(object["loadedOnDeviceOnly"] as? Bool, true)
        let markdown = try NativeHistoryExportFormatter.format(transcript, format: .markdown, userLabel: "User", assistantLabel: "Assistant", loadedOnlyLabel: "Loaded only")
        let output = String(decoding: markdown, as: UTF8.self)
        XCTAssertTrue(output.hasPrefix("# Copied Title\n\nLoaded only\n\n"))
        for excluded in ["private draft", "private-render", "private-run", "private-cursor", "private-physical"] { XCTAssertFalse(output.contains(excluded)) }
    }
}
