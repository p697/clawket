import Foundation
import Testing
import ClawketTransport
@testable import ClawketRuntime

private let participantRoute = "agent:main:slack:channel:room:thread:thread-a"

@Suite(.serialized)
struct MessageAttributionTests {
    @Test(arguments: BackendKind.allCases)
    func explicitAttributionIsBackendNeutralAndCannotClaimLocalOwnership(_ backend: BackendKind) throws {
        let raw: JSONValue = .object(["id": .string("provided"), "role": .string("user"), "text": .string("Hello @viewer"),
            "sentLocally": .bool(true), "attribution": .object(["channel": .string("CUSTOM-CHAT"), "accountId": .string("account"),
                "conversationId": .string("room"), "threadId": .string("thread"), "messageId": .string("platform-message"),
                "sender": .object(["id": .string("person"), "name": .string("Member"), "username": .string("handle"),
                    "avatarUrl": .string("https://cdn.example.com/avatar.png?width=64"), "kind": .string("human")])])])
        let message = try WireModels.history(.object(["messages": .array([raw])]), key: "owned", backend: backend).messages[0]
        let author = try #require(message.attribution)
        #expect(author.channel == "custom-chat"); #expect(author.accountID == "account")
        #expect(author.conversationID == "room"); #expect(author.threadID == "thread"); #expect(author.messageID == "platform-message")
        #expect(author.sender?.id == "person"); #expect(author.sender?.kind == .human)
        #expect(author.sender?.avatarURL?.host == "cdn.example.com")
        #expect(!message.sentLocally); #expect(message.providedID == "provided"); #expect(message.idSource == .provided)
        #expect(try JSONDecoder().decode(RuntimeMessage.self, from: JSONEncoder().encode(message)) == message)
    }

    @Test(arguments: [BackendKind.openclaw, .hermes])
    func recordedSlackShapePreservesTwoAuthorsWithEqualTextAndClock(_ backend: BackendKind) throws {
        // Anonymized current Mobile gateway-message-attribution.test.ts recording.
        func packet(_ id: String, _ account: String) -> JSONValue {
            .object(["role": .string("user"), "content": .string("Same message"), "timestamp": .number(100_000),
                "__openclaw": .object(["id": .string("message-" + id), "senderIsOwner": .bool(true), "senderId": .string(id),
                    "senderName": .string("Member " + id), "senderUsername": .string("handle-" + id),
                    "senderIdentity": .object(["pluginId": .string("slack"), "accountId": .string(account), "senderKind": .string("unknown")]),
                    "transport": .object(["channel": .string("slack"), "conversationRef": .string("conversation"),
                        "messageId": .string("source-" + id), "threadId": .string("thread-a")])])])
        }
        let rows = try WireModels.history(.object(["messages": .array([packet("a", "workspace-a"), packet("b", "workspace-b")])]), key: participantRoute, backend: backend).messages
        #expect(rows.count == 2); #expect(rows[0].text == rows[1].text); #expect(rows[0].timestampMs == rows[1].timestampMs)
        #expect(rows[0].attribution?.sender?.id == "a"); #expect(rows[1].attribution?.sender?.id == "b")
        #expect(rows[0].attribution?.accountID != rows[1].attribution?.accountID)
        #expect(rows.allSatisfy { !$0.sentLocally }); #expect(rows[0].providedID != rows[1].providedID)
    }

    @Test(arguments: ["webchat", "cli", "gateway", "internal"])
    func explicitClientTransportOverridesChannelRouteFallback(_ transport: String) {
        let raw: JSONValue = .object(["__openclaw": .object(["transport": .object(["channel": .string(transport)])])])
        #expect(MessageAttributionWire.read(raw, key: participantRoute, backend: .openclaw, role: .user) == nil)
        var named = raw.object!; named["senderLabel"] = .string("Client member")
        let author = MessageAttributionWire.read(.object(named), key: participantRoute, backend: .openclaw, role: .user)
        #expect(author?.channel == "webchat"); #expect(author?.sender?.name == "Client member")
        #expect(author?.conversationID == nil)
    }

    @Test(arguments: ["slack:channel:room", "agent:main:discord:group:room", "telegram:direct:person",
        "matrix:dm:person", "linear:issue:issue-a", "custom-chat:comment:comment-a",
        "agent:main:linear:12345678-1234-1234-1234-123456789012"])
    func recognizedRouteCanSupplyChannelButNeverInventSender(_ route: String) {
        let author = MessageAttributionWire.read(.object([:]), key: route, backend: .hermes, role: .user)
        #expect(author != nil); #expect(author?.sender == nil)
        #expect(MessageAttributionWire.read(.object([:]), key: route, backend: .pi, role: .user) == nil)
    }

    @Test(arguments: ["main", "agent:main:main", "agent:main:cron:job", "agent:main:subagent:child",
        "agent:main:hook:issue:one", "agent::slack:channel:room", "linear:not-a-uuid"])
    func ordinaryAndAutomationRoutesDoNotInventParticipants(_ route: String) {
        #expect(MessageAttributionWire.session(route) == nil)
    }

    @Test func malformedDisplayFieldsCannotEstablishParticipantIdentity() throws {
        let value: JSONValue = .object(["channel": .string(" SLACK\n"), "accountId": .string(" account "),
            "conversationId": .string("valid-room"), "threadId": .number(10), "messageId": .string(String(repeating: "x", count: 513)),
            "sender": .object(["id": .string("member\u{202e}owner"), "name": .string(" A\u{202e}lice\n "),
                "username": .string(String(repeating: "x", count: 201)), "kind": .string("owner")])])
        let author = try #require(MessageAttributionWire.normalize(value))
        #expect(author.channel == "slack"); #expect(author.accountID == nil); #expect(author.conversationID == "valid-room")
        #expect(author.threadID == nil); #expect(author.messageID == nil)
        #expect(author.sender?.id == nil); #expect(author.sender?.name == "Alice")
        #expect(author.sender?.username == nil); #expect(author.sender?.kind == nil)
        #expect(MessageAttributionWire.normalize(.object(["channel": .string("slack.channel")])) == nil)
        let explicit: JSONValue = .object(["attribution": .object(["channel": .string("linear")]),
            "__openclaw": .object(["senderId": .string("not-the-explicit-author")])])
        #expect(MessageAttributionWire.read(explicit, key: participantRoute, backend: .openclaw, role: .user)?.sender == nil)
        #expect(MessageAttributionWire.read(explicit, key: participantRoute, backend: .openclaw, role: .assistant) == nil)
    }

    @Test(arguments: ["http://cdn.example.com/avatar.png", "/profile/photo", "https://user:password@cdn.example.com/avatar.png",
        "https://cdn.example.com/a?%74oken=private", "https://cdn.example.com/a?%2574oken=private", "https://cdn.example.com/a?%252574oken=private",
        "https://cdn.example.com/a?signature=value", "https://cdn.example.com/a#fragment",
        "https://localhost/a", "https://127.0.0.1/a", "https://10.1.2.3/a", "https://192.168.1.2/a",
        "https://169.254.0.1/a", "https://172.16.0.1/a", "https://host.local/a", "https://[::1]/a",
        "https://2130706433/a", "https://0x7f.1/a", "https://0177.0.0.1/a", "https://127.1/a", "https://%31%32%37.0.0.1/a",
        "https://./a", "https://profile/a", "https://100.64.0.1/a", "https://224.0.0.1/a"])
    func credentialAndLocalAvatarURLsNeverLeaveProjection(_ url: String) {
        #expect(MessageAttributionWire.avatar(.string(url)) == nil)
    }
}
