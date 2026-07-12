import { render } from '@testing-library/react-native';
import { Spinner } from './Spinner';

describe('Spinner', () => {
  it('renders without crashing', () => {
    const { toJSON } = render(<Spinner />);
    expect(toJSON()).toBeTruthy();
  });
});
