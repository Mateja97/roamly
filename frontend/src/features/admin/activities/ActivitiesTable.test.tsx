import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ActivitiesTable } from './ActivitiesTable';
import type { ActivitiesQueryState } from '../hooks/useAdminActivities';

function renderTable(result: ActivitiesQueryState, onClearFilters = vi.fn()) {
  const view = render(
    <MemoryRouter>
      <ActivitiesTable result={result} onClearFilters={onClearFilters} />
    </MemoryRouter>,
  );
  return { onClearFilters, container: view.container };
}

const activity = {
  id: 'a1',
  title: 'National Museum',
  category: 'culture',
  city: 'Belgrade',
  status: 'published' as const,
  rating: 4.5,
  photos: [{ url: 'https://example.com/photo.jpg' }],
};

describe('ActivitiesTable', () => {
  it('renders a skeleton row set while loading', () => {
    const { container } = renderTable({ status: 'loading' });
    expect(
      container.querySelectorAll('tbody tr[aria-hidden="true"]'),
    ).toHaveLength(7);
  });

  it('renders a row per activity when loaded', () => {
    renderTable({
      status: 'success',
      data: {
        activities: [activity],
        total: 1,
        page: 1,
        page_size: 20,
        stats: { total: 1, published: 1, draft: 0, pending: 0 },
      },
    });
    expect(screen.getByText('National Museum')).toBeInTheDocument();
    expect(screen.getByText('Published')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Edit National Museum' }),
    ).toHaveAttribute('href', '/activities/a1/edit');
  });

  it('falls back to a broken-image placeholder on img error', () => {
    const { container } = renderTable({
      status: 'success',
      data: {
        activities: [activity],
        total: 1,
        page: 1,
        page_size: 20,
        stats: { total: 1, published: 1, draft: 0, pending: 0 },
      },
    });
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img).not.toBeNull();
    fireEvent.error(img);
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(
      container.querySelector('.admin-thumb-placeholder'),
    ).toBeInTheDocument();
  });

  it('renders the empty state and wires Clear filters', async () => {
    const user = userEvent.setup();
    const { onClearFilters } = renderTable({
      status: 'success',
      data: {
        activities: [],
        total: 0,
        page: 1,
        page_size: 20,
        stats: { total: 0, published: 0, draft: 0, pending: 0 },
      },
    });
    expect(
      screen.getByText('No activities match your filters'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClearFilters).toHaveBeenCalled();
  });

  it('renders a dismissible error banner for a 500', async () => {
    const user = userEvent.setup();
    renderTable({ status: 500, message: 'internal error' });
    expect(screen.getByRole('alert')).toHaveTextContent('internal error');
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the error slot mounted after dismiss so the table below it does not shift', async () => {
    const user = userEvent.setup();
    const { container } = renderTable({
      status: 500,
      message: 'internal error',
    });
    expect(container.querySelector('.admin-error-slot')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    // The slot itself (which reserves the banner's footprint in CSS) stays
    // in the DOM — only the alert content inside it is gone.
    expect(container.querySelector('.admin-error-slot')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders the blocking 403 panel instead of the table, with no dismiss', () => {
    renderTable({ status: 403, message: 'invalid or missing admin token' });
    expect(screen.getByText('Admin access rejected')).toBeInTheDocument();
    expect(screen.getByText(/VITE_ADMIN_TOKEN/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Dismiss' }),
    ).not.toBeInTheDocument();
  });
});
