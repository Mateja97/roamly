import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SplashScreen } from './SplashScreen';

describe('SplashScreen', () => {
  afterEach(async () => {
    await AsyncStorage.clear();
  });

  it('renders the destination overline, hero headline, and tagline', () => {
    render(<SplashScreen onContinue={jest.fn()} />);
    expect(screen.getByText('Destination')).toBeTruthy();
    expect(screen.getByText('Where to?')).toBeTruthy();
    expect(screen.getByText('Search activities to do')).toBeTruthy();
  });

  it('renders exactly one Primary ticket CTA with its full accessible name', () => {
    render(<SplashScreen onContinue={jest.fn()} />);
    expect(
      screen.getByRole('button', { name: 'Start exploring, real places picked for right now' }),
    ).toBeTruthy();
  });

  it('advances immediately on CTA tap and persists the first-launch-seen flag', async () => {
    const onContinue = jest.fn();
    render(<SplashScreen onContinue={onContinue} />);

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: /start exploring/i }));
    });

    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem('roamly:first-launch-seen')).toBe('true');
  });
});
