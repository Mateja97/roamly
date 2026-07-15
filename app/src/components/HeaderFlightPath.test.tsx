import { render } from '@testing-library/react-native';
import Svg from 'react-native-svg';
import { HeaderFlightPath } from './HeaderFlightPath';

describe('HeaderFlightPath', () => {
  it('renders without crashing and stays hidden from accessibility tools', () => {
    const { toJSON, UNSAFE_root } = render(<HeaderFlightPath />);
    expect(toJSON()).toBeTruthy();
    expect(UNSAFE_root.findByType(Svg).props.accessibilityElementsHidden).toBe(true);
  });
});
