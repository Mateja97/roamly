import { fireEvent, render, screen } from '@testing-library/react-native';
import { TripadvisorSubratingsPlate } from './TripadvisorSubratingsPlate';

describe('TripadvisorSubratingsPlate', () => {
  it('renders all 4 cells with numeric text when no cell carries an icon_url', () => {
    render(
      <TripadvisorSubratingsPlate
        subratings={{
          food: { rating: 4.5 },
          service: { rating: 4.0 },
          value: { rating: 3.5 },
          atmosphere: { rating: 5.0 },
        }}
      />,
    );
    expect(screen.getByText('Food')).toBeTruthy();
    expect(screen.getByText('4.5')).toBeTruthy();
    expect(screen.getByText('Service')).toBeTruthy();
    expect(screen.getByText('4.0')).toBeTruthy();
    expect(screen.getByText('Value')).toBeTruthy();
    expect(screen.getByText('3.5')).toBeTruthy();
    expect(screen.getByText('Atmosphere')).toBeTruthy();
    expect(screen.getByText('5.0')).toBeTruthy();
  });

  it('renders only the cells that are present, dropping missing categories', () => {
    render(
      <TripadvisorSubratingsPlate
        subratings={{ food: { rating: 4.5 }, service: { rating: 4.0 } }}
      />,
    );
    expect(screen.getByText('Food')).toBeTruthy();
    expect(screen.getByText('Service')).toBeTruthy();
    expect(screen.queryByText('Value')).toBeNull();
    expect(screen.queryByText('Atmosphere')).toBeNull();
  });

  it('renders nothing when subratings is undefined (whole place has none — no empty grid)', () => {
    const { toJSON } = render(<TripadvisorSubratingsPlate subratings={undefined} />);
    expect(toJSON()).toBeNull();
  });

  it('renders nothing for an empty subratings object', () => {
    const { toJSON } = render(<TripadvisorSubratingsPlate subratings={{}} />);
    expect(toJSON()).toBeNull();
  });

  it('renders the API-hosted bubble image (compliance rule 02) when icon_url is present, no numeric fallback', () => {
    render(
      <TripadvisorSubratingsPlate
        subratings={{ food: { rating: 4.5, icon_url: 'https://tripadvisor.example/food-bubble.png' } }}
      />,
    );
    expect(screen.getByText('Food')).toBeTruthy();
    expect(screen.getByTestId('subrating-bubble-food')).toBeTruthy();
    expect(screen.queryByText('4.5')).toBeNull();
  });

  it('mixes image and numeric-fallback cells independently per aspect', () => {
    render(
      <TripadvisorSubratingsPlate
        subratings={{
          food: { rating: 4.5, icon_url: 'https://tripadvisor.example/food-bubble.png' },
          service: { rating: 4.0 },
        }}
      />,
    );
    expect(screen.getByTestId('subrating-bubble-food')).toBeTruthy();
    expect(screen.queryByText('4.5')).toBeNull();
    expect(screen.getByText('4.0')).toBeTruthy();
    expect(screen.queryByTestId('subrating-bubble-service')).toBeNull();
  });

  it('carries the aspect name + rating in the cell accessibility label so a11y never loses it behind the decorative image', () => {
    render(
      <TripadvisorSubratingsPlate
        subratings={{ food: { rating: 4.5, icon_url: 'https://tripadvisor.example/food-bubble.png' } }}
      />,
    );
    expect(screen.getByLabelText('Food rated 4.5')).toBeTruthy();
  });

  it('keeps the count in place when the bubble image fails to load (no bespoke fallback UI)', () => {
    render(
      <TripadvisorSubratingsPlate
        subratings={{ food: { rating: 4.5, icon_url: 'https://tripadvisor.example/food-bubble.png' } }}
      />,
    );
    const image = screen.getByTestId('subrating-bubble-food');
    fireEvent(image, 'error', { nativeEvent: { error: 'load failed' } });
    expect(screen.getByText('Food')).toBeTruthy();
  });
});
