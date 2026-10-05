// The "Aura" look, copied from the CSS in docs/index.html so the native screens match the web app.
import type { Colour } from './api';

export const C = {
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
  trackLine: '#2A2C33'
};

// The fonts from docs/fonts, turned into the .ttf files phones can load (assets/fonts, see README).
export const F = {
  neon: 'TiltNeon-Regular',       // the Frendzy wordmark
  display: 'Montserrat-ExtraBold',
  displayBold: 'Montserrat-Bold',
  body: 'Inter-Regular',
  bodyMid: 'Inter-Medium',
  bodyBold: 'Inter-Bold'
};

export const STOPS: Colour[] = ['on', 'thinking', 'off'];   // left to right on the status switch: G, A, R
export const COLOURS: Record<Colour, string> = { on: C.on, thinking: C.thinking, off: C.off };
export const LABELS: Record<Colour, string> = { on: 'Green', thinking: 'Amber', off: 'Red' };
export const STATUS_ICON: Record<Colour, string> = { on: 'tick', thinking: 'query', off: 'cross' };

// The same words the web app uses on Home.
export const STATUS_COPY: Record<Colour, [string, string]> = {
  on: ["You're green.", "Ready to go out. Friends on green or amber can see you're up for a sesh."],
  thinking: ["You're amber.", 'Thinking about it. Friends see you might be keen.'],
  off: ["You're red.", "You're off and hidden, and you can't see who else is out until you slide back."]
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
