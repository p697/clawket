jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
}));

import { buildAvatarKey, readAgentAvatar, resolveAgentAvatarKeyCandidates } from './agent-avatar';

describe('buildAvatarKey', () => {
  it('returns agentId:agentName when name is provided', () => {
    expect(buildAvatarKey('main', 'Claude')).toBe('main:Claude');
  });

  it('returns just agentId when name is undefined', () => {
    expect(buildAvatarKey('main')).toBe('main');
    expect(buildAvatarKey('main', undefined)).toBe('main');
  });

  it('returns just agentId when name is empty string', () => {
    expect(buildAvatarKey('main', '')).toBe('main');
  });

  it('handles agents with same id but different names', () => {
    const key1 = buildAvatarKey('main', 'Claude');
    const key2 = buildAvatarKey('main', 'Assistant');
    expect(key1).not.toBe(key2);
  });

  it('handles names with special characters', () => {
    expect(buildAvatarKey('agent-1', 'My Agent')).toBe('agent-1:My Agent');
  });

  it('keeps both legacy and filtered keys when Assistant is a placeholder name', () => {
    expect(resolveAgentAvatarKeyCandidates({
      id: 'main',
      name: 'Writer',
      identity: { name: 'Assistant' },
    })).toEqual(['main:Assistant', 'main:Writer', 'main']);
  });

  it('reads avatars saved under the legacy key format', () => {
    expect(readAgentAvatar(
      { 'main:Assistant': 'data:image/png;base64,legacy' },
      { id: 'main', name: 'Writer', identity: { name: 'Assistant' } },
    )).toBe('data:image/png;base64,legacy');
  });

  it('normalizes raw base64 avatar payloads from older builds', () => {
    const rawBase64 = 'a'.repeat(128);
    expect(readAgentAvatar(
      { 'main:Assistant': rawBase64 },
      { id: 'main', name: 'Writer', identity: { name: 'Assistant' } },
    )).toBe(`data:image/jpeg;base64,${rawBase64}`);
  });
});
