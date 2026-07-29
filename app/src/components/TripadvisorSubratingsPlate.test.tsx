import { render, screen } from '@testing-library/react-native';
import { TripadvisorSubratingsPlate } from './TripadvisorSubratingsPlate';

describe('TripadvisorSubratingsPlate', () => {
  it('renders all 4 cells with numeric text (no rating-image, per compliance rule 02)', () => {
    render(
      <TripadvisorSubratingsPlate
        subratings={{ food: 4.5, service: 4.0, value: 3.5, atmosphere: 5.0 }}
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
    render(<TripadvisorSubratingsPlate subratings={{ food: 4.5, service: 4.0 }} />);
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
});
