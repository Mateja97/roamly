import { AccessibilityInfo, Linking } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { suggestCities } from '../../api/cities';
import { ScopeSheet } from './ScopeSheet';
import { defaultScopeDraft } from './scopeDraft';

jest.mock('expo-location', () => ({
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));
jest.mock('../../api/cities', () => ({ suggestCities: jest.fn() }));

const mockedLocation = jest.mocked(Location);
const mockedSuggest = jest.mocked(suggestCities);

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: jest.fn() } as never);
  mockedSuggest.mockResolvedValue({ status: 'success', suggestions: [] });
});
afterEach(() => jest.resetAllMocks());

// The open-effect's reduce-motion check resolves on a microtask — flush it
// inside `act` so the resulting Animated.Value writes aren't attributed to
// "outside act" (same helper as FilterSheet.test.tsx).
async function flush() {
  await act(async () => {});
}

const activities = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i) }) as never);

describe('ScopeSheet', () => {
  describe('Nearby pane', () => {
    it('shows the fixed-range card, no controls, when already granted (coordinates present)', async () => {
      render(
        <ScopeSheet
          visible
          initialDraft={defaultScopeDraft('nearby', { latitude: 1, longitude: 2 })}
          onQuery={jest.fn().mockResolvedValue({ status: 'success', activities: activities(3) })}
          onApply={jest.fn()}
          onClose={jest.fn()}
        />
      );
      await flush();
      expect(screen.getByText('Within 10 km')).toBeTruthy();
      expect(screen.getByText('Fixed range around your location')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /turn on location/i })).toBeNull();
    });

    it('shows the explainer + Turn on location button when not yet asked, and resolves to the granted card', async () => {
      mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'undetermined' } as never);
      mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
      mockedLocation.getCurrentPositionAsync.mockResolvedValue({ coords: { latitude: 10, longitude: 20 } } as never);

      render(
        <ScopeSheet
          visible
          initialDraft={defaultScopeDraft('nearby')}
          onQuery={jest.fn().mockResolvedValue({ status: 'success', activities: activities(1) })}
          onApply={jest.fn()}
          onClose={jest.fn()}
        />
      );
      await flush();
      expect(screen.getByRole('button', { name: 'Turn on location' })).toBeTruthy();

      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Turn on location' }));
      });

      expect(screen.getByText('Within 10 km')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /turn on location/i })).toBeNull();
    });

    it('shows the Open settings pane on a fresh mount when permission is already denied (no tap needed)', async () => {
      mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never);
      const openSettings = jest.spyOn(Linking, 'openSettings').mockImplementation(() => Promise.resolve());

      render(
        <ScopeSheet
          visible
          initialDraft={defaultScopeDraft('nearby')}
          onQuery={jest.fn().mockResolvedValue({ status: 'success', activities: [] })}
          onApply={jest.fn()}
          onClose={jest.fn()}
        />
      );
      await flush();

      expect(screen.getByText(/use anywhere instead/i)).toBeTruthy();
      const settingsButton = screen.getByRole('button', { name: 'Open settings' });
      fireEvent.press(settingsButton);
      expect(openSettings).toHaveBeenCalledTimes(1);
    });

    it('shows the "Try again" pane, matching ScopePickerScreen\'s copy, when the GPS fix fails after permission is granted', async () => {
      mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
      mockedLocation.getCurrentPositionAsync.mockRejectedValue(new Error('timeout'));

      render(
        <ScopeSheet
          visible
          initialDraft={defaultScopeDraft('nearby')}
          onQuery={jest.fn().mockResolvedValue({ status: 'success', activities: [] })}
          onApply={jest.fn()}
          onClose={jest.fn()}
        />
      );
      await flush();

      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Turn on location' }));
      });

      expect(screen.getByText("We couldn't get your current location. Try again, or choose Anywhere instead.")).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    });
  });

  describe('Scope switch', () => {
    it('clears Anywhere-only fields (cities/max distance) when switching back to Nearby, keeping minRating', async () => {
      mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'undetermined' } as never);
      mockedSuggest.mockResolvedValue({
        status: 'success',
        suggestions: [{ city: 'Lisbon', country: 'Portugal', centroid: { lat: 38.7, lng: -9.1 } }],
      });
      render(
        <ScopeSheet
          visible
          initialDraft={defaultScopeDraft('nearby')}
          onQuery={jest.fn().mockResolvedValue({ status: 'success', activities: activities(1) })}
          onApply={jest.fn()}
          onClose={jest.fn()}
        />
      );
      await flush();

      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Scope: Anywhere' }));
      });
      fireEvent.changeText(screen.getByLabelText('Search cities'), 'Lis');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Lisbon, Portugal' })).toBeTruthy());
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Lisbon, Portugal' }));
      });
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: '4.5+' }));
      });
      expect(screen.getByText('1 selected')).toBeTruthy();

      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Scope: Nearby' }));
      });
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Scope: Anywhere' }));
      });

      // City cleared by the round trip through Nearby...
      expect(screen.getByText('0 selected')).toBeTruthy();
      // ...minRating (not scope-specific) survives it.
      expect(screen.getByRole('button', { name: '4.5+, selected' })).toBeTruthy();
    });
  });

  describe('Anywhere pane', () => {
    it('hides the distance slider with no anchor at all (no city, no device coordinates)', async () => {
      render(
        <ScopeSheet
          visible
          initialDraft={defaultScopeDraft('anywhere')}
          onQuery={jest.fn().mockResolvedValue({ status: 'success', activities: [] })}
          onApply={jest.fn()}
          onClose={jest.fn()}
        />
      );
      await flush();
      expect(screen.queryByText('Max distance')).toBeNull();
    });

    it('shows the slider once a city is selected, and the city becomes a removable chip', async () => {
      mockedSuggest.mockResolvedValue({
        status: 'success',
        suggestions: [{ city: 'Lisbon', country: 'Portugal', centroid: { lat: 38.7, lng: -9.1 } }],
      });
      render(
        <ScopeSheet
          visible
          initialDraft={defaultScopeDraft('anywhere')}
          onQuery={jest.fn().mockResolvedValue({ status: 'success', activities: activities(2) })}
          onApply={jest.fn()}
          onClose={jest.fn()}
        />
      );
      await flush();

      fireEvent.changeText(screen.getByLabelText('Search cities'), 'Lis');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Lisbon, Portugal' })).toBeTruthy());

      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Lisbon, Portugal' }));
      });

      expect(screen.getByText('1 selected')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Remove Lisbon, Portugal filter' })).toBeTruthy();
      expect(screen.getByText('Max distance')).toBeTruthy();
      expect(screen.getAllByText('No limit')).toHaveLength(2);
    });

    it('shows the slider once a device-location anchor is present, with no city', async () => {
      render(
        <ScopeSheet
          visible
          initialDraft={defaultScopeDraft('anywhere', { latitude: 1, longitude: 2 })}
          onQuery={jest.fn().mockResolvedValue({ status: 'success', activities: [] })}
          onApply={jest.fn()}
          onClose={jest.fn()}
        />
      );
      await flush();
      expect(screen.getByText('Max distance')).toBeTruthy();
    });

    it('renders a narrowed distance value from the initial draft', async () => {
      render(
        <ScopeSheet
          visible
          initialDraft={{ ...defaultScopeDraft('anywhere', { latitude: 1, longitude: 2 }), maxDistanceKm: 250 }}
          onQuery={jest.fn().mockResolvedValue({ status: 'success', activities: [] })}
          onApply={jest.fn()}
          onClose={jest.fn()}
        />
      );
      await flush();
      expect(screen.getByText('Within 250 km')).toBeTruthy();
    });
  });

  it('renders the Minimum rating group and lets a single option be selected', async () => {
    render(
      <ScopeSheet
        visible
        initialDraft={defaultScopeDraft('nearby', { latitude: 1, longitude: 2 })}
        onQuery={jest.fn().mockResolvedValue({ status: 'success', activities: [] })}
        onApply={jest.fn()}
        onClose={jest.fn()}
      />
    );
    await flush();
    expect(screen.getByText('Minimum rating')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: '4.5+' }));
    });
    expect(screen.getByRole('button', { name: '4.5+, selected' })).toBeTruthy();
  });

  it('never shows Category/subtype controls', async () => {
    render(
      <ScopeSheet
        visible
        initialDraft={defaultScopeDraft('nearby', { latitude: 1, longitude: 2 })}
        onQuery={jest.fn().mockResolvedValue({ status: 'success', activities: [] })}
        onApply={jest.fn()}
        onClose={jest.fn()}
      />
    );
    await flush();
    expect(screen.queryByText('Category')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restaurants' })).toBeNull();
    expect(screen.queryAllByText(/subtypes$/)).toHaveLength(0);
  });

  describe('Live count', () => {
    it('shows the debounced live count and never blanks it on a later failed refetch', async () => {
      const onQuery = jest.fn().mockResolvedValue({ status: 'success', activities: activities(4) });
      render(
        <ScopeSheet
          visible
          initialDraft={defaultScopeDraft('nearby', { latitude: 1, longitude: 2 })}
          onQuery={onQuery}
          onApply={jest.fn()}
          onClose={jest.fn()}
        />
      );
      await flush();
      await waitFor(() => expect(screen.getByRole('button', { name: 'Show 4 activities' })).toBeTruthy());

      onQuery.mockResolvedValueOnce({ status: 500, message: 'boom' });
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: '4.5+' }));
      });
      // The live-effect's own refetch fails silently — the last known count stays.
      await waitFor(() => expect(onQuery).toHaveBeenCalledTimes(2));
      expect(screen.getByRole('button', { name: 'Show 4 activities' })).toBeTruthy();
    });

    it('disables the CTA and shows the zero-result copy when the live count is 0', async () => {
      render(
        <ScopeSheet
          visible
          initialDraft={defaultScopeDraft('nearby', { latitude: 1, longitude: 2 })}
          onQuery={jest.fn().mockResolvedValue({ status: 'success', activities: [] })}
          onApply={jest.fn()}
          onClose={jest.fn()}
        />
      );
      await flush();
      await waitFor(() => expect(screen.getByText('No matches — widen distance or add a city')).toBeTruthy());
      expect(screen.getByRole('button', { name: 'Show 0 activities' }).props.accessibilityState?.disabled).not.toBe(false);
    });
  });

  describe('Apply / Reset', () => {
    it('commits the draft and closes on a successful Show tap', async () => {
      const onQuery = jest.fn().mockResolvedValue({ status: 'success', activities: activities(2) });
      const onApply = jest.fn();
      const onClose = jest.fn();
      render(
        <ScopeSheet
          visible
          initialDraft={defaultScopeDraft('nearby', { latitude: 1, longitude: 2 })}
          onQuery={onQuery}
          onApply={onApply}
          onClose={onClose}
        />
      );
      await flush();
      await waitFor(() => expect(screen.getByRole('button', { name: 'Show 2 activities' })).toBeTruthy());

      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Show 2 activities' }));
      });

      expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ scope: 'nearby' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('keeps the sheet open and shows the error, without committing, when Show fails', async () => {
      const onQuery = jest.fn().mockResolvedValue({ status: 'success', activities: activities(2) });
      const onApply = jest.fn();
      const onClose = jest.fn();
      render(
        <ScopeSheet
          visible
          initialDraft={defaultScopeDraft('nearby', { latitude: 1, longitude: 2 })}
          onQuery={onQuery}
          onApply={onApply}
          onClose={onClose}
        />
      );
      await flush();
      await waitFor(() => expect(screen.getByRole('button', { name: 'Show 2 activities' })).toBeTruthy());

      onQuery.mockResolvedValueOnce({ status: 500, message: 'internal error' });
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Show 2 activities' }));
      });

      expect(onApply).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByText('internal error')).toBeTruthy();
    });

    it('Reset clears cities/distance/rating but keeps the current scope tab and coordinates', async () => {
      mockedSuggest.mockResolvedValue({
        status: 'success',
        suggestions: [{ city: 'Lisbon', country: 'Portugal', centroid: { lat: 38.7, lng: -9.1 } }],
      });
      render(
        <ScopeSheet
          visible
          initialDraft={defaultScopeDraft('anywhere', { latitude: 1, longitude: 2 })}
          onQuery={jest.fn().mockResolvedValue({ status: 'success', activities: activities(1) })}
          onApply={jest.fn()}
          onClose={jest.fn()}
        />
      );
      await flush();

      fireEvent.changeText(screen.getByLabelText('Search cities'), 'Lis');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Lisbon, Portugal' })).toBeTruthy());
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Lisbon, Portugal' }));
      });
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: '4.5+' }));
      });
      expect(screen.getByText('1 selected')).toBeTruthy();

      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Reset' }));
      });

      expect(screen.getByText('0 selected')).toBeTruthy();
      expect(screen.getByRole('button', { name: '4.5+' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: '4.5+, selected' })).toBeNull();
      // Distance slider still shown (device coordinates survive Reset) at "No limit".
      expect(screen.getAllByText('No limit')).toHaveLength(2);
    });
  });
});
