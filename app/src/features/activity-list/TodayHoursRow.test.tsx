import { fireEvent, render, screen } from '@testing-library/react-native';
import type { TodayHoursRowData } from './activityDetailConfig';
import { TodayHoursRow } from './TodayHoursRow';

const BASE_DATA: TodayHoursRowData = {
  status: { text: 'Open', isOpen: true },
  weekday: 'Monday',
  hours: '09:00–17:00',
};

describe('TodayHoursRow', () => {
  it('shows Open in success color for a single hour range', () => {
    render(<TodayHoursRow data={BASE_DATA} onPress={jest.fn()} />);
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.getByText('Monday')).toBeTruthy();
    expect(screen.getByText('09:00–17:00')).toBeTruthy();
  });

  it('shows split-hours periods comma-joined on the detail line', () => {
    const data: TodayHoursRowData = {
      ...BASE_DATA,
      hours: '09:00–14:00, 18:00–22:00',
    };
    render(<TodayHoursRow data={data} onPress={jest.fn()} />);
    expect(screen.getByText('09:00–14:00, 18:00–22:00')).toBeTruthy();
  });

  it('shows Closed (muted, not error) when the venue has hours later today but is closed now', () => {
    const data: TodayHoursRowData = {
      status: { text: 'Closed', isOpen: false },
      weekday: 'Monday',
      hours: '09:00–17:00',
    };
    render(<TodayHoursRow data={data} onPress={jest.fn()} />);
    expect(screen.getByText('Closed')).toBeTruthy();
    expect(screen.getByText('09:00–17:00')).toBeTruthy();
  });

  it('shows "Closed today" when today has zero periods', () => {
    const data: TodayHoursRowData = {
      status: { text: 'Closed', isOpen: false },
      weekday: 'Monday',
      hours: 'Closed today',
    };
    render(<TodayHoursRow data={data} onPress={jest.fn()} />);
    expect(screen.getByText('Closed today')).toBeTruthy();
  });

  it('shows "Open 24 hours" for an always_open venue', () => {
    const data: TodayHoursRowData = {
      status: { text: 'Open', isOpen: true },
      weekday: 'Monday',
      hours: 'Open 24 hours',
    };
    render(<TodayHoursRow data={data} onPress={jest.fn()} />);
    expect(screen.getByText('Open 24 hours')).toBeTruthy();
  });

  describe('tap-to-expand affordance (T2)', () => {
    it('exposes the whole row as one 44×44+ button with the expand label', () => {
      render(<TodayHoursRow data={BASE_DATA} onPress={jest.fn()} />);
      expect(
        screen.getByRole('button', { name: 'See full opening hours' }),
      ).toBeTruthy();
    });

    it('calls onPress when the row is tapped', () => {
      const onPress = jest.fn();
      render(<TodayHoursRow data={BASE_DATA} onPress={onPress} />);
      fireEvent.press(
        screen.getByRole('button', { name: 'See full opening hours' }),
      );
      expect(onPress).toHaveBeenCalledTimes(1);
    });
  });
});
