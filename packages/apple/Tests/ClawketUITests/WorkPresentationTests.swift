import Foundation
import Testing
@testable import ClawketUI

@Suite(.serialized)
struct WorkPresentationTests {
    private let route = ConversationID(connectionID: "connection", agentID: "agent", sessionID: "session")

    @Test func workRemainsHiddenUntilTheHostGrantsInspection() {
        let conversation = ConversationPresentation(id: route, agentName: "Agent", sessionTitle: "Conversation")
        #expect(conversation.work == nil)
        var work = WorkDockPresentation(id: "work", title: "Tool work")
        #expect(work.status == .unknown)
        #expect(!work.inspect.isVisible)
        #expect(work.openIntent(conversationID: route) == nil)
        work.inspect = .temporarilyUnavailable("Reconnect to inspect")
        #expect(work.inspect.isVisible)
        #expect(work.openIntent(conversationID: route) == nil)
        work.inspect = .available
        guard case let .workInspectorOpened(actual, workID) = work.openIntent(conversationID: route) else {
            Issue.record("Supported inspection did not retain its concrete route"); return
        }
        #expect(actual == route); #expect(workID == "work")
        #expect(work.openIntent(conversationID: .init(connectionID: "connection", agentID: "agent", sessionID: "")) == nil)
    }

    @Test func newestFirstUsesCanonicalOrderAndPreservesTiesWithoutGuessingFromClocks() {
        let olderClock = WorkClockPresentation(startedAt: Date(timeIntervalSince1970: 10))
        let newerClock = WorkClockPresentation(startedAt: Date(timeIntervalSince1970: 90))
        let record = WorkRunPresentation(id: "run", order: 1, steps: [
            .init(id: "first", order: 7, title: "Equal first", clock: newerClock),
            .init(id: "latest", order: 9, title: "Canonical latest", clock: olderClock),
            .init(id: "second", order: 7, title: "Equal second"),
        ])
        #expect(record.newestFirstSteps.map(\.id) == ["latest", "first", "second"])
        let work = WorkDockPresentation(id: "work", title: "Work", records: [
            record, .init(id: "newer-run", order: 2, clock: olderClock),
        ])
        #expect(work.newestFirstRecords.map(\.id) == ["newer-run", "run"])
    }

    @Test func reusedRunNeverJoinsDifferentTurnAndInputLineages() {
        let step = WorkStepPresentation(id: "tool", order: 1, title: "Read", inspect: .available)
        let first = WorkRunPresentation(id: "first-input", order: 1,
            lineage: .init(runID: "same-wire-run", turnID: "turn-one", inputMessageID: "input-one"), steps: [step])
        let second = WorkRunPresentation(id: "second-input", order: 2,
            lineage: .init(runID: "same-wire-run", turnID: "turn-two", inputMessageKey: "input-two"), steps: [step])
        let work = WorkDockPresentation(id: "work", title: "Work", inspect: .available, records: [first, second])
        #expect(work.newestFirstRecords.count == 2)
        #expect(work.newestFirstRecords[0].lineage == second.lineage)
        guard case let .workStepOpened(actual, workID, recordID, stepID) = work.stepOpenIntent(
            conversationID: route, recordID: first.id, stepID: step.id) else {
            Issue.record("Exact step reading intent was lost"); return
        }
        #expect(actual == route); #expect(workID == "work")
        #expect(recordID == "first-input"); #expect(stepID == "tool")
    }

