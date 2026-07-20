import { render, screen } from '@testing-library/react-native';
import type { TodayHoursRowData } from './activityDetailConfig';
import { TodayHoursRow } from './TodayHoursRow';

describe('TodayHoursRow', () => {
  it('shows Open in success color for a single hour range', () => {
    const data: TodayHoursRowData = {
      status: { text: 'Open', isOpen: true },
      weekday: 'Monday',
      hours: '09:00–17:00',
    };
    render(<TodayHoursRow data={data} />);
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.getByText('Monday')).toBeTruthy();
    expect(screen.getByText('09:00–17:00')).toBeTruthy();
  });

  it('shows split-hours periods comma-joined on the detail line', () => {
    const data: TodayHoursRowData = {
      status: { text: 'Open', isOpen: true },
      weekday: 'Monday',
      hours: '09:00–14:00, 18:00–22:00',
    };
    render(<TodayHoursRow data={data} />);
    expect(screen.getByText('09:00–14:00, 18:00–22:00')).toBeTruthy();
  });

  it('shows Closed (muted, not error) when the venue has hours later today but is closed now', () => {
    const data: TodayHoursRowData = {
      status: { text: 'Closed', isOpen: false },
      weekday: 'Monday',
      hours: '09:00–17:00',
    };
    render(<TodayHoursRow data={data} />);
    expect(screen.getByText('Closed')).toBeTruthy();
    expect(screen.getByText('09:00–17:00')).toBeTruthy();
  });

  it('shows "Closed today" when today has zero periods', () => {
    const data: TodayHoursRowData = {
      status: { text: 'Closed', isOpen: false },
      weekday: 'Monday',
      hours: 'Closed today',
    };
    render(<TodayHoursRow data={data} />);
    expect(screen.getByText('Closed today')).toBeTruthy();
  });

  it('shows "Open 24 hours" for an always_open venue', () => {
    const data: TodayHoursRowData = {
      status: { text: 'Open', isOpen: true },
      weekday: 'Monday',
      hours: 'Open 24 hours',
    };
    render(<TodayHoursRow data={data} />);
    expect(screen.getByText('Open 24 hours')).toBeTruthy();
  });
});
