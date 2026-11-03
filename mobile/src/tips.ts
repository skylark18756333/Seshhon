// First-use tips: the first time someone taps a button (or first sees a part of a screen), a short tip lights it up
// and says what it does. Each tip is shown once per phone, and "Show tips again" on the You page brings them back.
//
// All the words live here, keyed by a tip id. To put a tip on a button, wrap it in <Tip id="..."> (see Tip.tsx)
// with an id from this list. When a button moves or is redesigned, move the <Tip> with it and change the words
// here; nothing else needs to know. A tip id that isn't listed below simply shows nothing.
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export type TipCopy = { title: string; body: string; go?: string };

export const TIPS: Record<string, TipCopy> = {
  /* ---------- seen on arriving (TipSpot), they don't wait for a tap ---------- */
  'home-switch': { title: 'Your switch', body: "Drag the glowing circle, or tap a light. Green: you're keen to go out. Amber: you're thinking about it, and only friends you allow see it. Red: you're off and hidden. Green and amber go back to red by themselves later." },
  'sesh-card': { title: "You're in a sesh", body: 'This card is the sesh: who\'s in, the newest chat line and the crawl. Tap Chat, Vote, Crawl or More along the bottom. When it ends, its chat and votes are deleted.' },

  /* ---------- the tab bar and the header ---------- */
  'tab-map': { title: 'The Map', body: 'Venues around you on a radar. Pick how far you\'ll go with the km buttons, swipe the cards along the bottom, and tap a pin for hours, ratings and deals.', go: 'Open the Map' },
  'tab-events': { title: "What's on", body: 'Real gigs, comedy and food events near you. Tap one for the details and a link to tickets.', go: 'Show events' },
  // Ready for the thumb dock (bottom bar with the status orb in the middle and Chats): wrap those buttons with these ids.
  'tab-chats': { title: 'Chats', body: 'Your messages and tonight\'s sesh chat in one place. Friend chats are locked end to end and deleted once read or after 7 days.', go: 'Open chats' },
  'dock-status': { title: 'Your status orb', body: "Tap it to change your status. Green: you're keen to go out. Amber: you're thinking about it, and only friends you allow see it. Red: you're off and hidden.", go: 'Change it' },
  'top-friends': { title: 'Your friends', body: 'Everyone you\'ve added, as a wall of photos lit in their colour. Add people by username, send your invite link, or set up crews and besties.', go: 'Open friends' },
  'top-messages': { title: 'Messages', body: 'Private chats with one friend at a time. They\'re locked end to end and deleted once read or after 7 days. Tonight\'s sesh chat sits at the top.', go: 'Open messages' },
  'top-you': { title: 'You', body: 'Your photo, username, look, safety settings and badges. This tour and these tips are there too.', go: 'Open my page' },

  /* ---------- the party lobby on Home (not in a sesh) ---------- */
  'lobby-now': { title: 'Go now', body: 'Start a sesh right now. You go green, and friends on green and amber can join and help pick a spot.', go: "Let's go" },
  'lobby-crawl': { title: 'Crewzy crawl', body: 'A few spots a short walk apart. Everyone in the sesh sees the route on the Sesh Map and ticks off each stop.', go: 'Plan a crawl' },
  'lobby-plan': { title: 'Plan for later', body: 'Pick a day in the next 2 weeks, a time and who to invite. It shows up under Coming up, and you can start it early.', go: 'Plan one' },
  'lobby-private': { title: 'Invite only', body: 'Only the friends you pick can see this sesh and join it. Nobody else knows it\'s on.', go: 'Pick friends' },
  'lobby-events': { title: "What's on", body: 'Jumps to the Events tab: gigs, comedy and food events near you to build a night around.', go: 'Show events' },
  'lobby-crews': { title: 'Crew catch-up', body: 'See when your crews are free and plan something that suits everyone.', go: 'Open crews' },
  'lobby-seat': { title: 'Fill your seats', body: 'Pick friends for a private sesh. Hosting earns you XP for each friend who joins.', go: 'Pick friends' },
  'join-sesh': { title: 'Join a sesh', body: 'Hop into a friend\'s sesh to chat, vote on where to go and follow the crawl.', go: 'Join' },

  /* ---------- in a sesh ---------- */
  'sesh-chat': { title: 'Sesh chat', body: 'Everyone in the sesh, one chat. It\'s deleted when the sesh ends.' },
  'sesh-where': { title: 'Where to', body: 'Vote for a spot, or see the one that\'s locked in. The starter can lock the winner.' },
  'sesh-crawl': { title: 'The crawl', body: 'The stops in order. Add them from the Map and tick each one off as you go.' },
  'sesh-more': { title: 'More', body: 'The pres address, inviting more friends, reporting and leaving.' },
  'sesh-end': { title: 'End the sesh', body: 'This ends it for everyone, and its chat and votes are deleted straight away.', go: 'End it' },

  /* ---------- the Map ---------- */
  'map-mode': { title: 'Around me or Middle', body: 'Around me shows venues near you. Middle shows spots halfway between everyone in your sesh who chooses to share a rough area. Nobody\'s exact spot is shown.' },
  'map-km': { title: 'How far', body: 'Sets the size of the radar circle. Venues inside it show on the map and in the cards.' },
  'map-filter': { title: 'Show only', body: 'Narrow the map down to one kind of place. Tap it again to show everything.' },

  /* ---------- Friends ---------- */
  'friend-tile': { title: 'A friend\'s profile', body: 'Their level, badges and status. Message them or invite them to a sesh from there.', go: 'Open profile' },
  'friends-crews': { title: 'Crews and besties', body: 'Group friends into crews, and pick besties who can always see your amber.', go: 'Open crews' },
  'friends-invite': { title: 'Invite link', body: 'Send your own link. Whoever opens it becomes your friend once you accept.', go: 'Send it' }
};

