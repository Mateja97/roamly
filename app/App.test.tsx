import { fireEvent, render, screen } from '@testing-library/react-native';
import App from './App';

describe('App', () => {
  it('opens on the scope picker', () => {
    render(<App />);
    expect(screen.getByText(/where do you want to explore/i)).toBeTruthy();
  });

  it('hands off the selected scope after choosing Home', () => {
    render(<App />);
    fireEvent.press(screen.getByRole('button', { name: /^Home\./i }));
    expect(screen.getByText(/scope selected: home/i)).toBeTruthy();
  });
});
