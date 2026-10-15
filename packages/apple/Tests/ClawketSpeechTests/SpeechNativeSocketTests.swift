import CryptoKit
import Foundation
import Network
import Testing
import ClawketTransport
@testable import ClawketSpeech

@Suite(.serialized)
struct SpeechNativeSocketTests {
    @Test func actualURLSessionCarriesFiveSignedHeadersAndBinaryPcm() async throws {
        let server = try SpeechLoopback(), endpoint = try await server.start()
        defer { server.stop() }
        var request = try SpeechFixture.request(); request.url = endpoint
        let socket = URLSessionSpeechSocket(request: request)
        try await socket.open()
        #expect(try await socket.receive() == .text("{\"type\":\"ready\",\"maxSeconds\":120,\"flowControl\":\"ack.v1\"}"))
        try await socket.send(.binary(Data(repeating: 7, count: 6_400)))
        #expect(try await socket.receive() == .text("{\"type\":\"ack\",\"bytes\":6400}"))
        try await socket.send(.text("{\"type\":\"finish\"}"))
        #expect(try await socket.receive() == .text("{\"type\":\"result\",\"text\":\"native 中文\"}"))
        #expect(server.matches(request.allHTTPHeaderFields ?? [:])); #expect(server.audioBytes == 6_400)
        await socket.close()
    }
    @Test func nativeUpgradeCancellationPublishesClosedOutcomeBeforeDelegateFailure() async throws {
        let server = try SpeechLoopback(mode: .stall), endpoint = try await server.start()
        defer { server.stop() }
        let socket = URLSessionSpeechSocket(request: URLRequest(url: endpoint))
        let task = Task { try await socket.open() }
        var accepted = server.accepted.makeAsyncIterator(); _ = await accepted.next()
        task.cancel()
        await #expect(throws: SpeechFailure(.cancelled)) { try await task.value }
        await socket.close()
    }
    @Test func pendingNativeReceiveCancellationReleasesCapturedSocket() async throws {
        let server = try SpeechLoopback(), endpoint = try await server.start()
        defer { server.stop() }
        let socket = URLSessionSpeechSocket(request: URLRequest(url: endpoint))
        try await socket.open(); _ = try await socket.receive()
        let read = Task { try await socket.receive() }; read.cancel()
        await #expect(throws: SpeechFailure(.cancelled)) { _ = try await read.value }
        await socket.close()
    }
    @Test func httpRedirectCannotForwardSpeechIdentityToAnotherOrigin() async throws {
        let trap = try SpeechLoopback(), target = try await trap.start()
        defer { trap.stop() }
        let server = try SpeechLoopback(mode: .redirect(target)), endpoint = try await server.start()
        defer { server.stop() }
        var request = try SpeechFixture.request(); request.url = endpoint
        let socket = URLSessionSpeechSocket(request: request)
        await #expect(throws: SpeechFailure.self) { try await socket.open() }
        #expect(trap.connectionCount == 0); await socket.close()
    }
}

