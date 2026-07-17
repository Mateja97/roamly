import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LocationSection } from './LocationSection';

describe('LocationSection', () => {
  it('renders address and city fields', () => {
    render(
      <LocationSection
        address="123 Main St"
        onAddressChange={vi.fn()}
        city="Belgrade"
        onCityChange={vi.fn()}
        location={undefined}
      />,
    );
    expect(screen.getByLabelText('Address')).toHaveValue('123 Main St');
    expect(screen.getByLabelText('City')).toHaveValue('Belgrade');
  });

  it('omits the map box entirely when there are no valid coordinates', () => {
    render(
      <LocationSection
        address=""
        onAddressChange={vi.fn()}
        city=""
        onCityChange={vi.fn()}
        location={undefined}
      />,
    );
    expect(
      screen.queryByAltText('Map showing the activity location'),
    ).toBeNull();
  });

  it('omits the map for the null-island (0,0) sentinel', () => {
    render(
      <LocationSection
        address=""
        onAddressChange={vi.fn()}
        city=""
        onCityChange={vi.fn()}
        location={{ lat: 0, lng: 0 }}
      />,
    );
    expect(
      screen.queryByAltText('Map showing the activity location'),
    ).toBeNull();
  });

  it('renders the map preview when a real location is present', () => {
    render(
      <LocationSection
        address=""
        onAddressChange={vi.fn()}
        city=""
        onCityChange={vi.fn()}
        location={{ lat: 44.8, lng: 20.4 }}
      />,
    );
    expect(
      screen.getByAltText('Map showing the activity location'),
    ).toBeInTheDocument();
  });
});
