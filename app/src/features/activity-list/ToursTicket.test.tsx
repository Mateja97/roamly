import { Linking } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ToursTicket } from './ToursTicket';

describe('ToursTicket', () => {
  const original = process.env.EXPO_PUBLIC_GYG_PARTNER_ID;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_GYG_PARTNER_ID = 'ABC123';
  });
  afterEach(() => {
    jest.restoreAllMocks();
    process.env.EXPO_PUBLIC_GYG_PARTNER_ID = original;
    if (original === undefined) delete process.env.EXPO_PUBLIC_GYG_PARTNER_ID;
  });

  it('names the city and opens the tracked link', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    render(<ToursTicket city="Belgrade" />);

    expect(screen.getByText('Book a guided tour in Belgrade')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: /Book a guided tour in Belgrade/ }));

    await waitFor(() =>
      expect(openURL).toHaveBeenCalledWith('https://www.getyourguide.com/s/?q=Belgrade&partner_id=ABC123')
    );
  });

  it('drops the city from the copy when none is known', () => {
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    render(<ToursTicket city={null} />);
    expect(screen.getByText('Book a guided tour')).toBeTruthy();
  });

  it('attributes the partner', () => {
    render(<ToursTicket city="Belgrade" />);
    expect(screen.getByText('Tours and booking by GetYourGuide.')).toBeTruthy();
  });

  // Partner TCs 3.2.2 plus consumer law — an affiliate link has to say so.
  // Not a copy nit: dropping this line is a compliance regression.
  it('discloses the commission', () => {
    render(<ToursTicket city="Belgrade" />);
    expect(screen.getByText('We may earn a commission from bookings.')).toBeTruthy();
  });

  // Visible on the stub, but deliberately outside the a11y tree — the card's
  // own accessible name already carries the meaning, so the badge would only
  // be repetition for a screen reader.
  it('labels the category on the stub without repeating it to screen readers', () => {
    render(<ToursTicket city="Belgrade" />);
    expect(screen.getByText('Guided tours', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText('Guided tours')).toBeNull();
  });

  it('warns in place instead of failing silently when no browser opens', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
    render(<ToursTicket city="Belgrade" />);

    fireEvent.press(screen.getByRole('button', { name: /Book a guided tour in Belgrade/ }));

    expect(await screen.findByText(/Couldn't open your browser/)).toBeTruthy();
  });

  it('tells screen readers the link leaves the app', () => {
    render(<ToursTicket city="Belgrade" />);
    expect(screen.getByLabelText('Book a guided tour in Belgrade. Opens GetYourGuide in your browser.')).toBeTruthy();
  });
});
