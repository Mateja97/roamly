import { AccessibilityInfo, BackHandler } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import App from './App';
import { queryActivities } from './src/api/activities';

// ScopePickerScreen's mount effect checks `isReduceMotionEnabled()` on a
// microtask — flush it inside `act` so a purely synchronous test doesn't
// leave it dangling past the test's own act scope.
async function flush() {
  await act(async () => {});
}

jest.mock('./src/api/activities', () => ({ queryActivities: jest.fn() }));
const mockedQuery = jest.mocked(queryActivities);

describe('App', () => {
  beforeEach(() => {
    mockedQuery.mockResolvedValue({ status: 'success', activities: [] });
    // afterEach's resetAllMocks wipes the RN jest preset's default
    // AccessibilityInfo mock implementations too — re-arm them each test.
    // true (reduced motion) sidesteps the Filter sheet's slide/fade Animated
    // calls — irrelevant to what these tests verify.
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: jest.fn() } as never);
  });
  afterEach(() => jest.resetAllMocks());

  it('opens on the scope picker', async () => {
    render(<App />);
    await flush();
    expect(screen.getByText(/where do you want to explore/i)).toBeTruthy();
  });

  it('hands off the selected scope after choosing Home, landing on the activity list', async () => {
    render(<App />);
    await flush();
    fireEvent.press(screen.getByRole('button', { name: /^Home\./i }));
    expect(screen.getByText('Home')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('No activities match')).toBeTruthy());
  });

  it('Android hardware back on the activity list returns to the scope picker (no custom back control)', async () => {
    const addBackListener = jest.spyOn(BackHandler, 'addEventListener');
    render(<App />);
    await flush();
    fireEvent.press(screen.getByRole('button', { name: /^Home\./i }));
    await waitFor(() => expect(screen.getByText('No activities match')).toBeTruthy());

    const registration = addBackListener.mock.calls.find(([eventName]) => eventName === 'hardwareBackPress');
    const handler = registration![1] as () => boolean;
    act(() => {
      handler();
    });
    expect(screen.getByText(/where do you want to explore/i)).toBeTruthy();
    addBackListener.mockRestore();
  });
});
