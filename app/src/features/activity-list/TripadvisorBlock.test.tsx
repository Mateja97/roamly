import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import type { TripadvisorAttribution, TripadvisorReview } from '../../api/activities';
import { TripadvisorBlock } from './TripadvisorBlock';

const tripadvisor: TripadvisorAttribution = {
  rating_image_url: 'https://tripadvisor.example/bubble.png',
  review_count: 1204,
  web_url: 'https://tripadvisor.example/place',
};

const reviews: TripadvisorReview[] = [
  { rating: 5, date: '14 June 2026', text: 'Fantastic evening, the staff could not have been more welcoming.' },
];

function renderBlock(overrides: Partial<ComponentProps<typeof TripadvisorBlock>> = {}) {
  return render(
    <TripadvisorBlock
      tripadvisor={tripadvisor}
      reviews={[]}
      address={undefined}
      ctaBusy={false}
      onCallPhone={jest.fn()}
      {...overrides}
    />,
  );
}

describe('TripadvisorBlock', () => {
  it('always renders the aggregate plate', () => {
    renderBlock();
    expect(screen.getByText('1,204 reviews on Tripadvisor')).toBeTruthy();
  });

  // Bug fix: the "Read all reviews on Tripadvisor" deep-link button + its
  // disclaimer moved out of this component — they're now the trailing
  // elements of the parent screen's scrollable content, after the
  // FactStrip/map (see ActivityDetailScreen.test.tsx), not mid-block here.
  it('does not render the deep-link button or the disclaimer (moved to the parent screen)', () => {
    renderBlock();
    expect(
      screen.queryByRole('button', { name: 'Read all reviews on Tripadvisor' }),
    ).toBeNull();
    expect(
      screen.queryByText(/Roamly does not rate these places/),
    ).toBeNull();
  });

  it('omits the subratings plate when tripadvisor.subratings is absent (no empty grid)', () => {
    renderBlock();
    expect(screen.queryByText('Food')).toBeNull();
  });

  it('renders the subratings plate when present', () => {
    renderBlock({ tripadvisor: { ...tripadvisor, subratings: { food: 4.5, service: 4.0, value: 3.5, atmosphere: 5.0 } } });
    expect(screen.getByText('Food')).toBeTruthy();
    expect(screen.getByText('4.5')).toBeTruthy();
  });

  it('omits the reviews carousel entirely when reviews is empty (no empty state)', () => {
    renderBlock();
    expect(screen.queryByText('Tripadvisor traveler reviews')).toBeNull();
  });

  it('renders the reviews carousel when reviews are present', () => {
    renderBlock({ reviews });
    expect(screen.getByText('Tripadvisor traveler reviews')).toBeTruthy();
    expect(screen.getByText('“Fantastic evening, the staff could not have been more welcoming.”')).toBeTruthy();
  });

  it('omits the facts block entirely when address and phone are both absent', () => {
    renderBlock();
    expect(screen.queryByLabelText(/call/i)).toBeNull();
  });

  it('renders the address row when present, non-interactive', () => {
    renderBlock({ address: 'Knez Mihailova 10, Belgrade' });
    expect(screen.getByText('Knez Mihailova 10, Belgrade')).toBeTruthy();
  });

  it('renders the phone row as a tel: link and calls onCallPhone with the number when pressed', () => {
    const onCallPhone = jest.fn();
    renderBlock({ tripadvisor: { ...tripadvisor, phone: '+381 11 123 4567' }, onCallPhone });
    const phoneLink = screen.getByRole('link', { name: 'Call +381 11 123 4567' });
    expect(phoneLink).toBeTruthy();
    fireEvent.press(phoneLink);
    expect(onCallPhone).toHaveBeenCalledWith('+381 11 123 4567');
  });

});
