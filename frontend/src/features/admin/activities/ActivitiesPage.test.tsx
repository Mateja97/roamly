import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ActivitiesPage } from './ActivitiesPage';
import {
  listAdminActivities,
  listAdminCities,
  type AdminApiResult,
  type ListAdminActivitiesResponse,
} from '../../../api/adminActivities';

vi.mock('../../../api/adminActivities', () => ({
  listAdminActivities: vi.fn(),
  listAdminCities: vi.fn(),
}));

const mockedList = vi.mocked(listAdminActivities);
const mockedCities = vi.mocked(listAdminCities);

const activity = {
  id: 'a1',
  title: 'National Museum',
  category: 'culture',
  city: 'Belgrade',
  status: 'published' as const,
  rating: 4.5,
  photos: [{ url: 'https://example.com/photo.jpg' }],
};

function successResponse() {
  return {
    status: 'success' as const,
    data: {
      activities: [activity],
      total: 45,
      page: 1,
      page_size: 20,
      stats: { total: 45, published: 40, draft: 3, pending: 2 },
    },
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ActivitiesPage />
    </MemoryRouter>,
  );
}

describe('ActivitiesPage', () => {
  beforeEach(() => {
    mockedCities.mockResolvedValue({
      status: 'success',
      data: ['Belgrade', 'Novi Sad'],
    });
    mockedList.mockResolvedValue(successResponse());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders rows once the request resolves', async () => {
    renderPage();
    expect(await screen.findByText('National Museum')).toBeInTheDocument();
    expect(
      screen.getByText('45 activities across 2 cities'),
    ).toBeInTheDocument();
  });

  it('selecting a status chip fires a request with the right params, reset to page 1', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('National Museum');
    mockedList.mockClear();

    await user.click(screen.getByRole('button', { name: 'Drafts' }));

    await waitFor(() =>
      expect(mockedList).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'draft', page: 1 }),
      ),
    );
  });

  it('advancing the page fires a request for the next page', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('National Museum');
    mockedList.mockClear();

    await user.click(screen.getByRole('button', { name: 'Next page' }));

    await waitFor(() =>
      expect(mockedList).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2 }),
      ),
    );
  });

  it('renders the error banner for a 500 branch', async () => {
    mockedList.mockResolvedValue({ status: 500, message: 'internal error' });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'internal error',
    );
  });

  it('renders the blocking auth-rejected message for a 403 branch', async () => {
    mockedList.mockResolvedValue({
      status: 403,
      message: 'invalid or missing admin token',
    });
    renderPage();
    expect(
      await screen.findByText('Admin access rejected'),
    ).toBeInTheDocument();
  });

  it('shows a pagination skeleton shell before the very first request resolves', async () => {
    let resolveFirst!: (
      value: AdminApiResult<ListAdminActivitiesResponse>,
    ) => void;
    mockedList.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const { container } = renderPage();

    expect(
      container.querySelector('.admin-pagination-skeleton'),
    ).toBeInTheDocument();

    resolveFirst(successResponse());
    await screen.findByText('National Museum');
    expect(
      container.querySelector('.admin-pagination-skeleton'),
    ).not.toBeInTheDocument();
  });

  it('keeps the pagination shell rendered (stale numbers, disabled) during a refetch instead of popping out', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('National Museum');
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    expect(nav).toHaveAttribute('aria-busy', 'false');

    let resolveNext!: (
      value: AdminApiResult<ListAdminActivitiesResponse>,
    ) => void;
    mockedList.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveNext = resolve;
        }),
    );
    await user.click(screen.getByRole('button', { name: 'Next page' }));

    // Same bar, same last-known numbers, now marked busy — never removed.
    expect(
      screen.getByRole('navigation', { name: 'Pagination' }),
    ).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Showing 1–20 of 45')).toBeInTheDocument();

    resolveNext({
      status: 'success',
      data: {
        activities: [activity],
        total: 45,
        page: 2,
        page_size: 20,
        stats: { total: 45, published: 40, draft: 3, pending: 2 },
      },
    });
    await waitFor(() =>
      expect(
        screen.getByRole('navigation', { name: 'Pagination' }),
      ).toHaveAttribute('aria-busy', 'false'),
    );
  });
});
