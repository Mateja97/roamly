import { fireEvent, render, screen } from '@testing-library/react-native';
import type { TripadvisorAttribution } from '../api/activities';
import { TripadvisorAttributionPlate } from './TripadvisorAttributionPlate';

const tripadvisor: TripadvisorAttribution = {
  rating_image_url: 'https://tripadvisor.example/bubble.png',
  review_count: 1204,
  web_url: 'https://tripadvisor.example/place',
};

describe('TripadvisorAttributionPlate', () => {
  it('card variant: shows the review count next to the rating image, no context line', () => {
    render(<TripadvisorAttributionPlate tripadvisor={tripadvisor} variant="card" />);
    expect(screen.getByText('1,204 reviews')).toBeTruthy();
    expect(screen.queryByText(/on Tripadvisor/)).toBeNull();
  });

  it('detail variant: shows a context line with review count + "on Tripadvisor", no ranking when absent', () => {
    render(<TripadvisorAttributionPlate tripadvisor={tripadvisor} variant="detail" />);
    expect(screen.getByText('1,204 reviews on Tripadvisor')).toBeTruthy();
  });

  it('detail variant: appends ranking_text verbatim, separated by " · ", when present', () => {
    render(
      <TripadvisorAttributionPlate
        tripadvisor={{ ...tripadvisor, ranking_text: '#3 of 512 Restaurants in Belgrade, June 2026' }}
        variant="detail"
      />,
    );
    expect(
      screen.getByText('1,204 reviews on Tripadvisor · #3 of 512 Restaurants in Belgrade, June 2026'),
    ).toBeTruthy();
  });

  it('reserves the rating image width so a broken load keeps the count in place', () => {
    render(<TripadvisorAttributionPlate tripadvisor={tripadvisor} variant="card" />);
    const image = screen.getByTestId('tripadvisor-rating-image');
    fireEvent(image, 'error', { nativeEvent: { error: 'load failed' } });
    // No bespoke broken-image UI (per design-spec.md, out of scope) — the
    // logo + review count still render regardless of the image's own state.
    expect(screen.getByText('1,204 reviews')).toBeTruthy();
  });
});
