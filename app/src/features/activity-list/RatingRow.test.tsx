import { fireEvent, render, screen } from '@testing-library/react-native';
import { RatingRow } from './RatingRow';

describe('RatingRow', () => {
  it('renders exactly the four rating options, Any filled by default', () => {
    render(<RatingRow selected={null} onSelect={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Any rating, selected' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rated 4.0 and up' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rated 4.5 and up' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rated 4.8 and up' })).toBeTruthy();
  });

  it('tapping a chip calls onSelect with that value', () => {
    const onSelect = jest.fn();
    render(<RatingRow selected={null} onSelect={onSelect} />);
    fireEvent.press(screen.getByRole('button', { name: 'Rated 4.5 and up' }));
    expect(onSelect).toHaveBeenCalledWith(4.5);
  });

  it('tapping the currently-selected chip is a no-op', () => {
    const onSelect = jest.fn();
    render(<RatingRow selected={4.5} onSelect={onSelect} />);
    fireEvent.press(screen.getByRole('button', { name: 'Rated 4.5 and up, selected' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('tapping the already-selected "Any" is a no-op, parity with CategoryRow', () => {
    const onSelect = jest.fn();
    render(<RatingRow selected={null} onSelect={onSelect} />);
    fireEvent.press(screen.getByRole('button', { name: 'Any rating, selected' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('marks the selected chip active independent of position', () => {
    render(<RatingRow selected={4.8} onSelect={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Rated 4.8 and up, selected' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Any rating' })).toBeTruthy();
  });
});
