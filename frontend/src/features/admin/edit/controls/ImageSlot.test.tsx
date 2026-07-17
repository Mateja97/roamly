import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageSlot } from './ImageSlot';

describe('ImageSlot', () => {
  it('empty (no src): shows ImageOff and the optional hint', () => {
    const { container } = render(
      <ImageSlot
        src={undefined}
        alt="Cover"
        className="admin-cover"
        emptyHint="No cover photo"
      />,
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByText('No cover photo')).toBeInTheDocument();
  });

  it('loading: renders a skeleton before the image fires load', () => {
    const { container } = render(
      <ImageSlot
        src="https://example.com/a.jpg"
        alt="Cover"
        className="admin-cover"
      />,
    );
    expect(
      container.querySelector('.admin-image-skeleton'),
    ).toBeInTheDocument();
  });

  it('loaded: image becomes visible and skeleton disappears on load', () => {
    const { container } = render(
      <ImageSlot
        src="https://example.com/a.jpg"
        alt="Cover"
        className="admin-cover"
      />,
    );
    const img = container.querySelector('img')!;
    fireEvent.load(img);
    expect(img).toHaveStyle({ display: 'block' });
    expect(
      container.querySelector('.admin-image-skeleton'),
    ).not.toBeInTheDocument();
  });

  it('broken: onError swaps to the ImageOff placeholder', () => {
    const { container } = render(
      <ImageSlot
        src="https://example.com/broken.jpg"
        alt="Cover"
        className="admin-cover"
      />,
    );
    const img = container.querySelector('img')!;
    fireEvent.error(img);
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
