import { AccessibilityInfo, Modal } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { WeekHoursModalData } from './activityDetailConfig';
import { WeekHoursModal } from './WeekHoursModal';

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
});
afterEach(() => jest.resetAllMocks());

async function flush() {
  await act(async () => {});
}

const DATA: WeekHoursModalData = {
  today: 'wednesday',
  days: [
    { day: 'monday', hours: '09:00–17:00' },
    { day: 'tuesday', hours: '09:00–17:00' },
    { day: 'wednesday', hours: '09:00–14:00, 18:00–22:00' },
    { day: 'thursday', hours: 'Closed' },
    { day: 'friday', hours: '09:00–17:00' },
    { day: 'saturday', hours: 'Open 24 hours' },
    { day: 'sunday', hours: 'Closed' },
  ],
};

describe('WeekHoursModal', () => {
  it('lists all seven days Monday->Sunday using the week-view data/format as-is', async () => {
    render(<WeekHoursModal data={DATA} onClose={jest.fn()} />);
    await flush();
    expect(screen.getByText('Monday')).toBeTruthy();
    expect(screen.getByText('Tuesday')).toBeTruthy();
    expect(screen.getByText('Wednesday · Today')).toBeTruthy();
    expect(screen.getByText('Thursday')).toBeTruthy();
    expect(screen.getByText('Friday')).toBeTruthy();
    expect(screen.getByText('Saturday')).toBeTruthy();
    expect(screen.getByText('Sunday')).toBeTruthy();
    expect(screen.getAllByText('09:00–17:00')).toHaveLength(3);
    expect(screen.getByText('09:00–14:00, 18:00–22:00')).toBeTruthy();
    expect(screen.getAllByText('Closed')).toHaveLength(2);
    expect(screen.getByText('Open 24 hours')).toBeTruthy();
  });

  it('visually emphasizes the current venue-local day with a non-color-only "Today" marker', async () => {
    render(<WeekHoursModal data={DATA} onClose={jest.fn()} />);
    await flush();
    expect(screen.getByText('Wednesday · Today')).toBeTruthy();
  });

  it('closes via the explicit close control', async () => {
    const onClose = jest.fn();
    render(<WeekHoursModal data={DATA} onClose={onClose} />);
    await flush();
    fireEvent.press(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ponytail: no scrim-tap test — the scrim Pressable sits inside an
  // Animated.View whose opacity starts at 0 (per FilterSheet's own
  // precedent, which for the same reason doesn't test its scrim either);
  // RNTL's accessibility-tree computation treats that as hidden regardless
  // of the mocked-reduced-motion `setValue(1)`, since Animated's imperative
  // `setNativeProps` update doesn't reach the JSON tree `render()` reads.
  // The explicit close control and onRequestClose below cover the required
  // dismiss paths (product-tasks.md T2's AC) end to end.

  it('closes (not the screen) on the platform back gesture / Android hardware back via onRequestClose', async () => {
    const onClose = jest.fn();
    render(<WeekHoursModal data={DATA} onClose={onClose} />);
    await flush();
    const modal = screen.UNSAFE_getByType(Modal);
    modal.props.onRequestClose();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
