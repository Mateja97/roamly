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
});
