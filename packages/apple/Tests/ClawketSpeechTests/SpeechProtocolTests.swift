import CryptoKit
import Foundation
import Testing
import ClawketTransport
@testable import ClawketSpeech

@Suite(.serialized)
struct SpeechProtocolTests {
    @Test func headersSignExactExistingWorkerPreimageAndNormalizeDefaultPort() throws {
        let config = try SpeechServiceConfiguration("WSS://SPEECH.invalid:443/v1/speech")
        #expect(config.authority == "speech.invalid")
        let request = try config.signedRequest(identity: SpeechFixture.identity, timestampMilliseconds: 1_700_000_000_000,
                                               nonce: String(repeating: "a", count: 32))
        #expect(request.allHTTPHeaderFields?.count == 5)
        #expect(request.value(forHTTPHeaderField: "x-speech-protocol") == "2")
        let hex = try #require(request.value(forHTTPHeaderField: "x-speech-signature"))
        let signature = Data(stride(from: 0, to: hex.count, by: 2).map { offset in
            UInt8(hex.dropFirst(offset).prefix(2), radix: 16)!
        })
        let publicKey = try Curve25519.Signing.PublicKey(rawRepresentation: SpeechFixture.identity.publicKey)
        #expect(publicKey.isValidSignature(signature, for: Data("clawket-speech-v1|speech.invalid|1700000000000|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".utf8)))
    }
    @Test(arguments: ["ws://speech.invalid/v1/speech", "wss://u:p@speech.invalid/v1/speech", "wss://speech.invalid/v1/speech?token=x",
                      "wss://speech.invalid/v1/speech#x", "wss://speech.invalid/v1/%73peech", "wss://speech.invalid/other"])
    func unsafeServiceConfigurationRejectsBeforeIdentity(_ value: String) {
        #expect(throws: SpeechFailure.self) { try SpeechServiceConfiguration(value) }
    }
    @Test func cumulativeAckWindowAndChineseFinalUseUTF16RatherThanUTF8Limit() async throws {
        let peer = SpeechPeer(), clock = SpeechTestClock()
        let connection = try await SpeechConnection.connect(request: SpeechFixture.request(), factory: SpeechPeerFactory(peer), clock: clock)
        for _ in 0..<10 { try await connection.audio(Data(repeating: 0, count: 6_400)) }
        #expect(try await !connection.writable(for: 2))
        await peer.emit("{\"type\":\"ack\",\"bytes\":6400}")
        await speechEventually { (try? await connection.writable(for: 6_400)) == true }
        let final = Task { try await connection.finish() }
        await speechEventually { await peer.sent.contains(.text("{\"type\":\"finish\"}")) }
        let text = String(repeating: "汉", count: 16_000)
        await peer.emit("{\"type\":\"result\",\"text\":\"\(text)\"}")
        #expect(try await final.value == text); #expect(await peer.closed)
    }
    @Test func nativeSendCompletionAfterFinalCannotEraseSuccess() async throws {
        let peer = SpeechPeer { frame, peer in
            if case .text = frame {
                await peer.emit("{\"type\":\"result\",\"text\":\"done\"}")
                await speechEventually { await peer.closed }
                throw SpeechFailure(.cancelled)
            }
        }
        let connection = try await SpeechConnection.connect(request: SpeechFixture.request(), factory: SpeechPeerFactory(peer), clock: SpeechTestClock())
        try await connection.audio(Data([0, 0])); #expect(try await connection.finish() == "done")
    }
    @Test func regressedOrFutureAckClosesWithoutInventingCapacity() async throws {
        let peer = SpeechPeer(), connection = try await SpeechConnection.connect(request: SpeechFixture.request(), factory: SpeechPeerFactory(peer), clock: SpeechTestClock())
        try await connection.audio(Data([0, 0])); await peer.emit("{\"type\":\"ack\",\"bytes\":3}")
        await speechEventually { await peer.closed }
        await #expect(throws: SpeechFailure(.invalidProtocol)) { try await connection.finish() }
    }
    @Test func readyDeadlineIsAbsoluteAndCancelsCapturedSocket() async throws {
        let peer = SpeechPeer(ready: false), clock = SpeechTestClock()
        let task = Task { try await SpeechConnection.connect(request: SpeechFixture.request(), factory: SpeechPeerFactory(peer), clock: clock) }
        await speechEventually { clock.pendingCount == 1 }
        clock.advance(.seconds(20))
        await #expect(throws: SpeechFailure(.connectTimeout)) { _ = try await task.value }
        #expect(await peer.closed)
    }
    @Test func cancellationWhileWaitingForReadyFinishesAndCloses() async throws {
        let peer = SpeechPeer(ready: false), factory = SpeechPeerFactory(peer)
        let task = Task { try await SpeechConnection.connect(request: SpeechFixture.request(), factory: factory, clock: SpeechTestClock()) }
        await speechEventually { factory.count == 1 }; task.cancel()
        await #expect(throws: SpeechFailure.self) { _ = try await task.value }
        #expect(await peer.closed)
    }
    @Test func lateReadyCannotWinWhileDeadlineTaskRemainsSuspended() async throws {
        let peer = SpeechPeer(ready: false), clock = SpeechTestClock()
        let task = Task { try await SpeechConnection.connect(request: SpeechFixture.request(), factory: SpeechPeerFactory(peer), clock: clock) }
        await speechEventually { clock.pendingCount == 1 }
        clock.advanceWithoutWaking(.seconds(21))
        await peer.emit("{\"type\":\"ready\",\"maxSeconds\":120}")
        await #expect(throws: SpeechFailure(.connectTimeout)) { _ = try await task.value }
        #expect(await peer.closed)
    }
    @Test func lateFinalCannotWinWhileFinishingDeadlineTaskRemainsSuspended() async throws {
        let peer = SpeechPeer(), clock = SpeechTestClock()
        let connection = try await SpeechConnection.connect(request: SpeechFixture.request(), factory: SpeechPeerFactory(peer), clock: clock)
        try await connection.audio(Data([0, 0]))
        let task = Task { try await connection.finish() }
        await speechEventually { await peer.sent.contains(.text("{\"type\":\"finish\"}")) && clock.pendingCount == 1 }
        clock.advanceWithoutWaking(.seconds(17))
        await peer.emit("{\"type\":\"result\",\"text\":\"too late\"}")
        await #expect(throws: SpeechFailure(.finishTimeout)) { _ = try await task.value }
        #expect(await peer.closed)
    }
    @Test func expiredProviderCannotExtendItsWindowByCallingFinish() async throws {
        let peer = SpeechPeer(), clock = SpeechTestClock()
        let connection = try await SpeechConnection.connect(request: SpeechFixture.request(), factory: SpeechPeerFactory(peer), clock: clock)
        await speechEventually { clock.pendingCount == 1 }
        clock.advanceWithoutWaking(.seconds(146))
        await #expect(throws: SpeechFailure(.timeout)) { _ = try await connection.finish() }
        #expect(await peer.sent.isEmpty)
    }
}
