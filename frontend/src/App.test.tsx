import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';
import { listAdminActivities } from './api/adminActivities';
import { suggestCities } from './api/cities';

vi.mock('./api/adminActivities', () => ({
  listAdminActivities: vi.fn(),
}));
vi.mock('./api/cities', () => ({
  suggestCities: vi.fn(),
}));

describe('App', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('redirects / to the Activities screen inside the admin shell', async () => {
    vi.mocked(suggestCities).mockResolvedValue([]);
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

  it('routes /activities/new to the T4 placeholder', async () => {
    vi.mocked(suggestCities).mockResolvedValue([]);
    window.history.pushState({}, '', '/activities/new');

    render(<App />);

    expect(await screen.findByText('New activity')).toBeInTheDocument();
    expect(screen.getByText('Coming in T4.')).toBeInTheDocument();
  });
});
