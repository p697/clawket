import Foundation

/// Display slices of one message. Byte offsets are view keys, never message identities.
enum NativeMarkdownBlocks {
    struct Block: Identifiable, Sendable {
        let id: Int
        let content: MessageContent
    }
    private struct Fence {
        let marker: UInt8
        let count: Int
        let language: String?
    }

    static func parse(_ text: String) -> [Block] {
        let bytes = Array(text.utf8)
        var blocks: [Block] = [], proseStart = 0, lineStart = 0
        var opening: (start: Int, body: Int, fence: Fence)?
        while lineStart < bytes.count {
            var end = lineStart
            while end < bytes.count && bytes[end] != 10 && bytes[end] != 13 { end += 1 }
            var next = end
            if next < bytes.count {
                next += 1
                if bytes[end] == 13 && next < bytes.count && bytes[next] == 10 { next += 1 }
            }
            // An opening tail can still grow into an info string. Require its
            // newline in every phase; connection proof never changes parsing.
            // A complete closing fence also closes at EOF, as in Markdown.
            if let current = opening {
                if closes(bytes[lineStart..<end], fence: current.fence) {
                    blocks.append(.init(id: current.start, content: .code(language: current.fence.language,
                        text: String(decoding: bytes[current.body..<lineStart], as: UTF8.self))))
                    opening = nil; proseStart = next
                }
            } else if end < bytes.count, let fence = opens(bytes[lineStart..<end]) {
                if proseStart < lineStart {
                    blocks.append(.init(id: proseStart, content: .markdown(String(decoding: bytes[proseStart..<lineStart], as: UTF8.self))))
                }
                opening = (lineStart, next, fence)
            }
            lineStart = next
        }
        if let current = opening {
            blocks.append(.init(id: current.start, content: .code(language: current.fence.language,
                text: String(decoding: bytes[current.body...], as: UTF8.self))))
        } else if proseStart < bytes.count {
            blocks.append(.init(id: proseStart, content: .markdown(String(decoding: bytes[proseStart...], as: UTF8.self))))
        }
        return blocks
    }

    private static func markerStart(_ line: ArraySlice<UInt8>) -> Int? {
        var index = line.startIndex, spaces = 0
        while index < line.endIndex && line[index] == 32 { index += 1; spaces += 1 }
        return spaces <= 3 && index < line.endIndex ? index : nil
    }

    private static func opens(_ line: ArraySlice<UInt8>) -> Fence? {
        guard let start = markerStart(line), line[start] == 96 || line[start] == 126 else { return nil }
        let marker = line[start]
        var end = start
        while end < line.endIndex && line[end] == marker { end += 1 }
        guard end - start >= 3 else { return nil }
        let info = line[end...]
        guard marker != 96 || !info.contains(96) else { return nil }
        let language = String(decoding: info, as: UTF8.self).split(whereSeparator: { $0.isWhitespace }).first.map { String($0.prefix(64)) }
        return .init(marker: marker, count: end - start, language: language)
    }

    private static func closes(_ line: ArraySlice<UInt8>, fence: Fence) -> Bool {
        guard let start = markerStart(line), line[start] == fence.marker else { return false }
        var end = start
        while end < line.endIndex && line[end] == fence.marker { end += 1 }
        return end - start >= fence.count && line[end...].allSatisfy { $0 == 32 || $0 == 9 }
    }
}
