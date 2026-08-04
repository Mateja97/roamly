import AsyncStorage from '@react-native-async-storage/async-storage';
import { hasSeenSplash, markSplashSeen } from './firstLaunch';

describe('firstLaunch', () => {
  afterEach(async () => {
    await AsyncStorage.clear();
  });

  it('reports unseen before the flag is ever written', async () => {
    expect(await hasSeenSplash()).toBe(false);
  });

  it('reports seen once markSplashSeen has run', async () => {
    await markSplashSeen();
    expect(await hasSeenSplash()).toBe(true);
  });

  it('review round 1 (Critical): a rejecting read falls back to unseen instead of throwing/hanging', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(hasSeenSplash()).resolves.toBe(false);
  });
});
