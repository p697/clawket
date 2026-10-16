#if os(iOS)
import SwiftUI

@MainActor
struct NativeWorkDock: View {
    let work: WorkDockPresentation
    let open: () -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Button(action: open) {
            HStack(spacing: 10) {
                WorkStatusGlyph(status: work.status)
                    .font(.system(size: 18))
                    .frame(width: 20).accessibilityHidden(true)
                Text(work.inspect.explanation ?? work.title).font(.subheadline.weight(.medium)).foregroundStyle(.primary)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let duration = work.clock.durationLabel {
                    Text(duration).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
                Image(systemName: "chevron.up").font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.tertiary).accessibilityHidden(true)
            }
            .padding(.horizontal, 14).frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!work.inspect.isEnabled)
        .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .padding(.horizontal, 12).padding(.top, 6)
        .frame(maxWidth: 790).frame(maxWidth: .infinity)
        .modifier(WorkEntryAccessibility(work: work, identifier: "work-dock"))
    }
}

@MainActor
struct NativeWorkToolbarButton: View {
    let work: WorkDockPresentation
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            WorkStatusGlyph(status: work.status)
                .font(.system(size: 18))
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!work.inspect.isEnabled)
        .modifier(WorkEntryAccessibility(work: work, identifier: "work-toolbar"))
    }
}

@MainActor
private struct WorkEntryAccessibility: ViewModifier {
    let work: WorkDockPresentation
    let identifier: String

    func body(content: Content) -> some View {
        content
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(work.title)
            .accessibilityValue([work.status.label, work.detail, work.clock.durationLabel, work.inspect.explanation]
                .compactMap { $0 }.joined(separator: ". "))
            .accessibilityHint("View work record")
            .accessibilityIdentifier(identifier)
    }
}

@MainActor
struct NativeWorkInspector: View {
    @ObservedObject var model: ClientPresentation
    let conversationID: ConversationID
    let workID: String
    let onIntent: @MainActor (ClientIntent) -> Void

    private var work: WorkDockPresentation? {
        guard let value = model.conversations[conversationID]?.work, value.id == workID,
              value.inspect.isEnabled else { return nil }
        return value
    }

    var body: some View {
        Group {
            if let work {
                List {
                    Section {
                        VStack(alignment: .leading, spacing: 8) {
                            Label { Text(work.title) } icon: { WorkStatusGlyph(status: work.status) }
                                .font(.headline)
                            Text(work.status.label).font(.subheadline).foregroundStyle(.secondary)
                            if let detail = work.detail { Text(detail).font(.subheadline).foregroundStyle(.secondary) }
                            WorkClockView(clock: work.clock)
                        }.padding(.vertical, 4)
                    }
                    ForEach(work.newestFirstRecords) { record in
                        Section {
                            WorkRunHeader(record: record)
                            ForEach(record.newestFirstSteps) { step in
                                if step.inspect.isVisible {
                                    NavigationLink(value: WorkStepRoute(recordID: record.id, stepID: step.id)) {
                                        WorkStepRow(step: step)
                                    }
                                    .disabled(!step.inspect.isEnabled)
                                    .accessibilityHint(step.inspect.explanation ?? "")
                                    .accessibilityIdentifier("work-step-\(record.id)-\(step.id)")
                                } else {
                                    WorkStepRow(step: step)
                                }
                            }
                            if record.newestFirstSteps.isEmpty { Text("No steps yet").foregroundStyle(.secondary) }
                        }
                    }
                    if work.newestFirstRecords.isEmpty {
                        Section { Text("No steps yet").foregroundStyle(.secondary) }
                    }
                }
                .listStyle(.insetGrouped)
            } else {
                WorkUnavailableView(text: String(localized: "This work record is no longer available."))
            }
        }
        .navigationTitle("Work record")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: WorkStepRoute.self) { route in
            NativeWorkStepDetail(model: model, conversationID: conversationID, workID: workID,
                                 route: route, onIntent: onIntent)
        }
        .accessibilityIdentifier("work-inspector")
    }
}

