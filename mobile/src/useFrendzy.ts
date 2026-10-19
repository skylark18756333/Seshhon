// Keeps the signed-in person's data for the native screens: one load at start-up, then the same five-second
// poll the web app uses, plus the few taps Home can do. Ported from load(), act() and the ACT list in docs/app.js.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { addFriendByUsername, friendPhotos, loadGates, loadState, myAccount } from './api';
import type { Colour, State } from './api';
import { POLL_MS } from './config';
import { latestRead } from './reliability';
import { currentSession, rpc, tryRememberedPhone, type ApiError } from './session';

export type Frendzy = {
  phase: 'loading' | 'ready' | 'twostep' | 'age' | 'computer' | 'failed';   // 'twostep' waits for the emailed login code, 'age' for the 18+ check; 'computer' is for venue and admin accounts, which are desktop only
  state: State | null;
  photos: Record<string, string>;
  username: string | null;
  offline: boolean;
  error: string | null;
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
export function useFrendzy(signedIn: boolean, paused?: boolean, sessionKey?: string): Frendzy {
  const [phase, setPhase] = useState<Frendzy['phase']>('loading');
  const [state, setState] = useState<State | null>(null);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [username, setUsername] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reads = useRef(latestRead());
  const polling = useRef(false);
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
    const ticket = reads.current.begin();
    try {
      const data = await loadState();
      if (!alive.current || !reads.current.current(ticket)) return;
      setState(data);
      setError(null);
      setOffline(false);
      setPhase('ready');
      if (data.me) {
        friendPhotos().then((p) => { if (alive.current && reads.current.current(ticket)) setPhotos(p); }).catch(() => {});
      }
    } catch (e) {
      const err = e as ApiError;
      if (err.signedOut || !alive.current || !reads.current.current(ticket)) return;   // the app shows the web sign-in instead
      setOffline(err.network === true);
      setError(err.message);
      setPhase((p) => (p === 'ready' ? p : 'failed'));
      if (!quiet || !err.network) say(err.message);
    }
  }, [say]);

  // Start-up: the login code and the age check have their own screens, and venue accounts are sent to a computer.
  useEffect(() => {
    alive.current = true;
    reads.current.invalidate();
    setState(null); setPhotos({}); setUsername(null); setError(null); setOffline(false);
    let cancelled = false;
    if (!signedIn) { setPhase('loading'); return () => { alive.current = false; reads.current.invalidate(); }; }
    setPhase('loading');
    loadGates().then(async (gates) => {
      if (cancelled || !alive.current) return;
      if (gates.twoStep) {
        // A phone that already confirmed an email code skips it (migration 0023); the gates are then read again.
        if (await tryRememberedPhone()) { if (!cancelled && alive.current) setTries((n) => n + 1); return; }
        if (!cancelled && alive.current) setPhase('twostep');
        return;
      }
      if (gates.role !== 'user') { setPhase('computer'); return; }   // venue and admin accounts are for frendzy.au on a computer
      if (gates.ageCheck) { setPhase('age'); return; }
      myAccount().then((a) => { if (!cancelled && alive.current) setUsername((a && a.username) || null); }).catch(() => {});
      return read(false);
    }).catch((e: ApiError) => { if (!cancelled && alive.current) { setError(e.message); setOffline(e.network === true); setPhase('failed'); } });
    return () => { cancelled = true; alive.current = false; reads.current.invalidate(); };
  }, [signedIn, sessionKey, tries, read]);

  // Taps are never dropped: if one is still running, the next waits its turn.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const waiting = useRef(0);
  const act = useCallback((fn: string, args?: Record<string, unknown>, okMsg?: string | null) => {
    const owner = currentSession();
    waiting.current += 1;
    const run = () => { if (!owner || currentSession()?.user_id !== owner.user_id) return Promise.resolve(null); reads.current.invalidate(); return rpc(fn, args || {}).then(async (result) => {
      if (okMsg) say(okMsg);
      await read(true);
      return result;
    }, (e: ApiError) => { if (!e.signedOut) say(e.message); return null; }); };
    const p = queue.current.then(run);
    queue.current = p.then(() => {}, () => {});
    return p.finally(() => { waiting.current -= 1; });
  }, [read, say]);

  // The same poll as the web app, paused while the app is in the background.
  useEffect(() => {
    if (phase !== 'ready' || !signedIn || paused) return;
    const poll = () => {
      if (polling.current || waiting.current > 0 || busy || AppState.currentState !== 'active') return;
      polling.current = true;
      read(true).finally(() => { polling.current = false; });
    };
    poll();
    const timer = setInterval(() => {
      poll();
    }, POLL_MS);
    const sub = AppState.addEventListener('change', (next) => { if (next === 'active') poll(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [phase, signedIn, paused, read, busy]);

  // Status writes wait their turn; confirmed state is read back after each write.
  const setColour = useCallback((colour: Colour) => {
    setBusy(true);
    act('set_status', { new_colour: colour }, { on: "You're green. Friends who are around can see it.", thinking: "You're amber.", off: "You're red. You're hidden." }[colour])
      .finally(() => setBusy(false));
  }, [act]);

  const answer = useCallback((friendship: string, accept: boolean) => {
    setBusy(true);
    act('answer_friend', { p_friendship: friendship, p_accept: accept }, accept ? "You're now friends." : null)
      .finally(() => setBusy(false));
  }, [act]);

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

  const acting = useCallback(() => waiting.current > 0, []);
  const refresh = useCallback(() => read(true), [read]);

  return { phase, state, photos, username, offline, error, toast, busy, setColour, answer, addFriend, retry, say, act, acting, refresh, setUsername };
}
