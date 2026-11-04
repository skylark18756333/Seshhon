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

  /* ---------- the tab bar and the header ---------- */
  'tab-map': { title: 'The Map', body: 'Venues around you on a radar. Pick how far you\'ll go with the km buttons, swipe the cards along the bottom, and tap a pin for hours, ratings and deals.', go: 'Open the Map' },
  'tab-events': { title: "What's on", body: 'Real gigs, comedy and food events near you. Tap one for the details and a link to tickets.', go: 'Show events' },
  // Ready for the thumb dock (bottom bar with the status orb in the middle and Chats): (Chats is the 'messages' tab.)
  'tab-messages': { title: 'Chats', body: 'Your messages and tonight\'s sesh chat in one place. Friend chats are locked end to end and deleted once read or after 7 days.', go: 'Open chats' },
  'dock-status': { title: 'Your status orb', body: "Tap it to change your status. Green: you're keen to go out. Amber: you're thinking about it, and only friends you allow see it. Red: you're off and hidden.", go: 'Change it' },
  'top-friends': { title: 'Your friends', body: 'Everyone you\'ve added, as a wall of photos lit in their colour. Add people by username, send your invite link, or set up crews and besties.', go: 'Open friends' },
  'top-you': { title: 'You', body: 'Your photo, username, look, safety settings and badges. This tour and these tips are there too.', go: 'Open my page' },

  /* ---------- the party lobby on Home (not in a sesh) ---------- */
  'lobby-now': { title: 'Start a sesh now', body: 'Your sesh starts straight away, then you and your friends vote on where to go. You go green, and friends on green and amber can join.', go: "Let's go" },
  'lobby-crawl': { title: 'Crewzy crawl', body: 'A few spots a short walk apart. Everyone in the sesh sees the route on the Sesh Map and ticks off each stop.', go: 'Plan a crawl' },
  'lobby-plan': { title: 'Plan for later', body: 'Pick a day on your calendar, a time and who to invite. It shows up under Coming up, and you can start it early.', go: 'Plan one' },
  'lobby-private': { title: 'Invite only', body: 'Only the friends you pick can see this sesh and join it. Nobody else knows it\'s on.', go: 'Pick friends' },
  'lobby-events': { title: "What's on", body: 'Jumps to the Events tab: gigs, comedy and food events near you to build a night around.', go: 'Show events' },
  'lobby-crews': { title: 'Crew catch-up', body: 'See when your crews are free and plan something that suits everyone.', go: 'Open crews' },
  'lobby-seat': { title: 'Fill your seats', body: 'Pick friends for a private sesh. Hosting earns you XP for each friend who joins.', go: 'Pick friends' },
  'join-sesh': { title: 'Join a sesh', body: 'Hop into a friend\'s sesh to chat, vote on where to go and follow the crawl.', go: 'Join' },


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
// step: set when the tip is a step of "Show me around" (see the guide below).
export type Showing = { id: string; rect: Rect; go?: () => void; step?: { n: number; total: number; title: string; body: string; tap: boolean } };

let showing: Showing | null = null;
const queue: Showing[] = [];
let paused = 0;   // the walkthrough is open: tips wait until it closes
const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
export function onTips(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; }
export function currentTip(): Showing | null { return paused ? null : showing; }
export function tipsPaused(): boolean { return paused > 0; }

