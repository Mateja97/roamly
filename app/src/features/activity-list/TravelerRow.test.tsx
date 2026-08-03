import { fireEvent, render, screen } from '@testing-library/react-native';
import type { Activity } from '../../api/activities';
import { TravelerRow } from './TravelerRow';

const activity: Activity = {
  id: '1',
  title: 'Old Town Walking Tour',
  description: '',
  category: 'tours_experiences',
  location: { lat: 0, lng: 0 },
  country: 'Serbia',
  rating: 4.7,
  image_refs: [],
  tags: [],
  distance_km: 1.2,
};

describe('TravelerRow', () => {
  it('renders nothing for the "omit" state (not traveler mode)', () => {
    render(<TravelerRow state={{ status: 'omit' }} showDistance onPressActivity={jest.fn()} />);
    expect(screen.queryByText('Top experiences here')).toBeNull();
  });

  it('renders nothing when loaded with zero curated results', () => {
    render(<TravelerRow state={{ status: 'loaded', activities: [] }} showDistance onPressActivity={jest.fn()} />);
    expect(screen.queryByText('Top experiences here')).toBeNull();
  });

  it('renders skeleton cards while loading', () => {
    render(<TravelerRow state={{ status: 'loading' }} showDistance onPressActivity={jest.fn()} />);
    expect(screen.getByText('Top experiences here')).toBeTruthy();
  });

  it('renders a curated card and fires onPressActivity on tap', () => {
    const onPressActivity = jest.fn();
    render(<TravelerRow state={{ status: 'loaded', activities: [activity] }} showDistance onPressActivity={onPressActivity} />);
    expect(screen.getByText('Old Town Walking Tour')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: /old town walking tour/i }));
    expect(onPressActivity).toHaveBeenCalledWith(activity);
  });
});
