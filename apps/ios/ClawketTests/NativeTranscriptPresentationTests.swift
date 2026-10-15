import ClawketRuntime
import ClawketUI
import Foundation
import XCTest
@testable import Clawket

final class NativeTranscriptPresentationTests: XCTestCase {
    @MainActor func testRemoteUserAndExplicitParticipantNeverAcquireQueueActionsFromAlignmentOrFlags() {
        let model = NativeAppModel()
        let remote = model.present(.init(id: "direct", role: .user, text: "remote", idempotencyKey: "key",
                                         delivery: .held), agentName: "Agent")
        XCTAssertEqual(remote.author, .directUser); XCTAssertTrue(remote.author.isOutgoing)
        XCTAssertFalse(remote.author.isLocal); XCTAssertNil(remote.delivery)
        XCTAssertEqual(remote.actions, [.copy])
        let person = RuntimeMessageAttribution(channel: "slack", sender: .init(id: "p", name: "  Person  "))
        let participant = model.present(.init(id: "person", role: .user, local: true, text: "other",
            idempotencyKey: "key", delivery: .held, attribution: person), agentName: "Agent", hasParticipants: true)
        XCTAssertEqual(participant.author, .participant(name: "  Person  ", channel: "slack"))
        XCTAssertFalse(participant.author.isOutgoing); XCTAssertNil(participant.delivery)
        XCTAssertEqual(participant.actions, [.copy])
        let owned = model.present(.init(id: "owned", role: .user, local: true, text: "mine",
                                       idempotencyKey: "key", delivery: .held), agentName: "Agent")
        XCTAssertEqual(owned.author, .local); XCTAssertEqual(owned.actions, [.copy, .edit, .remove])
    }

    func testParticipantLabelsKeepProducerValuesAndAgentBadgeReflectsActualContext() {
        let blankName = RuntimeMessageAttribution(channel: "telegram", sender: .init(id: "opaque", name: " \n ", username: "@original"))
        let row = NativeMessage(id: "person", role: .user, text: "hi", attribution: blankName)
        XCTAssertEqual(NativeTranscriptPresentation.author(row, agentName: "Agent", hasParticipants: true),
                       .participant(name: "@original", channel: "telegram"))
        let unknown = NativeMessage(id: "unknown", role: .user, text: "hi", attribution: .init(channel: "slack"))
        XCTAssertEqual(NativeTranscriptPresentation.author(unknown, agentName: "Agent", hasParticipants: true),
                       .participant(name: String(localized: "Participant"), channel: "slack"))
        let agent = NativeMessage(id: "agent", role: .assistant, text: "reply")
        XCTAssertEqual(NativeTranscriptPresentation.author(agent, agentName: "Original", hasParticipants: true),
                       .agent(name: "Original", label: String(localized: "Agent")))
        XCTAssertEqual(NativeTranscriptPresentation.author(agent, agentName: "Original", hasParticipants: false),
                       .agent(name: "Original", label: nil))
    }

    func testMissingAndInvalidProducerClocksNeverInventNowAndValidClocksUsePhoneTimeZone() throws {
        for value in [nil, -1, Int64.max] as [Int64?] {
            XCTAssertNil(NativeTranscriptPresentation.timeLabel(value))
        }
        let stamp: Int64 = 1_700_000_000_000
        let locale = Locale(identifier: "en_US_POSIX")
        let utc = try XCTUnwrap(TimeZone(secondsFromGMT: 0)), tokyo = try XCTUnwrap(TimeZone(secondsFromGMT: 32_400))
        let first = try XCTUnwrap(NativeTranscriptPresentation.timeLabel(stamp, locale: locale, timeZone: utc))
        let second = try XCTUnwrap(NativeTranscriptPresentation.timeLabel(stamp, locale: locale, timeZone: tokyo))
        XCTAssertNotEqual(first, second); XCTAssertEqual(stamp, 1_700_000_000_000)
    }

    func testUnicodeEquivalentTitleIsNotAProtocolIdentityUnlessOriginalBytesMatch() {
        let composed = "\u{00e9}", decomposed = "e\u{0301}"
        XCTAssertEqual(composed, decomposed)
        let value = NativeTranscriptPresentation.title(decomposed, key: composed, nativeSessionID: nil,
                                                       preview: "fallback", messages: [])
        XCTAssertTrue(value.utf8.elementsEqual(decomposed.utf8))
    }

    func testExplicitNamesIncludingUnrelatedUUIDRemainVerbatim() {
        for name in ["  Project notes  ", "6DB89288-CA67-468A-8CAD-50E40E6B8CEC"] {
            XCTAssertEqual(NativeTranscriptPresentation.title(name, key: "key", nativeSessionID: "id",
                preview: "preview", messages: [.init(id: "u", role: .user, text: "prompt")]), name)
        }
    }

    func testActualProtocolIdentityUsesFirstNonemptyHumanMessageInSourceOrder() {
        let messages: [NativeMessage] = [.init(id: "a", role: .assistant, text: "not a title"),
            .init(id: "t", role: .tool, text: "not a title"), .init(id: "e", role: .user, text: " \n "),
            .init(id: "u", role: .user, text: "  Original human request \n"),
            .init(id: "later", role: .user, text: "later request")]
        for title in ["key", "native-id", ""] {
            XCTAssertEqual(NativeTranscriptPresentation.title(title, key: "key", nativeSessionID: "native-id",
                preview: "backend preview", messages: messages), "Original human request")
        }
    }