export function showTip(s: Showing) {
  if (guide) { if (s.go) s.go(); return; }   // the run-through is on: buttons just work
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
  if (s.step) { showing = null; if (run && s.go) s.go(); emit(); if (guide) { guide.at++; setTimeout(runGuide, s.step.tap && run ? 900 : 250); } return; }
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

/* ---------- "Show me around": a run-through on the real screens ---------- */
// Every <Tip> and <TipSpot> on screen is an anchor for its id. The run-through lights up one anchor after another
// and says what it does; on a "tap" step tapping the lit-up button (or "Try it") does the real thing, so you move
// round the app as you go. A step whose button isn't on screen (say the lobby, while you're in a sesh) is skipped.
export type Anchor = { measure: (done: (r: Rect | null) => void) => void; go?: () => void };
const anchors: Record<string, Set<Anchor>> = {};
export function addAnchor(id: string, a: Anchor): () => void {
  (anchors[id] = anchors[id] || new Set()).add(a);
  return () => { anchors[id].delete(a); };
}

type GuideStep = { id: string; title: string; body: string; tap?: boolean };
const GUIDE: GuideStep[] = [
  { id: 'dock-status', title: 'Your status orb', body: "This glowing orb is you. Tap it and red, amber and green pop up, or push it sideways. Green: keen to go out. Amber: thinking about it. Red: off and hidden. It's on every screen." },
  { id: 'lobby-now', title: 'Start a sesh now', body: 'Your sesh starts straight away, then you and your friends vote on where to go. Friends on green and amber can jump in.' },
  { id: 'lobby-crawl', title: 'Crewzy crawl', body: 'Plan a few spots a short walk apart. Everyone sees the route and ticks off each stop.' },
  { id: 'lobby-plan', title: 'Plan for later', body: 'Pick a day on the calendar, a time and who to invite.' },
  { id: 'lobby-seat', title: 'Fill your seats', body: 'Tap a seat to pick friends for an invite-only sesh. Hosting earns XP for every friend who joins.' },
  { id: 'top-friends', title: 'Your friends', body: 'Tap here to see everyone you\'ve added.', tap: true },
  { id: 'friends-invite', title: 'Invite link', body: 'Send your link to a mate. Once you accept, they\'re on your wall.' },
  { id: 'friend-tile', title: 'A friend', body: 'Tap any face for their profile, badges and level, and to message or invite them.' },
  { id: 'friends-crews', title: 'Crews and besties', body: 'Group your mates into crews, and pick besties who always see your amber.' },
  { id: 'tab-map', title: 'The Map', body: 'Tap the Map to find somewhere to go.', tap: true },
  { id: 'map-km', title: 'How far', body: 'Set the radar circle: 1, 2, 5 km and more. Venues inside it show on the map and in the cards at the bottom.' },
  { id: 'map-mode', title: 'Around me or Middle', body: 'Middle finds spots halfway between your crew in a sesh. Nobody\'s exact spot is ever shown.' },
  { id: 'map-filter', title: 'Show only', body: 'Narrow it to places open now, popular or trending. Tap a pin on the map for hours, ratings and deals.' },
  { id: 'tab-events', title: "What's on", body: 'Tap Events for gigs, comedy and food near you.', tap: true },
  { id: 'tab-messages', title: 'Chats', body: 'Tap Chats for your messages and tonight\'s sesh chat. Friend chats are locked and deleted once read or after 7 days.', tap: true },
  { id: 'tab-home', title: 'Back home', body: 'Tap Home to get back to your lobby.', tap: true },
  { id: 'top-you', title: "That's the tour", body: 'Your page has your photo, look, safety settings and badges. Run this again any time from How Crewzy works. Have a good night out!' }
];
let guide: { at: number; tries: number } | null = null;
export function guideOn(): boolean { return !!guide; }
export function startGuide() {
  showing = null; queue.length = 0;
  guide = { at: 0, tries: 0 };
  emit();
  setTimeout(runGuide, 500);
}
export function endGuide() { guide = null; showing = null; emit(); }
function runGuide() {
  if (!guide) return;
  if (paused) { setTimeout(runGuide, 500); return; }
  const at = guide.at;
  if (at >= GUIDE.length) { endGuide(); return; }
  const step = GUIDE[at];
  const list = Array.from(anchors[step.id] || []);
  let left = list.length, found: { a: Anchor; r: Rect } | null = null;
  const settle = () => {
    if (!guide || guide.at !== at) return;
    if (found) {
      guide.tries = 0;
      showing = { id: step.id, rect: found.r, go: step.tap ? found.a.go : undefined,
        step: { n: at + 1, total: GUIDE.length, title: step.title, body: step.body, tap: !!step.tap && !!found.a.go } };
      emit();
    } else if (guide.tries++ < 6) setTimeout(runGuide, 300);   // the screen may still be drawing
    else { guide.tries = 0; guide.at++; runGuide(); }             // not on this screen: skip it
  };
  if (!left) { settle(); return; }
  list.forEach((a) => a.measure((r) => {
    if (r && !found && r.y + r.h > 0 && r.x + r.w > 0) found = { a, r };
    if (--left === 0) settle();
  }));
}