    @Test func ambiguousOrMissingIdentitiesCannotRetargetAnOpenStep() {
        let step = WorkStepPresentation(id: "tool", order: 1, title: "Read", inspect: .available)
        let record = WorkRunPresentation(id: "run", order: 1, steps: [step])
        var work = WorkDockPresentation(id: "work", title: "Work", inspect: .available, records: [record, record])
        #expect(work.step(recordID: "run", stepID: "tool") == nil)
        #expect(work.newestFirstRecords.isEmpty)
        #expect(work.stepOpenIntent(conversationID: route, recordID: "run", stepID: "tool") == nil)
        work.records = [.init(id: "run", order: 1, steps: [step, step, .init(id: "", order: 2, title: "Invalid")])]
        #expect(work.records[0].newestFirstSteps.isEmpty)
        #expect(work.step(recordID: "run", stepID: "tool") == nil)
        #expect(work.step(recordID: "run", stepID: "") == nil)
        #expect(work.step(recordID: "missing", stepID: "tool") == nil)
    }

    @Test func availabilityRevocationDoesNotGrantReadingThroughRetainedContent() {
        var step = WorkStepPresentation(id: "tool", order: 1, title: "Run", inspect: .available, content: [
            .init(id: "output", kind: .output, text: "private output"),
        ])
        #expect(!step.content[0].availability.isVisible)
        #expect(!step.content[0].canSelectText)
        var work = WorkDockPresentation(id: "work", title: "Work", inspect: .available,
                                       records: [.init(id: "run", order: 1, steps: [step])])
        #expect(work.stepOpenIntent(conversationID: route, recordID: "run", stepID: "tool") != nil)
        step.inspect = .unsupported
        work.records[0].steps = [step]
        #expect(work.stepOpenIntent(conversationID: route, recordID: "run", stepID: "tool") == nil)
        work.records[0].steps[0].inspect = .available
        work.inspect = .unsupported
        #expect(work.stepOpenIntent(conversationID: route, recordID: "run", stepID: "tool") == nil)
    }

    @Test func ambiguousContentSectionsCannotReuseAnotherInputsOrOutputsIdentity() {
        let step = WorkStepPresentation(id: "tool", order: 1, title: "Run", content: [
            .init(id: "same", kind: .input, text: "private input", availability: .available),
            .init(id: "same", kind: .output, text: "private output", availability: .available),
            .init(id: "", kind: .command, text: "invalid identity", availability: .available),
            .init(id: "hidden", kind: .error, text: "not permitted"),
            .init(id: "visible", kind: .output, text: "exact output\n", availability: .available, canSelectText: true, isComplete: false),
        ])
        #expect(step.visibleContent.map(\.id) == ["visible"])
        #expect(step.visibleContent[0].text == "exact output\n")
        #expect(!step.visibleContent[0].isComplete)
    }

    @Test func clocksAndOutputNeverProveCompletion() {
        let step = WorkStepPresentation(id: "tool", order: 1, title: "Read",
            clock: .init(startedAt: Date(timeIntervalSince1970: 100), finishedAt: Date(timeIntervalSince1970: 105), durationMilliseconds: 5_000),
            content: [.init(id: "output", kind: .output, text: "success")])
        #expect(step.status == .unknown)
        #expect(WorkRunPresentation(id: "run", order: 1, steps: [step]).status == .unknown)
        let malformed = WorkClockPresentation(startedAt: Date(timeIntervalSinceReferenceDate: .infinity),
                                             finishedAt: Date(timeIntervalSinceReferenceDate: .nan))
        #expect(malformed.validStartedAt == nil); #expect(malformed.validFinishedAt == nil)
    }

    @Test @MainActor func updatingWorkRetainsTheConversationDraftAndReadingStore() {
        let draft = ComposerDraft(conversationID: route, text: "日本語の未確定入力")
        let model = ClientPresentation(selectedConversation: route,
            conversations: [route: .init(id: route, agentName: "Agent", sessionTitle: "Conversation")], drafts: [route: draft])
        model.conversations[route]?.work = .init(id: "work", title: "Reading", status: .running, inspect: .available)
        model.conversations[route]?.work?.title = "Writing"
        #expect(model.selectedConversation == route)
        #expect(model.draft(for: route) === draft)
        #expect(model.draft(for: route).text == "日本語の未確定入力")
    }
}
