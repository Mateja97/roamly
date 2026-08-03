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
});
