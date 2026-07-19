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

  it('switching category clears details (avoids mixing old/new category keys, which the backend 400s on)', async () => {
    const user = userEvent.setup();
    getAdminActivity.mockResolvedValue({ status: 'success', data: ACTIVITY });
    patchAdminActivity.mockResolvedValue({ status: 'success', data: ACTIVITY });
    renderEditPage('/activities/a1/edit');

    await screen.findByDisplayValue('Kalemegdan Park');
    expect(screen.getByDisplayValue('2 hours')).toBeInTheDocument(); // nature.time_to_spend
    await user.selectOptions(screen.getByLabelText('Category'), 'sport');
    expect(screen.queryByDisplayValue('2 hours')).toBeNull();

    await user.click(screen.getByRole('button', { name: /Save changes/ }));
    await waitFor(() => expect(patchAdminActivity).toHaveBeenCalled());
    expect(patchAdminActivity).toHaveBeenCalledWith('a1', {
      category: 'sport',
      details: {},
    });
  });

  it('switching category resets subcategory to empty ("—")', async () => {
    const user = userEvent.setup();
    getAdminActivity.mockResolvedValue({
      status: 'success',
      data: { ...ACTIVITY, subcategory: 'hiking_trail' },
    });
    patchAdminActivity.mockResolvedValue({ status: 'success', data: ACTIVITY });
    renderEditPage('/activities/a1/edit');

    await screen.findByDisplayValue('Kalemegdan Park');
    expect(screen.getByLabelText('Subcategory')).toHaveValue('hiking_trail');
    await user.selectOptions(screen.getByLabelText('Category'), 'sport');
    expect(screen.getByLabelText('Subcategory')).toHaveValue('');

    await user.click(screen.getByRole('button', { name: /Save changes/ }));
    await waitFor(() => expect(patchAdminActivity).toHaveBeenCalled());
    expect(patchAdminActivity).toHaveBeenCalledWith('a1', {
      category: 'sport',
      subcategory: '',
      details: {},
    });
  });

  it('a subcategory pick is included in the PATCH payload', async () => {
    const user = userEvent.setup();
    getAdminActivity.mockResolvedValue({ status: 'success', data: ACTIVITY });
    patchAdminActivity.mockResolvedValue({ status: 'success', data: ACTIVITY });
    renderEditPage('/activities/a1/edit');

    await screen.findByDisplayValue('Kalemegdan Park');
    await user.selectOptions(screen.getByLabelText('Subcategory'), 'hiking_trail');
    await user.click(screen.getByRole('button', { name: /Save changes/ }));

    await waitFor(() => expect(patchAdminActivity).toHaveBeenCalled());
    expect(patchAdminActivity).toHaveBeenCalledWith('a1', {
      subcategory: 'hiking_trail',
    });
  });

  it('create mode Save includes the chosen subcategory in the payload', async () => {
    const user = userEvent.setup();
    createAdminActivity.mockResolvedValue({
      status: 'success',
      data: ACTIVITY,
    });
    renderEditPage('/activities/new');

    await user.type(screen.getByLabelText('Activity name'), 'New Spot');
    await user.selectOptions(screen.getByLabelText('Category'), 'nature');
    await user.selectOptions(screen.getByLabelText('Subcategory'), 'hiking_trail');
    await user.click(screen.getByRole('button', { name: /Save changes/ }));

    await waitFor(() => expect(createAdminActivity).toHaveBeenCalled());
    expect(createAdminActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'New Spot',
        category: 'nature',
        subcategory: 'hiking_trail',
      }),
    );
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

  describe('opening hours (T2)', () => {
    const RESTAURANT: AdminActivityDetail = {
      ...ACTIVITY,
      category: 'restaurants',
      details: {
        cuisine: 'Serbian',
        opening_hours: {
          timezone: 'Europe/Belgrade',
          always_open: false,
          periods: [{ day: 'monday', open: '09:00', close: '22:00' }],
        },
      },
    };

    it('renders a saved opening_hours object and round-trips it on Save', async () => {
      const user = userEvent.setup();
      getAdminActivity.mockResolvedValue({
        status: 'success',
        data: RESTAURANT,
      });
      patchAdminActivity.mockResolvedValue({
        status: 'success',
        data: RESTAURANT,
      });
      renderEditPage('/activities/a1/edit');

      await screen.findByDisplayValue('Kalemegdan Park');
      expect(screen.getByLabelText('Timezone')).toHaveValue('Europe/Belgrade');
      expect(screen.getByLabelText('Day')).toHaveValue('monday');
      expect(screen.getByLabelText('Opens')).toHaveValue('09:00');
      expect(screen.getByLabelText('Closes')).toHaveValue('22:00');

      // Change something so the PATCH actually carries `details` (the page
      // only sends fields that changed vs. the loaded snapshot).
      const closes = screen.getByLabelText('Closes');
      await user.clear(closes);
      await user.type(closes, '23:00');

      await user.click(screen.getByRole('button', { name: /Save changes/ }));
      await waitFor(() => expect(patchAdminActivity).toHaveBeenCalled());
      expect(patchAdminActivity).toHaveBeenCalledWith(
        'a1',
        expect.objectContaining({
          details: expect.objectContaining({
            opening_hours: {
              timezone: 'Europe/Belgrade',
              always_open: false,
              periods: [{ day: 'monday', open: '09:00', close: '23:00' }],
            },
          }),
        }),
      );
    });

    it('blocks Save on a missing timezone and shows the field error, no PATCH sent', async () => {
      const user = userEvent.setup();
      const noTimezone: AdminActivityDetail = {
        ...RESTAURANT,
        details: {
          ...RESTAURANT.details,
          opening_hours: {
            timezone: '',
            always_open: false,
            periods: [{ day: 'monday', open: '09:00', close: '22:00' }],
          },
        },
      };
      getAdminActivity.mockResolvedValue({
        status: 'success',
        data: noTimezone,
      });
      renderEditPage('/activities/a1/edit');

      await screen.findByDisplayValue('Kalemegdan Park');
      await user.click(screen.getByRole('button', { name: /Save changes/ }));

      expect(
        await screen.findByText("Add the venue's timezone"),
      ).toBeInTheDocument();
      expect(patchAdminActivity).not.toHaveBeenCalled();
    });

    it('a backend opening_hours rejection surfaces in the error banner', async () => {
      const user = userEvent.setup();
      getAdminActivity.mockResolvedValue({
        status: 'success',
        data: RESTAURANT,
      });
      patchAdminActivity.mockResolvedValue({
        status: 400,
        message: 'opening_hours.timezone "Bogus/Zone" is not a valid IANA zone',
      });
      renderEditPage('/activities/a1/edit');

      await screen.findByDisplayValue('Kalemegdan Park');
      await user.click(screen.getByRole('button', { name: /Save changes/ }));

      expect(
        await screen.findByText(
          'opening_hours.timezone "Bogus/Zone" is not a valid IANA zone',
        ),
      ).toBeInTheDocument();
      expect(navigateSpy).not.toHaveBeenCalled();
    });

    it('switching to an out-of-scope category clears opening_hours along with the rest of details', async () => {
      const user = userEvent.setup();
      getAdminActivity.mockResolvedValue({
        status: 'success',
        data: RESTAURANT,
      });
      renderEditPage('/activities/a1/edit');

      await screen.findByDisplayValue('Kalemegdan Park');
      expect(screen.getByText('Opening hours')).toBeInTheDocument();
      await user.selectOptions(screen.getByLabelText('Category'), 'nature');
      expect(screen.queryByText('Opening hours')).toBeNull();
    });
  });
});
