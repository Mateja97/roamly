import AsyncStorage from '@react-native-async-storage/async-storage';

// One local boolean flag, persisted for the install. Both sides swallow
// their own failure: a failed read is indistinguishable from "never
// written" and falls back to false, and a failed write silently drops the
// flag (worst case the flag's UI shows once more). Neither has a surface to
// surface an error into — these are local-only flags with no retry UI.
export function boolFlag(key: string) {
  return {
    async read(): Promise<boolean> {
      try {
        return (await AsyncStorage.getItem(key)) === 'true';
      } catch {
        return false;
      }
    },
    async write(): Promise<void> {
      try {
        await AsyncStorage.setItem(key, 'true');
      } catch {
        // ponytail: swallowed — no UI reachable from a local-only flag to
        // surface a retry into.
      }
    },
  };
}
