// Bridge: listens for postMessage from React Native and maps sessions to characters

import {
  createAllCharacters,
  setCharacterActivity,
  setBossPresence,
  triggerCharacterRushToDesk,
  type Character,
} from "./character";
import type { BubbleContext } from "./bubbles";
import {
  DEFAULT_OFFICE_CHANNEL_SLOT_CONFIG,
  isOfficeChannelSlotId,
  normalizeOfficeChannelId,
  normalizeOfficeChannelSlotConfig,
  officeChannelLabel,
  type OfficeChannelId,
  type OfficeChannelSlotConfig,
  type OfficeChannelSlotId,
} from "./channel-config";
import { setLocale } from "./i18n";

export interface SessionData {
  key: string;
  kind?: string;
  channel?: string;
  active: boolean;
  label?: string;
  updatedAt?: number | null;
  lastMessage?: string;
  model?: string;
}

interface SessionUpdateMessage {
  type: "SESSION_UPDATE";
  sessions: SessionData[];
}

interface TypingStateMessage {
  type: "TYPING_STATE";
  isTyping: boolean;
}

interface CharacterTapMessage {
  type: "CHARACTER_TAP";
  characterId: string;
}

interface UsageUpdateMessage {
  type: "USAGE_UPDATE";
  todayCost: number;
  todayTokens: number;
}

interface OfficeChannelConfigMessage {
  type: "OFFICE_CHANNEL_CONFIG";
  slots?: unknown;
}

interface ChannelStatusUpdateMessage {
  type: "CHANNEL_STATUS_UPDATE";
  statuses: Record<string, string>;
}

interface MemoryFileCountMessage {
  type: "MEMORY_FILE_COUNT";
  count: number;
}

interface PendingPairCountMessage {
  type: "PENDING_PAIR_COUNT";
  count: number;
}

interface CronFailureCountMessage {
  type: "CRON_FAILURE_COUNT";
  count: number;
}

interface AgentNameMessage {
  type: "AGENT_NAME";
  name: string;
}

interface LocaleMessage {
  type: "LOCALE";
  locale: string;
}

interface GatewayStateMessage {
  type: "GATEWAY_STATE";
  state: "configured" | "none";
}

interface OfficeInteractionConfigMessage {
  type: "OFFICE_INTERACTION_CONFIG";
  disabledCharacterIds?: string[];
  hiddenDeskLabelIds?: string[];
  disabledPropActions?: string[];
}

export interface DailyReportData {
  mainMessages: number;
  mainUserMessages: number;
  dmMessages: number;
  dmUserMessages: number;
  subagentMessages: number;
  cronMessages: number;
  channelMessages: Record<string, number>;
}

interface DailyReportDataMessage {
  type: "DAILY_REPORT_DATA";
  data: DailyReportData;
}

interface MenuActionMessage {
  type: "MENU_ACTION";
  action:
    | "chat"
    | "sessions"
    | "open_session"
    | "set_channel"
    | "memory"
    | "connections"
    | "status"
    | "management"
    | "skills"
    | "logs"
    | "console"
    | "models"
    | "new_cron"
    | "add_gateway"
    | "tools"
    | "node_devices";
  characterId: string;
  sessionKey?: string;
  channelId?: string;
}

type BridgeMessage =
  | SessionUpdateMessage
  | TypingStateMessage
  | CharacterTapMessage
  | MenuActionMessage
  | UsageUpdateMessage
  | OfficeChannelConfigMessage
  | ChannelStatusUpdateMessage
  | MemoryFileCountMessage
  | PendingPairCountMessage
  | CronFailureCountMessage
  | OfficeInteractionConfigMessage
  | GatewayStateMessage
  | DailyReportDataMessage
  | AgentNameMessage
  | LocaleMessage;

let characters: Character[] = [];
let onCharactersChanged: ((chars: Character[]) => void) | null = null;

// Buffer messages received before initBridge() registers the character callback.
// This prevents the LOCALE (and other early messages) from being lost when
// RN's onLoadEnd fires before the async sprite loading completes.
let earlyMessages: MessageEvent[] = [];
let bridgeReady = false;

function handleMessageDispatch(event: MessageEvent): void {
  if (!bridgeReady) {
    earlyMessages.push(event);
    return;
  }
  handleMessage(event);
}

