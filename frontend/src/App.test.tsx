import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';
import { listAdminActivities, listAdminCities } from './api/adminActivities';

vi.mock('./api/adminActivities', () => ({
  listAdminActivities: vi.fn(),
  listAdminCities: vi.fn(),
}));

describe('App', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('redirects / to the Activities screen inside the admin shell', async () => {
    vi.mocked(listAdminCities).mockResolvedValue({ status: 'success', data: [] });
    vi.mocked(listAdminActivities).mockResolvedValue({
      status: 'success',
      data: {
        activities: [],
        total: 0,
        page: 1,
        page_size: 20,
        stats: { total: 0, published: 0, draft: 0, pending: 0 },
      },
    });

    render(<App />);

    expect(
      await screen.findByText('No activities match your filters'),
    ).toBeInTheDocument();
    expect(screen.getByText('Roamly')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/activities');
  });

  it('routes /activities/new to the T4 create form', async () => {
    window.history.pushState({}, '', '/activities/new');

    render(<App />);

    expect(await screen.findByText('New activity')).toBeInTheDocument();
    expect(screen.getByLabelText('Activity name')).toBeInTheDocument();
  });
});
