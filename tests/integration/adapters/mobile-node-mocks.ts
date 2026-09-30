import { vi } from 'vitest';

// Native analytics is outside recorded protocol replay; keep the real reporter.
vi.mock('../../../apps/mobile/src/services/analytics/events', () => ({
  analyticsEvents: { transportDiagnostic: vi.fn() },
}));

vi.mock('../../../apps/mobile/src/connection/protocol', () => ({
  GatewayClient: class NodeIntegrationGatewayClient {},
}));

vi.mock('../../../apps/mobile/src/services/chat-cache', () => ({
  ChatCacheService: {
    getTimelinePage: vi.fn(async () => ({ messages: [] })),
  },
}));

vi.mock('../../../apps/mobile/src/services/storage', () => ({
  StorageService: {},
}));

vi.mock('../../../apps/mobile/src/features/discover', () => ({
  searchDiscoverSkills: vi.fn(async () => []),
}));

vi.mock('../../../apps/mobile/src/i18n', () => ({
  default: { language: 'en' },
}));

vi.mock('../../../apps/mobile/src/connection/adapters/youmind-sprite-api', () => ({
  YouMindSpriteApiClient: class NodeIntegrationYouMindApiClient {},
  mapYouMindSpriteApiError: (error: unknown) => ({
    message: error instanceof Error ? error.message : String(error ?? 'Request failed'),
  }),
}));
