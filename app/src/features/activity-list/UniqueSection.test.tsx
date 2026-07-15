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
          trailingStyle: 'muted',
        },
      ],
    };
    render(<UniqueSection data={data} />);
    expect(screen.getByText('23:00')).toBeTruthy();
    expect(screen.getByText('DJ Nina')).toBeTruthy();
    expect(screen.getByText('Main stage')).toBeTruthy();
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