// Register listeners at module scope so no messages are dropped.
window.addEventListener("message", handleMessageDispatch);
document.addEventListener("message", handleMessageDispatch as EventListener);
let mainTyping = false;
let latestSessions: SessionData[] = [];
let usageTodayCost: number | null = null;
let usageTodayTokens: number | null = null;
let channelSlots: OfficeChannelSlotConfig = {
  ...DEFAULT_OFFICE_CHANNEL_SLOT_CONFIG,
};
let channelConnectionStatuses: Record<string, string> = {};
let memoryFileCount = 0;
let pendingPairCount = 0;
let cronFailureCount = 0;
let gatewayState: "configured" | "none" = "none";
let dailyReportData: DailyReportData | null = null;
let agentName: string | null = null;
let disabledCharacterIds = new Set<string>();
let hiddenDeskLabelIds = new Set<string>();
let disabledPropActions = new Set<string>();

export const EVENING_START_HOUR = 18;
export const EVENING_END_HOUR = 22;

const MAIN_ACTIVE_WINDOW_MS = 60_000;
const WORKER_RECENT_WINDOW_MS = 120_000;
const SUBAGENT_RECENT_WINDOW_MS = 5 * 60_000;
const SUBAGENT_ACTIVE_STICKY_WINDOW_MS = 10 * 60_000;

const CHANNEL_KEY_ALIASES: Record<OfficeChannelId, string[]> = {
  telegram: ["telegram"],
  discord: ["discord"],
  slack: ["slack"],
  feishu: ["feishu", "lark"],
  whatsapp: ["whatsapp"],
  googlechat: ["googlechat", "google-chat", "google_chat", "gchat"],
  signal: ["signal"],
  imessage: ["imessage", "i_message"],
  webchat: ["webchat", "web_chat"],
};

export function initBridge(
  onChange: (chars: Character[]) => void,
): Character[] {
  onCharactersChanged = onChange;
  characters = createAllCharacters();

  // Replay any messages that arrived before initBridge was called.
  bridgeReady = true;
  for (const msg of earlyMessages) {
    handleMessage(msg);
  }
  earlyMessages = [];

  return characters;
}

function handleMessage(event: MessageEvent): void {
  let data: BridgeMessage;
  try {
    data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
  } catch {
    return;
  }

  switch (data.type) {
    case "SESSION_UPDATE":
      handleSessionUpdate(data.sessions);
      break;
    case "TYPING_STATE":
      handleTypingState(data.isTyping);
      break;
    case "USAGE_UPDATE":
      usageTodayCost = data.todayCost;
      usageTodayTokens = data.todayTokens;
      gatewayState = "configured";
      break;
    case "OFFICE_CHANNEL_CONFIG":
      channelSlots = normalizeOfficeChannelSlotConfig(data.slots);
      handleSessionUpdate(latestSessions);
      break;
    case "CHANNEL_STATUS_UPDATE":
      channelConnectionStatuses = data.statuses;
      break;
    case "MEMORY_FILE_COUNT":
      memoryFileCount = data.count ?? 0;
      break;
    case "PENDING_PAIR_COUNT":
      pendingPairCount = data.count ?? 0;
      break;
    case "CRON_FAILURE_COUNT":
      cronFailureCount = data.count ?? 0;
      break;
    case "GATEWAY_STATE":
      gatewayState = data.state;
      break;
    case "OFFICE_INTERACTION_CONFIG":
      disabledCharacterIds = new Set(Array.isArray(data.disabledCharacterIds) ? data.disabledCharacterIds : []);
      hiddenDeskLabelIds = new Set(Array.isArray(data.hiddenDeskLabelIds) ? data.hiddenDeskLabelIds : []);
      disabledPropActions = new Set(Array.isArray(data.disabledPropActions) ? data.disabledPropActions : []);
      break;
    case "DAILY_REPORT_DATA":
      dailyReportData = data.data;
      break;
    case "AGENT_NAME":
      agentName = data.name || null;
      break;
    case "LOCALE":
      setLocale(data.locale);
      break;
    case "CHARACTER_TAP":
      // v1: no-op, hook for v2
      break;
  }
}

function debugLog(msg: string): void {
  if ((window as any).ReactNativeWebView) {
    (window as any).ReactNativeWebView.postMessage(
      JSON.stringify({ type: "OFFICE_DEBUG", message: msg }),
    );
  }
}

