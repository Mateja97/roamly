import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ManagePhotosPage } from './ManagePhotosPage';
import type {
  AdminActivityDetail,
  AdminActivityPhoto,
} from '../../../api/adminActivities';

const {
  getAdminActivity,
  patchAdminActivity,
  uploadAdminActivityPhoto,
  navigateSpy,
} = vi.hoisted(() => ({
  getAdminActivity: vi.fn(),
  patchAdminActivity: vi.fn(),
  uploadAdminActivityPhoto: vi.fn(),
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
    uploadAdminActivityPhoto,
  };
});

vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>(
      'react-router-dom',
    );
  return { ...actual, useNavigate: () => navigateSpy };
});

function activityWith(photos: AdminActivityPhoto[]): AdminActivityDetail {
  return {
    id: 'a1',
    title: 'Kalemegdan Park',
    description: '',
    category: 'nature',
    city: 'Belgrade',
    address: '',
    status: 'draft',
    rating: 4.5,
    details: {},
    photos,
  };
}

function renderPage(id = 'a1') {
  return render(
    <MemoryRouter initialEntries={[`/activities/${id}/photos`]}>
      <Routes>
        <Route path="/activities/:id/photos" element={<ManagePhotosPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function tileSrcs() {
  return screen
    .getAllByAltText(/^Photo \d+$/)
    .map((img) => img.getAttribute('src'));
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom doesn't implement object URLs — the page only ever needs a
  // stable, distinguishable value back per call.
  let n = 0;
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => `blob:mock-${++n}`),
    revokeObjectURL: vi.fn(),
  });
});

