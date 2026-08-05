import { render, screen } from '@testing-library/react-native';
import { DistanceSlider } from './DistanceSlider';

describe('DistanceSlider', () => {
  it('renders all seven stop labels, in order', () => {
    render(<DistanceSlider value={null} onChange={jest.fn()} />);
    const labels = ['5', '10', '25', '50', '100', '200', 'Any'];
    for (const label of labels) expect(screen.getByText(label)).toBeTruthy();
  });

  it('reads "Within 25 km" at stop index 2 (value 25)', () => {
    render(<DistanceSlider value={25} onChange={jest.fn()} />);
    expect(screen.getByText('Within 25 km')).toBeTruthy();
  });

  it('reads "Any distance" at the "Any" stop (value null)', () => {
    render(<DistanceSlider value={null} onChange={jest.fn()} />);
    expect(screen.getByText('Any distance')).toBeTruthy();
  });

  it('snaps an off-list value to its nearest stop for the readout', () => {
    render(<DistanceSlider value={300} onChange={jest.fn()} />);
    expect(screen.getByText('Within 200 km')).toBeTruthy();
  });

  it('exposes the accessibility value in kilometres, or "Any distance" for the open-ended stop', () => {
    render(<DistanceSlider value={25} onChange={jest.fn()} />);
    expect(screen.getByLabelText('Max distance').props.accessibilityValue.text).toBe('25 kilometres');

    render(<DistanceSlider value={null} onChange={jest.fn()} />);
    const sliders = screen.getAllByLabelText('Max distance');
    expect(sliders[sliders.length - 1].props.accessibilityValue.text).toBe('Any distance');
  });
});
