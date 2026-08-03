import { render, screen } from '@testing-library/react-native';
import { UniqueSection } from './UniqueSection';
import type { UniqueSectionData } from './activityDetailConfig';

describe('UniqueSection', () => {
  it('renders nothing when data is undefined', () => {
    const { toJSON } = render(<UniqueSection data={undefined} />);
    expect(toJSON()).toBeNull();
  });

  it('shape B (pill list): renders each pill', () => {
    const data: UniqueSectionData = {
      shape: 'pills',
      heading: 'Signature pours',
      items: ['Old Fashioned', 'Negroni'],
    };
    render(<UniqueSection data={data} />);
    expect(screen.getByText('Old Fashioned')).toBeTruthy();
    expect(screen.getByText('Negroni')).toBeTruthy();
  });

  it('shape C (checklist): renders each item', () => {
    const data: UniqueSectionData = {
      shape: 'checklist',
      heading: 'Good to know',
      items: ['Bring water', 'Wear boots'],
    };
    render(<UniqueSection data={data} />);
    expect(screen.getByText('Bring water')).toBeTruthy();
    expect(screen.getByText('Wear boots')).toBeTruthy();
  });

  // design-import mockup's slot #8 "extended" note — the ✗ variant, Tours &
  // Experiences' only consumer (T10).
  it('shape C (checklist, ✗ variant): renders both the ✓ items and the ✗ crossItems', () => {
    const data: UniqueSectionData = {
      shape: 'checklist',
      heading: "What's included",
      items: ['Licensed local guide'],
      crossItems: ['Museum tickets'],
    };
    render(<UniqueSection data={data} />);
    expect(screen.getByText("What's included")).toBeTruthy();
    expect(screen.getByText('Licensed local guide')).toBeTruthy();
    expect(screen.getByText('Museum tickets')).toBeTruthy();
  });

  // Polarity lives only in icon glyph+color otherwise — assistive tech would
  // read a ✗ row as if it were included. Only the two-polarity checklist
  // (crossItems present) needs this; the plain single-polarity checklist's
  // heading already carries the polarity.
  it('shape C (checklist, ✗ variant): each row carries an accessible name that states its included/not-included state', () => {
    const data: UniqueSectionData = {
      shape: 'checklist',
      heading: "What's included",
      items: ['Licensed local guide'],
      crossItems: ['Museum tickets'],
    };
    render(<UniqueSection data={data} />);
    expect(screen.getByLabelText('Included: Licensed local guide')).toBeTruthy();
    expect(screen.getByLabelText('Not included: Museum tickets')).toBeTruthy();
  });

  it('shape C (plain checklist, no crossItems): rows carry no accessible-name override', () => {
    const data: UniqueSectionData = {
      shape: 'checklist',
      heading: 'Good to know',
      items: ['Bring water'],
    };
    render(<UniqueSection data={data} />);
    expect(screen.queryByLabelText('Included: Bring water')).toBeNull();
    expect(screen.getByText('Bring water')).toBeTruthy();
  });

  it('shape C (checklist, ✗ variant): renders the ✓ list alone when crossItems is empty', () => {
    const data: UniqueSectionData = {
      shape: 'checklist',
      heading: "What's included",
      items: ['Licensed local guide'],
      crossItems: [],
    };
    render(<UniqueSection data={data} />);
    expect(screen.getByText('Licensed local guide')).toBeTruthy();
  });

  it('shape C (checklist, ✗ variant): renders the ✗ list alone when items is empty', () => {
    const data: UniqueSectionData = {
      shape: 'checklist',
      heading: "What's included",
      items: [],
      crossItems: ['Museum tickets'],
    };
    render(<UniqueSection data={data} />);
    expect(screen.getByText('Museum tickets')).toBeTruthy();
  });

  it('shape C (checklist, ✗ variant): uses success-green ✓ / error-coral ✗ icons, distinct from the plain checklist\'s gold', () => {
    const paired: UniqueSectionData = {
      shape: 'checklist',
      heading: "What's included",
      items: ['Licensed local guide'],
      crossItems: ['Museum tickets'],
    };
    const { UNSAFE_getAllByType: getAllPaired } = render(<UniqueSection data={paired} />);
    const { Check, X } = jest.requireActual('lucide-react-native');
    const checkIcon = getAllPaired(Check)[0];
    const xIcon = getAllPaired(X)[0];
    expect(checkIcon.props.color).toBe('#A3D18E');
    expect(xIcon.props.color).toBe('#F5B79B');

    const plain: UniqueSectionData = {
      shape: 'checklist',
      heading: 'Good to know',
      items: ['Bring water'],
    };
    const { UNSAFE_getAllByType: getAllPlain } = render(<UniqueSection data={plain} />);
    expect(getAllPlain(Check)[0].props.color).toBe('#CE9042');
  });

  it('shape D (icon grid): renders each cell label', () => {
    const data: UniqueSectionData = {
      shape: 'icongrid',
      heading: 'Facilities',
      items: ['Parking', 'Restrooms'],
    };
    render(<UniqueSection data={data} />);
    expect(screen.getByText('Parking')).toBeTruthy();
    expect(screen.getByText('Restrooms')).toBeTruthy();
  });

  it('shape D (icon grid): maps each of the 4 mocked facilities to its own icon, unmapped labels fall back to the generic icon', () => {
    const data: UniqueSectionData = {
      shape: 'icongrid',
      heading: 'Facilities',
      items: [
        'Toilets',
        'Stroller-friendly',
        'Kiosk & café',
        'Shaded areas',
        'Something unmapped',
      ],
    };
    const { UNSAFE_getAllByType } = render(<UniqueSection data={data} />);
    const { Toilet, Baby, Coffee, Trees, CircleCheck } = jest.requireActual(
      'lucide-react-native',
    );
    expect(UNSAFE_getAllByType(Toilet)).toHaveLength(1);
    expect(UNSAFE_getAllByType(Baby)).toHaveLength(1);
    expect(UNSAFE_getAllByType(Coffee)).toHaveLength(1);
    expect(UNSAFE_getAllByType(Trees)).toHaveLength(1);
    expect(UNSAFE_getAllByType(CircleCheck)).toHaveLength(1);
  });

  it('shape E (accent banner): renders overline, title, and description', () => {
    const data: UniqueSectionData = {
      shape: 'banner',
      heading: 'Current exhibition',
      title: 'Modern Serbian Art',
      description: 'Through October',
    };
    render(<UniqueSection data={data} />);
    expect(screen.getByText('Current exhibition')).toBeTruthy();
    expect(screen.getByText('Modern Serbian Art')).toBeTruthy();
    expect(screen.getByText('Through October')).toBeTruthy();
  });

  it('shape E (accent banner): omits description when absent', () => {
    const data: UniqueSectionData = {
      shape: 'banner',
      heading: 'Now showing',
      title: 'Jazz Night',
    };
    render(<UniqueSection data={data} />);
    expect(screen.getByText('Jazz Night')).toBeTruthy();
  });

  it('shape F (schedule, compact density): renders leading/main/trailing per row', () => {
    const data: UniqueSectionData = {
      shape: 'schedule',
      heading: 'Tonight',
      density: 'compact',
      rows: [
        {
          leading: '23:00',
          main: 'DJ Nina',
          trailing: 'Main stage',
        },
      ],
    };
    render(<UniqueSection data={data} />);
    expect(screen.getByText('23:00')).toBeTruthy();
    expect(screen.getByText('DJ Nina')).toBeTruthy();
    expect(screen.getByText('Main stage')).toBeTruthy();
  });

  // Tours & Experiences' Itinerary (T10) — numbered-stop leading badge
  // instead of the plain time-sized text column every other compact
  // consumer (Nightlife/Wellness) uses.
  it('shape F (schedule, compact density, leadingStyle: number): renders the leading value inside a circular badge, not the plain text column', () => {
    const data: UniqueSectionData = {
      shape: 'schedule',
      heading: 'Itinerary',
      density: 'compact',
      rows: [{ leading: '1', main: 'Fortress', leadingStyle: 'number' }],
    };
    render(<UniqueSection data={data} />);
    const leadingText = screen.getByText('1');
    expect(screen.getByText('Fortress')).toBeTruthy();
    // Plain leading text is a width: 52 tabular-nums column (compactLeading);
    // a numbered row uses the badge's text style (compactLeadingBadgeText)
    // instead, and its immediate parent is the 22x22 circular badge.
    expect(leadingText.props.style).not.toMatchObject({ width: 52 });
    expect(leadingText.props.style).toMatchObject({ fontSize: 12, color: '#CE9042' });
    expect(leadingText.parent?.parent?.props.style).toMatchObject({
      width: 22,
      height: 22,
      borderRadius: 11,
    });
  });

  it('shape F (schedule, date-block density): renders day, date, and title (no subline slot)', () => {
    const data: UniqueSectionData = {
      shape: 'schedule',
      heading: 'Upcoming shows',
      density: 'dateblock',
      rows: [{ day: 'FRI', date: '20', title: 'Live at the Fort' }],
    };
    render(<UniqueSection data={data} />);
    expect(screen.getByText('FRI')).toBeTruthy();
    expect(screen.getByText('20')).toBeTruthy();
    expect(screen.getByText('Live at the Fort')).toBeTruthy();
  });

  // T9 round-3 fix: `activityDetailConfig.ts`'s `dateBlockRow` now omits
  // `date`/`day` (empty strings) when the raw date fails classification —
  // this pins the renderer's half: no date-block column, title still
  // renders.
  it('shape F (schedule, date-block density): omits the date block entirely when date is empty', () => {
    const data: UniqueSectionData = {
      shape: 'schedule',
      heading: 'Upcoming shows',
      density: 'dateblock',
      rows: [{ day: '', date: '', title: 'Live at the Fort' }],
    };
    render(<UniqueSection data={data} />);
    expect(screen.getByText('Live at the Fort')).toBeTruthy();
    expect(screen.queryByText('FRI')).toBeNull();
  });

  // T11 fix: a scalar-valid but unparseable raw date ("TBA") no longer gets
  // crushed into the 44px numeral column — it renders as an unstructured
  // label in the row body instead, and the date-block column itself omits
  // (day/date both empty).
  it('shape F (schedule, date-block density): renders dateLabel in the row body, not the numeral column, when date is empty', () => {
    const data: UniqueSectionData = {
      shape: 'schedule',
      heading: 'Upcoming shows',
      density: 'dateblock',
      rows: [{ day: '', date: '', dateLabel: 'TBA', title: 'Live at the Fort' }],
    };
    render(<UniqueSection data={data} />);
    expect(screen.getByText('TBA')).toBeTruthy();
    expect(screen.getByText('Live at the Fort')).toBeTruthy();
  });

  // T11 round 2: dateblock never checked `title` for absence — a show with
  // no title rendered a headless card.
  it('shape F (date-block density): drops a row whose title is absent entirely, keeps the rest', () => {
    const data: UniqueSectionData = {
      shape: 'schedule',
      heading: 'Upcoming shows',
      density: 'dateblock',
      rows: [
        { day: 'FRI', date: '20', title: 'Live at the Fort' },
        { day: 'SAT', date: '21', title: '' },
        { day: 'SUN', date: '22', title: '   ' },
      ],
    };
    render(<UniqueSection data={data} />);
    expect(screen.getByText('Live at the Fort')).toBeTruthy();
    expect(screen.queryByText('SAT')).toBeNull();
    expect(screen.queryByText('SUN')).toBeNull();
  });

  it('shape F (date-block density): omits the whole section, heading included, when every row lacks a title', () => {
    const data: UniqueSectionData = {
      shape: 'schedule',
      heading: 'Upcoming shows',
      density: 'dateblock',
      rows: [{ day: 'FRI', date: '20', title: '' }],
    };
    const { toJSON } = render(<UniqueSection data={data} />);
    expect(toJSON()).toBeNull();
    expect(screen.queryByText('Upcoming shows')).toBeNull();
  });

  // T2: no `subline` slot exists on DateBlockRow at all any more (the
  // retired shape conflated a scraped price with a scraped showtime) —
  // confirm no muted second line renders under the title even if a caller
  // somehow still had text to put there.
  it('shape F (date-block density): renders title-only, no muted subline under it', () => {
    const data: UniqueSectionData = {
      shape: 'schedule',
      heading: 'Upcoming shows',
      density: 'dateblock',
      rows: [{ day: 'FRI', date: '20', title: 'Live at the Fort' }],
    };
    const { toJSON } = render(<UniqueSection data={data} />);
    // Exactly one Text under the body (the title) — no second line.
    const json = JSON.stringify(toJSON());
    expect((json.match(/Live at the Fort/g) ?? []).length).toBe(1);
  });
});
