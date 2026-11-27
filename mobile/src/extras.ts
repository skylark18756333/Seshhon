// Little native extras that came with app 1.2.0: a light buzz when you change your colour, and the shortcuts you
// get by holding the app icon (Go green, Chats). Each is looked up carefully, so an older phone build without these
// parts simply goes without (and never crashes).
import { Platform } from 'react-native';

type Haptics = typeof import('expo-haptics');
type Quick = typeof import('expo-quick-actions');
type Sensors = typeof import('expo-sensors');
let haptics: Haptics | null = null;
let quick: Quick | null = null;
let sensors: Sensors | null = null;
if (Platform.OS !== 'web') {
  try { haptics = require('expo-haptics'); } catch (e) { haptics = null; }
  try { quick = require('expo-quick-actions'); } catch (e) { quick = null; }
  try { sensors = require('expo-sensors'); } catch (e) { sensors = null; }
}

// A short tap on the phone's motor. Green gets a happy double, red a firm single, amber a light one.
export function buzz(colour: 'on' | 'thinking' | 'off') {
  if (!haptics) return;
  try {
    if (colour === 'on') haptics.notificationAsync(haptics.NotificationFeedbackType.Success).catch(() => {});
    else if (colour === 'off') haptics.impactAsync(haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    else haptics.selectionAsync().catch(() => {});
  } catch (e) { /* no motor */ }
}

// Hold the app icon: Go green, Chats. onPick gets 'green' or 'chats', including for the hold that opened the app.
export function watchShortcuts(onPick: (id: string) => void): () => void {
  if (!quick) return () => {};
  let sub: { remove: () => void } | null = null;
  try {
    quick.setItems([
      { id: 'green', title: 'Go green', icon: null, params: null },
      { id: 'chats', title: 'Chats', icon: null, params: null }
    ]).catch(() => {});
    if (quick.initial && quick.initial.id) onPick(quick.initial.id);
    sub = quick.addListener((a) => { if (a && a.id) onPick(a.id); });
  } catch (e) { /* not on this phone */ }
  return () => { if (sub) sub.remove(); };
}

// Bump to add (app 1.3.0): true when this phone can feel a knock. Older builds fall back to a Bump button.
export const canFeelKnock = !!sensors;

// Calls onKnock when the phone is knocked against another (a sharp jolt, then quiet for a second so one knock
// isn't counted twice). Returns a function that stops listening.
export function watchKnock(onKnock: () => void): () => void {
  if (!sensors) return () => {};
  let sub: { remove: () => void } | null = null;
  let last = 0;
  try {
    sensors.Accelerometer.setUpdateInterval(20);
    sub = sensors.Accelerometer.addListener(({ x, y, z }) => {
      const g = Math.sqrt(x * x + y * y + z * z);
      const now = Date.now();
      if (g > 2.3 && now - last > 1200) { last = now; onKnock(); }
    });
  } catch (e) { sub = null; }
  return () => { if (sub) sub.remove(); };
}

// A firm double tap when a bump is felt or a friend is matched.
export function thud() {
  if (!haptics) return;
  try { haptics.impactAsync(haptics.ImpactFeedbackStyle.Heavy).catch(() => {}); } catch (e) { /* no motor */ }
}