function handleTypingState(isTyping: boolean): void {
  mainTyping = isTyping;

  const secretary = characters.find((c) => c.id === "assistant");
  if (secretary) {
    setCharacterActivity(secretary, mainTyping);
    debugLog(`typing: secretary ${mainTyping ? "W" : "I"}`);
    if (onCharactersChanged) onCharactersChanged(characters);
  }
}

function handleSessionUpdate(sessions: SessionData[]): void {
  latestSessions = sessions;
  const now = Date.now();

  // 1. Main session + DM sessions (secretary) — active if typing OR recently updated (within 60s)
  const mainSession = sessions.find((s) => /^agent:[^:]+:main$/.test(s.key));
  const dmSessions = sessions.filter((s) => s.kind === "direct");
  const mainOrDmActive =
    mainTyping ||
    (mainSession?.updatedAt
      ? now - mainSession.updatedAt < MAIN_ACTIVE_WINDOW_MS
      : false) ||
    dmSessions.some(
      (s) => s.updatedAt && now - s.updatedAt < MAIN_ACTIVE_WINDOW_MS,
    );
  const mainActive = mainOrDmActive;

  // 2. Sub-agents — active if ANY sub-agent session was recently updated
  const subSessions = sessions.filter(
    (s) => s.key.includes(":subagent:") || s.key.includes(":sub:"),
  );
  const subActive = subSessions.some((s) => {
    const ageMs =
      typeof s.updatedAt === "number"
        ? now - s.updatedAt
        : Number.POSITIVE_INFINITY;
    if (ageMs < SUBAGENT_RECENT_WINDOW_MS) return true;
    // Keep subagent in working mode a little longer when the upstream marks
    // a session as active, even if it hasn't emitted a very recent update.
    if (s.active === true && ageMs < SUBAGENT_ACTIVE_STICKY_WINDOW_MS)
      return true;
    // If updatedAt is absent but session is marked active, treat it as active.
    if (s.active === true && !Number.isFinite(ageMs)) return true;
    return false;
  });

  // 3. Cron jobs — active if any cron session was recently updated
  const cronSessions = sessions.filter((s) => s.key.includes(":cron:"));
  const cronActive = cronSessions.some(
    (s) => s.updatedAt && now - s.updatedAt < WORKER_RECENT_WINDOW_MS,
  );

  // 4. Channel agents — active if the channel's session was recently updated
  const channelActive = (channelId: OfficeChannelId): boolean => {
    const channelSessions = sessions.filter((s) => {
      const normalized = normalizeOfficeChannelId(s.channel);
      if (normalized === channelId) return true;
      return CHANNEL_KEY_ALIASES[channelId].some((alias) =>
        s.key.includes(`:${alias}:`),
      );
    });
    return channelSessions.some(
      (s) => s.updatedAt && now - s.updatedAt < WORKER_RECENT_WINDOW_MS,
    );
  };

  // 5. Boss — present when user is active (main session recently updated)
  //    Absent (chair empty) when idle >5min
  const bossPresent = mainSession?.updatedAt
    ? now - mainSession.updatedAt < 300_000
    : false;

  // Update character states
  const charById = new Map<string, Character>();
  for (const c of characters) charById.set(c.id, c);

  const boss = charById.get("boss");
  if (boss) setBossPresence(boss, bossPresent);

  const secretary = charById.get("assistant");
  if (secretary) setCharacterActivity(secretary, mainActive);

  const subagent = charById.get("subagent");
  if (subagent) {
    setCharacterActivity(subagent, subActive);
    // sub-agent is always visible — slacks when not working
  }

  const cron = charById.get("cron");
  if (cron) setCharacterActivity(cron, cronActive);

  const channel1 = charById.get("channel1");
  if (channel1)
    setCharacterActivity(channel1, channelActive(channelSlots.channel1));

  const channel2 = charById.get("channel2");
  if (channel2)
    setCharacterActivity(channel2, channelActive(channelSlots.channel2));

  const channel3 = charById.get("channel3");
  if (channel3)
    setCharacterActivity(channel3, channelActive(channelSlots.channel3));

  const channel4 = charById.get("channel4");
  if (channel4)
    setCharacterActivity(channel4, channelActive(channelSlots.channel4));

  // Debug: log state changes
  const states = characters.map(
    (c) => `${c.id}:${c.forceWork ? "W" : "I"}${c.visible ? "" : "(hidden)"}`,
  );
  debugLog(`states: ${states.join(" | ")}`);

  if (onCharactersChanged) onCharactersChanged(characters);
}

