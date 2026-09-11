import { AppState, AppStateStatus, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18next from '../i18n';

export type ChatNotificationOpenPayload = {
  type: 'chat-reply';
  sessionKey: string;
  agentId?: string;
  runId?: string;
};

type ChatNotificationResponse = {
  notification?: {
    request?: {
      identifier?: string;
      content?: {
        data?: unknown;
      };
    };
  };
};

type ChatNotificationRequest = {
  agentId?: string;
  agentName: string;
  previewText?: string | null;
  runId?: string;
  sessionKey: string;
};

const CHAT_REPLY_NOTIFICATIONS_KEY = 'clawket.chatReplyNotifications.v1';

let notificationHandlerInitialized = false;
let chatReplyNotificationsEnabled = false;
const recentNotificationKeys = new Map<string, number>();
const RECENT_NOTIFICATION_TTL_MS = 60_000;

export function areChatReplyNotificationsEnabled(): boolean {
  return chatReplyNotificationsEnabled;
}

export async function loadChatReplyNotificationsEnabled(): Promise<boolean> {
  try {
    chatReplyNotificationsEnabled = await AsyncStorage.getItem(CHAT_REPLY_NOTIFICATIONS_KEY) === 'true';
  } catch {
    chatReplyNotificationsEnabled = false;
  }
  initializeChatNotifications();
  return chatReplyNotificationsEnabled;
}

export async function setChatReplyNotificationsEnabled(enabled: boolean): Promise<void> {
  chatReplyNotificationsEnabled = enabled;
  await AsyncStorage.setItem(CHAT_REPLY_NOTIFICATIONS_KEY, enabled ? 'true' : 'false');
  initializeChatNotifications();
}

export function shouldShowChatReplyNotification(params: {
  activeTab: string;
  appState: AppStateStatus;
}): boolean {
  if (!chatReplyNotificationsEnabled) return false;
  const threadVisible = params.activeTab === 'Thread' || params.activeTab === 'Chat';
  return !threadVisible || params.appState !== 'active';
}

export function buildChatReplyNotificationTitle(agentName: string): string {
  return i18next.t('{{agentName}} replied', {
    ns: 'chat',
    agentName,
    defaultValue: '{{agentName}} replied',
  });
}

export function buildChatReplyNotificationBody(params: {
  agentName: string;
  previewText?: string | null;
}): string {
  const preview = params.previewText?.replace(/\s+/g, ' ').trim();
  if (preview) return preview.slice(0, 160);
  return i18next.t('New message from {{agentName}}', {
    ns: 'chat',
    agentName: params.agentName,
    defaultValue: 'New message from {{agentName}}',
  });
}

function pruneRecentNotificationKeys(now: number): void {
  for (const [key, timestamp] of recentNotificationKeys.entries()) {
    if (now - timestamp > RECENT_NOTIFICATION_TTL_MS) {
      recentNotificationKeys.delete(key);
    }
  }
}

function makeRecentNotificationKey(request: ChatNotificationRequest): string {
  return `${request.sessionKey}:${request.runId ?? ''}`;
}

export function initializeChatNotifications(): void {
  if (!chatReplyNotificationsEnabled) return;
  if (Platform.OS !== 'ios' || notificationHandlerInitialized) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  notificationHandlerInitialized = true;
}

export async function ensureChatNotificationPermissions(): Promise<boolean> {
  if (!chatReplyNotificationsEnabled) return false;
  if (Platform.OS !== 'ios') return false;
  let permissions = await Notifications.getPermissionsAsync();
  if (permissions.granted) return true;
  if (AppState.currentState !== 'active') return false;
  permissions = await Notifications.requestPermissionsAsync();
  return !!permissions.granted;
}

export async function scheduleChatReplyNotification(
  request: ChatNotificationRequest,
): Promise<boolean> {
  if (!chatReplyNotificationsEnabled) return false;
  if (Platform.OS !== 'ios') return false;
  initializeChatNotifications();
  const hasPermission = await ensureChatNotificationPermissions();
  if (!hasPermission) return false;

  const now = Date.now();
  pruneRecentNotificationKeys(now);
  const dedupeKey = makeRecentNotificationKey(request);
  const lastSentAt = recentNotificationKeys.get(dedupeKey);
  if (lastSentAt && now - lastSentAt < RECENT_NOTIFICATION_TTL_MS) {
    return false;
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title: buildChatReplyNotificationTitle(request.agentName),
      body: buildChatReplyNotificationBody({
        agentName: request.agentName,
        previewText: request.previewText,
      }),
      data: {
        type: 'chat-reply',
        sessionKey: request.sessionKey,
        agentId: request.agentId,
        runId: request.runId,
      } satisfies ChatNotificationOpenPayload,
    },
    trigger: null,
  });
  recentNotificationKeys.set(dedupeKey, now);
  return true;
}

export function extractChatNotificationOpenPayload(
  response: ChatNotificationResponse | null | undefined,
): ChatNotificationOpenPayload | null {
  const data = response?.notification?.request?.content?.data;
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  if (record.type !== 'chat-reply') return null;
  if (typeof record.sessionKey !== 'string' || record.sessionKey.trim().length === 0) {
    return null;
  }
  return {
    type: 'chat-reply',
    sessionKey: record.sessionKey.trim(),
    agentId: typeof record.agentId === 'string' && record.agentId.trim().length > 0
      ? record.agentId.trim()
      : undefined,
    runId: typeof record.runId === 'string' && record.runId.trim().length > 0
      ? record.runId.trim()
      : undefined,
  };
}

export function getChatNotificationResponseIdentifier(
  response: ChatNotificationResponse | null | undefined,
): string | null {
  const identifier = response?.notification?.request?.identifier;
  if (typeof identifier !== 'string' || identifier.trim().length === 0) return null;
  return identifier;
}
