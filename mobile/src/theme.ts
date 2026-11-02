// The app's colours. There are three looks to pick from in You > Look: Neon Night (the "Aura" look, copied from
// the CSS in docs/index.html so the native screens match the web app), Daylight and Midnight Pop.
// The green, amber and red lights are the same in every look.
import React from 'react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { Colour } from './api';

const NEON = {
  bg: '#050506',
  surface: 'rgba(255, 255, 255, 0.06)',
  surface2: 'rgba(255, 255, 255, 0.1)',
  line: 'rgba(255, 255, 255, 0.12)',
  fg: '#F5F6F8',
  muted: '#9B9EA8',
  accent: '#FFFFFF',
  accentInk: '#050506',
  on: '#3DDC84',
  thinking: '#F5C542',
  off: '#F0524B',
  ink: '#0B0B0D',
  track: '#0B0B0D',
  trackLine: '#2A2C33',
  unlit: 'rgba(255, 255, 255, 0.55)',     // the icons on the status switch that aren't picked
  tabBg: 'rgba(18, 18, 22, 0.72)',        // the floating tab bar
  logo: '#FFFFFF',                        // the wordmark and the outline of the three-light bubble
  logoGlow: 'rgba(255, 255, 255, 0.75)',
  bubbleBg: 'rgba(5, 5, 6, 0.6)',
  faceRing: 'rgba(255, 255, 255, 0.85)',  // the ring round a friend's face
  mineWhen: 'rgba(5, 5, 6, 0.55)',        // the time on your own chat messages
  whenText: 'rgba(255, 255, 255, 0.55)',
  accentTo: '',                           // a second colour: buttons fade from accent to this (Midnight Pop)
  heroFrom: '#E05A2A',                    // the big venue card in a sesh fades between these two
  heroTo: '#3A1030',
  dark: true
};
type Look = typeof NEON;

export const LOOKS: { id: string; name: string; note: string; colours: Look; fonts?: Partial<typeof F> }[] = [
  { id: 'neon', name: 'Neon Night', note: 'Black and glowing', colours: NEON },
  { id: 'day', name: 'Daylight', note: 'Light and clean', colours: {
    ...NEON,
    bg: '#F4F2EE',
    surface: '#FFFFFF',
    surface2: '#ECE9E3',
    line: 'rgba(17, 17, 20, 0.12)',
    fg: '#111114',
    muted: '#6B6B73',
    accent: '#111114',
    accentInk: '#FFFFFF',
    ink: '#111114',
    track: '#FFFFFF',
    trackLine: '#DDD9D2',
    unlit: 'rgba(17, 17, 20, 0.45)',
    tabBg: 'rgba(255, 255, 255, 0.92)',
    logo: '#111114',
    logoGlow: 'rgba(17, 17, 20, 0)',
    bubbleBg: '#111114',
    faceRing: '#FFFFFF',
    mineWhen: 'rgba(255, 255, 255, 0.6)',
    whenText: 'rgba(17, 17, 20, 0.5)',
    heroFrom: '#FF7A45',
    heroTo: '#E0407A',
    dark: false
  } },
  { id: 'pop', name: 'Midnight Pop', note: 'Deep purple and pink', colours: {
    ...NEON,
    bg: '#130A26',
    surface: 'rgba(255, 255, 255, 0.07)',
    surface2: 'rgba(255, 255, 255, 0.12)',
    line: 'rgba(255, 170, 230, 0.18)',
    fg: '#FFFFFF',
    muted: '#B9A9D9',
    accent: '#FF4FA0',
    accentInk: '#FFFFFF',
    ink: '#0E0720',
    track: '#0E0720',
    trackLine: '#3A2A60',
    tabBg: 'rgba(26, 15, 48, 0.85)',
    logoGlow: 'rgba(255, 120, 200, 0.8)',
    bubbleBg: 'rgba(26, 15, 48, 0.8)',
    mineWhen: 'rgba(255, 255, 255, 0.7)',
    whenText: 'rgba(255, 255, 255, 0.55)',
    accentTo: '#8A4DFF',
    heroFrom: '#8A4DFF',
    heroTo: '#FF4FA0'
  }, fonts: { display: 'Poppins-ExtraBold', displayBold: 'Poppins-Bold' } }
];

// The picked look is kept on the phone, and read before any screen draws so the app opens in it.
const LOOK_KEY = 'frendzy-look';
function readLook(): string {
  try {
    if (Platform.OS === 'web') return (typeof localStorage === 'undefined' ? null : localStorage.getItem(LOOK_KEY)) || 'neon';
    return SecureStore.getItem(LOOK_KEY) || 'neon';
  } catch (e) { return 'neon'; }
}
let lookId = LOOKS.some((l) => l.id === readLook()) ? readLook() : 'neon';

// The colours of the look in use. Screens read C as they draw, so it is changed in place when the look changes.
export const C: Look = { ...(LOOKS.find((l) => l.id === lookId) || LOOKS[0]).colours };

