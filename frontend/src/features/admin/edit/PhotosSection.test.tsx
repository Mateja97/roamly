import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PhotosSection } from './PhotosSection';

describe('PhotosSection', () => {
  it('empty (no photos): shows the cover hint, no gallery grid', () => {
    render(<PhotosSection title="Kalemegdan" photos={[]} />);
    expect(screen.getByText('No cover photo')).toBeInTheDocument();
    expect(screen.queryByAltText(/Photo 1 of/)).toBeNull();
  });

  it('cover = photos[0], gallery = the rest', () => {
    render(
      <PhotosSection
        title="Kalemegdan"
        photos={[
          { url: 'https://x/1.jpg' },
          { url: 'https://x/2.jpg' },
          { url: 'https://x/3.jpg' },
        ]}
      />,
    );
    expect(screen.getByAltText('Kalemegdan')).toBeInTheDocument();
    expect(screen.getByAltText('Photo 1 of Kalemegdan')).toBeInTheDocument();
    expect(screen.getByAltText('Photo 2 of Kalemegdan')).toBeInTheDocument();
  });

  it('renders no upload/add tile', () => {
    const { container } = render(
      <PhotosSection
        title="Kalemegdan"
        photos={[{ url: 'https://x/1.jpg' }]}
      />,
    );
    expect(container.querySelector('[aria-label*="Add"]')).toBeNull();
  });
});
