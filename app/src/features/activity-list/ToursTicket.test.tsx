import { AccessibilityInfo, Linking } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ToursTicket } from './ToursTicket';

describe('ToursTicket', () => {
  const original = process.env.EXPO_PUBLIC_GYG_PARTNER_ID;

  beforeEach(() => {
    // jest-expo's Linking.openURL is itself a jest.fn(); restoreAllMocks puts
    // it back but keeps its accumulated call counts, so a later test sees the
    // previous one's presses. Clear before each rather than trusting restore.
    jest.clearAllMocks();
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
    fireEvent.press(screen.getByRole('link', { name: /Book a guided tour in Belgrade/ }));

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

    fireEvent.press(screen.getByRole('link', { name: /Book a guided tour in Belgrade/ }));

    expect(await screen.findByText(/Couldn't open your browser/)).toBeTruthy();
    // Pressable collapses its subtree into one node, so a screen reader can
    // only ever hear the card's own name — the failure has to live there or
    // it is silent for VoiceOver/TalkBack users.
    expect(
      await screen.findByLabelText("Book a guided tour in Belgrade. Couldn't open your browser. Try again.")
    ).toBeTruthy();
  });

  // APP_STANDARDS: a control is disabled for the duration of its own async
  // action. Without the guard, three taps opened three browser tabs.
  it('opens once however many times it is tapped during the handoff', async () => {
    let release!: () => void;
    const openURL = jest
      .spyOn(Linking, 'openURL')
      .mockReturnValue(new Promise<never>((_, reject) => (release = () => reject(new Error('x')))));
    render(<ToursTicket city="Belgrade" />);

    const card = screen.getByRole('link', { name: /Book a guided tour in Belgrade/ });
    fireEvent.press(card);
    fireEvent.press(card);
    fireEvent.press(card);

    expect(openURL).toHaveBeenCalledTimes(1);
    await act(async () => release());
  });

  it('renders nothing at all when no partner id is configured', () => {
    delete process.env.EXPO_PUBLIC_GYG_PARTNER_ID;
    render(<ToursTicket city="Belgrade" />);
    // Not merely inert — absent. A rendered control that silently no-ops is
    // worse than no control.
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText(/Book a guided tour/)).toBeNull();
  });

  it('announces the failure, since a changed label is not re-read', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
    render(<ToursTicket city="Belgrade" />);

    fireEvent.press(screen.getByRole('link', { name: /Book a guided tour in Belgrade/ }));

    await waitFor(() => expect(announce).toHaveBeenCalledWith("Couldn't open your browser. Try again."));
  });

  it('tells screen readers the link leaves the app', () => {
    render(<ToursTicket city="Belgrade" />);
    expect(screen.getByLabelText('Book a guided tour in Belgrade. Opens GetYourGuide in your browser.')).toBeTruthy();
  });
});
