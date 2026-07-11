import { render } from '@testing-library/react-native';
import App from './App';

describe('App', () => {
  it('renders', () => {
    const { root } = render(<App />);
    expect(root).toBeTruthy();
  });
});
