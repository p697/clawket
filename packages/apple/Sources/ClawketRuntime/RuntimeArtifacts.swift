import Foundation
import ClawketTransport

/// Ephemeral authority captured from this coordinator's authenticated generation.
/// Never persist a handle; transcripts retain only the original artifactID.
public struct RuntimeArtifactHandle: Sendable {
    public let artifactID: String
    public let name: String
    public let mimeType: String
    public let size: Int
    let token: UUID
}

struct RuntimeArtifactEntry: Sendable {
    let handle: RuntimeArtifactHandle
    let scope: RuntimeCoordinator.Scope
    let sessionKey: String
    let remoteID: String?
    let data: Data?
    let expires: Duration
}

extension RuntimeCoordinator {
    public func openArtifact(sessionKey: String, artifactID: String) async throws -> RuntimeArtifactHandle {
        let scope = try scope()
        guard state.capabilities.artifacts, let connection else { throw RuntimeFailure(.unsupported) }
        guard !sessionKey.isEmpty, sessionKey.utf8.count <= 1_024, !artifactID.isEmpty, artifactID.utf8.count <= 512 else { throw RuntimeFailure(.invalidConnection) }
        expireArtifacts()
        guard artifactEntries.count + artifactOpenings.count < 16, artifactOpenings.count < 2 else { throw RuntimeFailure(.capacity) }
        let token = UUID(); artifactOpenings.insert(token)
        defer { artifactOpenings.remove(token) }
        let params: JSONValue = .object(["sessionKey": .string(sessionKey), "artifactId": .string(artifactID)])
        let entry: RuntimeArtifactEntry
        if connection.backendKind != .openclaw || (supportedMethods.contains("clawket.artifacts.open") && supportedMethods.contains("clawket.artifacts.read")) {
            let response = try await rpc("clawket.artifacts.open", params: params, timeout: .seconds(connection.backendKind == .openclaw ? 60 : 20), scope: scope)
            let file = try artifactMetadata(response)
            let handle = RuntimeArtifactHandle(artifactID: artifactID, name: file.name, mimeType: file.mime, size: file.size, token: token)
            entry = RuntimeArtifactEntry(handle: handle, scope: scope, sessionKey: sessionKey, remoteID: file.id, data: nil, expires: clock.now() + .seconds(120))
        } else {
            let retainedBytes: Int = artifactEntries.values.reduce(0) { partial, entry in
                partial + (entry.data?.count ?? 0)
            }
            guard connection.transportKind != .relay, retainedBytes <= 10 * 1_024 * 1_024 else { throw RuntimeFailure(.capacity) }
            let deadline = clock.now() + .seconds(45)
            func remaining() throws -> Duration {
                let duration = deadline - clock.now()
                guard duration > .zero else { throw RuntimeFailure(.timeout) }; return duration
            }
            let summary = try await rpc("artifacts.get", params: params, timeout: try remaining(), scope: scope)
            guard summary["artifact"]?["id"]?.stringValue == artifactID else { throw RuntimeFailure(.invalidResponse) }
            let preflight = summary["artifact"]?["sizeBytes"]?.safeInteger
            guard preflight == nil || preflight! <= 10 * 1_024 * 1_024,
                  summary["artifact"]?["download"]?["mode"]?.stringValue == "url" || (preflight != nil && preflight! <= 5 * 1_024 * 1_024) else { throw RuntimeFailure(.invalidResponse) }
            if summary["artifact"]?["sizeBytes"] != nil && preflight == nil { throw RuntimeFailure(.invalidResponse) }
            let response = try await rpc("artifacts.download", params: params, timeout: try remaining(), scope: scope)
            guard response["artifact"]?["id"]?.stringValue == artifactID else { throw RuntimeFailure(.invalidResponse) }
            let expected = response["artifact"]?["sizeBytes"]?.safeInteger
            guard expected == nil || expected! <= 10 * 1_024 * 1_024 else { throw RuntimeFailure(.invalidResponse) }
            if response["artifact"]?["sizeBytes"] != nil && expected == nil { throw RuntimeFailure(.invalidResponse) }
            let bytes: Data
            if response["encoding"]?.stringValue == "base64", let encoded = response["data"]?.stringValue {
                bytes = try artifactBase64(encoded, length: expected.map(Int.init), maximum: 10 * 1_024 * 1_024)
            } else {
                guard let rawURL = response["url"]?.stringValue else { throw RuntimeFailure(.invalidResponse) }
                let url = try artifactDownloadURL(rawURL, gateway: connection.url)
                let timeout = try remaining()
                let http = artifactHTTP
                let task = Task { try await http.download(url, timeout: timeout) }
                artifactDownloads[token] = task
                defer { artifactDownloads.removeValue(forKey: token) }
                do { bytes = try await withTaskCancellationHandler { try await task.value } onCancel: { task.cancel() } }
                catch is CancellationError { throw RuntimeFailure(.superseded) }
                catch let error as RuntimeFailure { throw error }
                catch { throw RuntimeFailure(.network, retryable: true) }
            }
            try assertCurrent(scope); guard !Task.isCancelled else { throw RuntimeFailure(.superseded) }; _ = try remaining()
            let currentRetainedBytes: Int = artifactEntries.values.reduce(0) { partial, entry in
                partial + (entry.data?.count ?? 0)
            }
            let totalBytes = currentRetainedBytes + bytes.count
            guard artifactOpenings.contains(token), bytes.count <= 10 * 1_024 * 1_024,
                  expected == nil || expected == Int64(bytes.count),
                  totalBytes <= 20 * 1_024 * 1_024 else { throw RuntimeFailure(.invalidResponse) }
            let mime = RuntimeAttachmentProjection.mime(response["artifact"]?["mimeType"]?.stringValue ?? "") ?? "application/octet-stream"
            let rawName = response["artifact"]?["title"]?.stringValue ?? ""
            let name = validArtifactName(rawName, maximum: 200) ? rawName : "attachment." + (["image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf"][mime] ?? "bin")
            let handle = RuntimeArtifactHandle(artifactID: artifactID, name: name, mimeType: mime, size: bytes.count, token: token)
            entry = RuntimeArtifactEntry(handle: handle, scope: scope, sessionKey: sessionKey, remoteID: nil, data: bytes, expires: clock.now() + .seconds(120))
        }
        try assertCurrent(scope); guard !Task.isCancelled else { throw RuntimeFailure(.superseded) }
        guard artifactOpenings.contains(token), state.capabilities.artifacts else { throw RuntimeFailure(.superseded) }
        artifactEntries[token] = entry
        return entry.handle
    }

