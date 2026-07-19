import type { ActivityStatus } from '../../api/adminActivities';

/** The 13-category taxonomy from BUSINESS_STANDARDS.md; wire values match
 * backend/shared/models/activitiessvc.Category's string consts. */
export const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'restaurants', label: 'Restaurants' },
  { value: 'cafes', label: 'Cafés' },
  { value: 'bars', label: 'Bars' },
  { value: 'nightlife', label: 'Nightlife' },
  { value: 'nature', label: 'Nature' },
  { value: 'sport', label: 'Sport' },
  { value: 'kids', label: 'Kids' },
  { value: 'culture', label: 'Culture' },
  { value: 'art', label: 'Art' },
  { value: 'wellness', label: 'Wellness' },
  { value: 'shopping', label: 'Shopping' },
  { value: 'entertainment', label: 'Entertainment' },
  { value: 'tours_experiences', label: 'Tours & Experiences' },
];

/** Category -> subtype options (T2), the single source-of-truth taxonomy
 * from BUSINESS_STANDARDS.md's subcategory table — same 59 slugs/labels as
 * `backend/shared/models/activitiessvc.Subcategories`. Backs both the admin
 * editor's dependent Subcategory select and the user-facing subtype filter
 * chips. */
export const SUBCATEGORIES: Record<string, { value: string; label: string }[]> = {
  restaurants: [
    { value: 'fine_dining', label: 'Fine Dining' },
    { value: 'casual_dining', label: 'Casual Dining' },
    { value: 'fast_casual', label: 'Fast Casual' },
    { value: 'street_food', label: 'Food Truck/Street Food' },
    { value: 'bakery_dessert', label: 'Bakery & Dessert' },
  ],
  cafes: [
    { value: 'coffee_shop', label: 'Coffee Shop' },
    { value: 'tea_house', label: 'Tea House' },
    { value: 'bakery_cafe', label: 'Bakery Cafe' },
  ],
  bars: [
    { value: 'cocktail_bar', label: 'Cocktail Bar' },
    { value: 'wine_bar', label: 'Wine Bar' },
    { value: 'brewery', label: 'Brewery/Beer Garden' },
    { value: 'sports_bar', label: 'Sports Bar' },
    { value: 'pub', label: 'Pub' },
  ],
  nightlife: [
    { value: 'nightclub', label: 'Nightclub' },
    { value: 'live_music_venue', label: 'Live Music Venue' },
    { value: 'lounge', label: 'Lounge' },
  ],
  nature: [
    { value: 'hiking_trail', label: 'Hiking Trail' },
    { value: 'park', label: 'Park' },
    { value: 'beach', label: 'Beach' },
    { value: 'botanical_garden', label: 'Garden/Botanical' },
    { value: 'viewpoint', label: 'Viewpoint/Lookout' },
  ],
  sport: [
    { value: 'gym_fitness', label: 'Gym/Fitness Studio' },
    { value: 'climbing_gym', label: 'Climbing Gym' },
    { value: 'swimming_pool', label: 'Swimming Pool' },
    { value: 'sports_court', label: 'Sports Court/Field' },
    { value: 'golf_course', label: 'Golf Course' },
    { value: 'extreme_sports', label: 'Adventure/Extreme Sports' },
  ],
  kids: [
    { value: 'playground', label: 'Playground' },
    { value: 'indoor_play_center', label: 'Indoor Play Center' },
    { value: 'zoo_aquarium', label: 'Zoo/Aquarium' },
    { value: 'amusement_park', label: 'Amusement Park' },
    { value: 'kids_museum', label: "Kids' Museum" },
  ],
  culture: [
    { value: 'historical_site', label: 'Historical Site' },
    { value: 'monument_landmark', label: 'Monument/Landmark' },
    { value: 'heritage_museum', label: 'Heritage Museum' },
    { value: 'religious_site', label: 'Religious Site' },
  ],
  art: [
    { value: 'art_gallery', label: 'Art Gallery' },
    { value: 'art_museum', label: 'Art Museum' },
    { value: 'studio_workshop', label: 'Studio/Workshop' },
    { value: 'public_art', label: 'Public Art Installation' },
  ],
  wellness: [
    { value: 'spa', label: 'Spa' },
    { value: 'yoga_studio', label: 'Yoga Studio' },
    { value: 'meditation_center', label: 'Meditation Center' },
    { value: 'thermal_bath', label: 'Hot Springs/Thermal Bath' },
  ],
  shopping: [
    { value: 'market_bazaar', label: 'Market/Bazaar' },
    { value: 'boutique', label: 'Boutique' },
    { value: 'mall', label: 'Mall' },
    { value: 'specialty_store', label: 'Specialty Store' },
  ],
  entertainment: [
    { value: 'cinema', label: 'Cinema' },
    { value: 'escape_room', label: 'Escape Room' },
    { value: 'bowling_arcade', label: 'Bowling/Arcade' },
    { value: 'theater', label: 'Theater/Performance' },
    { value: 'casino', label: 'Casino' },
  ],
  tours_experiences: [
    { value: 'walking_tour', label: 'Walking Tour' },
    { value: 'day_trip', label: 'Day Trip' },
    { value: 'food_drink_tour', label: 'Food & Drink Tour' },
    { value: 'adventure_tour', label: 'Adventure Tour' },
    { value: 'cooking_class', label: 'Cooking Class/Workshop' },
    { value: 'bike_tour', label: 'Bike Tour' },
  ],
};

export const STATUS_CHIPS: { value: ActivityStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Drafts' },
  { value: 'pending', label: 'Pending' },
];

/** Shared status-pill label + CSS class per status — used by the
 * activities table row and the edit form header's read-out pill. */
export const STATUS_PILL: Record<
  ActivityStatus,
  { label: string; className: string }
> = {
  published: { label: 'Published', className: 'admin-pill-published' },
  draft: { label: 'Draft', className: 'admin-pill-draft' },
  pending: { label: 'Pending', className: 'admin-pill-pending' },
};

export const DEFAULT_PAGE_SIZE = 20;
