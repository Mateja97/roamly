import {
  Activity,
  Armchair,
  Baby,
  Bath,
  Beer,
  Bike,
  Blocks,
  Brush,
  Building2,
  Bus,
  Cake,
  Church,
  Clapperboard,
  Cloudy,
  Coffee,
  Compass,
  CookingPot,
  CircleDot,
  Croissant,
  Dice5,
  Disc3,
  Drama,
  Dumbbell,
  FerrisWheel,
  Flag,
  Flower2,
  Footprints,
  Frame,
  Gem,
  GlassWater,
  GraduationCap,
  HeartPulse,
  Landmark,
  Leaf,
  MapPinned,
  Martini,
  Mic2,
  Moon,
  Mountain,
  Music,
  Palette,
  PawPrint,
  PersonStanding,
  Puzzle,
  Sandwich,
  ShoppingBag,
  ShoppingBasket,
  Sparkles,
  Spade,
  Store,
  Trees,
  Truck,
  Tv,
  Umbrella,
  Utensils,
  UtensilsCrossed,
  Waves,
  Wine,
  Zap,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { SUBCATEGORIES } from './filters';
import type { Category } from './types';

// design-spec.md T3: one lucide icon per subtype slug, sourced from
// filters.ts's canonical SUBCATEGORIES (not invented labels) — the icon
// choice itself is this task's own deliverable, no mock frame to trace it
// against. `subtypeIcons.test.ts` asserts every SUBCATEGORIES slug has an
// entry here (and vice versa), so a future taxonomy edit can't silently
// leave a subtype chip iconless.
export const SUBTYPE_ICONS: Record<string, LucideIcon> = {
  // Restaurants
  fine_dining: UtensilsCrossed,
  casual_dining: Utensils,
  fast_casual: Sandwich,
  street_food: Truck,
  bakery_dessert: Cake,
  // Cafés
  coffee_shop: Coffee,
  tea_house: Leaf,
  bakery_cafe: Croissant,
  // Bars
  cocktail_bar: Martini,
  wine_bar: Wine,
  brewery: Beer,
  sports_bar: Tv,
  pub: GlassWater,
  shisha: Cloudy,
  kafana: Utensils,
  // Nightlife
  nightclub: Disc3,
  live_music_venue: Mic2,
  lounge: Armchair,
  shisha_lounge: Cloudy,
  kafana_live: Music,
  // Nature
  hiking_trail: Mountain,
  park: Trees,
  beach: Umbrella,
  botanical_garden: Flower2,
  viewpoint: MapPinned,
  // Sport
  gym_fitness: Dumbbell,
  climbing_gym: Activity,
  swimming_pool: Waves,
  sports_court: CircleDot,
  golf_course: Flag,
  extreme_sports: Zap,
  // Kids
  playground: Blocks,
  indoor_play_center: Baby,
  zoo_aquarium: PawPrint,
  amusement_park: FerrisWheel,
  kids_museum: GraduationCap,
  // Culture
  historical_site: Landmark,
  monument_landmark: MapPinned,
  heritage_museum: Building2,
  religious_site: Church,
  // Art
  art_gallery: Palette,
  art_museum: Frame,
  studio_workshop: Brush,
  public_art: Sparkles,
  // Wellness
  spa: HeartPulse,
  yoga_studio: PersonStanding,
  meditation_center: Moon,
  thermal_bath: Bath,
  // Shopping
  market_bazaar: ShoppingBasket,
  boutique: ShoppingBag,
  mall: Store,
  specialty_store: Gem,
  // Entertainment
  cinema: Clapperboard,
  escape_room: Puzzle,
  bowling_arcade: Dice5,
  theater: Drama,
  casino: Spade,
  // Tours & Experiences
  walking_tour: Footprints,
  day_trip: Bus,
  food_drink_tour: Wine,
  adventure_tour: Compass,
  cooking_class: CookingPot,
  bike_tour: Bike,
};

// Every canonical slug, once, in the same category order SUBCATEGORIES
// already defines — used only by the coverage test below.
export const ALL_SUBTYPE_SLUGS: string[] = (Object.keys(SUBCATEGORIES) as Category[]).flatMap(
  (category) => SUBCATEGORIES[category].map((option) => option.value)
);
