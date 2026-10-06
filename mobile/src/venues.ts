// Venues for the Sesh tab: the list (api_venues), where each one is (venue_pins), their opening hours and how
// far away they are. Ported from loadVenues, loadPins, km, hoursLine, fmtKm, awayText, leaderOf and votePicks
// in docs/app.js. The opening-hours reader is docs/hours.js itself, copied in by scripts/bundle-web.mjs.
import { useEffect, useState } from 'react';
import { loadPins, loadVenues, type Sesh, type Venue } from './api';
import { MAP_CENTRE, RADIUS_KM } from './config';

type Hours = { parse: (text: string) => unknown; status: (h: unknown, dow: number, min: number) => { open: boolean; soon?: boolean; text: string } | null };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const SeshHours: Hours = require('../web/hours.generated.js');

/* ---------- kept for the whole time the app is open, like VENUES and pins in the web app ---------- */
let venues: Venue[] | null = null;
let venuesAt = 0;
let byId: Record<string, Venue> = {};
let pins: Record<string, [number, number]> | null = null;
let asking: Promise<void> | null = null;
const listeners = new Set<() => void>();

function fetchAll(): Promise<void> {
  if (!asking) {
    asking = Promise.all([
      loadVenues().then((list) => { venues = list; venuesAt = Date.now(); byId = {}; list.forEach((v) => { byId[v.id] = v; }); }, () => { venuesAt = Date.now(); }),
      pins ? Promise.resolve() : loadPins().then((p) => { pins = p; }, () => { pins = pins || {}; })
    ]).then(() => { asking = null; listeners.forEach((fn) => fn()); });
  }
  return asking;
}

export type Venues = { list: Venue[]; byId: Record<string, Venue>; pins: Record<string, [number, number]> | null };

// The venues, fetched when the Sesh tab opens and again if they are more than 5 minutes old.
export function useVenues(): Venues {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    listeners.add(fn);
    if (!venues || !pins || Date.now() - venuesAt > 5 * 60000) fetchAll();
    return () => { listeners.delete(fn); };
  }, []);
  return { list: venues || [], byId, pins };
}

/* ---------- distances ---------- */
// Distance between two [lat, lng] points along the earth's surface, in km.
export function km(a: [number, number], b: [number, number]): number {
  const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function fmtKm(d: number): string {
  return d < 1 ? Math.max(100, Math.round(d * 10) * 100) + ' m' : (d < 10 ? d.toFixed(1) : String(Math.round(d))) + ' km';
}
// The phone app doesn't use your location on this tab, so distances are from the city centre, as on the
// web app's map until someone taps it or shares their location.
export function awayText(v: Venues, id: string): string {
  const at = v.pins && v.pins[id];
  return at ? fmtKm(km(MAP_CENTRE, at)) + ' from the city centre' : '';
}
export function distanceAway(v: Venues, id: string): string {
  const at = v.pins && v.pins[id];
  return at ? fmtKm(km(MAP_CENTRE, at)) + ' away' : '';
}

/* ---------- opening hours (Perth time) ---------- */
const hoursCache: Record<string, unknown> = {};
function perthNow(): { dow: number; min: number } {
  let dow = 0, min = 0;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Australia/Perth', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(new Date()).forEach((p) => {
        if (p.type === 'weekday') dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.value);
        if (p.type === 'hour') min += (Number(p.value) % 24) * 60;
        if (p.type === 'minute') min += Number(p.value);
      });
  } catch (e) { const d = new Date(); dow = (d.getDay() + 6) % 7; min = d.getHours() * 60 + d.getMinutes(); }
  return { dow: Math.max(0, dow), min };
}
export function hoursLine(ven: Venue): string {
  if (ven.hours) {
    if (!(ven.hours in hoursCache)) hoursCache[ven.hours] = SeshHours.parse(ven.hours);
    const h = hoursCache[ven.hours];
    if (h) {
      const t = perthNow();
      const st = SeshHours.status(h, t.dow, t.min);
      if (st) return st.text;
    }
  }
  return ven.closes || 'Hours unknown';
}

/* ---------- the vote ---------- */
export type Tally = { best: string | null; by: Record<string, { n: number; firstAt: number }> };
// Same rule as the database: most votes wins, and a tie goes to the venue that reached its votes first.
export function leaderOf(sesh: Sesh): Tally {
  const by: Tally['by'] = {};
  sesh.votes.forEach((v) => {
    const t = new Date(v.voted_at).getTime();
    if (!by[v.venue_id]) by[v.venue_id] = { n: 0, firstAt: t };
    by[v.venue_id].n += 1;
    if (t < by[v.venue_id].firstAt) by[v.venue_id].firstAt = t;
  });
  let best: string | null = null;
  Object.keys(by).forEach((id) => {
    if (!best || by[id].n > by[best].n || (by[id].n === by[best].n && by[id].firstAt < by[best].firstAt)) best = id;
  });
  return { best, by };
}
// The venues offered for a vote: anything already voted for, then the nearest few within the radius, so a
// sesh never shows hundreds of venues at once. Any other venue can be voted for from the map.
const VOTE_PICKS = 8;
export function votePicks(v: Venues, tally: Tally): Venue[] {
  const voted = v.list.filter((x) => tally.by[x.id]);
  const pins = v.pins;
  if (!pins) return voted.length ? voted : v.list.slice(0, VOTE_PICKS);
  const near = v.list.filter((x) => pins[x.id] && !tally.by[x.id])
    .map((x) => ({ v: x, d: km(MAP_CENTRE, pins[x.id]) }))
    .filter((x) => x.d <= RADIUS_KM)
    .sort((a, b) => a.d - b.d)
    .slice(0, VOTE_PICKS).map((x) => x.v);
  return voted.concat(near);
}
