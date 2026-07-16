import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { EditActivityPlaceholder } from './EditActivityPlaceholder';

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/activities/new" element={<EditActivityPlaceholder />} />
        <Route
          path="/activities/:id/edit"
          element={<EditActivityPlaceholder />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('EditActivityPlaceholder', () => {
  it('renders a create-mode placeholder at /activities/new', () => {
    renderAt('/activities/new');
    expect(screen.getByText('New activity')).toBeInTheDocument();
    expect(screen.getByText('Coming in T4.')).toBeInTheDocument();
  });

  it('renders an edit-mode placeholder with the id at /activities/:id/edit', () => {
    renderAt('/activities/abc123/edit');
    expect(screen.getByText('Edit activity abc123')).toBeInTheDocument();
  });

  it('links back to the activities list', () => {
    renderAt('/activities/new');
    expect(
      screen.getByRole('link', { name: /back to activities/i }),
    ).toHaveAttribute('href', '/activities');
  });
});
