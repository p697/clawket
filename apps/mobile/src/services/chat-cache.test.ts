import AsyncStorage from "@react-native-async-storage/async-storage";
import { ChatCacheService, CachedSessionMeta } from "./chat-cache";
import { UiMessage } from "../types/chat";
import { DEFAULT_GATEWAY_HISTORY_CACHE, mergeGatewayHistory } from "../connection/adapters/gateway-history";
import { stableMessageId } from "../utils/chat-message";
import { act, renderHook } from "@testing-library/react-native";
import { useRef } from "react";
import { useChatHistoryState } from "../chat/useChatHistoryState";

jest.mock("./image-cache", () => ({
  getAllCachedForSession: jest.fn().mockResolvedValue([]),
  cacheMessageImages: jest.fn(),
  generateStableKey: jest.fn(() => "stable-key"),
  findCachedEntry: jest.fn(),
}));

const INDEX_KEY = "clawket.chatCache.index.v2";

function makeStorageKey(
  gatewayConfigId: string,
  agentId: string,
  sessionKey: string,
  sessionId?: string,
): string {
  if (sessionId) {
    return `clawket.chatCache.msgs.${gatewayConfigId}::${agentId}::${sessionKey}::sid:${sessionId}`;
  }
  return `clawket.chatCache.msgs.${gatewayConfigId}::${agentId}::${sessionKey}`;
}

// Replace the stateless mock with an in-memory store for these tests
let store: Record<string, string> = {};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  store = {};
  (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) =>
    Promise.resolve(store[key] ?? null),
  );
  (AsyncStorage.multiGet as jest.Mock).mockImplementation((keys: string[]) =>
    Promise.resolve(keys.map((key) => [key, store[key] ?? null])),
  );
  (AsyncStorage.setItem as jest.Mock).mockImplementation(
    (key: string, value: string) => {
      store[key] = value;
      return Promise.resolve();
    },
  );
  (AsyncStorage.multiSet as jest.Mock).mockImplementation(
    (entries: Array<[string, string]>) => {
      for (const [key, value] of entries) {
        store[key] = value;
      }
      return Promise.resolve();
    },
  );
  (AsyncStorage.removeItem as jest.Mock).mockImplementation((key: string) => {
    delete store[key];
    return Promise.resolve();
  });
  (AsyncStorage.multiRemove as jest.Mock).mockImplementation(
    (keys: string[]) => {
      for (const k of keys) delete store[k];
      return Promise.resolve();
    },
  );
  (AsyncStorage.getAllKeys as jest.Mock).mockImplementation(() =>
    Promise.resolve(Object.keys(store)),
  );
  (AsyncStorage.clear as jest.Mock).mockImplementation(() => {
    store = {};
    return Promise.resolve();
  });
});

function makeMsg(overrides: Partial<UiMessage> = {}): UiMessage {
  return {
    id: "msg_1",
    role: "user",
    text: "Hello world",
    timestampMs: 1700000000000,
    ...overrides,
  };
}

