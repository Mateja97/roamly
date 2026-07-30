import { fireEvent, render, screen } from '@testing-library/react-native';
import type { TripadvisorAttribution } from '../api/activities';
import { TripadvisorAttributionPlate } from './TripadvisorAttributionPlate';

const tripadvisor: TripadvisorAttribution = {
  rating_image_url: 'https://tripadvisor.example/bubble.png',
  review_count: 1204,
  web_url: 'https://tripadvisor.example/place',
};

describe('TripadvisorAttributionPlate', () => {
  it('card variant: shows the numeric rating and review count together, no context line', () => {
    render(<TripadvisorAttributionPlate tripadvisor={tripadvisor} rating={4.5} variant="card" />);
    expect(screen.getByText('4.5 · 1,204')).toBeTruthy();
    expect(screen.queryByText(/on Tripadvisor/)).toBeNull();
  });

  it('card variant: rounds the rating to one decimal place', () => {
    render(<TripadvisorAttributionPlate tripadvisor={tripadvisor} rating={4} variant="card" />);
    expect(screen.getByText('4.0 · 1,204')).toBeTruthy();
  });

  it('detail variant: shows the bold numeric rating plus a context line with review count + "on Tripadvisor", no ranking when absent', () => {
    render(<TripadvisorAttributionPlate tripadvisor={tripadvisor} rating={4.5} variant="detail" />);
    expect(screen.getByText('4.5')).toBeTruthy();
    expect(screen.getByText('1,204 reviews on Tripadvisor')).toBeTruthy();
  });

  it('detail variant: appends the dated ranking sentence to the context line, verbatim, when present', () => {
    render(
      <TripadvisorAttributionPlate
        tripadvisor={{ ...tripadvisor, ranking_text: '#3 of 512 Restaurants in Belgrade, June 2026' }}
        rating={4.5}
        variant="detail"
      />,
    );
    expect(
      screen.getByText('1,204 reviews on Tripadvisor · #3 of 512 Restaurants in Belgrade, June 2026'),
    ).toBeTruthy();
  });

  it('card variant: never renders ranking_text even when present (mock shows rating · count only)', () => {
    render(
      <TripadvisorAttributionPlate
        tripadvisor={{ ...tripadvisor, ranking_text: '#3 of 512 Restaurants in Belgrade, June 2026' }}
        rating={4.5}
        variant="card"
      />,
    );
    expect(screen.getByText('4.5 · 1,204')).toBeTruthy();
    expect(screen.queryByText(/#3 of 512/)).toBeNull();
  });

  it('detail variant: renders the Travelers\' Choice badge when award is present', () => {
    render(
      <TripadvisorAttributionPlate
        tripadvisor={{ ...tripadvisor, award: { name: "Travelers' Choice", year: 2026 } }}
        rating={4.5}
        variant="detail"
      />,
    );
    expect(screen.getByText("Travelers' Choice 2026")).toBeTruthy();
  });

  it('detail variant: omits the badge entirely when award is absent (no empty badge)', () => {
    render(<TripadvisorAttributionPlate tripadvisor={tripadvisor} rating={4.5} variant="detail" />);
    expect(screen.queryByText(/Travelers' Choice/)).toBeNull();
  });

  it('card variant: never renders the award badge even when present (mock shows no badge on the card)', () => {
    render(
      <TripadvisorAttributionPlate
        tripadvisor={{ ...tripadvisor, award: { name: "Travelers' Choice", year: 2026 } }}
        rating={4.5}
        variant="card"
      />,
    );
    expect(screen.queryByText(/Travelers' Choice/)).toBeNull();
  });

  it('card variant: is an inset content-hugging pill, not a full-bleed band', () => {
    render(<TripadvisorAttributionPlate tripadvisor={tripadvisor} rating={4.5} variant="card" />);
    const plate = screen.getByTestId('tripadvisor-attribution-plate');
    const style = Array.isArray(plate.props.style) ? Object.assign({}, ...plate.props.style) : plate.props.style;
    expect(style.alignSelf).toBe('flex-start');
    expect(style.borderRadius).toBeGreaterThanOrEqual(999);
    expect(style.marginHorizontal).toBeUndefined();
  });

  it('reserves the rating image width so a broken load keeps the count in place', () => {
    render(<TripadvisorAttributionPlate tripadvisor={tripadvisor} rating={4.5} variant="card" />);
    const image = screen.getByTestId('tripadvisor-rating-image');
    fireEvent(image, 'error', { nativeEvent: { error: 'load failed' } });
    // No bespoke broken-image UI (per design-spec.md, out of scope) — the
    // logo + rating + review count still render regardless of the image's own state.
    expect(screen.getByText('4.5 · 1,204')).toBeTruthy();
  });
});
