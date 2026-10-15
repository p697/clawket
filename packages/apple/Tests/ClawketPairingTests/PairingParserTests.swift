import Foundation
import XCTest
@testable import ClawketPairing

final class PairingParserTests: XCTestCase, @unchecked Sendable {
    func testAllCompactBackendShapesAndLegacyForms() throws {
        for backend in PairingBackend.allCases where backend != .hermes {
            let raw = "{\"k\":\"cp\",\"v\":2,\"b\":\"\(backend.rawValue)\",\"s\":\"https://self-hosted.invalid\",\"g\":\"gateway\",\"a\":\"code\",\"pv\":2,\"sb\":true}"
            let payload = try PairingParser.parseQR(raw)
            XCTAssertEqual(payload.backend, backend); XCTAssertEqual(payload.transport, .relay)
            XCTAssertEqual(payload.relay?.protocolVersion, 2); XCTAssertEqual(payload.relay?.supportsBootstrap, true)
            try PairingParser.validate(payload, expectation: PairingExpectation(backend: backend, environment: .preview))
        }
        let old = try PairingParser.parseQR("{\"kind\":\"clawket_pair\",\"version\":1,\"server\":\"https://registry.clawket.ai\",\"gatewayId\":\"g\",\"accessCode\":\"a\",\"token\":\"t\"}")
        XCTAssertEqual(old.backend, .openclaw); XCTAssertEqual(old.token, "t")
        let hermes = try PairingParser.parseQR("{\"kind\":\"clawket_hermes_pair\",\"version\":1,\"server\":\"https://hermes-registry.clawket.ai\",\"bridgeId\":\"b\",\"accessCode\":\"a\"}")
        XCTAssertEqual(hermes.backend, .hermes); XCTAssertEqual(hermes.transport, .relay)
    }

    func testDirectAuthBootstrapIPv6AndHermesHTTPMetadata() throws {
        let local = try PairingParser.parseQR("{\"kind\":\"clawket_hermes_local\",\"version\":1,\"mode\":\"hermes\",\"url\":\"ws://192.168.1.2:4319/v1/hermes/ws?token=test\",\"hermes\":{\"bridgeUrl\":\"http://192.168.1.2:4319\",\"displayName\":\"Computer\"}}")
        XCTAssertEqual(local.transport, .local); XCTAssertEqual(local.hermesBridgeURL?.scheme, "http"); XCTAssertEqual(local.displayName, "Computer")
        let direct = try PairingParser.parseQR("openclaw://connect?host=192.168.1.2&port=18789&token=test&mode=local")
        XCTAssertEqual(direct.url?.absoluteString, "ws://192.168.1.2:18789"); XCTAssertEqual(direct.transport, .local)
        let stringPort = try PairingParser.parseQR("{\"host\":\"192.168.1.2\",\"port\":\"4000\",\"token\":\"test\"}")
        XCTAssertEqual(stringPort.url?.port, 4000)
        let ipv6 = try PairingParser.parseQR("{\"host\":\"::1\",\"port\":18789,\"password\":\"test\"}")
        XCTAssertEqual(ipv6.url?.host, "::1")
        let bootstrap = try PairingParser.parseQR("{\"url\":\"wss://gateway.invalid\",\"bootstrap\":{\"token\":\"temporary\",\"strategy\":\"mobile-setup\",\"access\":\"limited\"}}")
        XCTAssertEqual(bootstrap.bootstrap?.strategy, .mobileSetup); XCTAssertEqual(bootstrap.bootstrap?.access, .limited)
        let saved = try PairingParser.parseQR("{\"url\":\"wss://custom.invalid/ws\",\"relay\":{\"serverUrl\":\"https://custom.invalid\",\"gatewayId\":\"g\",\"clientToken\":\"synthetic\"}}")
        XCTAssertEqual(saved.transport, .relay)
        let codex = try PairingParser.parseQR("{\"url\":\"ws://192.168.1.2:4320/ws\",\"mode\":\"local\",\"backendKind\":\"codex\",\"token\":\"test\",\"displayName\":\"Codex · Office\"}")
        XCTAssertEqual(codex.backend, .codex); XCTAssertEqual(codex.displayName, "Codex · Office")
    }