describe("ChatCacheService", () => {
  it.each(["openclaw", "hermes"].flatMap(backend => [true, false].map(known => [backend, known] as const)))(
    "restores the current %s snapshot before network history (known generation: %s)", async (backendKind, known) => {
      const key = "agent:main:main";
      const scope = { gatewayConfigId: "gw1", agentId: "main", sessionKey: key };
      const messages = Array.from({ length: 123 }, (_, index) => makeMsg({
        id: `cached-${index}`, historyMessageId: `source-${index}`,
        role: index % 2 ? "assistant" : "user",
        text: index === 119 || index === 121 ? "Repeated reply" : `Message ${index}`,
        timestampMs: 100_000 + index * 1000,
      }));
      // The old unscoped snapshot starts later, but its tail is out of date.
      // Sorting generations by their first row puts this stale copy last.
      await ChatCacheService.saveMessages(scope, messages.slice(40, 90));
      await ChatCacheService.saveMessages({ ...scope, sessionId: "current" }, messages);
      const expected = messages.slice(-50).map(message => message.text);
      const adapter = { connection: { backendKind }, state: "ready", loadSession: jest.fn().mockResolvedValue({
        sessionId: "current", messages: messages.slice(-50).map(message => ({
          id: message.historyMessageId, role: message.role, text: message.text, timestampMs: message.timestampMs,
        })),
      }) };
      const { result, unmount } = renderHook(() => {
        const sessionKeyRef = useRef<string | null>(key);
        return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: key => key, sessionKeyRef,
          routeSessionKey: key, mainSessionKey: key, gatewayConfigId: "gw1", currentAgentId: "main" });
      });
      act(() => result.current.setSessionKey("agent:main:other"));
      act(() => result.current.setSessionKey(key));
      await act(async () => { await result.current.restoreCachedMessages(key, { sessionId: known ? "current" : undefined }); });
      expect(result.current.messages.map(message => message.text)).toEqual(expected);
      const renderKeys = result.current.messages.map(message => message.renderKey ?? message.id);
      await act(async () => { await result.current.loadHistory(key); });
      expect(result.current.messages.map(message => message.text)).toEqual(expected);
      expect(result.current.messages.map(message => message.renderKey ?? message.id)).toEqual(renderKeys);
      // Entry must not delete the legacy snapshot or older rows needed for paging.
      expect(await ChatCacheService.getMessages("gw1", "main", key, "current")).toHaveLength(123);
      expect(await ChatCacheService.getMessagesByStorageKey(makeStorageKey("gw1", "main", key))).toHaveLength(50);
      unmount();
    },
  );

  it.each(["openclaw", "hermes"])("keeps archived %s history pageable after restoring a short current snapshot", async backendKind => {
    const key = "agent:main:main";
    const scope = { gatewayConfigId: "gw1", agentId: "main", sessionKey: key };
    const archived = [makeMsg({ id: "old", text: "Archived reply", timestampMs: 100_000 })];
    const current = [makeMsg({ id: stableMessageId("user", 200_000, "Current reply"), historyMessageId: "source", text: "Current reply", timestampMs: 200_000 })];
    await ChatCacheService.saveMessages({ ...scope, sessionId: "old" }, archived);
    await ChatCacheService.saveMessages({ ...scope, sessionId: "current" }, current);
    const adapter = { connection: { backendKind }, state: "ready", loadSession: jest.fn().mockResolvedValue({
      sessionId: "current", messages: [{ id: "source", role: "user", text: "Current reply", timestampMs: 200_000 }],
    }) };
    const { result, unmount } = renderHook(() => {
      const sessionKeyRef = useRef<string | null>(key);
      return useChatHistoryState({ adapter: adapter as any, dbg: jest.fn(), t: key => key, sessionKeyRef,
        routeSessionKey: key, mainSessionKey: key, gatewayConfigId: "gw1", currentAgentId: "main" });
    });
    await act(async () => { await result.current.restoreCachedMessages(key, { sessionId: "current" }); });
    expect(result.current.messages.map(message => message.text)).toEqual(["Current reply"]);
    await act(async () => { await result.current.loadHistory(key); });
    await act(async () => { await result.current.onLoadMoreHistory(); });
    expect(result.current.messages.map(message => message.text)).toEqual(["Archived reply", "Current reply"]);
    unmount();
  });

  describe("saveMessages + getMessages", () => {
    it("uses projected identity when a legacy Gateway renumbers history-page fallback IDs", async () => {
      const scope = { gatewayConfigId: "gw1", agentId: "main", sessionKey: "agent:main:main" };
      const remote = [{ id: `${scope.sessionKey}:history:130000:15`, role: "assistant" as const, text: "Finished", timestampMs: 130_000 }];
      await ChatCacheService.saveMessages(scope, [{
        id: stableMessageId("assistant", 130_000, "Finished"),
        historyMessageId: `${scope.sessionKey}:history:130000:5`,
        role: "assistant", text: "Finished", timestampMs: 150_000,
      }]);
      expect(mergeGatewayHistory(remote, await DEFAULT_GATEWAY_HISTORY_CACHE.load("gw1", "main", scope.sessionKey, 50)))
        .toEqual(remote);
    });

    it("round-trips canonical history identity across cold loads without duplicating tool replies", async () => {
      const scope = { gatewayConfigId: "gw1", agentId: "main", sessionKey: "agent:main:main" };
      const remote = [
        { id: "question", role: "user" as const, text: "Check", timestampMs: 100_000 },
        { id: "paragraph", role: "assistant" as const, text: "Checking now", timestampMs: 110_000 },
        { id: "tool", role: "tool" as const, text: "", timestampMs: 120_000,
          tool: { name: "read", callId: "call-1", status: "success" as const } },
        { id: "answer", role: "assistant" as const, text: "Finished", timestampMs: 130_000 },
        { id: "next-question", role: "user" as const, text: "Again", timestampMs: 140_000 },
        { id: "next-answer", role: "assistant" as const, text: "Finished", timestampMs: 150_000 },
      ];
      // Display timestamps/IDs survive live reconciliation; source IDs must survive storage too.
      const rows: UiMessage[] = remote.map((message, index) => ({
        id: message.tool ? "toolresult_call-1" : `h_local_${index}`,
        historyMessageId: message.tool ? undefined : message.id,
        role: message.role, text: message.text, timestampMs: message.timestampMs + 90_000,
        toolName: message.tool?.name, toolStatus: message.tool?.status,
      }));
      await ChatCacheService.saveMessages(scope, rows);
      const cached = await DEFAULT_GATEWAY_HISTORY_CACHE.load("gw1", "main", scope.sessionKey, 50);
      expect(cached.filter(message => message.role === "assistant").map(message => message.id))
        .toEqual(["paragraph", "answer", "next-answer"]);
      expect(mergeGatewayHistory(remote, cached)).toEqual(remote);
      // A second restart remains stable, including two intentional equal replies.
      await ChatCacheService.saveMessages(scope, rows);
      expect(mergeGatewayHistory(remote, await DEFAULT_GATEWAY_HISTORY_CACHE.load("gw1", "main", scope.sessionKey, 50)))
        .toEqual(remote);
      expect(mergeGatewayHistory([], cached)).toEqual(cached);
    });

    it("preserves uncertain delivery when restoring the local cache", async () => {
      await ChatCacheService.saveMessages(
        { gatewayConfigId: "gw1", agentId: "agent1", sessionKey: "agent:agent1:main" },
        [makeMsg({ sendUncertain: true })],
      );
      const restored = await ChatCacheService.getMessages("gw1", "agent1", "agent:agent1:main");
      expect(restored[0].sendUncertain).toBe(true);
    });

    it("saves and retrieves messages", async () => {
      const messages: UiMessage[] = [
        makeMsg({ id: "1", text: "Hello" }),
        makeMsg({ id: "2", role: "assistant", text: "Hi there" }),
      ];

      await ChatCacheService.saveMessages(
        {
          gatewayConfigId: "gw1",
          agentId: "agent1",
          sessionKey: "agent:agent1:main",
        },
        messages,
      );

      const result = await ChatCacheService.getMessages(
        "gw1",
        "agent1",
        "agent:agent1:main",
      );
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("1");
      expect(result[0].text).toBe("Hello");
      expect(result[1].role).toBe("assistant");
    });

    it("strips transient fields but preserves chat content", async () => {
      const messages: UiMessage[] = [
        makeMsg({
          id: "1",
          text: "Photo",
          idempotencyKey: "run_123",
          imageUris: ["file:///photo.png"],
          imageMetas: [{ uri: "file:///photo.png", width: 100, height: 100 }],
          fileAttachments: [{
            uri: "file:///spec.pdf",
            mimeType: "application/pdf",
            fileName: "spec.pdf",
          }],
          streaming: true,
          approval: {
            id: "a1",
            command: "rm -rf",
            expiresAtMs: 0,
            status: "pending",
          },
          usage: { inputTokens: 10, outputTokens: 20 },
        }),
      ];

      await ChatCacheService.saveMessages(
        { gatewayConfigId: "gw1", agentId: "a1", sessionKey: "main" },
        messages,
      );

      const result = await ChatCacheService.getMessages("gw1", "a1", "main");
      expect(result).toHaveLength(1);
      expect(result[0].idempotencyKey).toBe("run_123");
      expect(result[0].imageUris).toEqual(["file:///photo.png"]);
      expect(result[0].imageMetas).toEqual([
        { uri: "file:///photo.png", width: 100, height: 100 },
      ]);
      expect(result[0].fileAttachments).toEqual([{
        uri: "file:///spec.pdf",
        mimeType: "application/pdf",
        fileName: "spec.pdf",
      }]);
      expect(result[0].usage).toEqual({ inputTokens: 10, outputTokens: 20 });
      expect((result[0] as any).streaming).toBeUndefined();
      expect((result[0] as any).approval).toBeUndefined();
    });

    it("returns empty for non-existent sessions", async () => {
      const result = await ChatCacheService.getMessages(
        "gw1",
        "a1",
        "nonexistent",
      );
      expect(result).toEqual([]);
    });

    it("does not cache system messages while preserving user, assistant, and tool messages", async () => {
      const messages: UiMessage[] = [
        makeMsg({
          id: "sys_1",
          role: "system",
          text: "Connection Setup Required",
        }),
        makeMsg({ id: "1", role: "user", text: "Hello" }),
        makeMsg({ id: "2", role: "assistant", text: "Hi there" }),
        makeMsg({
          id: "3",
          role: "tool",
          text: "",
          toolName: "bash",
          toolSummary: "Executed npm test",
          toolStatus: "success",
        }),
        makeMsg({
          id: "sys_2",
          role: "system",
          text: "Error: WebSocket error",
        }),
      ];

      await ChatCacheService.saveMessages(
        {
          gatewayConfigId: "gw1",
          agentId: "agent1",
          sessionKey: "agent:agent1:main",
        },
        messages,
      );

      const result = await ChatCacheService.getMessages(
        "gw1",
        "agent1",
        "agent:agent1:main",
      );
      expect(result.map((message) => message.id)).toEqual(["1", "2", "3"]);
      expect(result.map((message) => message.role)).toEqual([
        "user",
        "assistant",
        "tool",
      ]);
    });

    it("does not cache hidden user messages that match transcript suppression rules", async () => {
      const messages: UiMessage[] = [
        makeMsg({ id: "hidden", role: "user", text: "OpenClaw runtime context\n\ninternal" }),
        makeMsg({ id: "visible", role: "assistant", text: "Visible reply" }),
      ];

      await ChatCacheService.saveMessages(
        {
          gatewayConfigId: "gw1",
          agentId: "agent1",
          sessionKey: "agent:agent1:main",
        },
        messages,
      );

      const result = await ChatCacheService.getMessages(
        "gw1",
        "agent1",
        "agent:agent1:main",
      );

      expect(result.map((message) => message.id)).toEqual(["visible"]);
    });

    it("isolates cache generations by sessionId under the same session key", async () => {
      await ChatCacheService.saveMessages(
        {
          gatewayConfigId: "gw1",
          agentId: "a1",
          sessionKey: "agent:a1:main",
          sessionId: "sess-old",
        },
        [makeMsg({ id: "1", text: "Old generation message" })],
      );
      await ChatCacheService.saveMessages(
        {
          gatewayConfigId: "gw1",
          agentId: "a1",
          sessionKey: "agent:a1:main",
          sessionId: "sess-new",
        },
        [makeMsg({ id: "2", text: "New generation message" })],
      );

      await expect(
        ChatCacheService.getMessages("gw1", "a1", "agent:a1:main", "sess-old"),
      ).resolves.toMatchObject([{ id: "1", text: "Old generation message" }]);
      await expect(
        ChatCacheService.getMessages("gw1", "a1", "agent:a1:main", "sess-new"),
      ).resolves.toMatchObject([{ id: "2", text: "New generation message" }]);
      await expect(
        ChatCacheService.getMessages("gw1", "a1", "agent:a1:main"),
      ).resolves.toMatchObject([{ id: "2", text: "New generation message" }]);
    });

    it("serializes concurrent index updates without dropping cached sessions", async () => {
      const firstIndexRead = deferred<string | null>();
      const secondIndexRead = deferred<string | null>();
      const firstIndexReadObserved = deferred<void>();
      const secondIndexReadObserved = deferred<void>();
      let indexReadCount = 0;

      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === INDEX_KEY) {
          indexReadCount += 1;
          if (indexReadCount === 1) {
            firstIndexReadObserved.resolve();
            return firstIndexRead.promise;
          }
          if (indexReadCount === 2) {
            secondIndexReadObserved.resolve();
            return secondIndexRead.promise;
          }
        }
        return Promise.resolve(store[key] ?? null);
      });

      const firstSave = ChatCacheService.saveMessages(
        { gatewayConfigId: "gw1", agentId: "a1", sessionKey: "session-1" },
        [makeMsg({ id: "1", text: "First session" })],
      );
      const secondSave = ChatCacheService.saveMessages(
        { gatewayConfigId: "gw1", agentId: "a2", sessionKey: "session-2" },
        [makeMsg({ id: "2", text: "Second session" })],
      );

      await firstIndexReadObserved.promise;
      expect(indexReadCount).toBe(1);

      firstIndexRead.resolve(null);
      await firstSave;

      await secondIndexReadObserved.promise;
      expect(indexReadCount).toBe(2);

      secondIndexRead.resolve(store[INDEX_KEY] ?? null);
      await secondSave;

      const sessions = await ChatCacheService.listSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions.map((session) => session.sessionKey).sort()).toEqual([
        "session-1",
        "session-2",
      ]);
    });

    it("preserves the full cached generation instead of truncating to the latest 200 messages", async () => {
      const messages = Array.from({ length: 250 }, (_, index) =>
        makeMsg({
          id: `msg_${index}`,
          role: index % 2 === 0 ? "user" : "assistant",
          text: `Message ${index}`,
          timestampMs: 1_700_000_000_000 + index,
        }),
      );

      await ChatCacheService.saveMessages(
        {
          gatewayConfigId: "gw1",
          agentId: "agent1",
          sessionKey: "agent:agent1:main",
          sessionId: "sess-1",
        },
        messages,
      );

      const result = await ChatCacheService.getMessages(
        "gw1",
        "agent1",
        "agent:agent1:main",
        "sess-1",
      );
      expect(result).toHaveLength(250);
      expect(result[0]?.text).toBe("Message 0");
      expect(result[249]?.text).toBe("Message 249");
    });

    it("keeps the previously committed generation visible when a new chunked write fails before manifest commit", async () => {
      const initialMessages = Array.from({ length: 120 }, (_, index) =>
        makeMsg({
          id: `initial_${index}`,
          role: index % 2 === 0 ? "user" : "assistant",
          text: `Initial ${index}`,
          timestampMs: 1_700_000_000_000 + index,
        }),
      );
      const replacementMessages = Array.from({ length: 120 }, (_, index) =>
        makeMsg({
          id: `replacement_${index}`,
          role: index % 2 === 0 ? "user" : "assistant",
          text: `Replacement ${index}`,
          timestampMs: 1_700_000_100_000 + index,
        }),
      );

      await ChatCacheService.saveMessages(
        {
          gatewayConfigId: "gw1",
          agentId: "agent1",
          sessionKey: "agent:agent1:main",
          sessionId: "sess-1",
        },
        initialMessages,
      );

      const originalManifest =
        store[makeStorageKey("gw1", "agent1", "agent:agent1:main", "sess-1")];

      let multiSetCalls = 0;
      (AsyncStorage.multiSet as jest.Mock).mockImplementationOnce(
        (entries: Array<[string, string]>) => {
          multiSetCalls += 1;
          const [firstEntry] = entries;
          if (firstEntry) {
            store[firstEntry[0]] = firstEntry[1];
          }
          return Promise.reject(new Error("simulated chunk write failure"));
        },
      );

      await ChatCacheService.saveMessages(
        {
          gatewayConfigId: "gw1",
          agentId: "agent1",
          sessionKey: "agent:agent1:main",
          sessionId: "sess-1",
        },
        replacementMessages,
      );

      expect(multiSetCalls).toBe(1);
      expect(
        store[makeStorageKey("gw1", "agent1", "agent:agent1:main", "sess-1")],
      ).toBe(originalManifest);

      const result = await ChatCacheService.getMessages(
        "gw1",
        "agent1",
        "agent:agent1:main",
        "sess-1",
      );
      expect(result).toHaveLength(120);
      expect(result[0]?.text).toBe("Initial 0");
      expect(result[119]?.text).toBe("Initial 119");
    });
  });

  describe("listSessions", () => {
    it("returns saved session metadata sorted by updatedAt", async () => {
      await ChatCacheService.saveMessages(
        {
          gatewayConfigId: "gw1",
          agentId: "a1",
          agentName: "Bot A",
          sessionKey: "session1",
        },
        [makeMsg()],
      );

      // Small delay for different updatedAt
      await new Promise((r) => setTimeout(r, 10));

      await ChatCacheService.saveMessages(
        {
          gatewayConfigId: "gw1",
          agentId: "a2",
          agentName: "Bot B",
          sessionKey: "session2",
        },
        [makeMsg()],
      );

      const sessions = await ChatCacheService.listSessions();
      expect(sessions).toHaveLength(2);
      // Most recent first
      expect(sessions[0].agentId).toBe("a2");
      expect(sessions[1].agentId).toBe("a1");
    });

    it("updates existing session metadata on re-save", async () => {
      await ChatCacheService.saveMessages(
        { gatewayConfigId: "gw1", agentId: "a1", sessionKey: "main" },
        [makeMsg()],
      );

      await ChatCacheService.saveMessages(
        { gatewayConfigId: "gw1", agentId: "a1", sessionKey: "main" },
        [makeMsg(), makeMsg({ id: "2", text: "Second" })],
      );

      const sessions = await ChatCacheService.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].messageCount).toBe(2);
      expect(sessions[0].lastMessagePreview).toBe("Second");
    });

    it("removes system-only sessions from the index during sanitization", async () => {
      const storageKey = makeStorageKey("gw1", "a1", "main");
      store[storageKey] = JSON.stringify([
        makeMsg({
          id: "sys_1",
          role: "system",
          text: "Connection Setup Required",
        }),
      ]);
      store[INDEX_KEY] = JSON.stringify([
        {
          storageKey,
          gatewayConfigId: "gw1",
          agentId: "a1",
          sessionKey: "main",
          sessionLabel: "Main",
          messageCount: 1,
          lastMessagePreview: "Connection Setup Required",
          updatedAt: 1700000000000,
        },
      ] satisfies CachedSessionMeta[]);

      await expect(ChatCacheService.listSessions()).resolves.toEqual([]);
      expect(store[storageKey]).toBeUndefined();
    });

    it("drops silent NO_REPLY previews from cached session metadata", async () => {
      await ChatCacheService.saveMessages(
        { gatewayConfigId: "gw1", agentId: "a1", sessionKey: "main" },
        [makeMsg({ id: "1", role: "assistant", text: "NO_REPLY" })],
      );

      const sessions = await ChatCacheService.listSessions();
      expect(sessions[0]?.lastMessagePreview).toBeUndefined();
    });
  });

  describe("getSessionLineage", () => {
    it("returns cached generations oldest to newest for one logical session", async () => {
      await ChatCacheService.saveMessages(
        {
          gatewayConfigId: "gw1",
          agentId: "a1",
          sessionKey: "main",
          sessionId: "sess-old",
        },
        [makeMsg({ id: "1", text: "Old generation", timestampMs: 1000 })],
      );
      await ChatCacheService.saveMessages(
        {
          gatewayConfigId: "gw1",
          agentId: "a1",
          sessionKey: "main",
          sessionId: "sess-new",
        },
        [makeMsg({ id: "2", text: "New generation", timestampMs: 2000 })],
      );
      await ChatCacheService.saveMessages(
        {
          gatewayConfigId: "gw1",
          agentId: "a1",
          sessionKey: "other",
          sessionId: "sess-other",
        },
        [makeMsg({ id: "3", text: "Other session", timestampMs: 3000 })],
      );

      const lineage = await ChatCacheService.getSessionLineage(
        "gw1",
        "a1",
        "main",
      );

      expect(lineage).toHaveLength(2);
      expect(lineage.map((snapshot) => snapshot.meta.sessionId)).toEqual([
        "sess-old",
        "sess-new",
      ]);
      expect(lineage.map((snapshot) => snapshot.messages[0]?.text)).toEqual([
        "Old generation",
        "New generation",
      ]);
    });
  });

  describe("getSessionMeta", () => {
    it("returns cached metadata for one session", async () => {
      await ChatCacheService.saveMessages(
        { gatewayConfigId: "gw1", agentId: "a1", sessionKey: "main" },
        [makeMsg({ id: "1", text: "Saved preview" })],
      );

      await expect(
        ChatCacheService.getSessionMeta("gw1", "a1", "main"),
      ).resolves.toMatchObject({
        sessionKey: "main",
        lastMessagePreview: "Saved preview",
      });
    });

    it("repairs metadata after stripping cached system messages", async () => {
      const storageKey = makeStorageKey("gw1", "a1", "main");
      store[storageKey] = JSON.stringify([
        makeMsg({
          id: "sys_1",
          role: "system",
          text: "Error: WebSocket error",
        }),
        makeMsg({ id: "1", role: "user", text: "Hello" }),
        makeMsg({ id: "2", role: "assistant", text: "Hi there" }),
      ]);
      store[INDEX_KEY] = JSON.stringify([
        {
          storageKey,
          gatewayConfigId: "gw1",
          agentId: "a1",
          sessionKey: "main",
          sessionLabel: "Main",
          messageCount: 3,
          lastMessagePreview: "Error: WebSocket error",
          updatedAt: 1700000000000,
        },
      ] satisfies CachedSessionMeta[]);

      await expect(
        ChatCacheService.getMessages("gw1", "a1", "main"),
      ).resolves.toMatchObject([
        { id: "1", role: "user", text: "Hello" },
        { id: "2", role: "assistant", text: "Hi there" },
      ]);

      await expect(
        ChatCacheService.getSessionMeta("gw1", "a1", "main"),
      ).resolves.toMatchObject({
        sessionKey: "main",
        messageCount: 2,
        lastMessagePreview: "Hi there",
      });
      expect(JSON.parse(store[storageKey])).toMatchObject({
        version: 3,
        chunkCount: 1,
        messageCount: 2,
      });
    });
  });

  describe("deleteSession", () => {
    it("removes session from index and storage", async () => {
      await ChatCacheService.saveMessages(
        { gatewayConfigId: "gw1", agentId: "a1", sessionKey: "main" },
        [makeMsg()],
      );

      const sessions = await ChatCacheService.listSessions();
      expect(sessions).toHaveLength(1);

      await ChatCacheService.deleteSession(sessions[0].storageKey);

      const after = await ChatCacheService.listSessions();
      expect(after).toHaveLength(0);

      const msgs = await ChatCacheService.getMessages("gw1", "a1", "main");
      expect(msgs).toEqual([]);
    });
  });

  describe("deleteMessages", () => {
    it("removes a session by gateway, agent, and session key", async () => {
      await ChatCacheService.saveMessages(
        { gatewayConfigId: "gw1", agentId: "a1", sessionKey: "main" },
        [makeMsg()],
      );

      await ChatCacheService.deleteMessages("gw1", "a1", "main");

      await expect(
        ChatCacheService.getMessages("gw1", "a1", "main"),
      ).resolves.toEqual([]);
      await expect(
        ChatCacheService.getSessionMeta("gw1", "a1", "main"),
      ).resolves.toBeNull();
    });

    it("removes all generations when sessionId is omitted", async () => {
      await ChatCacheService.saveMessages(
        {
          gatewayConfigId: "gw1",
          agentId: "a1",
          sessionKey: "main",
          sessionId: "sess-old",
        },
        [makeMsg({ id: "1", text: "Old generation message" })],
      );
      await ChatCacheService.saveMessages(
        {
          gatewayConfigId: "gw1",
          agentId: "a1",
          sessionKey: "main",
          sessionId: "sess-new",
        },
        [makeMsg({ id: "2", text: "New generation message" })],
      );

      await ChatCacheService.deleteMessages("gw1", "a1", "main");

      await expect(
        ChatCacheService.getMessages("gw1", "a1", "main", "sess-old"),
      ).resolves.toEqual([]);
      await expect(
        ChatCacheService.getMessages("gw1", "a1", "main", "sess-new"),
      ).resolves.toEqual([]);
    });
  });

  describe("clearAll", () => {
    it("removes all cached data", async () => {
      await ChatCacheService.saveMessages(
        { gatewayConfigId: "gw1", agentId: "a1", sessionKey: "s1" },
        [makeMsg()],
      );
      await ChatCacheService.saveMessages(
        { gatewayConfigId: "gw1", agentId: "a2", sessionKey: "s2" },
        [makeMsg()],
      );

      await ChatCacheService.clearAll();

      const sessions = await ChatCacheService.listSessions();
      expect(sessions).toHaveLength(0);
    });
  });

  describe("clearConnection", () => {
    it("removes all indexed and orphaned chunks for one connection only", async () => {
      await ChatCacheService.saveMessages(
        {
          gatewayConfigId: "gw1",
          agentId: "a1",
          sessionKey: "main",
          sessionId: "old",
        },
        [makeMsg({ id: "gw1-old", text: "First connection old" })],
      );
      await ChatCacheService.saveMessages(
        {
          gatewayConfigId: "gw1",
          agentId: "a1",
          sessionKey: "main",
          sessionId: "new",
        },
        [makeMsg({ id: "gw1-new", text: "First connection new" })],
      );
      await ChatCacheService.saveMessages(
        { gatewayConfigId: "gw2", agentId: "a1", sessionKey: "main" },
        [makeMsg({ id: "gw2", text: "Second connection" })],
      );
      store["clawket.chatCache.msgs.gw1::orphan::rev:stale::chunk:0"] =
        JSON.stringify([makeMsg({ id: "orphan", text: "Orphaned secret" })]);

      await ChatCacheService.clearConnection("gw1");

      expect(Object.keys(store).some((key) => (
        key.startsWith("clawket.chatCache.msgs.gw1::")
      ))).toBe(false);
      expect(Object.keys(store).some((key) => (
        key.startsWith("clawket.chatCache.msgs.gw2::")
      ))).toBe(true);
      await expect(ChatCacheService.listSessions()).resolves.toEqual([
        expect.objectContaining({ gatewayConfigId: "gw2" }),
      ]);
      await expect(
        ChatCacheService.getMessages("gw1", "a1", "main", "old"),
      ).resolves.toEqual([]);
      await expect(
        ChatCacheService.getMessages("gw2", "a1", "main"),
      ).resolves.toEqual([expect.objectContaining({ text: "Second connection" })]);
    });

    it("fails before changing cache state when storage cannot be enumerated", async () => {
      await ChatCacheService.saveMessages(
        { gatewayConfigId: "gw1", agentId: "a1", sessionKey: "main" },
        [makeMsg({ id: "gw1", text: "Keep after failure" })],
      );
      (AsyncStorage.getAllKeys as jest.Mock).mockRejectedValueOnce(
        new Error("storage unavailable"),
      );

      await expect(ChatCacheService.clearConnection("gw1")).rejects.toThrow(
        "storage unavailable",
      );
      await expect(ChatCacheService.getMessages("gw1", "a1", "main")).resolves.toEqual([
        expect.objectContaining({ text: "Keep after failure" }),
      ]);
      await expect(ChatCacheService.clearConnection(" ")).rejects.toThrow(
        "Connection id is required",
      );
    });
  });

  describe("search", () => {
    it("finds messages matching query across sessions", async () => {
      await ChatCacheService.saveMessages(
        { gatewayConfigId: "gw1", agentId: "a1", sessionKey: "s1" },
        [
          makeMsg({ id: "1", text: "How to deploy" }),
          makeMsg({ id: "2", text: "Weather today" }),
        ],
      );
      await ChatCacheService.saveMessages(
        { gatewayConfigId: "gw1", agentId: "a2", sessionKey: "s2" },
        [makeMsg({ id: "3", text: "Deploy instructions" })],
      );

      const results = await ChatCacheService.search("deploy");
      expect(results).toHaveLength(2);
      expect(results[0].matches).toHaveLength(1);
    });

    it("filters by agent", async () => {
      await ChatCacheService.saveMessages(
        { gatewayConfigId: "gw1", agentId: "a1", sessionKey: "s1" },
        [makeMsg({ id: "1", text: "Deploy app" })],
      );
      await ChatCacheService.saveMessages(
        { gatewayConfigId: "gw1", agentId: "a2", sessionKey: "s2" },
        [makeMsg({ id: "2", text: "Deploy server" })],
      );

      const results = await ChatCacheService.search("deploy", {
        agentId: "a1",
      });
      expect(results).toHaveLength(1);
      expect(results[0].meta.agentId).toBe("a1");
    });

    it("filters by gateway and agent together", async () => {
      await ChatCacheService.saveMessages(
        { gatewayConfigId: "gw1", agentId: "main", sessionKey: "s1" },
        [makeMsg({ id: "1", text: "Deploy app" })],
      );
      await ChatCacheService.saveMessages(
        { gatewayConfigId: "gw2", agentId: "main", sessionKey: "s2" },
        [makeMsg({ id: "2", text: "Deploy server" })],
      );

      const results = await ChatCacheService.search("deploy", {
        gatewayConfigId: "gw2",
        agentId: "main",
      });
      expect(results).toHaveLength(1);
      expect(results[0].meta.gatewayConfigId).toBe("gw2");
    });

    it("searches tool names and summaries", async () => {
      await ChatCacheService.saveMessages(
        { gatewayConfigId: "gw1", agentId: "a1", sessionKey: "s1" },
        [
          makeMsg({
            id: "1",
            role: "tool",
            text: "",
            toolName: "bash",
            toolSummary: "Executed npm install",
          }),
        ],
      );

      const byName = await ChatCacheService.search("bash");
      expect(byName).toHaveLength(1);

      const bySummary = await ChatCacheService.search("npm install");
      expect(bySummary).toHaveLength(1);
    });
  });

  describe("getTimelinePage", () => {
    it("returns the most recent page across the combined session timeline", async () => {
      const messages = Array.from({ length: 230 }, (_, index) =>
        makeMsg({
          id: `page_${index}`,
          role: index % 2 === 0 ? "user" : "assistant",
          text: `Page ${index}`,
          timestampMs: 1_700_000_100_000 + index,
        }),
      );

      await ChatCacheService.saveMessages(
        {
          gatewayConfigId: "gw1",
          agentId: "agent1",
          sessionKey: "agent:agent1:main",
          sessionId: "sess-1",
        },
        messages,
      );

      const page = await ChatCacheService.getTimelinePage(
        "gw1",
        "agent1",
        "agent:agent1:main",
        {
          pageSize: 50,
        },
      );

      expect(page.messages).toHaveLength(50);
      expect(page.messages[0]?.text).toBe("Page 180");
      expect(page.messages[49]?.text).toBe("Page 229");
      expect(page.hasMore).toBe(true);
    });

    it("returns the next older page before the supplied message id", async () => {
      const oldGeneration = Array.from({ length: 80 }, (_, index) =>
        makeMsg({
          id: `old_${index}`,
          role: index % 2 === 0 ? "user" : "assistant",
          text: `Old ${index}`,
          timestampMs: 1_700_000_200_000 + index,
        }),
      );
      const currentGeneration = Array.from({ length: 80 }, (_, index) =>
        makeMsg({
          id: `current_${index}`,
          role: index % 2 === 0 ? "user" : "assistant",
          text: `Current ${index}`,
          timestampMs: 1_700_000_300_000 + index,
        }),
      );

      await ChatCacheService.saveMessages(
        {
          gatewayConfigId: "gw1",
          agentId: "agent1",
          sessionKey: "agent:agent1:main",
          sessionId: "sess-old",
        },
        oldGeneration,
      );
      await ChatCacheService.saveMessages(
        {
          gatewayConfigId: "gw1",
          agentId: "agent1",
          sessionKey: "agent:agent1:main",
          sessionId: "sess-current",
        },
        currentGeneration,
      );

      const latestPage = await ChatCacheService.getTimelinePage(
        "gw1",
        "agent1",
        "agent:agent1:main",
        {
          pageSize: 40,
        },
      );
      const olderPage = await ChatCacheService.getTimelinePage(
        "gw1",
        "agent1",
        "agent:agent1:main",
        {
          pageSize: 40,
          beforeMessageId: latestPage.messages[0]?.id,
        },
      );

      expect(olderPage.messages).toHaveLength(40);
      expect(olderPage.messages[0]?.text).toBe("Current 0");
      expect(olderPage.messages[39]?.text).toBe("Current 39");
      expect(olderPage.hasMore).toBe(true);
    });
  });

  describe("cache key isolation", () => {
    it("isolates by gateway config ID", async () => {
      await ChatCacheService.saveMessages(
        { gatewayConfigId: "gw1", agentId: "a1", sessionKey: "main" },
        [makeMsg({ id: "1", text: "Gateway 1 message" })],
      );
      await ChatCacheService.saveMessages(
        { gatewayConfigId: "gw2", agentId: "a1", sessionKey: "main" },
        [makeMsg({ id: "2", text: "Gateway 2 message" })],
      );

      const gw1 = await ChatCacheService.getMessages("gw1", "a1", "main");
      const gw2 = await ChatCacheService.getMessages("gw2", "a1", "main");
      expect(gw1[0].text).toBe("Gateway 1 message");
      expect(gw2[0].text).toBe("Gateway 2 message");
    });

    it("isolates by agent ID", async () => {
      await ChatCacheService.saveMessages(
        { gatewayConfigId: "gw1", agentId: "a1", sessionKey: "main" },
        [makeMsg({ id: "1", text: "Agent 1" })],
      );
      await ChatCacheService.saveMessages(
        { gatewayConfigId: "gw1", agentId: "a2", sessionKey: "main" },
        [makeMsg({ id: "2", text: "Agent 2" })],
      );

      const a1 = await ChatCacheService.getMessages("gw1", "a1", "main");
      const a2 = await ChatCacheService.getMessages("gw1", "a2", "main");
      expect(a1[0].text).toBe("Agent 1");
      expect(a2[0].text).toBe("Agent 2");
    });

    it("isolates by session key", async () => {
      await ChatCacheService.saveMessages(
        { gatewayConfigId: "gw1", agentId: "a1", sessionKey: "session1" },
        [makeMsg({ id: "1", text: "Session 1" })],
      );
      await ChatCacheService.saveMessages(
        { gatewayConfigId: "gw1", agentId: "a1", sessionKey: "session2" },
        [makeMsg({ id: "2", text: "Session 2" })],
      );

      const s1 = await ChatCacheService.getMessages("gw1", "a1", "session1");
      const s2 = await ChatCacheService.getMessages("gw1", "a1", "session2");
      expect(s1[0].text).toBe("Session 1");
      expect(s2[0].text).toBe("Session 2");
    });
  });
});


