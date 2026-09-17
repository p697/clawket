import AsyncStorage from '@react-native-async-storage/async-storage';
import { SessionPreferencesService } from './session-preferences';

let store: Record<string, string> = {};

beforeEach(() => {
  store = {};
  (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) =>
    Promise.resolve(store[key] ?? null),
  );
  (AsyncStorage.setItem as jest.Mock).mockImplementation((key: string, value: string) => {
    store[key] = value;
    return Promise.resolve();
  });
  (AsyncStorage.getAllKeys as jest.Mock).mockImplementation(() => Promise.resolve(Object.keys(store)));
  (AsyncStorage.multiRemove as jest.Mock).mockImplementation((keys: string[]) => {
    for (const key of keys) delete store[key];
    return Promise.resolve();
  });
});

describe('SessionPreferencesService', () => {
  it('stores pinned session keys per gateway and agent scope', async () => {
    await SessionPreferencesService.setPinnedSession('gw1', 'agentA', 'session:1', true);
    await SessionPreferencesService.setPinnedSession('gw1', 'agentB', 'session:2', true);

    await expect(SessionPreferencesService.getPinnedSessionKeys('gw1', 'agentA')).resolves.toEqual(['session:1']);
    await expect(SessionPreferencesService.getPinnedSessionKeys('gw1', 'agentB')).resolves.toEqual(['session:2']);
  });

  it('clears every agent scope for one connection without touching adjacent or global keys', async () => {
    await SessionPreferencesService.setPinnedSession('gw1', 'agentA', 'session:1', true);
    await SessionPreferencesService.setAgentPinned('gw1', 'agentB', true);
    await SessionPreferencesService.setPinnedSession('gw10', 'agentA', 'session:10', true);
    store['clawket.someGlobalPreference'] = 'keep';

    await SessionPreferencesService.clearConnection('gw1');

    await expect(SessionPreferencesService.getAgentPreferences('gw1', 'agentA')).resolves.toEqual({
      pinnedSessionKeys: [],
      agentPinned: false,
    });
    await expect(SessionPreferencesService.getAgentPreferences('gw1', 'agentB')).resolves.toEqual({
      pinnedSessionKeys: [],
      agentPinned: false,
    });
    await expect(SessionPreferencesService.getPinnedSessionKeys('gw10', 'agentA')).resolves.toEqual([
      'session:10',
    ]);
    expect(store['clawket.someGlobalPreference']).toBe('keep');
    expect(AsyncStorage.multiRemove).toHaveBeenCalledWith([
      'clawket.sessionPreferences.v1.gw1::agentA',
      'clawket.sessionPreferences.v1.gw1::agentB',
    ]);
  });

  it('deduplicates pinned keys and keeps latest pin at the front', async () => {
    await SessionPreferencesService.setPinnedSession('gw1', 'agentA', 'session:1', true);
    await SessionPreferencesService.setPinnedSession('gw1', 'agentA', 'session:2', true);
    await SessionPreferencesService.setPinnedSession('gw1', 'agentA', 'session:1', true);

    await expect(SessionPreferencesService.getPinnedSessionKeys('gw1', 'agentA')).resolves.toEqual(['session:1', 'session:2']);
  });

  it('toggles and clears pinned state', async () => {
    await SessionPreferencesService.togglePinnedSession('gw1', 'agentA', 'session:1');
    await expect(SessionPreferencesService.getPinnedSessionKeys('gw1', 'agentA')).resolves.toEqual(['session:1']);

    await SessionPreferencesService.togglePinnedSession('gw1', 'agentA', 'session:1');
    await expect(SessionPreferencesService.getPinnedSessionKeys('gw1', 'agentA')).resolves.toEqual([]);

    await SessionPreferencesService.setPinnedSession('gw1', 'agentA', 'session:2', true);
    await SessionPreferencesService.clearSession('gw1', 'agentA', 'session:2');
    await expect(SessionPreferencesService.getPinnedSessionKeys('gw1', 'agentA')).resolves.toEqual([]);
  });

  it('persists the Agent pin without losing pinned sessions', async () => {
    await SessionPreferencesService.setPinnedSession('gw1', 'agentA', 'session:1', true);
    await SessionPreferencesService.toggleAgentPinned('gw1', 'agentA');

    await expect(SessionPreferencesService.getAgentPreferences('gw1', 'agentA')).resolves.toEqual({
      pinnedSessionKeys: ['session:1'],
      agentPinned: true,
    });

    await SessionPreferencesService.setAgentPinned('gw1', 'agentA', false);
    await expect(SessionPreferencesService.getAgentPreferences('gw1', 'agentA')).resolves.toEqual({
      pinnedSessionKeys: ['session:1'],
      agentPinned: false,
    });
  });

  it('drops the retired mute flag from stored records without rewriting them', async () => {
    store['clawket.sessionPreferences.v1.gw1::agentA'] = JSON.stringify({
      pinnedSessionKeys: ['session:1'],
      agentPinned: true,
      muted: true,
    });
    (AsyncStorage.setItem as jest.Mock).mockClear();

    await expect(SessionPreferencesService.getAgentPreferences('gw1', 'agentA')).resolves.toEqual({
      pinnedSessionKeys: ['session:1'],
      agentPinned: true,
    });
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('upgrades malformed and legacy state to safe defaults', async () => {
    store['clawket.sessionPreferences.v1.gw1::legacy'] = JSON.stringify({
      pinnedSessionKeys: ['session:1', 'session:1', '', 42],
    });
    store['clawket.sessionPreferences.v1.gw1::broken'] = '{';

    await expect(SessionPreferencesService.getAgentPreferences('gw1', 'legacy')).resolves.toEqual({
      pinnedSessionKeys: ['session:1'],
      agentPinned: false,
    });
    await expect(SessionPreferencesService.getAgentPreferences('gw1', 'broken')).resolves.toEqual({
      pinnedSessionKeys: [],
      agentPinned: false,
    });
  });
});
