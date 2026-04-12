import { getChatHeaderStatusLabel } from './chatHeaderStatusLabel';
import { ChatHeaderStatusKind } from './chatSyncPolicy';

const t = (key: string) => `i18n:${key}`;

describe('getChatHeaderStatusLabel', () => {
  it('returns null for null status', () => {
    expect(getChatHeaderStatusLabel(null, t)).toBeNull();
  });

  it.each<[ChatHeaderStatusKind, string]>([
    ['starting_hermes', 'Starting Hermes, this may take a few seconds.'],
    ['connecting_gateway', 'Connecting to gateway...'],
    ['reconnecting', 'Reconnecting...'],
    ['connecting', 'Connecting...'],
    ['waiting_for_approval', 'Waiting for approval...'],
    ['refreshing_conversation', 'Refreshing conversation...'],
    ['syncing_conversation', 'Syncing conversation...'],
  ])('maps %s to translated label', (status, key) => {
    expect(getChatHeaderStatusLabel(status, t)).toBe(`i18n:${key}`);
  });
});
