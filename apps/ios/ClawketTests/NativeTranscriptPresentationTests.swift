import ClawketRuntime
import Foundation
import XCTest
@testable import Clawket

final class NativeTranscriptPresentationTests: XCTestCase {
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
