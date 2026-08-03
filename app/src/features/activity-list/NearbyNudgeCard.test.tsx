import { fireEvent, render, screen } from '@testing-library/react-native';
import { NearbyNudgeCard } from './NearbyNudgeCard';

describe('NearbyNudgeCard', () => {
  it('ask variant renders title + hint + dismiss, tapping the body opens the scope sheet', () => {
    const onOpenScope = jest.fn();
    const onDismiss = jest.fn();
    render(<NearbyNudgeCard variant="ask" onOpenScope={onOpenScope} onDismiss={onDismiss} />);
    expect(screen.getByText("See what's near you")).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: /see what's near you/i }));
    expect(onOpenScope).toHaveBeenCalledTimes(1);
  });

  it('ask variant dismiss button calls onDismiss without opening the sheet', () => {
    const onOpenScope = jest.fn();
    const onDismiss = jest.fn();
    render(<NearbyNudgeCard variant="ask" onOpenScope={onOpenScope} onDismiss={onDismiss} />);
    fireEvent.press(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onOpenScope).not.toHaveBeenCalled();
  });

  it('choose-city variant renders the quiet nudge with no dismiss control', () => {
    const onOpenScope = jest.fn();
    render(<NearbyNudgeCard variant="choose-city" onOpenScope={onOpenScope} />);
    expect(screen.getByText('Choose a city to explore')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: /choose a city/i }));
    expect(onOpenScope).toHaveBeenCalledTimes(1);
  });
});
