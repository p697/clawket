import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'clawket.pausedConnections.v1';

export interface PausedConnectionStore {
  read(): Promise<ReadonlyArray<string>>;
  write(ids: ReadonlyArray<string>): Promise<void>;
}

/** Connection ids only; credentials and backend state remain in their own stores. */
export const pausedConnectionStore: PausedConnectionStore = {
  async read() {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (!raw) return [];
      const value: unknown = JSON.parse(raw);
      // Salvage valid pauses without letting one corrupt preference block startup.
      return Array.isArray(value)
        ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))]
        : [];
    } catch {
      // Do not overwrite storage on a transient read failure.
      return [];
    }
  },
  async write(ids) {
    await AsyncStorage.setItem(KEY, JSON.stringify([...new Set(ids)]));
  },
};
