import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { queryActivities } from '../../api/activities';
import { suggestCities } from '../../api/cities';
import { AnywhereSearchScreen } from './AnywhereSearchScreen';

jest.mock('../../api/activities', () => ({ queryActivities: jest.fn() }));
jest.mock('../../api/cities', () => ({ suggestCities: jest.fn() }));

const mockedQuery = jest.mocked(queryActivities);
const mockedSuggest = jest.mocked(suggestCities);

const activity = (id: string) => ({
  id,
  title: 'Tour',
  description: '',
  category: 'sport' as const,
  location: { lat: 0, lng: 0 },
  country: 'Spain',
  rating: 4.5,
  image_refs: [],
  tags: [],
  distance_km: 1,
});

describe('AnywhereSearchScreen', () => {
  const onSearchComplete = jest.fn();
  const onBack = jest.fn();

  beforeEach(() => {
    mockedQuery.mockResolvedValue({ status: 'success', activities: [activity('1'), activity('2')] });
    mockedSuggest.mockResolvedValue({ status: 'success', suggestions: [] });
  });
  afterEach(() => jest.resetAllMocks());

  function setup(coordinates?: { latitude: number; longitude: number }) {
    return render(
      <AnywhereSearchScreen
        selection={{ scope: 'anywhere', coordinates }}
        onBack={onBack}
        onSearchComplete={onSearchComplete}
      />
    );
  }

  it('shows the live count once the initial (default-state) query resolves', async () => {
    setup();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show 2 activities' })).toBeTruthy());
    expect(mockedQuery).toHaveBeenCalledWith({ scope: 'anywhere', max_distance_km: 500 });
  });

  it('selecting a city from the typeahead adds a removable chip and updates the count', async () => {
    mockedSuggest.mockResolvedValue({
      status: 'success',
      suggestions: [{ city: 'Barcelona', country: 'Spain', centroid: { lat: 41.4, lng: 2.2 } }],
    });
    setup();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show 2 activities' })).toBeTruthy());

    fireEvent.changeText(screen.getByLabelText('Search cities'), 'Bar');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Barcelona, Spain' })).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Barcelona, Spain' }));
    });

    expect(screen.getByText('1 selected')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Barcelona, Spain filter' })).toBeTruthy();

    // Cities selected -> the next (debounced) query anchors on the centroid, not current_location.
    await waitFor(() =>
      expect(mockedQuery).toHaveBeenLastCalledWith({ scope: 'anywhere', max_distance_km: 500, cities: [{ lat: 41.4, lng: 2.2 }] })
    );

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Remove Barcelona, Spain filter' }));
    });
    expect(screen.getAllByText('0 selected')).toHaveLength(2);
  });

  it('selecting an activity chip increments the count and is reflected in the next request', async () => {
    setup({ latitude: 1, longitude: 2 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show 2 activities' })).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Sport' }));
    });

    await waitFor(() =>
      expect(mockedQuery).toHaveBeenLastCalledWith({
        scope: 'anywhere',
        max_distance_km: 500,
        current_location: { lat: 1, lng: 2 },
        categories: ['sport'],
      })
    );

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Sport, selected' }));
    });
    await waitFor(() =>
      expect(mockedQuery).toHaveBeenLastCalledWith({ scope: 'anywhere', max_distance_km: 500, current_location: { lat: 1, lng: 2 } })
    );
  });

  it('Reset clears cities, distance, and activity selections, and is disabled at the default state', async () => {
    mockedSuggest.mockResolvedValue({
      status: 'success',
      suggestions: [{ city: 'Barcelona', country: 'Spain', centroid: { lat: 41.4, lng: 2.2 } }],
    });
    setup();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show 2 activities' })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Reset' }).props.accessibilityState.disabled).toBe(true);

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Sport' }));
    });
    expect(screen.getByRole('button', { name: 'Reset' }).props.accessibilityState.disabled).toBe(false);

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Reset' }));
    });
    expect(screen.getAllByText('0 selected')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Reset' }).props.accessibilityState.disabled).toBe(true);
  });

  it('running the search calls onSearchComplete with the resolved activities and categories', async () => {
    setup();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show 2 activities' })).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Show 2 activities' }));
    });

    expect(onSearchComplete).toHaveBeenCalledWith([activity('1'), activity('2')], [], []);
  });

  it('a failed search shows the error banner and lets the CTA be retried', async () => {
    setup();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show 2 activities' })).toBeTruthy());

    mockedQuery.mockResolvedValueOnce({ status: 500, message: 'Something went wrong.' });
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Show 2 activities' }));
    });

    expect(screen.getByText('Something went wrong.')).toBeTruthy();
    expect(onSearchComplete).not.toHaveBeenCalled();
  });
});
