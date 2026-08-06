import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DetailsSection } from './DetailsSection';

describe('DetailsSection', () => {
  it('wellness renders treatments as line-items (not a flat chip list)', () => {
    render(
      <DetailsSection category="wellness" details={{}} onChange={vi.fn()} />,
    );
    expect(screen.getByText('Treatments')).toBeInTheDocument();
    expect(screen.getByText(/No treatments yet/)).toBeInTheDocument();
    expect(screen.getByLabelText('External booking note')).toBeInTheDocument();
  });

  it('nightlife renders the lineup line-items and no legacy free-text hours fields', () => {
    render(
      <DetailsSection category="nightlife" details={{}} onChange={vi.fn()} />,
    );
    expect(screen.getByText('Lineup')).toBeInTheDocument();
    expect(screen.queryByLabelText('Opens')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Open tonight')).not.toBeInTheDocument();
  });

  it('art renders two nested object-groups (artwork, current_exhibition)', () => {
    render(<DetailsSection category="art" details={{}} onChange={vi.fn()} />);
    expect(screen.getByText('Artwork')).toBeInTheDocument();
    expect(screen.getByText('Current exhibition')).toBeInTheDocument();
    expect(screen.getAllByText('Not set')).toHaveLength(2);
  });

  it('sport.difficulty renders a numeric input', () => {
    render(
      <DetailsSection
        category="sport"
        details={{ difficulty: 3 }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Difficulty')).toHaveAttribute(
      'type',
      'number',
    );
    expect(screen.getByLabelText('Difficulty')).toHaveValue(3);
  });

  it('clearing a url field to empty removes the key (never sends "")', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DetailsSection
        category="bars"
        details={{ website_url: 'https://example.com' }}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText('Booking website');
    await user.clear(input);
    await user.tab();
    const lastCall = onChange.mock.calls.at(-1)![0];
    expect(lastCall).not.toHaveProperty('website_url');
  });

  it.each(['cafes', 'nature', 'kids', 'shopping', 'tours_experiences'])(
    '%s renders the Booking website field and round-trips a saved value',
    (category) => {
      render(
        <DetailsSection
          category={category}
          details={{ website_url: 'https://example.com' }}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByLabelText('Booking website')).toHaveValue(
        'https://example.com',
      );
    },
  );

  it('restaurants renders the Opening hours group after the free-text hours field', () => {
    render(
      <DetailsSection category="restaurants" details={{}} onChange={vi.fn()} />,
    );
    expect(screen.getByText('Opening hours')).toBeInTheDocument();
    expect(screen.getByLabelText('Open 24/7')).toBeInTheDocument();
  });

  it('nature (out-of-scope category) renders no Opening hours group', () => {
    render(<DetailsSection category="nature" details={{}} onChange={vi.fn()} />);
    expect(screen.queryByText('Opening hours')).toBeNull();
  });

  it('renders no input for the scraped-value keys the Go model dropped for good (detail-price-duration-purge T1)', () => {
    const removedLabels = ['Time / price'];
    for (const category of ['sport', 'wellness', 'entertainment']) {
      const { unmount } = render(
        <DetailsSection category={category} details={{}} onChange={vi.fn()} />,
      );
      for (const label of removedLabels) {
        expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
      }
      unmount();
    }
  });

  it('nature.good_to_know renders chips, not a textarea (addendum correction)', () => {
    render(
      <DetailsSection
        category="nature"
        details={{ good_to_know: ['Bring water'] }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Bring water')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Good to know' })).toBeNull();
  });

  it('tours_experiences renders all eight fields, not the "No additional details" fallback', () => {
    render(
      <DetailsSection
        category="tours_experiences"
        details={{}}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.queryByText('No additional details for this category'),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Duration')).toBeInTheDocument();
    expect(screen.getByLabelText('Group size')).toBeInTheDocument();
    expect(screen.getByLabelText('Languages')).toBeInTheDocument();
    expect(screen.getByLabelText('Difficulty level')).toBeInTheDocument();
    expect(screen.getByText('Included')).toBeInTheDocument();
    expect(screen.getByText('Not included')).toBeInTheDocument();
    expect(screen.getByText('Itinerary')).toBeInTheDocument();
    expect(screen.getByLabelText('Meeting point')).toBeInTheDocument();
  });

  it('difficulty_level renders as a native select offering — plus exactly the three documented values, no free text', () => {
    render(
      <DetailsSection
        category="tours_experiences"
        details={{ difficulty_level: 'Moderate' }}
        onChange={vi.fn()}
      />,
    );
    const select = screen.getByLabelText('Difficulty level');
    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveValue('Moderate');
    const options = Array.from(select.querySelectorAll('option')).map(
      (o) => o.textContent,
    );
    expect(options).toEqual(['—', 'Easy', 'Moderate', 'Challenging']);
  });

  it('picking — for difficulty_level removes the key (setScalar\'s empty-string branch)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DetailsSection
        category="tours_experiences"
        details={{ difficulty_level: 'Easy' }}
        onChange={onChange}
      />,
    );
    await user.selectOptions(screen.getByLabelText('Difficulty level'), '');
    const lastCall = onChange.mock.calls.at(-1)![0];
    expect(lastCall).not.toHaveProperty('difficulty_level');
  });

  it('restaurants/culture/art/nightlife render their new free-text price field', () => {
    const cases: Array<[string, string]> = [
      ['restaurants', 'Price tier'],
      ['culture', 'Ticket price'],
      ['art', 'Ticket price'],
      ['nightlife', 'Entry price'],
    ];
    for (const [category, label] of cases) {
      const { unmount } = render(
        <DetailsSection category={category} details={{}} onChange={vi.fn()} />,
      );
      const input = screen.getByLabelText(label);
      expect(input).toBeInTheDocument();
      expect(input).toHaveAttribute('type', 'text');
      unmount();
    }
  });

  it('wellness and entertainment render good_to_know as chips', () => {
    for (const category of ['wellness', 'entertainment']) {
      const { unmount } = render(
        <DetailsSection
          category={category}
          details={{ good_to_know: ['Bring cash'] }}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByText('Bring cash')).toBeInTheDocument();
      unmount();
    }
  });

  it('popular_dishes/on_the_bar rows grow a Price sub-field that reflects an existing value', () => {
    render(
      <DetailsSection
        category="restaurants"
        details={{ popular_dishes: [{ name: 'Pljeskavica', price: '$8' }] }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue('Pljeskavica')).toBeInTheDocument();
    expect(screen.getByDisplayValue('$8')).toBeInTheDocument();
  });

  it('adding a dish still moves focus to Name, not the new Price sub-field', async () => {
    const user = userEvent.setup();
    function Wrapper() {
      const [details, setDetails] = useState<Record<string, unknown>>({});
      return (
        <DetailsSection
          category="restaurants"
          details={details}
          onChange={setDetails}
        />
      );
    }
    render(<Wrapper />);
    await user.click(screen.getByRole('button', { name: 'Add dish' }));
    expect(screen.getByLabelText('Name')).toHaveFocus();
  });
});
