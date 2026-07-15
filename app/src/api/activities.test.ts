import { queryActivities } from './activities';
import {
  badgeQualifier,
  factStripFields,
  uniqueSection,
} from '../features/activity-list/activityDetailConfig';

function mockFetchOnce(status: number, body: unknown, ok = status < 300) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  } as never);
}

describe('queryActivities', () => {
  afterEach(() => jest.resetAllMocks());

  it('resolves success with the activities array on 200', async () => {
    mockFetchOnce(200, { activities: [{ id: '1' }] });
    const result = await queryActivities({ scope: 'nearby' });
    expect(result).toEqual({ status: 'success', activities: [{ id: '1', image_refs: [] }] });
  });

  it('normalizes today\'s plain-string image_refs into { uri } photo objects', async () => {
    mockFetchOnce(200, { activities: [{ id: '1', image_refs: ['https://example.com/img.jpg'] }] });
    const result = await queryActivities({ scope: 'nearby' });
    expect(result).toEqual({
      status: 'success',
      activities: [{ id: '1', image_refs: [{ uri: 'https://example.com/img.jpg' }] }],
    });
  });

  it('passes through an already-object image_refs entry (T3 wire format) unchanged', async () => {
    const attribution = { author: 'Jane Doe', link: 'https://maps.google.com/maps/contrib/1' };
    mockFetchOnce(200, {
      activities: [{ id: '1', image_refs: [{ uri: 'https://example.com/img.jpg', attribution }] }],
    });
    const result = await queryActivities({ scope: 'nearby' });
    expect(result).toEqual({
      status: 'success',
      activities: [{ id: '1', image_refs: [{ uri: 'https://example.com/img.jpg', attribution }] }],
    });
  });

  it('resolves a 400 with the server message', async () => {
    mockFetchOnce(400, { error: 'unknown scope: galaxy' });
    const result = await queryActivities({ scope: 'nearby' });
    expect(result).toEqual({ status: 400, message: 'unknown scope: galaxy' });
  });

  it('resolves a 500 with the server message', async () => {
    mockFetchOnce(500, { error: 'internal error' });
    const result = await queryActivities({ scope: 'nearby' });
    expect(result).toEqual({ status: 500, message: 'internal error' });
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.reject(new Error('not json')),
    } as never);
    const result = await queryActivities({ scope: 'nearby' });
    expect(result).toEqual({ status: 400, message: 'Something went wrong. Please try again.' });
  });

  it('maps a network failure (fetch throws) to a 500 result', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    const result = await queryActivities({ scope: 'nearby' });
    expect(result.status).toBe(500);
  });

  it('buckets an unrecognized status code under 500', async () => {
    mockFetchOnce(418, { error: "I'm a teapot" });
    const result = await queryActivities({ scope: 'nearby' });
    expect(result.status).toBe(500);
  });

  // T6: real wire shape — `details` never carries a `category` key, only the
  // category's own fields. This is the exact fixture shape the old test
  // suite was missing (fixtures elsewhere manually added `category` inside
  // `details`), which let the discriminant bug ship undetected.
  it('stamps the top-level category onto a wire-shaped details payload with no nested category key', async () => {
    mockFetchOnce(200, {
      activities: [
        {
          id: '1',
          category: 'restaurants',
          details: { cuisine: 'Serbian', price_tier: '$$' },
        },
      ],
    });
    const result = await queryActivities({ scope: 'nearby' });
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    const activity = result.activities[0];
    expect(activity.details).toEqual({ category: 'restaurants', cuisine: 'Serbian', price_tier: '$$' });

    const chips = factStripFields(activity);
    expect(chips.map((c) => c.label)).toEqual(['Cuisine', 'Price']);
    expect(chips.map((c) => c.value)).toEqual(['Serbian', '$$']);
  });

  it('still handles an empty wire-shaped details object ({}) cleanly after stamping category', async () => {
    mockFetchOnce(200, {
      activities: [{ id: '1', category: 'restaurants', details: {} }],
    });
    const result = await queryActivities({ scope: 'nearby' });
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    const activity = result.activities[0];
    expect(activity.details).toEqual({ category: 'restaurants' });
    expect(factStripFields(activity)).toEqual([]);
  });

  // Representative categories beyond Restaurants, each with wire-shaped
  // details (no nested category key) — confirms the fix isn't a
  // Restaurants-only special case.
  it('renders Sport fact strip + checklist unique section from a wire-shaped payload', async () => {
    mockFetchOnce(200, {
      activities: [
        {
          id: '1',
          category: 'sport',
          details: {
            difficulty: 3,
            effort_level: 'Moderate',
            duration: '2h',
            gear: 'Boots',
            what_to_bring: ['Water', 'Sunscreen'],
          },
        },
      ],
    });
    const result = await queryActivities({ scope: 'nearby' });
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    const activity = result.activities[0];
    expect(factStripFields(activity).map((c) => c.label)).toEqual(['Effort', 'Duration', 'Gear']);
    expect(uniqueSection(activity)).toEqual({
      shape: 'checklist',
      heading: 'What to bring',
      items: ['Water', 'Sunscreen'],
    });
  });

  it('renders Kids badge qualifier + icon-grid unique section from a wire-shaped payload', async () => {
    mockFetchOnce(200, {
      activities: [
        {
          id: '1',
          category: 'kids',
          details: { age_range: '3-10', facilities: ['Parking', 'Restrooms'] },
        },
      ],
    });
    const result = await queryActivities({ scope: 'nearby' });
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    const activity = result.activities[0];
    expect(badgeQualifier(activity)).toBe('Ages 3-10');
    expect(uniqueSection(activity)).toEqual({
      shape: 'icongrid',
      heading: 'Facilities',
      items: ['Parking', 'Restrooms'],
    });
  });

  it('renders Culture fact strip + now-showing banner from a wire-shaped payload', async () => {
    mockFetchOnce(200, {
      activities: [
        {
          id: '1',
          category: 'culture',
          details: {
            venue_type: 'Museum',
            ticket_price: '€10',
            hours: '10am–6pm',
            now_showing: { title: 'Modern Serbian Art', description: 'Through October' },
          },
        },
      ],
    });
    const result = await queryActivities({ scope: 'nearby' });
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    const activity = result.activities[0];
    expect(factStripFields(activity).map((c) => c.label)).toEqual(['Venue', 'Tickets', 'Hours']);
    expect(uniqueSection(activity)).toEqual({
      shape: 'banner',
      heading: 'Now showing',
      title: 'Modern Serbian Art',
      description: 'Through October',
    });
  });
});
