import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditActivityPage } from './EditActivityPage';
import type { AdminActivityDetail } from '../../../api/adminActivities';

const {
  getAdminActivity,
  patchAdminActivity,
  createAdminActivity,
  navigateSpy,
} = vi.hoisted(() => ({
  getAdminActivity: vi.fn(),
  patchAdminActivity: vi.fn(),
  createAdminActivity: vi.fn(),
  navigateSpy: vi.fn(),
}));

vi.mock('../../../api/adminActivities', async () => {
  const actual = await vi.importActual<
    typeof import('../../../api/adminActivities')
  >('../../../api/adminActivities');
  return {
    ...actual,
    getAdminActivity,
    patchAdminActivity,
    createAdminActivity,
  };
});

vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>(
      'react-router-dom',
    );
  return { ...actual, useNavigate: () => navigateSpy };
});

const ACTIVITY: AdminActivityDetail = {
  id: 'a1',
  title: 'Kalemegdan Park',
  description: 'A big park',
  category: 'nature',
  city: 'Belgrade',
  address: 'Kalemegdanski put 1',
  status: 'draft',
  rating: 4.5,
  details: { time_to_spend: '2 hours' },
  photos: [{ url: 'https://x/1.jpg' }],
  location: { lat: 44.8, lng: 20.4 },
  created_at: '2026-07-01T10:00:00Z',
};

function renderEditPage(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/activities/new" element={<EditActivityPage />} />
        <Route path="/activities/:id/edit" element={<EditActivityPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EditActivityPage', () => {
  it('loads and populates every field in edit mode', async () => {
    getAdminActivity.mockResolvedValue({ status: 'success', data: ACTIVITY });
    renderEditPage('/activities/a1/edit');

    expect(
      await screen.findByDisplayValue('Kalemegdan Park'),
    ).toBeInTheDocument();
    // City is shown in both Basics and Location (one shared value, see
    // LocationSection's doc comment) — both instances should populate.
    expect(screen.getAllByDisplayValue('Belgrade')).toHaveLength(2);
    expect(screen.getByDisplayValue('A big park')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Draft' })).toBeChecked();
  });

  it('renders the 404 blocking panel', async () => {
    getAdminActivity.mockResolvedValue({
      status: 404,
      message: 'activity not found',
    });
    renderEditPage('/activities/missing/edit');
    expect(await screen.findByText('Activity not found')).toBeInTheDocument();
  });

  it('renders the 403 blocking panel on load', async () => {
    getAdminActivity.mockResolvedValue({
      status: 403,
      message: 'forbidden',
    });
    renderEditPage('/activities/a1/edit');
    expect(
      await screen.findByText('Admin access rejected'),
    ).toBeInTheDocument();
  });

  it('Save sends a PATCH with only the changed field(s)', async () => {
    const user = userEvent.setup();
    getAdminActivity.mockResolvedValue({ status: 'success', data: ACTIVITY });
    patchAdminActivity.mockResolvedValue({ status: 'success', data: ACTIVITY });
    renderEditPage('/activities/a1/edit');

    const nameInput = await screen.findByDisplayValue('Kalemegdan Park');
    await user.clear(nameInput);
    await user.type(nameInput, 'Kalemegdan Fortress');
    await user.click(screen.getByRole('button', { name: /Save changes/ }));

    await waitFor(() => expect(patchAdminActivity).toHaveBeenCalled());
    expect(patchAdminActivity).toHaveBeenCalledWith('a1', {
      title: 'Kalemegdan Fortress',
    });
  });

  it('a status change is included in the PATCH payload', async () => {
    const user = userEvent.setup();
    getAdminActivity.mockResolvedValue({ status: 'success', data: ACTIVITY });
    patchAdminActivity.mockResolvedValue({ status: 'success', data: ACTIVITY });
    renderEditPage('/activities/a1/edit');

    await screen.findByDisplayValue('Kalemegdan Park');
    await user.click(screen.getByRole('radio', { name: 'Published' }));
    await user.click(screen.getByRole('button', { name: /Save changes/ }));

    await waitFor(() => expect(patchAdminActivity).toHaveBeenCalled());
    expect(patchAdminActivity).toHaveBeenCalledWith('a1', {
      status: 'published',
    });
  });

  it('validation blocks submit and focuses the first invalid field', async () => {
    const user = userEvent.setup();
    getAdminActivity.mockResolvedValue({ status: 'success', data: ACTIVITY });
    renderEditPage('/activities/a1/edit');

    const nameInput = await screen.findByDisplayValue('Kalemegdan Park');
    await user.clear(nameInput);
    await user.click(screen.getByRole('button', { name: /Save changes/ }));

    expect(
      await screen.findByText('Enter an activity name'),
    ).toBeInTheDocument();
    expect(nameInput).toHaveFocus();
    expect(patchAdminActivity).not.toHaveBeenCalled();
  });

  it('a submit failure shows the error banner and preserves the form input', async () => {
    const user = userEvent.setup();
    getAdminActivity.mockResolvedValue({ status: 'success', data: ACTIVITY });
    patchAdminActivity.mockResolvedValue({
      status: 500,
      message: 'Something went wrong. Try again.',
    });
    renderEditPage('/activities/a1/edit');

    const nameInput = await screen.findByDisplayValue('Kalemegdan Park');
    await user.clear(nameInput);
    await user.type(nameInput, 'Renamed Park');
    await user.click(screen.getByRole('button', { name: /Save changes/ }));

    expect(
      await screen.findByText('Something went wrong. Try again.'),
    ).toBeInTheDocument();
    expect(nameInput).toHaveValue('Renamed Park');
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('create mode renders empty fields, Draft pre-selected, no created line', () => {
    renderEditPage('/activities/new');
    expect(screen.getByLabelText('Activity name')).toHaveValue('');
    expect(screen.getByRole('radio', { name: 'Draft' })).toBeChecked();
    expect(screen.queryByText('Created')).toBeNull();
    expect(screen.getByText('New activity')).toBeInTheDocument();
  });

  it('create mode Save calls createAdminActivity and navigates on success', async () => {
    const user = userEvent.setup();
    createAdminActivity.mockResolvedValue({
      status: 'success',
      data: ACTIVITY,
    });
    renderEditPage('/activities/new');

    await user.type(screen.getByLabelText('Activity name'), 'New Spot');
    await user.selectOptions(screen.getByLabelText('Category'), 'nature');
    await user.click(screen.getByRole('button', { name: /Save changes/ }));

    await waitFor(() => expect(createAdminActivity).toHaveBeenCalled());
    expect(createAdminActivity).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'New Spot', category: 'nature' }),
    );
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith('/activities'),
    );
  });

  it('Cancel navigates back to the list', async () => {
    const user = userEvent.setup();
    getAdminActivity.mockResolvedValue({ status: 'success', data: ACTIVITY });
    renderEditPage('/activities/a1/edit');
    await screen.findByDisplayValue('Kalemegdan Park');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(navigateSpy).toHaveBeenCalledWith('/activities');
  });
});
