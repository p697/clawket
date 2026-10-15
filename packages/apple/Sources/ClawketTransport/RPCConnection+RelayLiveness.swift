import Foundation

extension RPCConnection {
    /// Remaining protection on this exact socket, not health or permission to retry.
    func transferGrace(generation: ConnectionGeneration) -> Duration {
        guard current?.generation == generation, current?.liveness.transferHintNegotiated == true,
              state == .ready || state == .handshaking else { return .zero }
        return current?.liveness.transfer.grace(at: clock.now()) ?? .zero
    }

    func consumeRelayLiveness(_ value: JSONValue, bytes: Int, generation: ConnectionGeneration) -> Bool {
        let event = value["event"]?.stringValue ?? ""
        let reserved = ["relay.client-ping", "relay.client-pong", "relay.transfer-start"]
        let name = event.trimmingCharacters(in: .whitespacesAndNewlines)
        guard current?.generation == generation else { return true }
        if reserved.contains(name), (event != name || bytes > 512) { return true }
        guard current?.relay != nil else { return reserved.contains(name) }
        if event == "relay.ready", bytes <= 512,
           case .array(let values)? = value["payload"]?["capabilities"], values.count <= 32,
           values.allSatisfy({ $0.stringValue != nil }) {
            if values.contains(.string(RelayHeartbeatConfiguration.clientPingCapability)) {
                current?.liveness.clientPingNegotiated = true
                current?.heartbeatTask?.cancel(); current?.heartbeatTask = nil
                scheduleClientPing(generation)
            }
            if current?.liveness.clientPingNegotiated == true,
               values.contains(.string(RelayHeartbeatConfiguration.transferHintCapability)) {
                current?.liveness.transferHintNegotiated = true
            }
            return false // Runtime may still consume an additive heartbeat policy.
        }
        if event == "relay.transfer-start" {
            guard current?.liveness.transferHintNegotiated == true,
                  let bytes = value["payload"]?["bytes"]?.numberValue, bytes.isFinite,
                  bytes.rounded(.towardZero) == bytes,
                  bytes >= Double(RelayTransferLease.minimumBytes), bytes <= Double(RelayTransferLease.maximumBytes) else { return true }
            observeTransferDeadlines(generation)
            guard current?.generation == generation else { return true }
            if current?.liveness.transfer.beginIncoming(bytes: Int(bytes), at: clock.now()) == true {
                scheduleClientPing(generation, delay: .zero, completingTransfer: true)
            }
            return true
        }
        if event == "relay.client-pong" {
            receiveClientPong(value["payload"]?["nonce"]?.stringValue, generation: generation)
            return true
        }
        return reserved.contains(name)
    }

    func beginOutgoingTransfer(bytes: Int, generation: ConnectionGeneration) -> UUID? {
        guard current?.generation == generation, current?.liveness.transferHintNegotiated == true else { return nil }
        observeTransferDeadlines(generation)
        guard current?.generation == generation else { return nil }
        let token = current?.liveness.transfer.beginOutgoing(bytes: bytes, at: clock.now())
        if token != nil { scheduleClientPing(generation, delay: .zero, completingTransfer: true) }
        return token
    }

    func finishOutgoingTransfer(_ token: UUID?, accepted: Bool, uncertain: Bool = false, generation: ConnectionGeneration) {
        guard let token, current?.generation == generation else { return }
        observeTransferDeadlines(generation)
        current?.liveness.transfer.finishOutgoing(token, accepted: accepted, uncertain: uncertain)
        observeTransferDeadlines(generation)
        refreshTransferPing(generation)
    }

    func completeIncomingTransfer(bytes: Int, generation: ConnectionGeneration) {
        observeTransferDeadlines(generation)
        guard current?.generation == generation else { return }
        if current?.liveness.transfer.completeIncoming(bytes: bytes) == true {
            observeTransferDeadlines(generation)
            refreshTransferPing(generation)
        }
    }

    func refreshTransferPing(_ generation: ConnectionGeneration) {
        guard current?.generation == generation else { return }
        if current?.liveness.transfer.hasWindow == true {
            current?.liveness.pause()
            scheduleClientPing(generation, delay: .zero, completingTransfer: true)
        } else {
            // A rejected reservation grants neither grace nor another ordinary
            // ping window. Preserve an existing nonce/cadence from before it.
            if current?.liveness.pendingProbe != nil {
                _ = validateLivenessDeadline(generation)
                return
            }
            if current?.liveness.pingTimer != nil, current?.liveness.pingIsTransfer != true { return }
            current?.liveness.pause()
            let delay = current?.liveness.lastPingAt.map { max(.zero, $0 + .seconds(5) - clock.now()) } ?? .seconds(5)
            scheduleClientPing(generation, delay: delay)
        }
    }

    func validateLivenessDeadline(_ generation: ConnectionGeneration) -> Bool {
        guard current?.generation == generation else { return false }
        if foreground, state == .ready, let probe = current?.liveness.pendingProbe,
           clock.now() >= probe.deadline, transferGrace(generation: generation) <= .zero {
            fail(generation, code: .heartbeatTimeout)
            return false
        }
        return true
    }

