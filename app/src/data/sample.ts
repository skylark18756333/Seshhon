// Example friends, venues and deals. None of these are real.
// When the Supabase backend is connected, this file is replaced by live data.
import type { Deal, Status } from '../core/rules';

export type Venue = { id: string; name: string; kind: string; km: number; close: string; baseRating: number; ratingCount: number };
export type Friend = { id: string; name: string; status: Status; note: string; vote: string | null };

export const VENUES: Record<string, Venue> = {
  lowtide: { id: 'lowtide', name: 'Lowtide Bar', kind: 'Cocktail bar', km: 0.9, close: 'open till 1am', baseRating: 4.6, ratingCount: 212 },
  bodega: { id: 'bodega', name: 'Bodega Nine', kind: 'Pizza bar', km: 1.6, close: 'open till 12am', baseRating: 4.3, ratingCount: 148 },
  lantern: { id: 'lantern', name: 'The Paper Lantern', kind: 'Live music venue', km: 2.1, close: 'open till 12am', baseRating: 4.4, ratingCount: 96 },
};
export const VENUE_IDS = ['lowtide', 'bodega', 'lantern'];

export const DEALS: Deal[] = [
  { id: 'd1', venueId: 'lowtide', type: 'Food', title: 'Free share plate for groups of 4+', fromHour: 17, toHour: 23, alcohol: false },
  { id: 'd2', venueId: 'lowtide', type: 'Drinks', title: 'Happy hour: 25% off house drinks', fromHour: 17, toHour: 18, alcohol: true, discountPct: 25 },
  { id: 'd3', venueId: 'bodega', type: 'Food', title: '2-for-1 pizzas', fromHour: 17, toHour: 21, alcohol: false },
  { id: 'd4', venueId: 'lantern', type: 'Entry', title: 'Free entry for groups of 4+', fromHour: 20, toHour: 24, alcohol: false },
  { id: 'd5', venueId: 'lantern', type: 'Events', title: 'Live music tonight, table held for your sesh', fromHour: 19, toHour: 23, alcohol: false },
];

export const FRIENDS: Friend[] = [
  { id: 'jess', name: 'Jess M', status: 'on', note: 'On since 8:40pm, 1.2 km away', vote: 'lowtide' },
  { id: 'tom', name: 'Tom K', status: 'on', note: 'On since 9:05pm, 2.4 km away', vote: 'lowtide' },
  { id: 'aisha', name: 'Aisha R', status: 'on', note: 'On since 9:20pm, 0.8 km away', vote: 'bodega' },
  { id: 'dan', name: 'Dan L', status: 'thinking', note: 'Looking at deals', vote: 'lantern' },
  { id: 'priya', name: 'Priya S', status: 'thinking', note: 'Looking at deals', vote: null },
];

export const TAGS = ['Good vibe', 'Good value', 'Fast service'];
export const DEAL_TYPES = ['All', 'Food', 'Drinks', 'Entry', 'Events'] as const;
