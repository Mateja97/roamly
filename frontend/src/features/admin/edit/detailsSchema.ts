/** The build-deterministic per-category `details` key -> control mapping,
 * sourced 1:1 from `backend/shared/models/activitiessvc/activity.go`'s 13
 * detail structs. Data, not code — `DetailsSection` just iterates this per
 * the selected category. Never hand-add a field here that isn't a real JSON
 * key on the matching Go struct (an input that writes nowhere is
 * forbidden). */

export type ControlKind =
  | 'text'
  | 'numeric'
  | 'textarea'
  | 'url'
  | 'chips'
  | 'line-items'
  | 'object-group'
  | 'opening-hours'
  | 'select';

export interface SubFieldOption {
  value: string;
  label: string;
}

/** One sub-field of a line-item row or an object-group. */
export interface SubField {
  key: string;
  label: string;
  required?: boolean;
  /** The sub-field's own input — defaults to a plain text input. 'select'
   * needs `options`; 'time' renders a native time input (opening_hours'
   * day/open/close rows). */
  control?: 'text' | 'select' | 'time';
  options?: SubFieldOption[];
  /** Overrides the generic "<Label> is required" blur message. */
  requiredMessage?: string;
  /** Value a freshly-added row starts with — Day defaults to Monday since
   * a <select> can't represent a blank value the way a text input can. */
  defaultValue?: string;
}

export interface DetailField {
  /** The JSON key inside the activity's `details` object. */
  key: string;
  label: string;
  control: ControlKind;
  /** line-items / object-group: the sub-fields of one row/group. */
  itemFields?: SubField[];
  /** line-items: singular noun for "Add <item>" / "No <items> yet" copy. */
  itemLabel?: string;
  /** 'select': the field's own options, same shape a sub-field's `options`
   * already uses. Leads with a selectable `{ value: '', label: '—' }` when
   * the field is optional and clearable — never a disabled placeholder,
   * which would make the field un-clearable once a value is set. */
  options?: SubFieldOption[];
}

const BANNER: SubField[] = [
  { key: 'title', label: 'Title', required: true },
  { key: 'description', label: 'Description' },
];

const DAY_OPTIONS: SubFieldOption[] = [
  { value: 'monday', label: 'Monday' },
  { value: 'tuesday', label: 'Tuesday' },
  { value: 'wednesday', label: 'Wednesday' },
  { value: 'thursday', label: 'Thursday' },
  { value: 'friday', label: 'Friday' },
  { value: 'saturday', label: 'Saturday' },
  { value: 'sunday', label: 'Sunday' },
];

/** One row of `opening_hours.periods` — day/open/close, matching
 * `backend/shared/models/activitiessvc/activity.go`'s `Period` json tags. */
export const OPENING_HOURS_PERIOD_FIELDS: SubField[] = [
  {
    key: 'day',
    label: 'Day',
    control: 'select',
    options: DAY_OPTIONS,
    defaultValue: 'monday',
  },
  {
    key: 'open',
    label: 'Opens',
    control: 'time',
    required: true,
    requiredMessage: 'Enter a time',
  },
  {
    key: 'close',
    label: 'Closes',
    control: 'time',
    required: true,
    requiredMessage: 'Enter a time',
  },
];

/** The structured weekly-hours group (T2) — the only hours input in each of
 * the seven in-scope categories' schemas below. The old free-text hours /
 * opens_time / open_status / open_tonight fields were dropped from the
 * editor (T5): admins can only author the new structured shape going
 * forward. Existing activities that still carry the legacy keys keep them
 * untouched in `details` — the editor never explicitly deletes a key it
 * doesn't render a field for — and the app's fallback display for
 * unconverted rows (e.g. bars/nightlife, which have no reliable close time
 * to convert) is unaffected. */
const OPENING_HOURS_FIELD: DetailField = {
  key: 'opening_hours',
  label: 'Opening hours',
  control: 'opening-hours',
  itemFields: OPENING_HOURS_PERIOD_FIELDS,
  itemLabel: 'day',
};

/** `tours_experiences.difficulty_level`'s whole vocabulary — enum-backed on
 * the Go side (`ToursExperiencesDetails.DifficultyLevel`'s doc comment), so
 * a select with no free-text entry rather than a text input a typo could
 * silently blank server-side. Leading `—` mirrors how `BasicsSection`
 * builds `subtypeOptions`: difficulty is optional, so "no answer" must stay
 * reachable after an answer has been given. */
const DIFFICULTY_LEVEL_OPTIONS: SubFieldOption[] = [
  { value: '', label: '—' },
  { value: 'Easy', label: 'Easy' },
  { value: 'Moderate', label: 'Moderate' },
  { value: 'Challenging', label: 'Challenging' },
];

