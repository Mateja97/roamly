import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AdminShell } from './AdminShell';

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/activities']}>
      <Routes>
        <Route element={<AdminShell />}>
          <Route path="/activities" element={<div>page content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminShell', () => {
  it('renders the Roamly wordmark and Admin eyebrow', () => {
    renderShell();
    expect(screen.getByText('Roamly')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('renders Activities as the only interactive, current nav item', () => {
    renderShell();
    const activities = screen.getByRole('link', { name: /activities/i });
    expect(activities).toHaveAttribute('aria-current', 'page');
  });

  it('renders Categories/Cities/Reviews/Settings as disabled, non-interactive', () => {
    renderShell();
    for (const label of ['Categories', 'Cities', 'Reviews', 'Settings']) {
      const item = screen.getByText(label);
      expect(item.closest('[aria-disabled]')).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      expect(
        screen.queryByRole('link', { name: new RegExp(label, 'i') }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: new RegExp(label, 'i') }),
      ).not.toBeInTheDocument();
    }
  });

  it('renders the static user footer chrome', () => {
    renderShell();
    expect(screen.getByText('Mila Kostić')).toBeInTheDocument();
    expect(screen.getByText('Editor')).toBeInTheDocument();
  });

  it('renders the routed page content via Outlet', () => {
    renderShell();
    expect(screen.getByText('page content')).toBeInTheDocument();
  });
});
