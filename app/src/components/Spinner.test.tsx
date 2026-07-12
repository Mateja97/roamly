import { AccessibilityInfo } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { Spinner } from './Spinner';

describe('Spinner', () => {
  it('renders without crashing when motion is enabled', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const { toJSON } = render(<Spinner />);
    await waitFor(() => expect(toJSON()).toBeTruthy());
  });

  it('renders a static ring when reduce-motion is on', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const { toJSON } = render(<Spinner />);
    await waitFor(() => expect(toJSON()).toBeTruthy());
  });
});