export const DETAILS_SCHEMA: Record<string, DetailField[]> = {
  restaurants: [
    { key: 'cuisine', label: 'Cuisine', control: 'text' },
    { key: 'price_tier', label: 'Price tier', control: 'text' },
    OPENING_HOURS_FIELD,
    {
      key: 'popular_dishes',
      label: 'Popular dishes',
      control: 'line-items',
      itemFields: [
        { key: 'name', label: 'Name', required: true },
        { key: 'price', label: 'Price' },
      ],
      itemLabel: 'dish',
    },
    { key: 'action_url', label: 'Booking website', control: 'url' },
  ],
  cafes: [
    { key: 'known_for_brew', label: 'Known for brew', control: 'text' },
    { key: 'wifi_quality', label: 'Wifi quality', control: 'text' },
    OPENING_HOURS_FIELD,
    {
      key: 'on_the_bar',
      label: 'On the bar',
      control: 'line-items',
      itemFields: [
        { key: 'name', label: 'Name', required: true },
        { key: 'price', label: 'Price' },
      ],
      itemLabel: 'item',
    },
  ],
  bars: [
    { key: 'vibe', label: 'Vibe', control: 'text' },
    { key: 'happy_hour_window', label: 'Happy hour window', control: 'text' },
    OPENING_HOURS_FIELD,
    { key: 'signature_pours', label: 'Signature pours', control: 'chips' },
    { key: 'action_url', label: 'Booking website', control: 'url' },
  ],
  nightlife: [
    { key: 'entry_price', label: 'Entry price', control: 'text' },
    { key: 'dress_code', label: 'Dress code', control: 'text' },
    OPENING_HOURS_FIELD,
    {
      key: 'lineup',
      label: 'Lineup',
      control: 'line-items',
      itemFields: [
        { key: 'time', label: 'Time', required: true },
        { key: 'act', label: 'Act', required: true },
        { key: 'stage', label: 'Stage', required: true },
      ],
      itemLabel: 'lineup entry',
    },
    { key: 'action_url', label: 'Booking website', control: 'url' },
    { key: 'venue_type', label: 'Venue type', control: 'text' },
  ],
  nature: [
    { key: 'time_to_spend', label: 'Time to spend', control: 'text' },
    { key: 'best_time', label: 'Best time', control: 'text' },
    { key: 'cost', label: 'Cost', control: 'text' },
    { key: 'good_to_know', label: 'Good to know', control: 'chips' },
  ],
  sport: [
    { key: 'difficulty', label: 'Difficulty', control: 'numeric' },
    { key: 'effort_level', label: 'Effort level', control: 'text' },
    { key: 'gear', label: 'Gear', control: 'text' },
    { key: 'what_to_bring', label: 'What to bring', control: 'chips' },
    { key: 'action_url', label: 'Booking website', control: 'url' },
    { key: 'discipline', label: 'Discipline', control: 'text' },
  ],
  kids: [
    { key: 'age_range', label: 'Age range', control: 'text' },
    { key: 'facilities', label: 'Facilities', control: 'chips' },
  ],
  culture: [
    { key: 'venue_type', label: 'Venue type', control: 'text' },
    { key: 'ticket_price', label: 'Ticket price', control: 'text' },
    OPENING_HOURS_FIELD,
    {
      key: 'now_showing',
      label: 'Now showing',
      control: 'object-group',
      itemFields: BANNER,
    },
    { key: 'action_url', label: 'Booking website', control: 'url' },
  ],
  art: [
    { key: 'venue_type', label: 'Venue type', control: 'text' },
    { key: 'ticket_price', label: 'Ticket price', control: 'text' },
    OPENING_HOURS_FIELD,
    {
      key: 'artwork',
      label: 'Artwork',
      control: 'object-group',
      itemFields: [
        { key: 'artist', label: 'Artist' },
        { key: 'work', label: 'Work' },
        { key: 'medium', label: 'Medium' },
      ],
    },
    {
      key: 'current_exhibition',
      label: 'Current exhibition',
      control: 'object-group',
      itemFields: BANNER,
    },
    { key: 'action_url', label: 'Booking website', control: 'url' },
    { key: 'year', label: 'Year', control: 'numeric' },
  ],
  wellness: [
    {
      key: 'treatments',
      label: 'Treatments',
      control: 'line-items',
      itemFields: [{ key: 'item', label: 'Item', required: true }],
      itemLabel: 'treatment',
    },
    {
      key: 'external_booking_note',
      label: 'External booking note',
      control: 'textarea',
    },
    { key: 'action_url', label: 'Booking website', control: 'url' },
    { key: 'venue_type', label: 'Venue type', control: 'text' },
    { key: 'good_to_know', label: 'Good to know', control: 'chips' },
    OPENING_HOURS_FIELD,
  ],
  shopping: [
    { key: 'venue_type', label: 'Venue type', control: 'text' },
    { key: 'best_day', label: 'Best day', control: 'text' },
    OPENING_HOURS_FIELD,
    { key: 'what_youll_find', label: "What you'll find", control: 'chips' },
  ],
  entertainment: [
    { key: 'genre', label: 'Genre', control: 'text' },
    { key: 'neighborhood', label: 'Neighborhood', control: 'text' },
    {
      key: 'upcoming_shows',
      label: 'Upcoming shows',
      control: 'line-items',
      itemFields: [
        { key: 'date', label: 'Date', required: true },
        { key: 'title', label: 'Title', required: true },
      ],
      itemLabel: 'show',
    },
    { key: 'action_url', label: 'Booking website', control: 'url' },
    { key: 'good_to_know', label: 'Good to know', control: 'chips' },
    OPENING_HOURS_FIELD,
  ],
  tours_experiences: [
    { key: 'duration', label: 'Duration', control: 'text' },
    { key: 'group_size', label: 'Group size', control: 'text' },
    { key: 'languages', label: 'Languages', control: 'text' },
    {
      key: 'difficulty_level',
      label: 'Difficulty level',
      control: 'select',
      options: DIFFICULTY_LEVEL_OPTIONS,
    },
    { key: 'included', label: 'Included', control: 'chips' },
    { key: 'not_included', label: 'Not included', control: 'chips' },
    { key: 'itinerary', label: 'Itinerary', control: 'chips' },
    { key: 'meeting_point', label: 'Meeting point', control: 'textarea' },
  ],
};
