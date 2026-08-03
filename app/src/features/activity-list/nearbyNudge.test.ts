import AsyncStorage from '@react-native-async-storage/async-storage';
import { dismissNearbyNudge, isNearbyNudgeDismissed } from './nearbyNudge';

describe('nearbyNudge dismissal flag', () => {
  afterEach(async () => {
    await AsyncStorage.clear();
  });

  it('is not dismissed by default', async () => {
    expect(await isNearbyNudgeDismissed()).toBe(false);
  });

  it('persists true once dismissed', async () => {
    await dismissNearbyNudge();
    expect(await isNearbyNudgeDismissed()).toBe(true);
  });

  it('a rejected read resolves to "not dismissed" instead of throwing', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('boom'));
    await expect(isNearbyNudgeDismissed()).resolves.toBe(false);
  });

  it('a rejected write resolves instead of throwing (dismissal just does not persist)', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('boom'));
    await expect(dismissNearbyNudge()).resolves.toBeUndefined();
  });
});
