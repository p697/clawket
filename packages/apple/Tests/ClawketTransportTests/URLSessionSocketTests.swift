import Foundation
import Network
import CryptoKit
import Testing
import ClawketTransport

@Suite(.serialized)
struct URLSessionSocketTests {
    @Test func realURLSessionCompletesUpgradeAndUTF8Roundtrip() async throws {
        let server = try LoopbackWebSocketServer()
        let endpoint = try await server.start()
        defer { server.stop() }
        let socket = try URLSessionWebSocketFactory().makeSocket(url: endpoint)
        try await socket.open()
        let text = "{\"message\":\"native 中文 🦊\"}"
        try await socket.send(text)
        #expect(try await socket.receive() == .text(text))
        await socket.close(code: 1000)
    }

    @Test func cancellingNativeOpenCompletesWithoutAnUpgrade() async throws {
        let server = try LoopbackWebSocketServer(stallUpgrade: true)
        let endpoint = try await server.start()
        defer { server.stop() }
        let socket = try URLSessionWebSocketFactory().makeSocket(url: endpoint)
        let open = Task { try await socket.open() }
        var accepted = server.accepted.makeAsyncIterator()
        _ = await accepted.next()
        open.cancel()
        await #expect(throws: WebSocketFailure.closed) { try await open.value }
        await socket.close(code: 1000)
    }

    @Test func cancellingNativeReceiveReleasesThePendingRead() async throws {
        let server = try LoopbackWebSocketServer()
        let endpoint = try await server.start()
        defer { server.stop() }
        let socket = try URLSessionWebSocketFactory().makeSocket(url: endpoint)
        try await socket.open()
        let read = Task { try await socket.receive() }
        read.cancel()
        await #expect(throws: WebSocketFailure.closed) { try await read.value }
        await socket.close(code: 1000)
    }

    @Test(arguments: ["https://example.test/ws", "wss://user:password@example.test/ws", "wss://example.test/ws#fragment"])
    func invalidEndpointIsRejectedBeforeNetwork(_ raw: String) throws {
        #expect(throws: WebSocketFailure.invalidEndpoint) {
            try URLSessionWebSocketFactory().makeSocket(url: URL(string: raw)!)
        }
    }
}

/// Small RFC 6455 echo peer. No external interpreter, service, credentials or inference.
private final class LoopbackWebSocketServer: @unchecked Sendable {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "clawket.native-transport-test")
    private let stallUpgrade: Bool
    let accepted: AsyncStream<Void>
    private let acceptedContinuation: AsyncStream<Void>.Continuation
    private var connections: [NWConnection] = [] // Accessed only on queue.

    init(stallUpgrade: Bool = false) throws {
        self.stallUpgrade = stallUpgrade
        let stream = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingOldest(1))
        accepted = stream.stream
        acceptedContinuation = stream.continuation
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
        listener = try NWListener(using: parameters)
    }

    func start() async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let completion = StartCompletion(continuation)
            listener.stateUpdateHandler = { [weak self] state in
                switch state {
                case .ready:
                    guard let port = self?.listener.port,
                          let endpoint = URL(string: "ws://127.0.0.1:\(port.rawValue)/ws") else {
                        completion.finish(.failure(WebSocketFailure.failed)); return
                    }
                    completion.finish(.success(endpoint))
                case .failed, .cancelled: completion.finish(.failure(WebSocketFailure.failed))
                default: break
                }
            }
            listener.newConnectionHandler = { [weak self] connection in
                guard let self else { connection.cancel(); return }
                connections.append(connection)
                connection.start(queue: queue)
                acceptedContinuation.yield(())
                if !stallUpgrade { readUpgrade(connection, buffered: Data()) }
            }
            listener.start(queue: queue)
        }
    }

    func stop() {
        listener.cancel()
        queue.async { [self] in
            for connection in connections { connection.cancel() }
            connections.removeAll()
        }
    }

    private func readUpgrade(_ connection: NWConnection, buffered: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16_384) { [weak self] data, _, complete, error in
            guard let self, error == nil, let data, !data.isEmpty else { connection.cancel(); return }
            let bytes = buffered + data
            guard bytes.count <= 16_384 else { connection.cancel(); return }
            guard let header = String(data: bytes, encoding: .utf8), header.contains("\r\n\r\n") else {
                if complete { connection.cancel() } else { readUpgrade(connection, buffered: bytes) }
                return
            }
            guard let keyLine = header.components(separatedBy: "\r\n").first(where: { $0.lowercased().hasPrefix("sec-websocket-key:") }),
                  let colon = keyLine.firstIndex(of: ":") else { connection.cancel(); return }
            let key = keyLine[keyLine.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            let digest = Insecure.SHA1.hash(data: Data((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").utf8))
            let accept = Data(digest).base64EncodedString()
            let reply = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: \(accept)\r\n\r\n"
            connection.send(content: Data(reply.utf8), completion: .contentProcessed { [weak self] error in
                if error != nil { connection.cancel() }
                else { self?.readFrame(connection, buffered: Data()) }
            })
        }
    }

    private func readFrame(_ connection: NWConnection, buffered: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8_192) { [weak self] data, _, complete, error in
            guard let self, error == nil, let data, !data.isEmpty else { connection.cancel(); return }
            let bytes = Array(buffered + data)
            guard bytes.count <= 8_192 else { connection.cancel(); return }
            guard bytes.count >= 2 else { readFrame(connection, buffered: Data(bytes)); return }
            let opcode = bytes[0] & 0x0F
            let length = Int(bytes[1] & 0x7F)
            // The real roundtrip is deliberately small. Reject malformed/unbounded test traffic.
            guard length < 126, bytes[1] & 0x80 != 0 else { connection.cancel(); return }
            let required = 6 + length
            guard bytes.count >= required else {
                if complete { connection.cancel() } else { readFrame(connection, buffered: Data(bytes)) }
                return
            }
            if opcode == 8 { connection.cancel(); return }
            let payload = (0..<length).map { bytes[6 + $0] ^ bytes[2 + $0 % 4] }
            let responseOpcode: UInt8 = opcode == 9 ? 10 : 1
            let response = Data([0x80 | responseOpcode, UInt8(length)] + payload)
            connection.send(content: response, completion: .contentProcessed { [weak self] error in
                if error != nil { connection.cancel() }
                else { self?.readFrame(connection, buffered: Data(bytes.dropFirst(required))) }
            })
        }
    }
}

private final class StartCompletion: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<URL, any Error>?
    init(_ continuation: CheckedContinuation<URL, any Error>) { self.continuation = continuation }
    func finish(_ result: Result<URL, any Error>) {
        let continuation = lock.withLock {
            let value = self.continuation
            self.continuation = nil
            return value
        }
        continuation?.resume(with: result)
    }
}
