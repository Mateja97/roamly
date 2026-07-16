import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pagination } from './Pagination';

describe('Pagination', () => {
  it('shows the correct "Showing X-Y of N" readout', () => {
    render(
      <Pagination page={2} pageSize={20} total={45} onPageChange={vi.fn()} />,
    );
    expect(screen.getByText('Showing 21–40 of 45')).toBeInTheDocument();
  });

  it('clamps the last page readout to the total', () => {
    render(
      <Pagination page={3} pageSize={20} total={45} onPageChange={vi.fn()} />,
    );
    expect(screen.getByText('Showing 41–45 of 45')).toBeInTheDocument();
  });

  it('disables Previous on page 1 and Next on the last page', () => {
    render(
      <Pagination page={1} pageSize={20} total={45} onPageChange={vi.fn()} />,
    );
    expect(
      screen.getByRole('button', { name: 'Previous page' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Next page' }),
    ).not.toBeDisabled();
  });

  it('marks the current page with aria-current and advances on click', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(
      <Pagination
        page={2}
        pageSize={20}
        total={45}
        onPageChange={onPageChange}
      />,
    );
    expect(screen.getByRole('button', { name: '2' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it('disables every control and marks aria-busy when disabled (stale-while-loading)', () => {
    render(
      <Pagination
        page={2}
        pageSize={20}
        total={45}
        onPageChange={vi.fn()}
        disabled
      />,
    );
    expect(
      screen.getByRole('navigation', { name: 'Pagination' }),
    ).toHaveAttribute('aria-busy', 'true');
    expect(
      screen.getByRole('button', { name: 'Previous page' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '2' })).toBeDisabled();
  });
});
