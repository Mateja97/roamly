import { fireEvent, render, screen } from '@testing-library/react-native';
import { Home } from 'lucide-react-native';
import { ChoiceCard } from './ChoiceCard';

describe('ChoiceCard', () => {
  it('is a labeled, tappable button that fires onPress', () => {
    const onPress = jest.fn();
    render(<ChoiceCard icon={Home} title="Home" hint="Activities around your home base" onPress={onPress} />);

    const button = screen.getByRole('button', { name: /home\. activities around your home base/i });
    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire onPress while busy', () => {
    const onPress = jest.fn();
    render(<ChoiceCard icon={Home} title="Nearby" hint="busy" onPress={onPress} busy />);

    fireEvent.press(screen.getByRole('button', { name: /nearby\. busy/i }));
    expect(onPress).not.toHaveBeenCalled();
  });
});
