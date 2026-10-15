import Foundation
import Network
import CryptoKit
import Testing
@testable import ClawketTransport

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

    @Test func realURLSessionCarriesNominalFiveMiBFrame() async throws {
        let server = try LoopbackWebSocketServer()
        let endpoint = try await server.start()
        defer { server.stop() }
        let socket = try URLSessionWebSocketFactory().makeSocket(url: endpoint)
        try await socket.open()
        let frame = String(repeating: "/", count: 5 * 1_024 * 1_024)
        try await socket.send(frame)
        #expect(try await socket.receive() == .text(frame))
        await socket.close(code: 1000)
    }

    @Test func realURLSessionNegotiatesMatchingNonceEcho() async throws {
        let server = try LoopbackWebSocketServer(relayMode: true)
        let endpoint = try await server.start()
        defer { server.stop() }
        let clock = RelayTestClock()
        let connection = try RPCConnection(clock: clock)
        var parts = try #require(URLComponents(url: endpoint, resolvingAgainstBaseURL: false))
        parts.queryItems = [.init(name: "capabilities", value: RelayHeartbeatConfiguration.advertisedCapabilities.joined(separator: ","))]
        let generation = try await connection.connect(to: #require(parts.url), relay: .init())
        try await realEventually { await connection.current?.liveness.clientPingNegotiated == true }
        #expect(await connection.state == .handshaking)
        #expect(server.clientPingCount == 0)
        #expect(await connection.confirmBackendReady(generation: generation))
        _ = await connection.nextReconnectDelay()
        try await realEventually { clock.hasDeadline(.seconds(5)) }
        clock.advance(by: .seconds(5))
        try await realEventually { server.clientPingCount == 1 }
        try await realEventually { await connection.current?.liveness.pendingProbe == nil }
        #expect(await connection.state == .ready)
        #expect(await connection.nextReconnectDelay() > .milliseconds(800))
        await connection.disconnect()
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
    private let relayMode: Bool
    private let pingLock = NSLock()
    private var pings = 0
    var clientPingCount: Int { pingLock.withLock { pings } }
    let accepted: AsyncStream<Void>
    private let acceptedContinuation: AsyncStream<Void>.Continuation
    private var connections: [NWConnection] = [] // Accessed only on queue.

    init(stallUpgrade: Bool = false, relayMode: Bool = false) throws {
        self.stallUpgrade = stallUpgrade
        self.relayMode = relayMode
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
            let target = header.components(separatedBy: "\r\n").first?.split(separator: " ").dropFirst().first.map(String.init) ?? "/"
            let requested = URLComponents(string: "http://localhost" + target)?.queryItems?
                .first { $0.name == "capabilities" }?.value?.split(separator: ",").map(String.init) ?? []
            let digest = Insecure.SHA1.hash(data: Data((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").utf8))
            let accept = Data(digest).base64EncodedString()
            let reply = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: \(accept)\r\n\r\n"
            connection.send(content: Data(reply.utf8), completion: .contentProcessed { [weak self] error in
                if error != nil { connection.cancel() }
                else {
                    if self?.relayMode == true, let ready = try? relayReady(
                        ping: requested.contains("relay.client-ping.v1"), transfer: requested.contains("relay.transfer-hint.v1")) {
                        connection.send(content: Self.frame(Data(ready.utf8)), completion: .contentProcessed { error in
                            if error != nil { connection.cancel() }
                        })
                    }
                    self?.readFrame(connection, buffered: Data())
                }
            })
        }
    }

    private func readFrame(_ connection: NWConnection, buffered: Data, fragment: Data? = nil) {
        let bytes = Array(buffered)
        guard bytes.count <= FrameCodec.maximumFrameBytes + 14 else { connection.cancel(); return }
        if bytes.count >= 2 {
            let marker = Int(bytes[1] & 0x7F)
            let lengthBytes = marker == 126 ? 2 : marker == 127 ? 8 : 0
            let header = 2 + lengthBytes + 4
            if bytes.count >= header {
                guard bytes[1] & 0x80 != 0 else { connection.cancel(); return }
                var length = marker
                if lengthBytes > 0 {
                    var value: UInt64 = 0
                    for byte in bytes[2..<(2 + lengthBytes)] { value = (value << 8) | UInt64(byte) }
                    guard value <= UInt64(FrameCodec.maximumFrameBytes) else { connection.cancel(); return }
                    length = Int(value)
                }
                if bytes.count >= header + length {
                    let opcode = bytes[0] & 0x0F, final = bytes[0] & 0x80 != 0
                    if opcode == 8 { connection.cancel(); return }
                    let mask = 2 + lengthBytes
                    let payload = Data((0..<length).map { bytes[header + $0] ^ bytes[mask + $0 % 4] })
                    var nextFragment = fragment
                    var output: Data?
                    var outputOpcode: UInt8 = 1
                    if opcode == 9 { output = payload; outputOpcode = 10 }
                    else if opcode == 1, fragment == nil {
                        if final { output = payload } else { nextFragment = payload }
                    } else if opcode == 0, let fragment {
                        let complete = fragment + payload
                        guard complete.count <= FrameCodec.maximumFrameBytes else { connection.cancel(); return }
                        if final { output = complete; nextFragment = nil } else { nextFragment = complete }
                    } else { connection.cancel(); return }
                    let rest = Data(bytes.dropFirst(header + length))
                    if let output {
                        let response = relayResponseIfNeeded(output)
                        connection.send(content: Self.frame(response, opcode: outputOpcode), completion: .contentProcessed { [weak self, nextFragment] error in
                            if error != nil { connection.cancel() }
                            else { self?.readFrame(connection, buffered: rest, fragment: nextFragment) }
                        })
                    } else { readFrame(connection, buffered: rest, fragment: nextFragment) }
                    return
                }
            }
        }
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8_192) { [weak self] data, _, _, error in
            guard let self, error == nil, let data, !data.isEmpty else { connection.cancel(); return }
            readFrame(connection, buffered: buffered + data, fragment: fragment)
        }
    }

    private func relayResponseIfNeeded(_ data: Data) -> Data {
        guard relayMode, let text = String(data: data, encoding: .utf8),
              text.hasPrefix(RelayControl.prefix),
              let value = try? FrameCodec.decode(String(text.dropFirst(RelayControl.prefix.count))),
              value["event"] == .string("relay.client-ping"),
              let reply = try? relayControl("relay.client-pong", value["payload"] ?? .null) else { return data }
        pingLock.withLock { pings += 1 }
        return Data(reply.utf8)
    }

    private static func frame(_ data: Data, opcode: UInt8 = 1) -> Data {
        var header: [UInt8] = [0x80 | opcode]
        if data.count < 126 { header.append(UInt8(data.count)) }
        else if data.count <= 65_535 {
            header += [126, UInt8(data.count >> 8), UInt8(data.count & 255)]
        } else {
            header.append(127)
            let length = UInt64(data.count)
            for shift in stride(from: 56, through: 0, by: -8) { header.append(UInt8((length >> shift) & 255)) }
        }
        return Data(header) + data
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

private func realEventually(_ check: () async -> Bool) async throws {
    let deadline = ContinuousClock.now + .seconds(5)
    while ContinuousClock.now < deadline {
        if await check() { return }
        try await Task.sleep(for: .milliseconds(5))
    }
    throw RelayTestFailure.waiting
}
