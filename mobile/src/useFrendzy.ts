// Keeps the signed-in person's data for the native screens: one load at start-up, then the same five-second
// poll the web app uses, plus the few taps Home can do. Ported from load(), act() and the ACT list in docs/app.js.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { addFriendByUsername, answerFriend, friendPhotos, loadGates, loadState, myAccount, setStatus } from './api';
import type { Colour, State } from './api';
import { POLL_MS } from './config';
import { rpc, type ApiError } from './session';

export type Frendzy = {
  phase: 'loading' | 'ready' | 'web' | 'failed';   // 'web' when only the packed web app can handle this account
  state: State | null;
  photos: Record<string, string>;
  username: string | null;
  offline: boolean;
  toast: string | null;
  busy: boolean;
  setColour: (c: Colour) => void;
  answer: (friendship: string, accept: boolean) => void;
  addFriend: (username: string) => Promise<boolean>;
  retry: () => void;
  say: (message: string) => void;
  // A tap that calls a database function, like act() in docs/app.js: taps wait their turn, the result is
  // said in a toast (or the error is), everything is read again, and the answer comes back (null if it failed).
  act: (fn: string, args?: Record<string, unknown>, okMsg?: string | null) => Promise<any>;
  acting: () => boolean;   // true while a tap is still running, so the chat poll waits as on the web
  refresh: () => Promise<void>;
  setUsername: (username: string | null) => void;   // the You page changed it
};

// paused: the packed web page is on screen and looking after itself, so the native poll waits.
export function useFrendzy(signedIn: boolean, paused?: boolean): Frendzy {
  const [phase, setPhase] = useState<Frendzy['phase']>('loading');
  const [state, setState] = useState<State | null>(null);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [username, setUsername] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tries, setTries] = useState(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const say = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3600);
  }, []);

  // One quiet read of everything the screen shows. Nothing is wiped when the phone is briefly offline.
  const read = useCallback(async (quiet: boolean) => {
    try {
      const data = await loadState();
      if (!alive.current) return;
      setState(data);
      setOffline(false);
      setPhase('ready');
      if (data.me) {
        friendPhotos().then((p) => { if (alive.current) setPhotos(p); });
      }
    } catch (e) {
      const err = e as ApiError;
      if (err.signedOut || !alive.current) return;   // the app shows the web sign-in instead
      setOffline(true);
      setPhase((p) => (p === 'ready' ? p : 'failed'));
      if (!quiet) say(err.message);
    }
  }, [say]);

  // Start-up: the rare screens the native side doesn't have (login code, age check, venue accounts) go to the web app.
  useEffect(() => {
    alive.current = true;
    if (!signedIn) { setPhase('loading'); return () => { alive.current = false; }; }
    setPhase('loading');
    loadGates().then((gates) => {
      if (!alive.current) return;
      if (gates.twoStep || gates.ageCheck || gates.role !== 'user') { setPhase('web'); return; }
      myAccount().then((a) => { if (alive.current) setUsername((a && a.username) || null); });
      return read(false);
    }, () => { if (alive.current) setPhase('failed'); });
    return () => { alive.current = false; };
  }, [signedIn, tries, read]);

  // The same poll as the web app, paused while the app is in the background.
  useEffect(() => {
    if (phase !== 'ready' || !signedIn || paused) return;
    read(true);   // whatever happened while the page was open, or while the app was away
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') read(true);
    }, POLL_MS);
    const sub = AppState.addEventListener('change', (next) => { if (next === 'active') read(true); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [phase, signedIn, paused, read]);

  // Your status. The switch moves straight away, then the database is told, as the web app does.
  const setColour = useCallback((colour: Colour) => {
    setState((old) => (old && old.me ? { ...old, me: { ...old.me, colour, expires_at: colour === 'off' ? null : old.me.expires_at } } : old));
    setBusy(true);
    setStatus(colour).then(() => {
      say({ on: "You're green. Friends who are around can see it.", thinking: "You're amber.", off: "You're red. You're hidden." }[colour]);
      return read(true);
    }, (e: ApiError) => { if (!e.signedOut) say(e.message); return read(true); }).then(() => setBusy(false));
  }, [read, say]);

  const answer = useCallback((friendship: string, accept: boolean) => {
    setBusy(true);
    answerFriend(friendship, accept).then(() => {
      if (accept) say("You're now friends.");
      return read(true);
    }, (e: ApiError) => { if (!e.signedOut) say(e.message); }).then(() => setBusy(false));
  }, [read, say]);

  const addFriend = useCallback(async (name: string) => {
    try {
      const r = await addFriendByUsername(name);
      if (!r || !r.ok) { say((r && r.message) || "That didn't work. Try again."); return false; }
      say(r.state === 'accepted' ? 'You and ' + r.name + ' are now friends.'
        : r.state === 'requested' ? 'Friend request sent to ' + r.name + '.' : 'You and ' + r.name + ' are already friends.');
      await read(true);
      return true;
    } catch (e) {
      const err = e as ApiError;
      say(err.missing ? 'Adding by username needs a database update. Send your invite link for now.' : err.message);
      return false;
    }
  }, [read, say]);

  const retry = useCallback(() => setTries((n) => n + 1), []);

  // Taps are never dropped: if one is still running, the next waits its turn.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const waiting = useRef(0);
  const act = useCallback((fn: string, args?: Record<string, unknown>, okMsg?: string | null) => {
    waiting.current += 1;
    const run = () => rpc(fn, args || {}).then(async (result) => {
      if (okMsg) say(okMsg);
      await read(true);
      return result;
    }, (e: ApiError) => { if (!e.signedOut) say(e.message); return null; });
    const p = queue.current.then(run);
    queue.current = p.then(() => {}, () => {});
    return p.then((result) => { waiting.current -= 1; return result; });
  }, [read, say]);
  const acting = useCallback(() => waiting.current > 0, []);
  const refresh = useCallback(() => read(true), [read]);

  return { phase, state, photos, username, offline, toast, busy, setColour, answer, addFriend, retry, say, act, acting, refresh, setUsername };
}
