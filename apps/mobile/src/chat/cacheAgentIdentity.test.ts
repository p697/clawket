import type { AgentInfo } from "../types/agent";
import { resolveCachedAgentIdentity } from "./cacheAgentIdentity";

describe("resolveCachedAgentIdentity", () => {
  const agents: AgentInfo[] = [
    { id: "main", identity: { name: "Main Agent", emoji: "🤖" } },
    { id: "writer", identity: { name: "Writer", emoji: "✍️" } },
  ];

  it("uses the agent derived from the session key when available", () => {
    expect(
      resolveCachedAgentIdentity(agents, "main", "agent:writer:main"),
    ).toEqual({
      agentId: "writer",
      agentName: "Writer",
      agentEmoji: "✍️",
    });
  });

  it("falls back to the current agent for non-agent session keys", () => {
    expect(
      resolveCachedAgentIdentity(agents, "main", "channel:slack:alerts"),
    ).toEqual({
      agentId: "main",
      agentName: "Main Agent",
      agentEmoji: "🤖",
    });
  });

  it("does not reuse the current agent name when the derived agent is missing", () => {
    expect(
      resolveCachedAgentIdentity(agents, "main", "agent:missing:main"),
    ).toEqual({
      agentId: "missing",
      agentName: undefined,
      agentEmoji: undefined,
    });
  });
});
