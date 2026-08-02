import { fireEvent, render, screen } from '@testing-library/react-native';
import { HoursRow } from './HoursRow';
import type { TodayHoursRowData } from './activityDetailConfig';

const openData: TodayHoursRowData = {
  status: { text: 'Open', isOpen: true },
  weekday: 'Monday',
  hours: '09:00–17:00',
};

const closedData: TodayHoursRowData = {
  status: { text: 'Closed', isOpen: false },
  weekday: 'Monday',
  hours: 'Closed today',
};

describe('HoursRow', () => {
  it('renders nothing when there is no usable structured opening_hours', () => {
    const { toJSON } = render(<HoursRow data={undefined} onPress={jest.fn()} />);
    expect(toJSON()).toBeNull();
  });

  it('shows today status and hours, and calls onPress when tapped', () => {
    const onPress = jest.fn();
    render(<HoursRow data={openData} onPress={onPress} />);
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.getByText('09:00–17:00')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'See full opening hours' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders Closed with the muted style, never an error color (closed is not an error)', () => {
    render(<HoursRow data={closedData} onPress={jest.fn()} />);
    const closedText = screen.getByText('Closed');
    const flatStyle = [closedText.props.style].flat();
    expect(flatStyle).not.toContainEqual(expect.objectContaining({ color: '#F5B79B' }));
  });
});
