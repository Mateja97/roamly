import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatCards } from './StatCards';

describe('StatCards', () => {
  it('renders a skeleton per card while loading', () => {
    const { container } = render(<StatCards state={{ kind: 'loading' }} />);
    expect(container.querySelectorAll('.admin-stat-skeleton')).toHaveLength(4);
  });

  it('renders an em-dash per card on error, not a stale/zero number', () => {
    render(<StatCards state={{ kind: 'error' }} />);
    expect(screen.getAllByText('—')).toHaveLength(4);
  });

  it('renders the real numbers from stats when loaded', () => {
    render(
      <StatCards
        state={{
          kind: 'loaded',
          stats: { total: 248, published: 214, draft: 22, pending: 12 },
        }}
      />,
    );
    expect(screen.getByText('248')).toBeInTheDocument();
    expect(screen.getByText('214')).toBeInTheDocument();
    expect(screen.getByText('22')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });
});
