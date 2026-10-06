// The sign-in and the two ways of talking to the database, ported from docs/app.js.
// The app owns the sign-in: it is kept in the phone's secure storage (expo-secure-store), handed to the packed
// web page before the page's own scripts run, and saved again whenever the page says it changed (sign-up,
// login, refresh, log out). The web page keeps its copy in localStorage under the same key.
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { API_KEY, API_URL } from './config';

export const SESSION_KEY = 'seshhon-session-v1';

export type Session = {
  access_token: string;
  refresh_token: string;
  expires_at: number;   // seconds since 1970, the way Supabase gives it
  user_id: string | null;
};

// An error from the database or from signing in, with the extra marks the screens look at.
export type ApiError = Error & { status?: number; code?: string; signedOut?: boolean; missing?: boolean };

/* ---------- where the sign-in is kept ---------- */
// The phone keeps it in secure storage. In a browser (Expo's web target, used for trying the screens out)
// there is no secure storage, so it sits in localStorage, the same place the web app keeps it.
async function readStored(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return typeof localStorage === 'undefined' ? null : localStorage.getItem(SESSION_KEY);
    return await SecureStore.getItemAsync(SESSION_KEY);
  } catch (e) { return null; }
}
function writeStored(text: string | null) {
  try {
    if (Platform.OS === 'web') {
      if (typeof localStorage === 'undefined') return;
      if (text === null) localStorage.removeItem(SESSION_KEY); else localStorage.setItem(SESSION_KEY, text);
      return;
    }
    if (text === null) SecureStore.deleteItemAsync(SESSION_KEY).catch(() => {});
    else SecureStore.setItemAsync(SESSION_KEY, text).catch(() => {});
  } catch (e) {}
}
function tidy(value: unknown): Session | null {
  const s = value as Session | null;
  if (!s || typeof s !== 'object' || !s.access_token || !s.refresh_token) return null;
  return {
    access_token: String(s.access_token),
    refresh_token: String(s.refresh_token),
    expires_at: Number(s.expires_at) || 0,
    user_id: s.user_id ? String(s.user_id) : null
  };
}

let session: Session | null = null;
let refreshing: Promise<void> | null = null;
const watchers = new Set<(s: Session | null) => void>();

export function currentSession(): Session | null { return session; }
export function onSessionChange(fn: (s: Session | null) => void): () => void {
  watchers.add(fn);
  return () => { watchers.delete(fn); };
}
function tell() { watchers.forEach((fn) => fn(session)); }

// Read the sign-in off the phone at start-up.
export async function loadStoredSession(): Promise<Session | null> {
  const text = await readStored();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (e) {}
  session = tidy(parsed);
  tell();
  return session;
}
// A sign-in the web page sent over, or a log out (null).
export function setSession(next: Session | null) {
  session = tidy(next);
  writeStored(session ? JSON.stringify(session) : null);
  tell();
}
// What the sign-in looks like to the web page: the exact text it would have put in localStorage itself.
export function sessionForPage(): string | null {
  return session ? JSON.stringify(session) : null;
}
// Keeps the sign-in from an auth answer, like saveSession in docs/app.js.
function saveSession(body: any): Session {
  if (!body || !body.access_token) throw new Error('Sign-in did not work. Try again.');
  setSession({
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: body.expires_at || Math.floor(Date.now() / 1000) + (body.expires_in || 3600),
    user_id: (body.user && body.user.id) || (session && session.user_id) || null
  });
  return session as Session;
}

/* ---------- talking to the database ---------- */
export async function authCall(path: string, body: unknown): Promise<any> {
  const res = await fetch(API_URL + '/auth/v1/' + path, {
    method: 'POST',
    headers: { apikey: API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) {}
  if (!res.ok) {
    const msg: string = (json && (json.msg || json.message || json.error_description)) || 'Sign-in did not work. Try again.';
    const err: ApiError = new Error(msg);
    err.status = res.status;
    err.code = (json && (json.error_code || json.error)) || '';
    throw err;
  }
  return json;
}

export function refreshSession(): Promise<void> {
  if (!refreshing) {
    const token = session ? session.refresh_token : '';
    refreshing = authCall('token?grant_type=refresh_token', { refresh_token: token })
      .then((body) => { saveSession(body); })
      .catch((e: ApiError) => {
        // A refresh token that is refused means this phone's sign-in is gone for good.
        if (e.status === 400 || e.status === 401 || e.status === 403) setSession(null);
        throw e;
      })
      .then(() => { refreshing = null; }, (e) => { refreshing = null; throw e; });
  }
  return refreshing;
}

// Calls a database function, exactly as the web app does: apikey plus the sign-in token, retried once after a refresh.
export async function rpc<T = any>(fn: string, args?: Record<string, unknown>, retried?: boolean): Promise<T> {
  if (session && session.expires_at - Date.now() / 1000 < 60) await refreshSession();
  if (!session) {
    const gone: ApiError = new Error('You have been signed out.');
    gone.signedOut = true;
    throw gone;
  }
  const res = await fetch(API_URL + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { apikey: API_KEY, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {})
  });
  if (res.status === 401 && !retried) {
    await refreshSession();
    return rpc<T>(fn, args, true);
  }
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) {}
  if (!res.ok && json && json.code === 'PGRST202') {
    // The database is missing a function this app calls: an update in supabase/ has not been run yet.
    const old: ApiError = new Error('Frendzy is being updated. Try again soon.');
    old.missing = true;
    throw old;
  }
  if (!res.ok) throw new Error((json && json.message) || 'Something went wrong. Try again.');
  return json as T;
}
