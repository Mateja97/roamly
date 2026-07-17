import { fireEvent, render, screen } from '@testing-library/react-native';
import { Share } from 'react-native';
import type { ActivityPhoto } from '../../api/activities';
import { PhotoViewerModal } from './PhotoViewerModal';

const photos: ActivityPhoto[] = [
  {
    uri: 'https://example.com/1.jpg',
    thumb_url: 'https://example.com/1_t.jpg',
    caption: 'Sunset over the river',
    attribution: { author: 'Jane Doe', link: 'https://maps.google.com/1' },
  },
  {
    uri: 'https://example.com/2.jpg',
    thumb_url: 'https://example.com/2_t.jpg',
  },
  {
    uri: 'https://example.com/3.jpg',
    thumb_url: 'https://example.com/3_t.jpg',
    caption: 'Only a caption, no attribution',
  },
];

describe('PhotoViewerModal', () => {
  it('renders nothing for fewer than 2 photos (defensive — the hero pill never opens it in this case)', () => {
    render(
      <PhotoViewerModal
        photos={[photos[0]]}
        activityTitle="Skadarlija Food Walk"
        onClose={jest.fn()}
      />,
    );
    expect(screen.queryByLabelText('Close photos')).toBeNull();
  });

  it('shows the 1 / M counter, hides the prev chevron, and shows both caption and attribution on the first photo', () => {
    render(
      <PhotoViewerModal
        photos={photos}
        activityTitle="Skadarlija Food Walk"
        onClose={jest.fn()}
      />,
    );
    expect(screen.getByText('1 / 3')).toBeTruthy();
    expect(screen.queryByLabelText('Previous photo')).toBeNull();
    expect(screen.getByLabelText('Next photo')).toBeTruthy();
    expect(screen.getByText('Sunset over the river')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Photo by Jane Doe' })).toBeTruthy();
  });

  it('calls onClose when the close control is pressed', () => {
    const onClose = jest.fn();
    render(
      <PhotoViewerModal
        photos={photos}
        activityTitle="Skadarlija Food Walk"
        onClose={onClose}
      />,
    );
    fireEvent.press(screen.getByLabelText('Close photos'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('jumps to the tapped thumbnail, updating the counter, dots, and chevrons', () => {
    render(
      <PhotoViewerModal
        photos={photos}
        activityTitle="Skadarlija Food Walk"
        onClose={jest.fn()}
      />,
    );
    fireEvent.press(screen.getByLabelText('Photo 3'));
    expect(screen.getByText('3 / 3')).toBeTruthy();
    // last photo: next chevron hidden, prev chevron shown
    expect(screen.queryByLabelText('Next photo')).toBeNull();
    expect(screen.getByLabelText('Previous photo')).toBeTruthy();
    // caption-only (no attribution) on photo 3
    expect(screen.getByText('Only a caption, no attribution')).toBeTruthy();
    expect(screen.queryByText(/photo by/i)).toBeNull();
  });

  it('moves one photo at a time via the chevrons, showing attribution-only (no caption) on photo 2', () => {
    render(
      <PhotoViewerModal
        photos={photos}
        activityTitle="Skadarlija Food Walk"
        onClose={jest.fn()}
      />,
    );
    fireEvent.press(screen.getByLabelText('Next photo'));
    expect(screen.getByText('2 / 3')).toBeTruthy();
    expect(screen.queryByText(/sunset|caption/i)).toBeNull();
  });

  it('updates the index from a native swipe (onMomentumScrollEnd)', () => {
    render(
      <PhotoViewerModal
        photos={photos}
        activityTitle="Skadarlija Food Walk"
        onClose={jest.fn()}
      />,
    );
    fireEvent(screen.getByTestId('photo-viewer-pager'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: 320 } },
    });
    expect(screen.getByText('2 / 3')).toBeTruthy();
  });

  it('falls back to the missing-image state when the current photo fails to load', () => {
    render(
      <PhotoViewerModal
        photos={photos}
        activityTitle="Skadarlija Food Walk"
        onClose={jest.fn()}
      />,
    );
    fireEvent(screen.getByTestId('photo-viewer-page-image-0'), 'error', {
      nativeEvent: { error: 'load failed' },
    });
    expect(screen.queryByTestId('photo-viewer-page-image-0')).toBeNull();
  });

  it('falls back to the broken-thumbnail block when a thumb_url fails to load', () => {
    render(
      <PhotoViewerModal
        photos={photos}
        activityTitle="Skadarlija Food Walk"
        onClose={jest.fn()}
      />,
    );
    fireEvent(screen.getByTestId('photo-viewer-thumb-image-2'), 'error', {
      nativeEvent: { error: 'load failed' },
    });
    expect(screen.queryByTestId('photo-viewer-thumb-image-2')).toBeNull();
    // the thumbnail button itself is still there, just showing the fallback
    expect(screen.getByLabelText('Photo 2')).toBeTruthy();
  });

  it('shares the current photo via the OS share sheet', async () => {
    const shareSpy = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: Share.sharedAction });
    render(
      <PhotoViewerModal
        photos={photos}
        activityTitle="Skadarlija Food Walk"
        onClose={jest.fn()}
      />,
    );
    fireEvent.press(screen.getByLabelText('Share this photo'));
    await screen.findByLabelText('Share this photo');
    expect(shareSpy).toHaveBeenCalledWith(
      expect.objectContaining({ url: photos[0].uri }),
    );
    shareSpy.mockRestore();
  });

  it('surfaces a dismissible error banner when the share handoff fails, without dropping the viewer', async () => {
    const shareSpy = jest
      .spyOn(Share, 'share')
      .mockRejectedValue(new Error('no share sheet'));
    render(
      <PhotoViewerModal
        photos={photos}
        activityTitle="Skadarlija Food Walk"
        onClose={jest.fn()}
      />,
    );
    fireEvent.press(screen.getByLabelText('Share this photo'));
    expect(
      await screen.findByText('Could not open the share sheet. Please try again.'),
    ).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Dismiss' }));
    expect(
      screen.queryByText('Could not open the share sheet. Please try again.'),
    ).toBeNull();
    // viewer is still up, not torn down by the failure
    expect(screen.getByText('1 / 3')).toBeTruthy();
    shareSpy.mockRestore();
  });

  it('renders an empty caption band (no crash) for a photo with neither caption nor attribution', () => {
    const bare: ActivityPhoto[] = [{ uri: 'a' }, { uri: 'b' }];
    render(
      <PhotoViewerModal
        photos={bare}
        activityTitle="Bare"
        onClose={jest.fn()}
      />,
    );
    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect(screen.queryByText(/photo by/i)).toBeNull();
  });
});
