import { render, screen } from '@testing-library/react-native';
import { DifficultyMeter } from './DifficultyMeter';

describe('DifficultyMeter', () => {
  it('shows the text readout with filled-count for a mid-scale value', () => {
    render(<DifficultyMeter difficulty={3} />);
    expect(screen.getByText('Intermediate · 3/5')).toBeTruthy();
  });

  it('clamps below-range values to the first segment', () => {
    render(<DifficultyMeter difficulty={0} />);
    expect(screen.getByText('Beginner · 1/5')).toBeTruthy();
  });

  it('clamps above-range values to the last segment', () => {
    render(<DifficultyMeter difficulty={9} />);
    expect(screen.getByText('Expert · 5/5')).toBeTruthy();
  });

  it('exposes the readout as one accessible label (never color-only)', () => {
    render(<DifficultyMeter difficulty={4} />);
    expect(screen.getByLabelText('Difficulty: Advanced · 4/5')).toBeTruthy();
  });
});