it('round-trips participant identity and local-send evidence in connection-scoped cache', async () => {
  const scope = { gatewayConfigId: 'participants-a', agentId: 'main', sessionKey: 'agent:main:slack:channel:room' };
  const incoming = makeMsg({ id: 'incoming', attribution: { channel: 'slack', accountId: 'workspace',
    sender: { id: 'user-a', name: 'Alice', avatarUrl: 'https://cdn.example.com/alice.png' } } });
  const own = makeMsg({ id: 'own', sentLocally: true, idempotencyKey: 'local-send' });
  await ChatCacheService.saveMessages(scope, [incoming, own]);
  const restored = await ChatCacheService.getMessages(scope.gatewayConfigId, scope.agentId, scope.sessionKey);
  expect(restored[0].attribution).toMatchObject(incoming.attribution!);
  expect(restored[1].sentLocally).toBe(true);
  const mapped = await DEFAULT_GATEWAY_HISTORY_CACHE.load(scope.gatewayConfigId, scope.agentId, scope.sessionKey, 50);
  expect(mapped[0].attribution).toMatchObject(incoming.attribution!);
  expect(mapped[1].sentLocally).toBe(true);
  expect(await ChatCacheService.getMessages('participants-b', scope.agentId, scope.sessionKey)).toEqual([]);
});
