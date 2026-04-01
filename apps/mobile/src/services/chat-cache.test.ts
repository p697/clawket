import AsyncStorage from "@react-native-async-storage/async-storage";
import { ChatCacheService, CachedSessionMeta } from "./chat-cache";
import { UiMessage } from "../types/chat";

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
  describe("saveMessages + getMessages", () => {
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
          toolSummary: "Executed pnpm test",
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
            toolSummary: "Executed pnpm add -g",
          }),
        ],
      );

      const byName = await ChatCacheService.search("bash");
      expect(byName).toHaveLength(1);

      const bySummary = await ChatCacheService.search("pnpm add -g");
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
