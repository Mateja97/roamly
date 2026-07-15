import { render, screen } from '@testing-library/react-native';
import { UniqueSection } from './UniqueSection';
import type { UniqueSectionData } from './activityDetailConfig';

describe('UniqueSection', () => {
  it('renders nothing when data is undefined', () => {
    const { toJSON } = render(<UniqueSection data={undefined} />);
    expect(toJSON()).toBeNull();
  });

  it('shape A (name+price list): renders each row name and price', () => {
    const data: UniqueSectionData = {
      shape: 'nameprice',
      heading: 'Popular dishes',
      items: [{ name: 'Ćevapi', price: '€8' }],
    };
    render(<UniqueSection data={data} />);
    expect(screen.getByText('Popular dishes')).toBeTruthy();
    expect(screen.getByText('Ćevapi')).toBeTruthy();
    expect(screen.getByText('€8')).toBeTruthy();
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

  it('shape E (accent banner): renders overline, title, description, and attribution', () => {
    const data: UniqueSectionData = {
      shape: 'banner',
      heading: 'Current exhibition',
      title: 'Modern Serbian Art',
      description: 'Through October',
      attribution: 'Nadežda Petrović · Untitled, 1910 · oil on canvas',
    };
    render(<UniqueSection data={data} />);
    expect(screen.getByText('Current exhibition')).toBeTruthy();
    expect(screen.getByText('Modern Serbian Art')).toBeTruthy();
    expect(screen.getByText('Through October')).toBeTruthy();
    expect(
      screen.getByText('Nadežda Petrović · Untitled, 1910 · oil on canvas'),
    ).toBeTruthy();
  });

  it('shape E (accent banner): omits description/attribution when absent', () => {
    const data: UniqueSectionData = {
      shape: 'banner',
      heading: 'Now showing',
      title: 'Jazz Night',
    };
    render(<UniqueSection data={data} />);
    expect(screen.getByText('Jazz Night')).toBeTruthy();
  });

  it('shape F (schedule, compact density): renders leading/main/trailing per row and the note', () => {
    const data: UniqueSectionData = {
      shape: 'schedule',
      heading: 'Tonight',
      density: 'compact',
      rows: [
        {
          leading: '23:00',
          main: 'DJ Nina',
          trailing: 'Main stage',
          trailingStyle: 'muted',
        },
      ],
      note: undefined,
    };
    render(<UniqueSection data={data} />);
    expect(screen.getByText('23:00')).toBeTruthy();
    expect(screen.getByText('DJ Nina')).toBeTruthy();
    expect(screen.getByText('Main stage')).toBeTruthy();
  });

  it('shape F (schedule, compact density): renders the external-booking note when present', () => {
    const data: UniqueSectionData = {
      shape: 'schedule',
      heading: 'Treatments',
      density: 'compact',
      rows: [
        {
          leading: '60 min',
          main: 'Deep tissue massage',
          trailing: '€45',
          trailingStyle: 'price',
        },
      ],
      note: "Booking is handled on the venue's own site",
    };
    render(<UniqueSection data={data} />);
    expect(screen.getByText('€45')).toBeTruthy();
    expect(
      screen.getByText("Booking is handled on the venue's own site"),
    ).toBeTruthy();
  });

  it('shape F (schedule, date-block density): renders day, date, title, and subline', () => {
    const data: UniqueSectionData = {
      shape: 'schedule',
      heading: 'Upcoming shows',
      density: 'dateblock',
      rows: [
        {
          day: 'FRI',
          date: '20',
          title: 'Live at the Fort',
          subline: '20:00 · from €15',
        },
      ],
    };
    render(<UniqueSection data={data} />);
    expect(screen.getByText('FRI')).toBeTruthy();
    expect(screen.getByText('20')).toBeTruthy();
    expect(screen.getByText('Live at the Fort')).toBeTruthy();
    expect(screen.getByText('20:00 · from €15')).toBeTruthy();
  });
});