    func scheduleClientPing(_ generation: ConnectionGeneration, delay: Duration = .seconds(5), completingTransfer: Bool = false) {
        guard current?.generation == generation, foreground, state == .ready,
              current?.liveness.clientPingNegotiated == true,
              current?.liveness.pingTimer == nil, current?.liveness.pendingProbe == nil else { return }
        let now = clock.now()
        var delay = max(.zero, delay)
        if delay == .zero, let previous = current?.liveness.lastPingAt {
            delay = min(.seconds(1), max(.zero, .seconds(1) - (now - previous)))
        }
        if completingTransfer {
            let remaining = current?.liveness.transfer.remaining(at: now) ?? .zero
            if remaining <= .zero { fail(generation, code: .heartbeatTimeout); return }
            delay = min(delay, remaining)
        }
        let clock = clock
        let timerID = UUID()
        current?.liveness.pingTimerID = timerID
        current?.liveness.pingIsTransfer = completingTransfer
        current?.liveness.pingTimer = Task { [weak self] in
            do { try await clock.sleep(for: delay) } catch { return }
            await self?.sendClientPing(generation, timerID: timerID, completingTransfer: completingTransfer)
        }
    }

    private func sendClientPing(_ generation: ConnectionGeneration, timerID: UUID, completingTransfer: Bool) {
        guard !Task.isCancelled, current?.generation == generation,
              current?.liveness.pingTimerID == timerID else { return }
        current?.liveness.pingTimer = nil
        current?.liveness.pingTimerID = nil
        current?.liveness.pingIsTransfer = false
        guard foreground, state == .ready, current?.liveness.clientPingNegotiated == true else { return }
        let now = clock.now()
        let remaining = current?.liveness.transfer.remaining(at: now) ?? .zero
        if completingTransfer, remaining <= .zero { fail(generation, code: .heartbeatTimeout); return }
        // A concurrently completed download cannot put a confirmation ahead of
        // an in-flight native upload. Keep the same absolute budget while waiting.
        if current?.liveness.transfer.canConfirm == false {
            if remaining <= .zero { fail(generation, code: .heartbeatTimeout); return }
            scheduleClientPing(generation, delay: min(.seconds(1), remaining), completingTransfer: true)
            return
        }
        guard let entry = current else { return }
        guard entry.liveness.dispatches.count < 16 else { fail(generation, code: .heartbeatTimeout); return }
        let nonce = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        let timeout = remaining > .zero ? min(remaining, .seconds(5)) : .seconds(5)
        let probe = RelayLivenessState.Probe(id: UUID(), nonce: nonce, deadline: now + timeout,
                                             transferGeneration: entry.liveness.transfer.generation)
        let frame: String
        do {
            frame = RelayControl.prefix + (try FrameCodec.encode(.object(["type": .string("control"),
                "event": .string("relay.client-ping"), "payload": .object(["nonce": .string(nonce)])])))
        } catch { fail(generation, code: .invalidFrame); return }
        // Publish before send; an injected/native peer may echo synchronously.
        current?.liveness.pendingProbe = probe
        current?.liveness.lastPingAt = now
        let clock = clock
        current?.liveness.pongTimer = Task { [weak self] in
            var delay = timeout
            do {
                while !Task.isCancelled {
                    try await clock.sleep(for: delay)
                    guard let next = await self?.clientPongTimeoutDelay(probe.id, generation: generation) else { return }
                    delay = next
                }
            } catch { return }
        }
        current?.liveness.dispatches[probe.id] = Task { [weak self, socket = entry.socket] in
            var failed = false
            do { try Task.checkCancellation(); try await socket.send(frame) }
            catch { failed = !Task.isCancelled }
            await self?.clientPingDispatched(probe.id, generation: generation, failed: failed)
        }
    }

    private func clientPingDispatched(_ id: UUID, generation: ConnectionGeneration, failed: Bool) {
        guard current?.generation == generation else { return }
        current?.liveness.dispatches.removeValue(forKey: id)
        if failed { fail(generation, code: .socketFailure) }
    }

    private func clientPongTimeoutDelay(_ id: UUID, generation: ConnectionGeneration) -> Duration? {
        guard current?.generation == generation, foreground, state == .ready,
              let pending = current?.liveness.pendingProbe, pending.id == id else { return nil }
        let grace = transferGrace(generation: generation)
        if grace > .zero { return min(grace, .seconds(1)) }
        if clock.now() < pending.deadline { return pending.deadline - clock.now() }
        fail(generation, code: .heartbeatTimeout)
        return nil
    }

    private func receiveClientPong(_ nonce: String?, generation: ConnectionGeneration) {
        guard current?.generation == generation, foreground, state == .ready,
              current?.liveness.clientPingNegotiated == true,
              let pending = current?.liveness.pendingProbe, pending.nonce == nonce else { return }
        let now = clock.now()
        if now >= pending.deadline, transferGrace(generation: generation) <= .zero {
            fail(generation, code: .heartbeatTimeout); return
        }
        observeTransferDeadlines(generation)
        guard current?.generation == generation else { return }
        let confirmed = current?.liveness.transfer.confirmProbe(generation: pending.transferGeneration, at: now) == true
        observeTransferDeadlines(generation)
        current?.liveness.pause()
        if confirmed {
            current?.lastTick = now // Transport traffic only; never backend ready/backoff.
            scheduleClientPing(generation)
        } else {
            scheduleClientPing(generation, delay: .seconds(1), completingTransfer: true)
        }
    }
}
