import { render, screen } from '@testing-library/react-native';
import App from './App';
import * as health from './src/api/health';

describe('App', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows healthy once proxy-service responds ok', async () => {
    jest.spyOn(health, 'fetchHealth').mockResolvedValue();
    render(<App />);
    expect(await screen.findByText(/proxy-service: healthy/i)).toBeTruthy();
  });

  it('shows unreachable if proxy-service errors', async () => {
    jest.spyOn(health, 'fetchHealth').mockRejectedValue(new Error('boom'));
    render(<App />);
    expect(await screen.findByText(/proxy-service: unreachable/i)).toBeTruthy();
  });
});
