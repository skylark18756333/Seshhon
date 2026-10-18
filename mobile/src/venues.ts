// Venues for the Sesh tab: the list (api_venues), where each one is (venue_pins), their opening hours and how
// far away they are. Ported from loadVenues, loadPins, km, hoursLine, fmtKm, awayText, leaderOf and votePicks
// in docs/app.js. The opening-hours reader is docs/hours.js itself, copied in by scripts/bundle-web.mjs.
import * as Location from 'expo-location';
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

// Fetch the venues again now (after a rating, say), as freshVenues does in docs/app.js.
export function refreshVenues(): Promise<void> { return fetchAll(); }

export type Venues = { list: Venue[]; byId: Record<string, Venue>; pins: Record<string, [number, number]> | null };

// The venues, fetched when the Sesh tab opens and again if they are more than 5 minutes old.
export function useVenues(): Venues {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    listeners.add(fn);
    if (!venues || !pins || Date.now() - venuesAt > 5 * 60000) fetchAll();
    findMe(false);
    return () => { listeners.delete(fn); };
  }, []);
  return { list: venues || [], byId, pins };
}

/* ---------- where you are ---------- */
// This phone's position, kept in memory only while the app is open: never sent anywhere or saved. Asked for
// once when the Map tab opens (ask = true shows the permission question); other screens use it only if the
// phone already said yes, and fall back to the city centre.
let here: [number, number] | null = null;
let hereAt = 0;
let finding: Promise<[number, number] | null> | null = null;
const HERE_MS = 2 * 60000;   // a position older than this is asked for again
export function myPlace(): [number, number] | null { return here; }
export function findMe(ask: boolean, fresh?: boolean): Promise<[number, number] | null> {
  if (here && !fresh && Date.now() - hereAt < HERE_MS) return Promise.resolve(here);
  if (!finding) {
    finding = (async () => {
      try {
        const perm = ask ? await Location.requestForegroundPermissionsAsync() : await Location.getForegroundPermissionsAsync();
        if (perm.status !== 'granted') return null;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const at: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        const moved = !here || km(here, at) > 0.05;
        here = at; hereAt = Date.now();
        if (moved) listeners.forEach((fn) => fn());
        return here;
      } catch (e) {
        return null;
      } finally {
        finding = null;
      }
    })();
  }
  return finding;
}

// Where you are, for any screen that wants a map or distances from you (the Map tab, a map on Home):
// re-renders when the position arrives or moves. ask = true shows the permission question if it hasn't been answered.
export function useMyPlace(ask: boolean): [number, number] | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    listeners.add(fn);
    findMe(ask).then(fn);
    return () => { listeners.delete(fn); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return here;
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
// Distances are from you when the phone has said where you are, otherwise from the city centre.
export function awayText(v: Venues, id: string): string {
  const at = v.pins && v.pins[id];
  return at ? fmtKm(km(here || MAP_CENTRE, at)) + (here ? ' away' : ' from the city centre') : '';
}
export function distanceAway(v: Venues, id: string): string {
  const at = v.pins && v.pins[id];
  return at ? fmtKm(km(here || MAP_CENTRE, at)) + ' away' : '';
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
// { open, soon, text } or null when the hours are unknown (openState in docs/app.js).
export function openState(ven: Venue): { open: boolean; soon?: boolean; text: string } | null {
  if (!ven.hours) return null;
  if (!(ven.hours in hoursCache)) hoursCache[ven.hours] = SeshHours.parse(ven.hours);
  const h = hoursCache[ven.hours];
  if (!h) return null;
  const t = perthNow();
  return SeshHours.status(h, t.dow, t.min);
}
export function hoursLine(ven: Venue): string {
  const st = openState(ven);
  return st ? st.text : (ven.closes || 'Hours unknown');
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
// The venues offered for a vote: anything already voted for, then the nearest few within the radius of you
// (or the city centre), so a
// sesh never shows hundreds of venues at once. Any other venue can be voted for from the map.
const VOTE_PICKS = 8;
export function votePicks(v: Venues, tally: Tally): Venue[] {
  const voted = v.list.filter((x) => tally.by[x.id]);
  const pins = v.pins;
  if (!pins) return voted.length ? voted : v.list.slice(0, VOTE_PICKS);
  const from = here || MAP_CENTRE;
  const near = v.list.filter((x) => pins[x.id] && !tally.by[x.id])
    .map((x) => ({ v: x, d: km(from, pins[x.id]) }))
    .filter((x) => x.d <= RADIUS_KM)
    .sort((a, b) => a.d - b.d)
    .slice(0, VOTE_PICKS).map((x) => x.v);
  return voted.concat(near);
}