private struct WorkStepRoute: Hashable {
    let recordID: String
    let stepID: String
}

@MainActor
private struct NativeWorkStepDetail: View {
    @ObservedObject var model: ClientPresentation
    let conversationID: ConversationID
    let workID: String
    let route: WorkStepRoute
    let onIntent: @MainActor (ClientIntent) -> Void
    @State private var announced = false

    private var work: WorkDockPresentation? {
        guard let value = model.conversations[conversationID]?.work, value.id == workID,
              value.inspect.isEnabled else { return nil }
        return value
    }
    private var step: WorkStepPresentation? {
        guard let value = work?.step(recordID: route.recordID, stepID: route.stepID), value.inspect.isEnabled else { return nil }
        return value
    }
    private var record: WorkRunPresentation? { work?.records.first { $0.id == route.recordID } }

    var body: some View {
        Group {
            if let step {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 22) {
                        VStack(alignment: .leading, spacing: 10) {
                            Text(step.title).font(.title2.weight(.semibold))
                            Label { Text(step.status.label) } icon: { WorkStatusGlyph(status: step.status) }
                                .font(.subheadline).foregroundStyle(.secondary)
                            if let detail = step.detail { Text(detail).font(.body) }
                            WorkClockView(clock: step.clock)
                        }
                        if let record { WorkRunHeader(record: record) }
                        if step.isLoading { ProgressView().frame(maxWidth: .infinity).accessibilityLabel("Loading work details…") }
                        ForEach(step.visibleContent) { section in
                            WorkContentSectionView(section: section)
                        }
                        if !step.isLoading && step.visibleContent.isEmpty {
                            Text("Content unavailable").font(.body).foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: 790, alignment: .leading)
                    .frame(maxWidth: .infinity)
                    .padding(20)
                }
                .onAppear {
                    guard !announced else { return }
                    guard let intent = work?.stepOpenIntent(conversationID: conversationID,
                                                           recordID: route.recordID, stepID: route.stepID) else { return }
                    announced = true
                    onIntent(intent)
                }
            } else {
                WorkUnavailableView(text: String(localized: "This step is no longer available."))
            }
        }
        .background(Color(uiColor: .systemBackground))
        .navigationTitle("Details")
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("work-step-detail")
    }
}

@MainActor
private struct WorkRunHeader: View {
    let record: WorkRunPresentation
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(record.title ?? (record.inputPreview == nil ? String(localized: "Unattributed work") : String(localized: "Message")))
                .font(.subheadline.weight(.semibold))
            if let input = record.inputPreview {
                Text(input).font(.subheadline).foregroundStyle(.secondary)
                    .lineLimit(3)
                    .accessibilityLabel(Text("Request: \(input)"))
            }
            HStack(spacing: 8) {
                Text(record.status.label)
                if let duration = record.clock.durationLabel { Text(duration).monospacedDigit() }
                Spacer(minLength: 0)
                if let start = record.clock.validStartedAt {
                    Text(start, format: .dateTime.month(.abbreviated).day().hour().minute().second())
                }
            }.font(.caption).foregroundStyle(.secondary)
        }
        .padding(.vertical, 5)
        .accessibilityElement(children: .combine)
    }
}

@MainActor
private struct WorkStepRow: View {
    let step: WorkStepPresentation
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            WorkStatusGlyph(status: step.status).frame(width: 20).padding(.top, 2).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 5) {
                Text(step.title).font(.body).foregroundStyle(.primary)
                if let detail = step.detail { Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
                HStack(spacing: 8) {
                    Text(step.status.label)
                    if let duration = step.clock.durationLabel { Text(duration).monospacedDigit() }
                }.font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if let start = step.clock.validStartedAt {
                Text(start, format: .dateTime.hour().minute().second())
                    .font(.caption.monospacedDigit()).foregroundStyle(.tertiary)
            }
        }
        .frame(minHeight: 44, alignment: .center).padding(.vertical, 3)
        .accessibilityElement(children: .combine)
    }
}

