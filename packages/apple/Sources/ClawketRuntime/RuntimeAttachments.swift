import Foundation
import ClawketTransport

public struct RuntimePromptAttachment: Codable, Sendable, Equatable {
    public enum Kind: String, Codable, Sendable { case image, file }
    public let type: Kind
    public let mimeType: String
    public let content: Data
    public let name: String?
    public init(type: Kind, mimeType: String, content: Data, name: String? = nil) {
        self.type = type; self.mimeType = mimeType; self.content = content; self.name = name
    }
}

/// Display reference only. Inline source data remains in raw legacy history and
/// is bounded before use; downloaded bytes/ticket URLs never enter this model.
public struct RuntimeMessageAttachment: Codable, Sendable, Equatable {
    public let type: RuntimePromptAttachment.Kind
    public let mimeType: String
    public let name: String?
    public let artifactID: String?
}

enum RuntimeAttachmentProjection {
    static func inlineData(_ value: JSONValue, index: Int) throws -> Data? {
        let values = (value["attachments"]?.array ?? value["content"]?.array ?? []).prefix(64).filter {
            !extract(.object(["attachments": .array([$0])])).isEmpty
        }
        guard index >= 0, index < values.count else { throw RuntimeFailure(.invalidConnection) }
        let raw = Array(values)[index], block = raw["type"]?.stringValue == "attachment" ? raw["attachment"] ?? .null : raw
        if block["artifactId"]?.nonemptyString != nil { return nil }
        let content = block["content"]?.stringValue ?? block["data"]?.stringValue ?? block["source"]?["data"]?.stringValue
        if let content { return try artifactBase64(content, length: nil, maximum: 5 * 1_024 * 1_024) }
        let uri = block["uri"]?.stringValue ?? block["image_url"]?["url"]?.stringValue
        if let uri, uri.hasPrefix("data:"), let separator = uri.range(of: ";base64,") {
            let declared = String(uri[uri.index(uri.startIndex, offsetBy: 5)..<separator.lowerBound])
            guard let mime = mime(declared), extract(.object(["attachments": .array([raw])])).first?.mimeType == mime else { throw RuntimeFailure(.invalidResponse) }
            return try artifactBase64(String(uri[separator.upperBound...]), length: nil, maximum: 5 * 1_024 * 1_024)
        }
        return nil
    }
    static func extract(_ value: JSONValue) -> [RuntimeMessageAttachment] {
        let values = value["attachments"]?.array ?? value["content"]?.array ?? []
        return values.prefix(64).compactMap { raw in
            let block = raw["type"]?.stringValue == "attachment" ? raw["attachment"] ?? .null : raw
            let uri = block["uri"]?.stringValue ?? block["image_url"]?["url"]?.stringValue
            let uriMIME: String?
            if let uri, uri.hasPrefix("data:"), let separator = uri.range(of: ";base64,") { uriMIME = String(uri[uri.index(uri.startIndex, offsetBy: 5)..<separator.lowerBound]) }
            else { uriMIME = nil }
            guard ["image", "file", "image_url", "attachment", "audio", "video"].contains(raw["type"]?.stringValue ?? ""),
                  let mime = mime(block["mimeType"]?.stringValue ?? block["mime_type"]?.stringValue ?? block["source"]?["media_type"]?.stringValue ?? uriMIME ?? "application/octet-stream") else { return nil }
            let artifact = block["artifactId"]?.nonemptyString
            guard artifact?.utf8.count ?? 0 <= 512 else { return nil }
            let name = block["name"]?.stringValue ?? block["fileName"]?.stringValue ?? block["label"]?.stringValue ?? block["alt"]?.stringValue
            return RuntimeMessageAttachment(type: ["image", "image_url"].contains(raw["type"]?.stringValue ?? "") ? .image : .file,
                                            mimeType: mime, name: (name?.utf8.count ?? 0) <= 1_024 ? name : nil, artifactID: artifact)
        }
    }
    static func mime(_ raw: String) -> String? {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return value.utf8.count <= 255 && value.range(of: "^[a-z0-9.+-]+/[a-z0-9.+-]+$", options: .regularExpression) != nil ? value : nil
    }
    static func displayText(_ value: JSONValue, fallback: String, enabled: Bool) -> String {
        guard enabled, extract(value).contains(where: { $0.artifactID != nil }),
              let text = value["artifactDisplayText"]?.stringValue else { return fallback }
        return text
    }
    static func stripMediaDirectives(_ value: String) -> String {
        var fence: Character?
        return value.components(separatedBy: "\n").filter { line in
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                if fence == trimmed.first { fence = nil } else if fence == nil { fence = trimmed.first }
                return true
            }
            return fence != nil || line.range(of: "^\\s*MEDIA:\\s*(?:/|\\./|~/|https?://)\\S[^\\r\\n]*\\s*$", options: .regularExpression) == nil
        }.joined(separator: "\n")
    }

    static func reconcileOpenClaw(_ messages: [RuntimeMessage]) -> [RuntimeMessage] {
        var output: [RuntimeMessage] = [], start = 0
        while start < messages.count {
            var end = start + 1
            while end < messages.count && messages[end].role != .user { end += 1 }
            let turn = messages[start..<end]
            let delivered = turn.contains { $0.role == .assistant && $0.attachments.contains { $0.artifactID != nil } }
            var managed: [String: Int] = [:]
            for message in turn {
                let text = delivered && message.role == .assistant ? stripMediaDirectives(message.text) : message.text
                let references = message.attachments.compactMap(\.artifactID)
                let identity: String?
                if message.role == .assistant, !references.isEmpty, references.count == message.attachments.count,
                   references.allSatisfy({ $0.hasPrefix("artifact_managed_") }) {
                    identity = (try? JSONEncoder().encode([text.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")] + references.sorted())).map { $0.base64EncodedString() }
                } else { identity = nil }
                let replacement = RuntimeMessage(id: message.id, role: message.role, text: text, timestampMs: message.timestampMs,
                                                 runID: message.runID, turnID: message.turnID, idempotencyKey: message.idempotencyKey,
                                                 sentLocally: message.sentLocally, raw: message.raw, providedID: message.providedID,
                                                 idSource: message.idSource, attribution: message.attribution,
                                                 transcriptPosition: message.transcriptPosition, transcriptBoundary: message.transcriptBoundary)
                let ambiguous = message.idSource == .ambiguousProvided
                if !ambiguous, let identity, let previous = managed[identity] { output[previous] = replacement; continue }
                if !ambiguous, let identity { managed[identity] = output.count }
                if ambiguous || text == message.text || !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !message.attachments.isEmpty { output.append(replacement) }
            }
            start = end
        }
        return output
    }
}

extension RuntimeSessionUpdate {
    public var finalAttachments: [RuntimeMessageAttachment] {
        if case .runFinished(_, _, _, _, let raw) = self { return RuntimeAttachmentProjection.extract(raw["message"] ?? raw) }
        return []
    }
    public func inlineFinalAttachmentData(at index: Int) throws -> Data? {
        if case .runFinished(_, _, _, _, let raw) = self { return try RuntimeAttachmentProjection.inlineData(raw["message"] ?? raw, index: index) }
        throw RuntimeFailure(.invalidConnection)
    }
}

extension RuntimeCoordinator {
    func configureAttachmentCapabilities(_ value: inout RuntimeCapabilities) {
        guard let connection else { return }
        switch connection.backendKind {
        case .openclaw:
            value.attachments = true; value.fileAttachments = true
            value.artifacts = (supportedMethods.contains("clawket.artifacts.open") && supportedMethods.contains("clawket.artifacts.read"))
                || (connection.transportKind != .relay && supportedMethods.contains("artifacts.get") && supportedMethods.contains("artifacts.download"))
        case .hermes:
            value.attachments = true; value.documentAttachments = bridgeCapabilities.contains("hermes.documents.v1")
            value.artifacts = bridgeCapabilities.contains("bridge.artifacts.v1")
        case .codex, .pi:
            value.attachments = true; value.artifacts = backendHealth["artifacts"]?.boolValue == true
        case .claudeCode:
            value.attachments = backendHealth["vision"]?.boolValue == true; value.artifacts = backendHealth["artifacts"]?.boolValue == true
        case .localModel: value.attachments = backendHealth["vision"]?.boolValue == true
        }
    }

    /// Local-only preflight before moving the editable outbox. Send reconstructs
    /// the identical params and uses Transport's same full-envelope serializer.
    public func validatePrompt(sessionKey: String, input: RuntimePrompt) throws {
        _ = try scope()
        _ = try promptParameters(sessionKey: sessionKey, input: input)
    }

    func promptParameters(sessionKey: String, input: RuntimePrompt) throws -> JSONValue {
        guard let connection, !sessionKey.isEmpty, sessionKey.utf8.count <= 1_024,
              !input.idempotencyKey.isEmpty, input.idempotencyKey.utf8.count <= 200,
              input.skillID?.utf8.count ?? 0 <= 1_024, input.thinkingLevel?.utf8.count ?? 0 <= 128,
              !input.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !input.attachments.isEmpty else { throw RuntimeFailure(.invalidConnection) }
        if connection.backendKind == .localModel && sessionKey != "main" { throw RuntimeFailure(.unsupported) }
        guard input.attachments.count <= 6,
              input.attachments.allSatisfy({ $0.content.count <= 5 * 1_024 * 1_024 && ($0.name?.utf8.count ?? 0) <= 1_024 }) else {
            throw RuntimeFailure(.capacity, delivery: .rejectedBeforeDispatch)
        }
        if input.attachments.contains(where: { $0.type == .image }) { try validateModelImages(sessionKey: sessionKey, scope: scope()) }
        // A proven lower bound avoids allocating large base64/JSON intermediates;
        // the complete serializer below still decides the exact wire boundary.
        let encodedBytes = input.attachments.reduce(0) { $0 + 4 * (($1.content.count + 2) / 3) }
        guard input.text.utf8.count <= FrameCodec.maximumFrameBytes,
              encodedBytes <= FrameCodec.maximumFrameBytes - input.text.utf8.count else { throw RuntimeFailure(.capacity, delivery: .rejectedBeforeDispatch) }
        let documents: Set<String> = ["text/plain", "text/markdown", "text/csv", "application/json", "application/pdf", "application/x-ipynb+json",
                                      "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]
        let attachments: [JSONValue] = try input.attachments.map { item in
            guard let mime = RuntimeAttachmentProjection.mime(item.mimeType),
                  (item.type == .image) == mime.hasPrefix("image/"), state.capabilities.attachments,
                  item.type == .image || state.capabilities.fileAttachments || (state.capabilities.documentAttachments && documents.contains(mime)) else { throw RuntimeFailure(.unsupported) }
            var result: [String: JSONValue] = ["type": .string(item.type.rawValue), "mimeType": .string(mime), "content": .string(item.content.base64EncodedString())]
            if let name = item.name { result["name"] = .string(name) }
            return .object(result)
        }
        let gateway = connection.backendKind == .openclaw || connection.backendKind == .hermes
        let text = input.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Review these attachments." : input.text
        var params: [String: JSONValue] = ["sessionKey": .string(sessionKey), "idempotencyKey": .string(input.idempotencyKey), gateway ? "message" : "text": .string(text)]
        if !attachments.isEmpty { params["attachments"] = .array(attachments) }
        if connection.backendKind == .openclaw { params["deliver"] = .bool(false) }
        if connection.backendKind != .hermes, let thinking = input.thinkingLevel,
           !(thinking == "off" && [.codex, .claudeCode].contains(connection.backendKind)) {
            params[connection.backendKind == .openclaw ? "thinking" : "thinkingLevel"] = .string(thinking)
        }
        if let skill = input.skillID { params["skillId"] = .string(skill) }
        let result = JSONValue.object(params)
        do { try RPCConnection.validateRequest(method: "chat.send", params: result) }
        catch { throw RuntimeFailure(.capacity, delivery: .rejectedBeforeDispatch) }
        return result
    }
}