describe('ManagePhotosPage', () => {
  it('loads and renders the populated grid with the live photo count', async () => {
    getAdminActivity.mockResolvedValue({
      status: 'success',
      data: activityWith([
        { url: 'https://x/1.jpg' },
        { url: 'https://x/2.jpg' },
      ]),
    });
    renderPage();
    expect(await screen.findByText('2 photos')).toBeInTheDocument();
    expect(tileSrcs()).toEqual(['https://x/1.jpg', 'https://x/2.jpg']);
    expect(screen.getByRole('button', { name: 'Add photo' })).toBeInTheDocument();
  });

  it('empty: only the dropzone renders, no grid or Add-photo tile', async () => {
    getAdminActivity.mockResolvedValue({
      status: 'success',
      data: activityWith([]),
    });
    renderPage();
    expect(await screen.findByText('0 photos')).toBeInTheDocument();
    expect(
      screen.getByText(
        'JPG or PNG, up to 8 MB each · first photo becomes the cover',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Add photo$/ })).toBeNull();
  });

  it('renders the 404 blocking panel', async () => {
    getAdminActivity.mockResolvedValue({ status: 404, message: 'not found' });
    renderPage('missing');
    expect(await screen.findByText('Activity not found')).toBeInTheDocument();
  });

  it('renders the 403 blocking panel', async () => {
    getAdminActivity.mockResolvedValue({ status: 403, message: 'forbidden' });
    renderPage();
    expect(
      await screen.findByText('Admin access rejected'),
    ).toBeInTheDocument();
  });

  it('load failure: shows the blocking panel with Retry, which re-fetches', async () => {
    const user = userEvent.setup();
    getAdminActivity.mockResolvedValueOnce({
      status: 500,
      message: 'Something went wrong. Try again.',
    });
    renderPage();
    expect(
      await screen.findByText("Couldn't load photos"),
    ).toBeInTheDocument();

    getAdminActivity.mockResolvedValueOnce({
      status: 'success',
      data: activityWith([{ url: 'https://x/1.jpg' }]),
    });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('1 photo')).toBeInTheDocument();
    expect(getAdminActivity).toHaveBeenCalledTimes(2);
  });

  it('reorder: keyboard pickup + arrow moves the tile, Enter drops', async () => {
    const user = userEvent.setup();
    getAdminActivity.mockResolvedValue({
      status: 'success',
      data: activityWith([
        { url: 'https://x/1.jpg' },
        { url: 'https://x/2.jpg' },
      ]),
    });
    renderPage();
    await screen.findByText('2 photos');
    expect(tileSrcs()).toEqual(['https://x/1.jpg', 'https://x/2.jpg']);

    const handle = screen.getByRole('button', { name: 'Reorder photo 1' });
    handle.focus();
    await user.keyboard(' ');
    await user.keyboard('{ArrowRight}');
    await user.keyboard('{Enter}');

    expect(tileSrcs()).toEqual(['https://x/2.jpg', 'https://x/1.jpg']);
  });

  it('reorder: Escape cancels and restores the original order', async () => {
    const user = userEvent.setup();
    getAdminActivity.mockResolvedValue({
      status: 'success',
      data: activityWith([
        { url: 'https://x/1.jpg' },
        { url: 'https://x/2.jpg' },
      ]),
    });
    renderPage();
    await screen.findByText('2 photos');

    const handle = screen.getByRole('button', { name: 'Reorder photo 1' });
    handle.focus();
    await user.keyboard(' ');
    await user.keyboard('{ArrowRight}');
    await user.keyboard('{Escape}');

    expect(tileSrcs()).toEqual(['https://x/1.jpg', 'https://x/2.jpg']);
  });

  it('set-cover: "Set as cover" moves that tile to index 0', async () => {
    const user = userEvent.setup();
    getAdminActivity.mockResolvedValue({
      status: 'success',
      data: activityWith([
        { url: 'https://x/1.jpg' },
        { url: 'https://x/2.jpg' },
      ]),
    });
    renderPage();
    await screen.findByText('2 photos');

    await user.click(screen.getByRole('button', { name: 'Set as cover' }));

    expect(tileSrcs()).toEqual(['https://x/2.jpg', 'https://x/1.jpg']);
    expect(screen.getAllByText('Cover')).toHaveLength(2); // pill + check
  });

  it('remove: the ✕ removes the tile from the staged array', async () => {
    const user = userEvent.setup();
    getAdminActivity.mockResolvedValue({
      status: 'success',
      data: activityWith([
        { url: 'https://x/1.jpg' },
        { url: 'https://x/2.jpg' },
      ]),
    });
    renderPage();
    await screen.findByText('2 photos');

    await user.click(screen.getByRole('button', { name: 'Remove photo 1' }));

    expect(await screen.findByText('1 photo')).toBeInTheDocument();
    expect(tileSrcs()).toEqual(['https://x/2.jpg']);
  });

  it('client pre-check rejects an oversize/non-image file without staging it', async () => {
    const user = userEvent.setup();
    getAdminActivity.mockResolvedValue({
      status: 'success',
      data: activityWith([]),
    });
    renderPage();
    await screen.findByText('0 photos');

    const tooBig = new File([new Uint8Array(9 * 1024 * 1024)], 'big.jpg', {
      type: 'image/jpeg',
    });
    await user.upload(screen.getByLabelText('Browse files'), tooBig);

    expect(await screen.findByText(/is over 8 MB/)).toBeInTheDocument();
    expect(screen.getByText('0 photos')).toBeInTheDocument();
  });

  it('cancel-writes-nothing: staging a file then Cancel writes zero bytes and revokes the preview', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    getAdminActivity.mockResolvedValue({
      status: 'success',
      data: activityWith([]),
    });
    renderPage();
    await screen.findByText('0 photos');

    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText('Browse files'), file);
    expect(await screen.findByText('1 photo')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(window.confirm).toHaveBeenCalledWith('Discard unsaved photos?');
    expect(uploadAdminActivityPhoto).not.toHaveBeenCalled();
    expect(patchAdminActivity).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-1');
    expect(navigateSpy).toHaveBeenCalledWith('/activities/a1/edit');
  });

  it('Cancel with no staged edits navigates without confirming', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm');
    getAdminActivity.mockResolvedValue({
      status: 'success',
      data: activityWith([{ url: 'https://x/1.jpg' }]),
    });
    renderPage();
    await screen.findByText('1 photo');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith('/activities/a1/edit');
  });

  it('save posts-then-patches-once: uploads each pending file once, then a single PATCH with the full ordered photos[]', async () => {
    const user = userEvent.setup();
    getAdminActivity.mockResolvedValue({
      status: 'success',
      data: activityWith([{ url: 'https://x/1.jpg', caption: 'Existing' }]),
    });
    uploadAdminActivityPhoto.mockResolvedValue({
      status: 'success',
      data: { url: 'https://x/new.jpg', thumb_url: 'https://x/new_t.jpg' },
    });
    patchAdminActivity.mockResolvedValue({
      status: 'success',
      data: activityWith([]),
    });
    renderPage();
    await screen.findByText('1 photo');

    const file = new File(['x'], 'new.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText('Browse files'), file);
    await screen.findByText('2 photos');

    await user.click(screen.getByRole('button', { name: /Save gallery/ }));

    await waitFor(() => expect(patchAdminActivity).toHaveBeenCalled());
    expect(uploadAdminActivityPhoto).toHaveBeenCalledTimes(1);
    expect(uploadAdminActivityPhoto).toHaveBeenCalledWith('a1', file);
    expect(patchAdminActivity).toHaveBeenCalledTimes(1);
    expect(patchAdminActivity).toHaveBeenCalledWith('a1', {
      photos: [
        { url: 'https://x/1.jpg', thumb_url: undefined, caption: 'Existing' },
        {
          url: 'https://x/new.jpg',
          thumb_url: 'https://x/new_t.jpg',
          caption: undefined,
        },
      ],
    });
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith('/activities/a1/edit'),
    );
  });

  it('upload failure keeps the staged gallery editable and shows the error banner', async () => {
    const user = userEvent.setup();
    getAdminActivity.mockResolvedValue({
      status: 'success',
      data: activityWith([]),
    });
    uploadAdminActivityPhoto.mockResolvedValue({
      status: 500,
      message: 'Something went wrong. Try again.',
    });
    renderPage();
    await screen.findByText('0 photos');

    const file = new File(['x'], 'new.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText('Browse files'), file);
    await user.click(screen.getByRole('button', { name: /Save gallery/ }));

    // Both the page banner and the per-tile error row name the failure.
    expect(
      await screen.findAllByText('Something went wrong. Try again.'),
    ).toHaveLength(2);
    expect(patchAdminActivity).not.toHaveBeenCalled();
    // The staged tile is still there — never dropped.
    expect(screen.getByText('1 photo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
