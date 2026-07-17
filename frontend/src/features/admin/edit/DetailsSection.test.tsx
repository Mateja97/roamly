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

  it('nightlife renders the boolean toggle and the lineup line-items', () => {
    render(
      <DetailsSection
        category="nightlife"
        details={{ open_tonight: true }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Open tonight')).toBeChecked();
    expect(screen.getByText('Lineup')).toBeInTheDocument();
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
        details={{ action_url: 'https://example.com' }}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText('Booking website');
    await user.clear(input);
    await user.tab();
    const lastCall = onChange.mock.calls.at(-1)![0];
    expect(lastCall).not.toHaveProperty('action_url');
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
});