    func testOfficialEnvironmentAndBackendValidationCustomAndLocalModelExceptions() throws {
        func payload(_ server: String, _ backend: PairingBackend = .openclaw) throws -> PairingPayload {
            try PairingParser.parseQR("{\"k\":\"cp\",\"v\":2,\"b\":\"\(backend.rawValue)\",\"s\":\"\(server)\",\"g\":\"g\",\"a\":\"a\"}")
        }
        let preview = try payload("https://clawket-registry-preview.clawket.workers.dev")
        XCTAssertThrowsError(try PairingParser.validate(preview, expectation: PairingExpectation(backend: .openclaw))) { XCTAssertEqual($0 as? PairingError, .previewRequiresDebugMode) }
        XCTAssertThrowsError(try PairingParser.validate(preview, expectation: PairingExpectation(backend: .openclaw, debugMode: true))) { XCTAssertEqual($0 as? PairingError, .environmentMismatch) }
        try PairingParser.validate(preview, expectation: PairingExpectation(backend: .openclaw, environment: .preview, debugMode: true))
        XCTAssertThrowsError(try PairingParser.validate(preview, expectation: PairingExpectation(backend: .codex)))
        try PairingParser.validate(payload("https://self-hosted.invalid"), expectation: PairingExpectation(backend: .openclaw, environment: .preview))
        try PairingParser.validate(payload("https://local-model-registry.clawket.ai", .localModel), expectation: PairingExpectation(backend: .localModel))
        try PairingParser.validate(payload("https://pi-registry.clawket.ai", .pi), expectation: PairingExpectation(backend: .pi, environment: .preview, debugMode: true))
        XCTAssertThrowsError(try PairingParser.validate(payload("https://codex-registry.clawket.ai"), expectation: PairingExpectation(backend: .openclaw)))
    }

    func testSecureLinkAndLegacyCustomSchemeHaveSameDescriptor() throws {
        let vector = try PairingVectors.load()
        let session = vector.secure.sessionID, key = vector.secretBox.linkKey
        let web = try PairingParser.parseLink("https://codex-registry.clawket.ai/pair/\(session)#k=\(key)")
        let scheme = try PairingParser.parseLink("clawket://pair?server=https%3A%2F%2Fcodex-registry.clawket.ai&session=\(session)&key=\(key)")
        XCTAssertEqual(web, scheme)
        for raw in ["https://custom.invalid/pair/\(session)#k=\(key)", "http://codex-registry.clawket.ai/pair/\(session)#k=\(key)",
                    "https://codex-registry.clawket.ai/pair/\(session)#k=\(key)&k=\(key)", "clawket://pair?server=https://custom.invalid&session=\(session)&key=\(key)"] {
            XCTAssertThrowsError(try PairingParser.parseLink(raw))
        }
    }

    func testCorruptUnsupportedExpiredAndOversizedPayloadsFailClosed() {
        for raw in ["", "{}", "[]", "{", "{\"k\":\"cp\",\"v\":true,\"s\":\"https://r.invalid\",\"g\":\"g\",\"a\":\"a\"}",
                    "{\"url\":\"ws://gateway.invalid\",\"mode\":\"hermes\",\"backendKind\":\"codex\",\"token\":\"test\"}",
                    "{\"url\":\"file:///tmp/test\",\"token\":\"test\"}", "{\"url\":\"ws://name:secret@host.invalid\",\"token\":\"test\"}",
                    "{\"url\":\"ws://host.invalid\",\"token\":\"test\",\"expiresAt\":1}", String(repeating: "x", count: PairingLimits.qrBytes + 1),
                    "openclaw://connect?host=host.invalid&token=a&token=b"] { XCTAssertThrowsError(try PairingParser.parseQR(raw), raw.prefix(40).description) }
        XCTAssertEqual(PairingParser.normalizeCode("ab cd-12_34 eFgh"), "ABCD1234EFGH")
    }
}