@MainActor
private struct WorkContentSectionView: View {
    let section: WorkContentSection
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(section.title ?? section.kind.label).font(.headline).accessibilityAddTraits(.isHeader)
            if !section.availability.isEnabled {
                Text(section.availability.explanation ?? String(localized: "Content unavailable"))
                    .font(.body).foregroundStyle(.secondary)
            } else if section.text.isEmpty {
                Text("No content").font(.body).foregroundStyle(.secondary)
            } else if section.canSelectText {
                // Monospaced mode is literal: no Markdown parsing, URL opening or command execution.
                SelectableMessageText(text: section.text, monospaced: true, onURL: { _ in })
            } else {
                Text(verbatim: section.text).font(.system(.body, design: .monospaced))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if section.availability.isEnabled && !section.isComplete {
                Text("Only part of this content is available.").font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("work-content-\(section.id)")
    }
}

@MainActor
private struct WorkClockView: View {
    let clock: WorkClockPresentation
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            if let start = clock.validStartedAt {
                LabeledContent("Started") { Text(start, format: .dateTime.year().month(.abbreviated).day().hour().minute().second()) }
            }
            if let finish = clock.validFinishedAt {
                LabeledContent("Finished") { Text(finish, format: .dateTime.year().month(.abbreviated).day().hour().minute().second()) }
            }
            if let duration = clock.durationLabel { LabeledContent("Duration", value: duration) }
        }.font(.caption).foregroundStyle(.secondary)
    }
}

@MainActor
private struct WorkUnavailableView: View {
    let text: String
    var body: some View {
        Text(text).font(.body).foregroundStyle(.secondary).multilineTextAlignment(.center)
            .padding(30).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

@MainActor
private struct WorkStatusGlyph: View {
    let status: WorkStatus
    var body: some View {
        Group {
            switch status {
            case .running: ProgressView().controlSize(.small)
            case .waiting: Image(systemName: "hand.raised").foregroundStyle(.orange)
            case .succeeded: Image(systemName: "checkmark.circle").foregroundStyle(.secondary)
            case .failed: Image(systemName: "exclamationmark.circle").foregroundStyle(.red)
            case .stopped: Image(systemName: "stop.circle").foregroundStyle(.secondary)
            case .unknown: Image(systemName: "questionmark.circle").foregroundStyle(.secondary)
            }
        }
    }
}

private extension WorkStatus {
    var label: String {
        switch self {
        case .unknown: String(localized: "Unknown")
        case .running: String(localized: "Running")
        case .waiting: String(localized: "Waiting")
        case .succeeded: String(localized: "Completed")
        case .failed: String(localized: "Failed")
        case .stopped: String(localized: "Stopped")
        }
    }
}

private extension WorkContentSection.Kind {
    var label: String {
        switch self {
        case .input: String(localized: "Input")
        case .output: String(localized: "Output")
        case .command: String(localized: "Command")
        case .error: String(localized: "Error")
        case .detail: String(localized: "Details")
        }
    }
}

private extension WorkClockPresentation {
    var durationLabel: String? {
        guard let value = durationMilliseconds, value >= 0 else { return nil }
        if value < 1_000 {
            let formatter = MeasurementFormatter()
            formatter.unitOptions = .providedUnit; formatter.unitStyle = .short
            formatter.numberFormatter.maximumFractionDigits = 0
            return formatter.string(from: Measurement(value: Double(value), unit: UnitDuration.milliseconds))
        }
        let formatter = DateComponentsFormatter()
        formatter.allowedUnits = value >= 3_600_000 ? [.hour, .minute, .second] : [.minute, .second]
        formatter.unitsStyle = .positional; formatter.zeroFormattingBehavior = .pad
        return formatter.string(from: Double(value) / 1_000)
    }
}
#endif
