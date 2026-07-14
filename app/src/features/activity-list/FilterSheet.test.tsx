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
  it('renders all three filter groups when visible, including the distance slider for nearby', async () => {
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
    expect(screen.getByText('Max distance')).toBeTruthy();
    expect(screen.getByText('Within 50 km')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sports' })).toBeTruthy();
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

    fireEvent.press(screen.getByRole('button', { name: 'Sports' }));

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: /^apply filters$/i }));
    });

    expect(onApply).toHaveBeenCalledWith({
      categories: ['sports'],
      minRating: null,
      maxDistanceKm: 50,
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

    fireEvent.press(screen.getByRole('button', { name: 'Sports' }));

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: /^apply filters$/i }));
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('internal error')).toBeTruthy();
    // Selection preserved: Sports chip still shows as selected.
    expect(screen.getByRole('button', { name: /sports, selected/i })).toBeTruthy();
  });

  it('Clear all resets every group to unset, including the distance slider back to its 50km ceiling', async () => {
    const initial: Filters = { categories: ['sports'], minRating: 4.5, maxDistanceKm: 25 };
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
    expect(screen.getByRole('button', { name: /sports, selected/i })).toBeTruthy();
    expect(screen.getByText('Within 25 km')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Clear all' }));

    // Sports chip returns to unselected; the always-present "Any" rating
    // option and the slider's 50km ceiling legitimately stay selected as
    // the default.
    expect(screen.getByRole('button', { name: 'Sports' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /sports, selected/i })).toBeNull();
    expect(screen.getByText('Within 50 km')).toBeTruthy();
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
    const withSports: Filters = { ...EMPTY_FILTERS, categories: ['sports'] };
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
    expect(screen.getByRole('button', { name: /sports, selected/i })).toBeTruthy();
  });
});
