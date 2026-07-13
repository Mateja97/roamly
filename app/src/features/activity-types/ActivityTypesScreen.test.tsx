import { BackHandler } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ActivityTypesScreen } from './ActivityTypesScreen';

describe('ActivityTypesScreen', () => {
  it('renders the six category chips, all unselected, with the all-types status', () => {
    render(<ActivityTypesScreen onConfirm={jest.fn()} onBack={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Food & Drink' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sports' })).toBeTruthy();
    expect(screen.getByText('All activity types')).toBeTruthy();
  });

  it('confirming with zero selected carries an empty category list forward', () => {
    const onConfirm = jest.fn();
    render(<ActivityTypesScreen onConfirm={onConfirm} onBack={jest.fn()} />);
    fireEvent.press(screen.getByRole('button', { name: 'Show activities' }));
    expect(onConfirm).toHaveBeenCalledWith([]);
  });

  it('toggling chips updates the status line and carries the selection forward on confirm', () => {
    const onConfirm = jest.fn();
    render(<ActivityTypesScreen onConfirm={onConfirm} onBack={jest.fn()} />);

    fireEvent.press(screen.getByRole('button', { name: 'Sports' }));
    fireEvent.press(screen.getByRole('button', { name: 'Food & Drink' }));
    expect(screen.getByText('2 types selected')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Sports' }));
    expect(screen.getByText('1 types selected')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Show activities' }));
    expect(onConfirm).toHaveBeenCalledWith(['food_and_drink']);
  });

  it('calls onBack on Android hardware back press — no custom back control', () => {
    const addBackListener = jest.spyOn(BackHandler, 'addEventListener');
    const onBack = jest.fn();
    render(<ActivityTypesScreen onConfirm={jest.fn()} onBack={onBack} />);

    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();

    const registration = addBackListener.mock.calls.find(([eventName]) => eventName === 'hardwareBackPress');
    expect(registration).toBeTruthy();
    const handler = registration![1] as () => boolean;
    expect(handler()).toBe(true);
    expect(onBack).toHaveBeenCalledTimes(1);

    addBackListener.mockRestore();
  });
});
