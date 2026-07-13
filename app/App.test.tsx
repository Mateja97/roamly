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

function pressBackHandler(addBackListener: jest.SpyInstance) {
  const registration = addBackListener.mock.calls.find(([eventName]) => eventName === 'hardwareBackPress');
  const handler = registration![1] as () => boolean;
  act(() => {
    handler();
  });
}

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

  it('hands off the selected scope after choosing Home, landing on the types picker', async () => {
    render(<App />);
    await flush();
    fireEvent.press(screen.getByRole('button', { name: /^Home\./i }));
    expect(screen.getByText('What are you into?')).toBeTruthy();
  });

  it('confirming the types picker carries the selection to the list, pre-filtered', async () => {
    render(<App />);
    await flush();
    fireEvent.press(screen.getByRole('button', { name: /^Home\./i }));
    fireEvent.press(screen.getByRole('button', { name: 'Sports' }));

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Show activities' }));
    });

    expect(screen.getByText('Home')).toBeTruthy();
    await waitFor(() => expect(mockedQuery).toHaveBeenCalledWith(expect.objectContaining({ categories: ['sports'] })));
    expect(screen.getByRole('button', { name: 'Remove Sports filter' })).toBeTruthy();
  });

  it('Android hardware back on the types picker returns to the scope picker', async () => {
    const addBackListener = jest.spyOn(BackHandler, 'addEventListener');
    render(<App />);
    await flush();
    fireEvent.press(screen.getByRole('button', { name: /^Home\./i }));
    expect(screen.getByText('What are you into?')).toBeTruthy();

    pressBackHandler(addBackListener);
    expect(screen.getByText(/where do you want to explore/i)).toBeTruthy();
    addBackListener.mockRestore();
  });

  it('Android hardware back on the activity list returns to the types picker (not the scope picker)', async () => {
    const addBackListener = jest.spyOn(BackHandler, 'addEventListener');
    render(<App />);
    await flush();
    fireEvent.press(screen.getByRole('button', { name: /^Home\./i }));
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Show activities' }));
    });
    await waitFor(() => expect(screen.getByText('No activities match')).toBeTruthy());

    pressBackHandler(addBackListener);
    expect(screen.getByText('What are you into?')).toBeTruthy();
    addBackListener.mockRestore();
  });
});