/** Return the latest session list received from RN. */
export function getLatestSessions(): SessionData[] {
  return latestSessions;
}

export function postToRN(message: unknown): void {
  if ((window as any).ReactNativeWebView) {
    (window as any).ReactNativeWebView.postMessage(JSON.stringify(message));
  }
}

export function getChannelForSlot(
  slotId: OfficeChannelSlotId,
): OfficeChannelId {
  return channelSlots[slotId];
}

export function getChannelLabelForSlot(slotId: string): string {
  if (!isOfficeChannelSlotId(slotId)) return slotId;
  return officeChannelLabel(getChannelForSlot(slotId));
}

export function getOfficeChannelSlots(): OfficeChannelSlotConfig {
  return { ...channelSlots };
}

/** Return today's usage data received from RN. null = not yet received. */
export function getUsageData(): {
  todayCost: number | null;
  todayTokens: number | null;
} {
  return { todayCost: usageTodayCost, todayTokens: usageTodayTokens };
}

/** Return the connection status for a channel slot: 'connected' | 'configured' | 'none'. */
export function getChannelConnectionStatus(slotId: string): string {
  return channelConnectionStatuses[slotId] || "none";
}

/** Return the current memory file count received from RN. */
export function getMemoryFileCount(): number {
  return memoryFileCount;
}

/** Return the pending pair request count received from RN. */
export function getPendingPairCount(): number {
  return pendingPairCount;
}

/** Return the cron failure count received from RN. */
export function getCronFailureCount(): number {
  return cronFailureCount;
}

/** Return whether a gateway is configured. */
export function getGatewayState(): "configured" | "none" {
  return gatewayState;
}

/** Return the daily report data received from RN. null = not yet received. */
export function getDailyReportData(): DailyReportData | null {
  return dailyReportData;
}

/** Return the agent name received from RN. null = not yet received. */
export function getAgentName(): string | null {
  return agentName;
}

export function isOfficeCharacterDisabled(characterId: string): boolean {
  return disabledCharacterIds.has(characterId);
}

export function isDeskLabelHidden(characterId: string): boolean {
  return hiddenDeskLabelIds.has(characterId);
}

export function isOfficeActionDisabled(action: string): boolean {
  return disabledPropActions.has(action);
}

/** Derive bubble context from current bridge state (no new bridge messages needed). */
export function getBubbleContext(): BubbleContext {
  const now = Date.now();
  const date = new Date();
  const hour = date.getHours();

  const subSessions = latestSessions.filter(
    (s) => s.key.includes(":subagent:") || s.key.includes(":sub:"),
  );
  const cronSessions = latestSessions.filter((s) => s.key.includes(":cron:"));
  const mainSession = latestSessions.find((s) =>
    /^agent:[^:]+:main$/.test(s.key),
  );

  return {
    isMainActive:
      mainTyping || (mainSession?.updatedAt ?? 0) > now - MAIN_ACTIVE_WINDOW_MS,
    subagentCount: subSessions.filter(
      (s) => s.updatedAt && now - s.updatedAt < SUBAGENT_RECENT_WINDOW_MS,
    ).length,
    cronSessionCount: cronSessions.filter(
      (s) => s.updatedAt && now - s.updatedAt < WORKER_RECENT_WINDOW_MS,
    ).length,
    cronFailureCount,
    activeJobId: cronSessions[0]?.key.split(":").pop(),
    isEarlyMorning: hour >= 7 && hour < 9,
    isLunch: hour >= 12 && hour < 13,
    isEvening: hour >= EVENING_START_HOUR && hour < EVENING_END_HOUR,
    isLateNight: hour >= 22 || hour < 5,
    currentTime: `${String(hour).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
  };
}

/** Called by the office clock interaction in canvas renderer. */
export function triggerOfficeClockRecall(): void {
  // Recall everyone except boss (boss is the user avatar).
  for (const c of characters) {
    if (c.id === "boss") continue;
    triggerCharacterRushToDesk(c, 10_000);
  }
  debugLog("clock: recall workers to desks (2x)");
  if (onCharactersChanged) onCharactersChanged(characters);
}
