import {
  areChatReplyNotificationsEnabled,
  buildChatReplyNotificationBody,
  extractChatNotificationOpenPayload,
  getChatNotificationResponseIdentifier,
  loadChatReplyNotificationsEnabled,
  setChatReplyNotificationsEnabled,
  shouldShowChatReplyNotification,
} from './chat-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

describe('chat notifications', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
    await setChatReplyNotificationsEnabled(false);
  });

  it('keeps chat reply notifications disabled by default', () => {
    expect(areChatReplyNotificationsEnabled()).toBe(false);
  });

  it('does not show a notification when the feature is disabled', () => {
    expect(shouldShowChatReplyNotification({
      activeTab: 'Console',
      appState: 'active',
    })).toBe(false);
    expect(shouldShowChatReplyNotification({
      activeTab: 'Chat',
      appState: 'background',
    })).toBe(false);
  });

  it('persists the account preference and enables background replies', async () => {
    await setChatReplyNotificationsEnabled(true);

    expect(areChatReplyNotificationsEnabled()).toBe(true);
    expect(shouldShowChatReplyNotification({
      activeTab: 'Thread',
      appState: 'active',
    })).toBe(false);
    expect(shouldShowChatReplyNotification({
      activeTab: 'Roster',
      appState: 'active',
    })).toBe(true);
    expect(shouldShowChatReplyNotification({
      activeTab: 'Thread',
      appState: 'background',
    })).toBe(true);

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'clawket.chatReplyNotifications.v1',
      'true',
    );
    await setChatReplyNotificationsEnabled(false);
    jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce('true');
    await expect(loadChatReplyNotificationsEnabled()).resolves.toBe(true);
  });

  it('falls back to a generic body when preview text is missing', () => {
    expect(buildChatReplyNotificationBody({
      agentName: 'Milo',
      previewText: '   ',
    })).toBe('New message from Milo');
  });

  it('extracts notification open payload from response data', () => {
    const payload = extractChatNotificationOpenPayload({
      notification: {
        request: {
          content: {
            data: {
              type: 'chat-reply',
              sessionKey: 'agent:main:main',
              agentId: 'main',
              runId: 'run-1',
            },
          },
        },
      },
    });

    expect(payload).toEqual({
      type: 'chat-reply',
      sessionKey: 'agent:main:main',
      agentId: 'main',
      runId: 'run-1',
    });
  });

  it('returns null for unrelated notification payloads', () => {
    expect(extractChatNotificationOpenPayload({
      notification: {
        request: {
          content: {
            data: {
              type: 'other',
            },
          },
        },
      },
    })).toBeNull();
  });

  it('returns the response identifier when present', () => {
    expect(getChatNotificationResponseIdentifier({
      notification: {
        request: {
          identifier: 'notif-1',
        },
      },
    })).toBe('notif-1');
  });
});
