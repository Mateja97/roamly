import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PhotosSection } from './PhotosSection';

function renderSection(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('PhotosSection', () => {
  it('empty (no photos): shows the cover hint, no gallery grid', () => {
    renderSection(<PhotosSection title="Kalemegdan" photos={[]} />);
    expect(screen.getByText('No cover photo')).toBeInTheDocument();
    expect(screen.queryByAltText(/Photo 1 of/)).toBeNull();
  });

  it('cover = photos[0], gallery = the rest', () => {
    renderSection(
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

  it('renders no add tile (that lives on the Manage-photos page now)', () => {
    const { container } = renderSection(
      <PhotosSection
        title="Kalemegdan"
        photos={[{ url: 'https://x/1.jpg' }]}
      />,
    );
    expect(container.querySelector('[aria-label*="Add"]')).toBeNull();
  });

  it('renders no "Manage photos" link when there is no activityId (create mode)', () => {
    renderSection(<PhotosSection title="Kalemegdan" photos={[]} />);
    expect(
      screen.queryByRole('link', { name: /Manage photos/ }),
    ).toBeNull();
  });

  it('links "Manage photos" to /activities/:id/photos when activityId is set', () => {
    renderSection(
      <PhotosSection title="Kalemegdan" photos={[]} activityId="a1" />,
    );
    expect(screen.getByRole('link', { name: /Manage photos/ })).toHaveAttribute(
      'href',
      '/activities/a1/photos',
    );
  });
});