/// Isolated RFC6455 fixture bound to loopback, never an official speech service.
private final class SpeechLoopback: @unchecked Sendable {
    enum Mode: Sendable { case normal, stall, redirect(URL) }
    private let listener: NWListener
    private let queue = DispatchQueue(label: "clawket.speech-loopback")
    private let lock = NSLock()
    private let mode: Mode
    private var header: [String: String] = [:]
    private var bytes = 0
    private var count = 0
    private var connections: [NWConnection] = [] // queue only
    let accepted: AsyncStream<Void>
    private let notify: AsyncStream<Void>.Continuation
    init(mode: Mode = .normal) throws {
        self.mode = mode
        let stream = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingOldest(1))
        accepted = stream.stream; notify = stream.continuation
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
        listener = try NWListener(using: parameters)
    }
    var audioBytes: Int { lock.withLock { bytes } }
    var connectionCount: Int { lock.withLock { count } }
    func matches(_ expected: [String: String]) -> Bool {
        lock.withLock { expected.allSatisfy { header[$0.key.lowercased()] == $0.value } }
    }
    func start() async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let completion = SpeechServerStart(continuation)
            listener.stateUpdateHandler = { [weak self] state in
                switch state {
                case .ready:
                    guard let port = self?.listener.port,
                          let url = URL(string: "ws://127.0.0.1:\(port.rawValue)/v1/speech") else {
                        completion.finish(.failure(SpeechFailure(.failed))); return
                    }
                    completion.finish(.success(url))
                case .failed, .cancelled: completion.finish(.failure(SpeechFailure(.failed)))
                default: break
                }
            }
            listener.newConnectionHandler = { [weak self] connection in
                guard let self else { connection.cancel(); return }
                connections.append(connection); lock.withLock { count += 1 }
                connection.start(queue: queue); notify.yield(())
                if case .stall = mode { return }
                upgrade(connection, data: Data())
            }
            listener.start(queue: queue)
        }
    }
    func stop() {
        listener.cancel()
        queue.async { [self] in connections.forEach { $0.cancel() }; connections = []; notify.finish() }
    }
    private func upgrade(_ connection: NWConnection, data: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16_384) { [weak self] next, _, _, error in
            guard let self, error == nil, let next, !next.isEmpty, data.count + next.count <= 16_384 else { connection.cancel(); return }
            let all = data + next
            guard let text = String(data: all, encoding: .utf8), text.contains("\r\n\r\n") else { upgrade(connection, data: all); return }
            var fields: [String: String] = [:]
            for line in text.components(separatedBy: "\r\n").dropFirst() {
                if let colon = line.firstIndex(of: ":") {
                    fields[String(line[..<colon]).lowercased()] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
                }
            }
            lock.withLock { header = fields }
            if case .redirect(let target) = mode {
                let reply = "HTTP/1.1 302 Found\r\nLocation: \(target.absoluteString)\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                connection.send(content: Data(reply.utf8), completion: .contentProcessed { _ in connection.cancel() }); return
            }
            guard let key = fields["sec-websocket-key"] else { connection.cancel(); return }
            let digest = Insecure.SHA1.hash(data: Data((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").utf8))
            let reply = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: \(Data(digest).base64EncodedString())\r\n\r\n"
            connection.send(content: Data(reply.utf8), completion: .contentProcessed { [weak self] error in
                guard let self, error == nil else { connection.cancel(); return }
                send("{\"type\":\"ready\",\"maxSeconds\":120,\"flowControl\":\"ack.v1\"}", to: connection)
                frame(connection, data: Data())
            })
        }
    }
    private func frame(_ connection: NWConnection, data: Data) {
        let wire = Array(data)
        guard wire.count <= 13_000 else { connection.cancel(); return }
        if wire.count >= 2 {
            let marker = Int(wire[1] & 127), sizeBytes = marker == 126 ? 2 : marker == 127 ? 8 : 0
            let header = 2 + sizeBytes + 4
            if wire.count >= header {
                guard wire[1] & 128 != 0, wire[0] & 128 != 0, marker != 127 else { connection.cancel(); return }
                let length = marker == 126 ? Int(wire[2]) * 256 + Int(wire[3]) : marker
                guard length <= 6_400 else { connection.cancel(); return }
                if wire.count >= header + length {
                    let opcode = wire[0] & 15
                    if opcode == 8 { connection.cancel(); return }
                    let mask = 2 + sizeBytes
                    let body = Data((0..<length).map { wire[header + $0] ^ wire[mask + $0 % 4] })
                    if opcode == 2 {
                        let total = lock.withLock { bytes += body.count; return bytes }
                        send("{\"type\":\"ack\",\"bytes\":\(total)}", to: connection)
                    } else if opcode == 1, body == Data("{\"type\":\"finish\"}".utf8) {
                        send("{\"type\":\"result\",\"text\":\"native 中文\"}", to: connection)
                    } else { connection.cancel(); return }
                    frame(connection, data: Data(wire.dropFirst(header + length))); return
                }
            }
        }
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8_192) { [weak self] next, _, _, error in
            guard let self, error == nil, let next, !next.isEmpty else { connection.cancel(); return }
            frame(connection, data: data + next)
        }
    }
    private func send(_ text: String, to connection: NWConnection) {
        let data = Data(text.utf8)
        guard data.count < 126 else { connection.cancel(); return }
        connection.send(content: Data([129, UInt8(data.count)]) + data, completion: .contentProcessed { error in
            if error != nil { connection.cancel() }
        })
    }
}

private final class SpeechServerStart: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<URL, any Error>?
    init(_ continuation: CheckedContinuation<URL, any Error>) { self.continuation = continuation }
    func finish(_ result: Result<URL, any Error>) {
        let old = lock.withLock { let old = continuation; continuation = nil; return old }
        old?.resume(with: result)
    }
}