/* ---------- which tips this phone has already seen ---------- */
const SEEN_KEY = 'crewzy-tips-seen';
const OFF_KEY = 'crewzy-tips-off';

function read(key: string): string | null {
  try {
    if (Platform.OS === 'web') return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    return SecureStore.getItem(key);
  } catch (e) { return null; }
}
function write(key: string, text: string | null) {
  try {
    if (Platform.OS === 'web') {
      if (typeof localStorage === 'undefined') return;
      if (text === null) localStorage.removeItem(key); else localStorage.setItem(key, text);
      return;
    }
    if (text === null) SecureStore.deleteItemAsync(key).catch(() => {});
    else SecureStore.setItemAsync(key, text).catch(() => {});
  } catch (e) {}
}

let seen: Record<string, 1> = (() => {
  try { const p = JSON.parse(read(SEEN_KEY) || '{}'); return p && typeof p === 'object' ? p : {}; } catch (e) { return {}; }
})();
let off = read(OFF_KEY) === '1';

export function tipsOn(): boolean { return !off; }
export function tipSeen(id: string): boolean { return off || !TIPS[id] || !!seen[id]; }
export function markSeen(id: string) {
  if (seen[id]) return;
  seen = { ...seen, [id]: 1 };
  write(SEEN_KEY, JSON.stringify(seen));
}
// "Turn off tips" on a tip: none show again until "Show tips again".
export function turnOffTips() { off = true; write(OFF_KEY, '1'); close(false); queue.length = 0; emit(); }
// "Show tips again" on the You page.
export function resetTips() { seen = {}; off = false; write(SEEN_KEY, null); write(OFF_KEY, null); emit(); }

/* ---------- the tip on show, one at a time ---------- */
export type Rect = { x: number; y: number; w: number; h: number };
// go: what the button would have done; it runs when the tip's button or the lit-up button is tapped.
export type Showing = { id: string; rect: Rect; go?: () => void };

let showing: Showing | null = null;
const queue: Showing[] = [];
let paused = 0;   // the walkthrough is open: tips wait until it closes
const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
export function onTips(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; }
export function currentTip(): Showing | null { return paused ? null : showing; }
export function tipsPaused(): boolean { return paused > 0; }

export function showTip(s: Showing) {
  if (tipSeen(s.id)) { if (s.go) s.go(); return; }
  if (showing && showing.id === s.id) return;
  if (queue.some((q) => q.id === s.id)) return;
  // Something else is on show (or the walkthrough is open): a tapped button just does its thing, a tip seen on
  // arriving waits its turn.
  if (showing || paused) { if (s.go) s.go(); else queue.push(s); return; }
  showing = s;
  emit();
}
// The tip is closed: run says whether to carry on with what the button does.
export function close(run: boolean) {
  const s = showing;
  if (!s) return;
  markSeen(s.id);
  showing = null;
  if (run && s.go) s.go();
  emit();
  // The next waiting tip, a moment later so the screen can settle.
  setTimeout(next, 350);
}
function next() {
  while (queue.length && !showing && !paused) {
    const n = queue.shift() as Showing;
    if (!tipSeen(n.id)) showing = n;
  }
  emit();
}
export function pauseTips(on: boolean) {
  paused = Math.max(0, paused + (on ? 1 : -1));
  if (!paused) setTimeout(next, 600); else emit();
}
// A tip that waits on arriving went off screen (its screen was left) before it could show.
export function dropTip(id: string) {
  const i = queue.findIndex((q) => q.id === id);
  if (i >= 0) queue.splice(i, 1);
  if (showing && showing.id === id && !showing.go) { showing = null; emit(); }
}
