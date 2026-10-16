import Foundation
import Testing
@testable import ClawketUI

@Suite(.serialized)
struct MarkdownBlocksTests {
    @Test func mixedProseAndFencesKeepOrderLanguageAndExactCodeBytes() throws {
        let prefix = "# Explanation 中文\r\n\r\n"
        let code = "  let é = \"e\u{301}\"\r\n\tprint(é)\r\n"
        let raw = prefix + "```swift title\r\n" + code + "```\r\nBetween\n~~~sh\necho done\n~~~\nAfter"
        let blocks = NativeMarkdownBlocks.parse(raw)
        #expect(blocks.map(\.content) == [.markdown(prefix), .code(language: "swift", text: code),
            .markdown("Between\n"), .code(language: "sh", text: "echo done\n"), .markdown("After")])
        #expect(blocks[1].id == prefix.utf8.count)
        guard case let .code(_, copied) = blocks[1].content else { Issue.record("Missing code"); return }
        #expect(Data(copied.utf8) == Data(code.utf8))
    }

    @Test func closingFenceRequiresTheOpeningMarkerLengthAndWhitespaceOnlyTail() {
        let body = "```\n~~~\n````not a close\nvalue\n"
        let blocks = NativeMarkdownBlocks.parse("````txt\n" + body + "````` \t\nAfter")
        #expect(blocks.map(\.content) == [.code(language: "txt", text: body), .markdown("After")])
    }

    @Test func indentationIsConservativeAndCodeIndentationIsNeverRewritten() {
        let raw = "   ```python\n   print('raw indentation')\n  ```\n"
        #expect(NativeMarkdownBlocks.parse(raw).map(\.content)
            == [.code(language: "python", text: "   print('raw indentation')\n")])
        for literal in ["    ```swift\n", "inline ```swift\n", "```bad`info\n", "``swift\n", "\\```swift\n"] {
            #expect(NativeMarkdownBlocks.parse(literal).map(\.content) == [.markdown(literal)])
        }
    }

    @Test func fenceRulesDependOnlyOnRawTextAndRetainUnclosedTailVerbatim() {
        #expect(NativeMarkdownBlocks.parse("```sw").map(\.content) == [.markdown("```sw")])
        let prefix = "Intro\n", body = "**literal**\r\n`quoted`\r\n"
        for tail in ["", "`", "``", "``` trailing"] {
            let blocks = NativeMarkdownBlocks.parse(prefix + "```swift\r\n" + body + tail)
            #expect(blocks.map(\.content) == [.markdown(prefix), .code(language: "swift", text: body + tail)])
            #expect(blocks[1].id == prefix.utf8.count)
        }
        #expect(NativeMarkdownBlocks.parse(prefix + "```swift\r\n" + body + "```").map(\.content)
            == [.markdown(prefix), .code(language: "swift", text: body)])
    }

    @Test func sourceOffsetsStayStableAcrossGrowthClosureAndFollowingContent() {
        let first = "é\n```swift\n"
        let partial = NativeMarkdownBlocks.parse(first + "let x = 1")
        let final = NativeMarkdownBlocks.parse(first + "let x = 12\n```\nAfter\n```sh\necho ok\n```")
        #expect(Array(final.prefix(2)).map(\.id) == partial.map(\.id))
        #expect(final.map(\.id) == final.map(\.id).sorted())
        #expect(Set(final.map(\.id)).count == final.count)
    }

    @Test func emptyAndUnclosedFinalFencesPreserveAvailableBodyWithoutInventingText() {
        #expect(NativeMarkdownBlocks.parse("").isEmpty)
        #expect(NativeMarkdownBlocks.parse("```").map(\.content) == [.markdown("```")])
        #expect(NativeMarkdownBlocks.parse("~~~\rbody\r").map(\.content) == [.code(language: nil, text: "body\r")])
        #expect(NativeMarkdownBlocks.parse("```\n\n```\n").map(\.content) == [.code(language: nil, text: "\n")])
    }

    @Test func markdownAndCodeEqualityAndHashingKeepCanonicalAliasesDistinct() {
        let composed = "é", decomposed = "e\u{301}"
        let values: [MessageContent] = [.markdown(composed), .markdown(decomposed),
            .code(language: "swift", text: composed), .code(language: "swift", text: decomposed),
            .code(language: composed, text: "same"), .code(language: decomposed, text: "same")]
        #expect(Set(values).count == values.count)
        for value in values {
            #expect(value == value)
            #expect(Set([value, value]).count == 1)
        }
        #expect(MessageContent.notice(composed) == .notice(decomposed)) // Other cases retain their existing semantics.
    }
}