    /// Exact 128 KiB protocol chunks, including one empty terminal chunk for a
    /// zero-byte file. A successful final read retires this ephemeral handle.
    public func readArtifact(_ handle: RuntimeArtifactHandle, offset: Int) async throws -> Data {
        expireArtifacts()
        guard let entry = artifactEntries[handle.token], entry.handle.artifactID == handle.artifactID else { throw RuntimeFailure(.superseded) }
        try assertCurrent(entry.scope)
        guard state.capabilities.artifacts, offset >= 0, (offset < entry.handle.size || (offset == 0 && entry.handle.size == 0)),
              offset % (128 * 1_024) == 0 else { throw RuntimeFailure(.invalidConnection) }
        let length = min(128 * 1_024, entry.handle.size - offset), bytes: Data
        if let data = entry.data { bytes = data.subdata(in: offset..<(offset + length)) }
        else {
            guard let id = entry.remoteID else { throw RuntimeFailure(.invalidResponse) }
            let response = try await rpc("clawket.artifacts.read", params: .object(["sessionKey": .string(entry.sessionKey), "id": .string(id), "offset": .number(Double(offset))]), scope: entry.scope)
            guard response["offset"]?.safeInteger == Int64(offset), response["total"]?.safeInteger == Int64(entry.handle.size),
                  response["done"]?.boolValue == (offset + length == entry.handle.size), let encoded = response["data"]?.stringValue else { throw RuntimeFailure(.invalidResponse) }
            bytes = try artifactBase64(encoded, length: length, maximum: 128 * 1_024)
        }
        try assertCurrent(entry.scope); guard !Task.isCancelled else { throw RuntimeFailure(.superseded) }
        guard artifactEntries[handle.token] != nil, clock.now() < entry.expires else { throw RuntimeFailure(.superseded) }
        if offset + length == entry.handle.size { artifactEntries.removeValue(forKey: handle.token) }
        return bytes
    }

