import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ActivityPhoto } from '../../api/activities';
import { HeroCarousel } from './HeroCarousel';

const photos: ActivityPhoto[] = [
  { uri: 'https://example.com/1.jpg', caption: 'Photo via Tripadvisor' },
  { uri: 'https://example.com/2.jpg', caption: 'Second photo' },
  { uri: 'https://example.com/3.jpg' },
];

describe('HeroCarousel', () => {
  it('calls onBack when the overlaid back control is pressed', () => {
    const onBack = jest.fn();
    render(<HeroCarousel photos={photos} onBack={onBack} onOpenViewer={jest.fn()} />);
    fireEvent.press(screen.getByLabelText('Back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('shows dots and the "Photos N" pill for 2+ photos, and the first photo caption', () => {
    render(<HeroCarousel photos={photos} onBack={jest.fn()} onOpenViewer={jest.fn()} />);
    expect(screen.getByLabelText('View 3 photos')).toBeTruthy();
    expect(screen.getByText('Photos 3')).toBeTruthy();
    expect(screen.getByText('Photo via Tripadvisor')).toBeTruthy();
  });

  it('updates the current photo and caption from a native swipe (onMomentumScrollEnd)', () => {
    render(<HeroCarousel photos={photos} onBack={jest.fn()} onOpenViewer={jest.fn()} />);
    fireEvent(screen.getByTestId('activity-detail-hero-pager'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: 320 } },
    });
    expect(screen.getByText('Second photo')).toBeTruthy();
  });

  it('reports the swiped-to page via onIndexChange', () => {
    const onIndexChange = jest.fn();
    render(
      <HeroCarousel
        photos={photos}
        onBack={jest.fn()}
        onOpenViewer={jest.fn()}
        onIndexChange={onIndexChange}
      />,
    );
    fireEvent(screen.getByTestId('activity-detail-hero-pager'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: 320 } },
    });
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });

  it("opens the viewer at the carousel's current (swiped-to) page, not always 0", () => {
    const onOpenViewer = jest.fn();
    render(<HeroCarousel photos={photos} onBack={jest.fn()} onOpenViewer={onOpenViewer} />);
    fireEvent(screen.getByTestId('activity-detail-hero-pager'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: 640 } },
    });
    fireEvent.press(screen.getByLabelText('View 3 photos'));
    expect(onOpenViewer).toHaveBeenCalledWith(2);
  });

  it('renders no dots and no "Photos N" pill for a single photo (no dead swipe UI)', () => {
    render(
      <HeroCarousel photos={[photos[0]]} onBack={jest.fn()} onOpenViewer={jest.fn()} />,
    );
    expect(screen.queryByLabelText(/view \d+ photos/i)).toBeNull();
    // Still shows the single photo's own caption and the always-present back control.
    expect(screen.getByText('Photo via Tripadvisor')).toBeTruthy();
    expect(screen.getByLabelText('Back')).toBeTruthy();
  });

  it('renders the ImageOff fallback with no dots/pill/caption for zero photos', () => {
    render(<HeroCarousel photos={[]} onBack={jest.fn()} onOpenViewer={jest.fn()} />);
    expect(screen.queryByLabelText(/view \d+ photos/i)).toBeNull();
    expect(screen.queryByTestId(/activity-detail-hero-image-/)).toBeNull();
    expect(screen.getByLabelText('Back')).toBeTruthy();
  });

  it('falls back to the missing-image state when the current photo fails to load', () => {
    render(<HeroCarousel photos={photos} onBack={jest.fn()} onOpenViewer={jest.fn()} />);
    fireEvent(screen.getByTestId('activity-detail-hero-image-0'), 'error', {
      nativeEvent: { error: 'load failed' },
    });
    expect(screen.queryByTestId('activity-detail-hero-image-0')).toBeNull();
  });
});
