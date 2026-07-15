import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { FilterSheet } from './FilterSheet';
import { EMPTY_FILTERS, defaultFilters } from './filters';
import type { Filters } from './types';

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: jest.fn() } as never);
});
afterEach(() => jest.resetAllMocks());

// The open-effect's `AccessibilityInfo.isReduceMotionEnabled()` check
// resolves on a microtask after `render()` returns — flush it inside `act`
// so the resulting Animated.Value writes aren't attributed to "outside act".
async function flush() {
  await act(async () => {});
}

describe('FilterSheet', () => {
  it('renders category and rating groups for nearby, with no Max distance control (server-fixed range)', async () => {
    render(
      <FilterSheet
        visible
        initialFilters={EMPTY_FILTERS}
        scope="nearby"
        hasLocationAnchor
        onApply={jest.fn()}
        onClose={jest.fn()}
      />
    );
    await flush();
    expect(screen.getByText('Category')).toBeTruthy();
    expect(screen.getByText('Minimum rating')).toBeTruthy();
    expect(screen.queryByText('Max distance')).toBeNull();
    expect(screen.getByRole('button', { name: 'Sport' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '4.5+' })).toBeTruthy();
  });

  it('shows the Max distance group for anywhere with a location anchor, defaulting to "No limit"', async () => {
    render(
      <FilterSheet
        visible
        initialFilters={defaultFilters('anywhere')}
        scope="anywhere"
        hasLocationAnchor
        onApply={jest.fn()}
        onClose={jest.fn()}
      />
    );
    await flush();
    expect(screen.getByText('Max distance')).toBeTruthy();
    // Both the value readout and the top end-label read "No limit" at the
    // default — assert there are two, not one.
    expect(screen.getAllByText('No limit')).toHaveLength(2);
  });

  it('hides the Max distance group entirely for anywhere with no location anchor', async () => {
    render(
      <FilterSheet
        visible
        initialFilters={defaultFilters('anywhere')}
        scope="anywhere"
        hasLocationAnchor={false}
        onApply={jest.fn()}
        onClose={jest.fn()}
      />
    );
    await flush();
    expect(screen.queryByText('Max distance')).toBeNull();
  });

  it('applies the current draft selection on Apply and closes on success', async () => {
    const onApply = jest.fn().mockResolvedValue({ status: 'success', activities: [] });
    const onClose = jest.fn();
    render(
      <FilterSheet
        visible
        initialFilters={EMPTY_FILTERS}
        scope="nearby"
        hasLocationAnchor
        onApply={onApply}
        onClose={onClose}
      />
    );
    await flush();

    fireEvent.press(screen.getByRole('button', { name: 'Sport' }));

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: /^apply filters$/i }));
    });

    expect(onApply).toHaveBeenCalledWith({
      categories: ['sport'],
      minRating: null,
      maxDistanceKm: null,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the sheet open and shows the error, preserving the selection, when Apply fails', async () => {
    const onApply = jest.fn().mockResolvedValue({ status: 500, message: 'internal error' });
    const onClose = jest.fn();
    render(
      <FilterSheet
        visible
        initialFilters={EMPTY_FILTERS}
        scope="nearby"
        hasLocationAnchor
        onApply={onApply}
        onClose={onClose}
      />
    );
    await flush();

    fireEvent.press(screen.getByRole('button', { name: 'Sport' }));

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: /^apply filters$/i }));
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('internal error')).toBeTruthy();
    // Selection preserved: Sport chip still shows as selected.
    expect(screen.getByRole('button', { name: /sport, selected/i })).toBeTruthy();
  });

  it('Clear all resets every group to unset for nearby (no distance control to reset)', async () => {
    const initial: Filters = { categories: ['sport'], minRating: 4.5, maxDistanceKm: null };
    render(
      <FilterSheet
        visible
        initialFilters={initial}
        scope="nearby"
        hasLocationAnchor
        onApply={jest.fn()}
        onClose={jest.fn()}
      />
    );
    await flush();
    expect(screen.getByRole('button', { name: /sport, selected/i })).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Clear all' }));

    // Sport chip returns to unselected; the always-present "Any" rating
    // option legitimately stays selected as the default.
    expect(screen.getByRole('button', { name: 'Sport' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /sport, selected/i })).toBeNull();
    expect(screen.queryByText('Max distance')).toBeNull();
  });

  it('Clear all resets anywhere\'s distance slider back to "No limit"', async () => {
    const initial: Filters = { categories: [], minRating: null, maxDistanceKm: 300 };
    render(
      <FilterSheet
        visible
        initialFilters={initial}
        scope="anywhere"
        hasLocationAnchor
        onApply={jest.fn()}
        onClose={jest.fn()}
      />
    );
    await flush();
    expect(screen.getByText('Within 300 km')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Clear all' }));

    expect(screen.getAllByText('No limit')).toHaveLength(2);
  });

  it('seeds the draft straight from initialFilters on mount', async () => {
    // The parent (ActivityListScreen) remounts this component fresh on each
    // open — keyed on open/closed — rather than this component reacting to
    // an `initialFilters` prop change in place; a fresh mount already reads
    // the latest `initialFilters` as its starting draft.
    const withSports: Filters = { ...EMPTY_FILTERS, categories: ['sport'] };
    render(
      <FilterSheet
        visible
        initialFilters={withSports}
        scope="nearby"
        hasLocationAnchor
        onApply={jest.fn()}
        onClose={jest.fn()}
      />
    );
    await flush();
    expect(screen.getByRole('button', { name: /sport, selected/i })).toBeTruthy();
  });
});