    func testPreviewAndLocalizedDefaultNeverDisplayKnownOpaqueIdentity() {
        XCTAssertEqual(NativeTranscriptPresentation.title(nil, key: "key", nativeSessionID: "id",
            preview: "  Backend summary \n", messages: []), "Backend summary")
        for preview in [nil, "", " \n ", "key", "id", " id "] as [String?] {
            XCTAssertEqual(NativeTranscriptPresentation.title(nil, key: "key", nativeSessionID: "id",
                preview: preview, messages: []), String(localized: "New conversation"))
        }
    }

    func testOnlyEmptyToolRowsAreHiddenAndSourceValuesRemain() throws {
        let media = try JSONDecoder().decode(NativeMediaReference.self,
            from: Data(#"{"id":"asset","artifactID":"original","kind":"file","mimeType":"text/plain","name":"result.txt"}"#.utf8))
        let messages: [NativeMessage] = [.init(id: "empty", role: .tool, text: " \n"),
            .init(id: "output", role: .tool, text: "original result"),
            .init(id: "file", role: .tool, text: "", media: [media]),
            .init(id: "user", role: .user, local: true, text: "", delivery: .uncertain),
            .init(id: "agent", role: .assistant, text: "", streaming: true)]
        XCTAssertEqual(messages.filter(NativeTranscriptPresentation.isVisible).map(\.id), ["output", "file", "user", "agent"])
        XCTAssertEqual(messages.count, 5); XCTAssertEqual(messages[0].text, " \n")
        XCTAssertEqual(messages[2].media, [media]); XCTAssertEqual(messages[3].delivery, .uncertain)
    }

    @MainActor func testOnlyActualToolRoleUsesVerbatimOutputAndKeepsItsMediaSeparate() throws {
        let model = NativeAppModel()
        let raw = "{\"status\":\"complete\",\"output\":\"**literal**\"}\n```\n# untouched\n"
        let media = try JSONDecoder().decode(NativeMediaReference.self,
            from: Data(#"{"id":"asset","artifactID":"original","kind":"file","mimeType":"text/plain","name":"result.txt"}"#.utf8))
        let source = NativeMessage(id: "tool", role: .tool, text: raw, media: [media])
        let presented = model.present(source, agentName: "Agent")
        XCTAssertEqual(presented.content.first, .toolOutput(.init(text: raw)))
        let composed = ToolOutputPresentation(text: "\u{00e9}"), decomposed = ToolOutputPresentation(text: "e\u{0301}")
        XCTAssertEqual(composed.text, decomposed.text)
        XCTAssertNotEqual(composed, decomposed); XCTAssertEqual(Set([composed, decomposed]).count, 2)
        XCTAssertEqual(presented.content.count, 2)
        guard case let .attachment(attachment) = presented.content[1] else { return XCTFail("Tool media was collapsed into its text") }
        XCTAssertEqual(attachment.name, "result.txt")
        XCTAssertEqual(presented.author, .system); XCTAssertNil(presented.delivery)
        XCTAssertFalse(presented.isStreaming); XCTAssertEqual(presented.actions, [.copy])
        for role in [RuntimeMessage.Role.user, .assistant, .system] {
            let message = NativeMessage(id: "other", role: role, text: raw)
            XCTAssertEqual(model.present(message, agentName: "Agent").content.first, .markdown(raw))
        }
        XCTAssertEqual(source.text, raw); XCTAssertEqual(source.media, [media])
        XCTAssertEqual(source.id, "tool"); XCTAssertNil(source.runID)
    }

    func testOnlyEndedWhitespaceAssistantWithoutMediaIsHiddenAndStoredMessagesRemain() throws {
        let media = try JSONDecoder().decode(NativeMediaReference.self,
            from: Data(#"{"id":"asset","artifactID":"original","kind":"file","mimeType":"text/plain","name":"result.txt"}"#.utf8))
        let source: [NativeMessage] = [
            .init(id: "ended", role: .assistant, text: " \n\t"),
            .init(id: "stream", role: .assistant, text: " \n", streaming: true),
            .init(id: "media", role: .assistant, text: "", media: [media]),
            .init(id: "body", role: .assistant, text: "  original  "),
            .init(id: "user", role: .user, local: true, text: "", delivery: .uncertain),
            .init(id: "system", role: .system, text: ""),
            .init(id: "tool", role: .tool, text: "{\"output\":\"\"}")]
        let visible = source.filter(NativeTranscriptPresentation.isVisible)
        XCTAssertEqual(visible.map(\.id), ["stream", "media", "body", "user", "system", "tool"])
        XCTAssertEqual(source.count, 7); XCTAssertEqual(source.first?.text, " \n\t")
        XCTAssertEqual(source[1].streaming, true); XCTAssertEqual(source[2].media, [media])
        XCTAssertEqual(source[4].delivery, .uncertain)
    }

    func testDerivedTitleBoundsWholeGraphemesWithoutMutatingOriginalMessage() {
        let text = String(repeating: "👩🏽‍💻", count: 200)
        let message = NativeMessage(id: "u", role: .user, text: text)
        let title = NativeTranscriptPresentation.title("id", key: "key", nativeSessionID: "id",
            preview: nil, messages: [message])
        XCTAssertEqual(title, String(repeating: "👩🏽‍💻", count: 160))
        XCTAssertEqual(message.text, text); XCTAssertEqual(message.id, "u"); XCTAssertNil(message.remoteID)
        let oversizedGrapheme = "a" + String(repeating: "\u{301}", count: 5_000)
        XCTAssertEqual(NativeTranscriptPresentation.title(nil, key: "key", nativeSessionID: nil,
            preview: "Safe summary", messages: [.init(id: "large", role: .user, text: oversizedGrapheme)]), "Safe summary")
    }
}
