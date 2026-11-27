// Little native extras that came with app 1.2.0: a light buzz when you change your colour, and the shortcuts you
// get by holding the app icon (Go green, Chats). Each is looked up carefully, so an older phone build without these
// parts simply goes without (and never crashes).
import { Platform } from 'react-native';

type Haptics = typeof import('expo-haptics');
type Quick = typeof import('expo-quick-actions');
let haptics: Haptics | null = null;
let quick: Quick | null = null;
if (Platform.OS !== 'web') {
  try { haptics = require('expo-haptics'); } catch (e) { haptics = null; }
  try { quick = require('expo-quick-actions'); } catch (e) { quick = null; }
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