let version = 0;
const listeners = new Set<() => void>();
export function currentLook(): string { return lookId; }
export function setLook(id: string) {
  const look = LOOKS.find((l) => l.id === id);
  if (!look || id === lookId) return;
  lookId = id;
  Object.assign(C, look.colours);
  Object.assign(F, FONTS, look.fonts || {});
  version++;
  try {
    if (Platform.OS === 'web') { if (typeof localStorage !== 'undefined') localStorage.setItem(LOOK_KEY, id); }
    else SecureStore.setItemAsync(LOOK_KEY, id).catch(() => {});
  } catch (e) {}
  listeners.forEach((f) => f());
}
// Redraws the calling screen (and everything under it) when the look changes.
export function useLook(): string {
  const [, redraw] = React.useState(0);
  React.useEffect(() => {
    const f = () => redraw((n) => n + 1);
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);
  return lookId;
}
// A screen's styles, made again from C the first time they are used after the look changes.
export function themed<T extends object>(make: () => T): T {
  let made = make(), at = version;
  return new Proxy({} as T, {
    get(_t, key) {
      if (at !== version) { made = make(); at = version; }
      return (made as any)[key];
    },
    has(_t, key) { return key in made; },
    ownKeys() { return Reflect.ownKeys(made); },
    getOwnPropertyDescriptor(_t, key) {
      if (at !== version) { made = make(); at = version; }
      const d = Object.getOwnPropertyDescriptor(made, key);
      return d ? { ...d, configurable: true } : undefined;
    }
  });
}

// The fonts from docs/fonts, turned into the .ttf files phones can load (assets/fonts, see README).
// Midnight Pop swaps the two display fonts for Poppins; F is changed in place like C.
const FONTS = {
  neon: 'TiltNeon-Regular',       // the Crewzy wordmark
  display: 'Montserrat-ExtraBold',
  displayBold: 'Montserrat-Bold',
  body: 'Inter-Regular',
  bodyMid: 'Inter-Medium',
  bodyBold: 'Inter-Bold'
};
export const F: typeof FONTS = { ...FONTS, ...((LOOKS.find((l) => l.id === lookId) || LOOKS[0]).fonts || {}) };

export const STOPS: Colour[] = ['on', 'thinking', 'off'];   // left to right on the status switch: G, A, R
export const COLOURS: Record<Colour, string> = { on: C.on, thinking: C.thinking, off: C.off };
export const LABELS: Record<Colour, string> = { on: 'Green', thinking: 'Amber', off: 'Red' };
export const STATUS_ICON: Record<Colour, string> = { on: 'tick', thinking: 'query', off: 'cross' };

// The same words the web app uses on Home.
export const STATUS_COPY: Record<Colour, [string, string]> = {
  on: ["You're green.", "Ready to go out. Friends on green or amber can see you're up for a sesh."],
  thinking: ["You're amber.", 'Thinking about it. Friends see you might be keen.'],
  off: ["You're red.", "You're off and hidden, and you can't see who else is out until you slide the switch up top."]
};

/* ---------- small helpers, ported from docs/app.js ---------- */
export function initials(n?: string): string {
  const p = String(n || '?').trim().split(/\s+/);
  return ((p[0] || '?').charAt(0) + (p[1] ? p[1].charAt(0) : '')).toUpperCase();
}
export function first(n?: string): string {
  return String(n || 'Someone').trim().split(/\s+/)[0];
}
export function fmtLeft(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (h > 0) return h + 'h ' + m + 'm';
  return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
}
// A steady colour per person for their circle until faces can be added.
export function hue(name?: string): number {
  let h = 0;
  const t = String(name || '');
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 360;
  return h;
}
// A colour at part strength, for glows and dim lamps (CSS does this with color-mix).
export function fade(colour: string, part: number): string {
  const hex = colour.replace('#', '');
  const n = parseInt(hex.length === 3 ? hex.replace(/(.)/g, '$1$1') : hex, 16);
  return 'rgba(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ', ' + part + ')';
}

// "8:05 pm", in this phone's time (fmtTime in docs/app.js).
export function fmtTime(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const h = d.getHours(), m = d.getMinutes();
  return (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + (h >= 12 ? ' pm' : ' am');
}
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "Today, 8:00 pm", "Tomorrow, 7:30 pm" or "Sat 10 Oct, 8:00 pm", in this phone's time (fmtWhen in docs/app.js).
export function fmtWhen(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '';
  const d = new Date(iso), t = new Date(), day = 86400000;
  if (isNaN(d.getTime())) return '';
  const midnight = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime(), diff = Math.floor((d.getTime() - midnight) / day);
  const dayText = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : DAY_NAMES[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
  return dayText + ', ' + fmtTime(d.getTime());
}

const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// A day as the database sends it ("2026-10-09") in this phone's own calendar.
export function dayOf(iso: string): Date {
  const p = String(iso).split('-').map(Number);
  return new Date(p[0], (p[1] || 1) - 1, p[2] || 1);
}
// "Fri 9 Oct".
export function fmtDay(iso: string): string {
  const d = dayOf(iso);
  return DAY_NAMES[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
}
export const PART_NAMES: Record<string, string> = { morning: 'Morning', arvo: 'Arvo', night: 'Night' };
// "Friday night", "Tomorrow arvo" or "Today morning".
export function fmtSlot(iso: string, part: string): string {
  const d = dayOf(iso), t = new Date();
  const diff = Math.round((d.getTime() - new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()) / 86400000);
  return (diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : LONG_DAYS[d.getDay()]) + ' ' + (PART_NAMES[part] || part).toLowerCase();
}
// When a part of a day starts, for planning a sesh: morning 10:00, arvo 2:00 pm, night 7:00 pm.
export function slotStart(iso: string, part: string): Date {
  const d = dayOf(iso);
  d.setHours(part === 'morning' ? 10 : part === 'arvo' ? 14 : 19, 0, 0, 0);
  return d;
}
export const HANGOUTS: [string, string][] = [['night_out', 'Night out'], ['coffee', 'Coffee'], ['lunch', 'Lunch'], ['gym', 'Gym'], ['footy', 'Footy']];
