import { fireEvent, render, screen } from '@testing-library/react-native';
import { ErrorBanner } from './ErrorBanner';

describe('ErrorBanner', () => {
  it('shows the message', () => {
    render(
      <ErrorBanner message="Could not open maps." onDismiss={jest.fn()} />,
    );
    expect(screen.getByText('Could not open maps.')).toBeTruthy();
  });

  it('calls onDismiss when the close control is pressed', () => {
    const onDismiss = jest.fn();
    render(
      <ErrorBanner message="Could not open maps." onDismiss={onDismiss} />,
    );
    fireEvent.press(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