    public func closeArtifact(_ handle: RuntimeArtifactHandle) { artifactEntries.removeValue(forKey: handle.token) }

    func clearArtifacts() {
        for task in artifactDownloads.values { task.cancel() }
        artifactDownloads.removeAll(); artifactEntries.removeAll(); artifactOpenings.removeAll()
    }
    func expireArtifacts() {
        artifactEntries = artifactEntries.filter { isCurrent($0.value.scope) && clock.now() < $0.value.expires }
    }
}

func validArtifactName(_ name: String, maximum: Int = 255) -> Bool {
    !name.isEmpty && name.utf8.count <= maximum && !name.hasPrefix(".") && !name.contains("/") && !name.contains("\\")
        && !name.unicodeScalars.contains { $0.value < 32 || $0.value == 127 }
}
func artifactMetadata(_ value: JSONValue) throws -> (id: String, name: String, mime: String, size: Int) {
    guard let id = value["id"]?.stringValue, !id.isEmpty, id.utf8.count <= 128,
          let name = value["name"]?.stringValue, validArtifactName(name),
          let mime = value["mimeType"]?.stringValue, let normalized = RuntimeAttachmentProjection.mime(mime),
          let size = value["size"]?.safeInteger, size <= 10 * 1_024 * 1_024 else { throw RuntimeFailure(.invalidResponse) }
    return (id, name, normalized, Int(size))
}
func artifactBase64(_ value: String, length: Int?, maximum: Int) throws -> Data {
    guard value.utf8.count <= 4 * ((maximum + 2) / 3),
          length == nil || value.utf8.count == 4 * ((length! + 2) / 3),
          let bytes = Data(base64Encoded: value), bytes.count <= maximum,
          bytes.base64EncodedString() == value, length == nil || bytes.count == length else { throw RuntimeFailure(.invalidResponse) }
    return bytes
}
func artifactDownloadURL(_ raw: String, gateway: URL) throws -> URL {
    guard raw.utf8.count <= 8_192, var base = URLComponents(url: gateway, resolvingAgainstBaseURL: false) else { throw RuntimeFailure(.invalidResponse) }
    base.scheme = base.scheme?.lowercased() == "wss" || base.scheme?.lowercased() == "https" ? "https" : "http"
    base.query = nil; base.fragment = nil; base.user = nil; base.password = nil
    guard let baseURL = base.url, let url = URL(string: raw, relativeTo: baseURL)?.absoluteURL,
          let target = URLComponents(url: url, resolvingAgainstBaseURL: false), target.user == nil, target.password == nil, target.fragment == nil,
          target.scheme?.lowercased() == base.scheme, target.host?.lowercased() == base.host?.lowercased(),
          (target.port ?? (target.scheme?.lowercased() == "https" ? 443 : 80)) == (base.port ?? (base.scheme == "https" ? 443 : 80)) else { throw RuntimeFailure(.invalidResponse) }
    let prefix = base.path.hasSuffix("/") ? String(base.path.dropLast()) : base.path
    let path = target.path
    guard path.hasPrefix(prefix + "/api/chat/media/outgoing/") || path.hasPrefix(prefix + "/api/artifacts/download/"),
          !path.contains("\\"), !path.split(separator: "/").contains("..") else { throw RuntimeFailure(.invalidResponse) }
    return url
}
