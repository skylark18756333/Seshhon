// The sign-in and the two ways of talking to the database, ported from docs/app.js.
// The app owns the sign-in: it is kept in the phone's secure storage (expo-secure-store), handed to the packed
// web page before the page's own scripts run, and saved again whenever the page says it changed (sign-up,
// login, refresh, log out). The web page keeps its copy in localStorage under the same key.
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { API_KEY, API_URL } from './config';

export const SESSION_KEY = 'seshhon-session-v1';
// Other things the web page keeps in its own storage that the native screens also change (see pageStore below).
export const DEVICE_KEY = 'seshhon-remembered-phone';   // per account: the secret that lets this phone skip the email code
export const LAST_USER_KEY = 'seshhon-last-username';    // filled in on the login screen next time
export const TOUR_KEY = 'seshhon-tour-pending';          // the walkthrough still to show after sign-up
export const PAGE_KEYS = [DEVICE_KEY, LAST_USER_KEY, TOUR_KEY];
const PAGE_STORE_KEY = 'seshhon-page-store';

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
async function readStored(key = SESSION_KEY): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    return await SecureStore.getItemAsync(key);
  } catch (e) { return null; }
}
function writeStored(text: string | null, key = SESSION_KEY) {
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

/* ---------- the web page's other stored things ---------- */
// The native You page does things the web page used to do itself: it remembers this phone after an email
// code (so the next login on it skips the code), notes the username for the login screen, and on log out or
// delete clears the walkthrough flag, the username and the remembered phone. Those live in the web page's own
// storage, which the native side can't reach directly. So the app keeps its own copy here (in secure
// storage, as the remembered-phone token is a secret), hands it to the page before the page's scripts run,
// and the page reports back whenever it changes one itself.
// A value is the exact text the page keeps (JSON), or null for "not there". A key the app has never heard
// about is left as the page has it. The remembered phones are per account, so they are merged instead of
// replaced: an account set to null here is taken off the page's list.
let pageStore: Record<string, string | null> = {};
async function loadPageStore() {
  const text = await readStored(PAGE_STORE_KEY);
  try { const p = text ? JSON.parse(text) : null; pageStore = p && typeof p === 'object' ? p : {}; } catch (e) { pageStore = {}; }
}
function savePageStore() { writeStored(JSON.stringify(pageStore), PAGE_STORE_KEY); }
// The page said it changed one of these itself (sign-up, login, the walkthrough).
export function pageStored(key: string, value: string | null) {
  if (PAGE_KEYS.indexOf(key) < 0) return;
  pageStore[key] = value;
  savePageStore();
}
function setPageValue(key: string, value: unknown) {
  pageStore[key] = value === null || value === undefined ? null : JSON.stringify(value);
  savePageStore();
}
export function rememberUsername(username: string | null) { setPageValue(LAST_USER_KEY, username); }
export function clearTour() { setPageValue(TOUR_KEY, null); }
function phones(): Record<string, string | null> {
  try { const p = JSON.parse(pageStore[DEVICE_KEY] || 'null'); return p && typeof p === 'object' ? p : {}; } catch (e) { return {}; }
}
export function forgetPhone(userId: string) {
  const all = phones();
  all[userId] = null;
  pageStore[DEVICE_KEY] = JSON.stringify(all);
  savePageStore();
}
// rememberPhone in docs/app.js: after the email code, this phone keeps a secret that skips the code for 30 days.
export function rememberPhone(): Promise<void> {
  const uid = session && session.user_id;
  if (!uid) return Promise.resolve();
  return rpc<string | null>('two_step_remember_device').then((token) => {
    const all = phones();
    all[uid] = token || null;
    pageStore[DEVICE_KEY] = JSON.stringify(all);
    savePageStore();
  }, () => {});   // an older database without it: the code is just asked for next time
}
// The script that puts the app's copy into the page's storage, before the page's own scripts run.
export function pageStoreScript(): string {
  const lines: string[] = [];
  Object.keys(pageStore).forEach((key) => {
    if (PAGE_KEYS.indexOf(key) < 0) return;
    const value = pageStore[key];
    if (key === DEVICE_KEY && value !== null) {
      lines.push(`(function () { var mine = {}, all = {}; try { mine = JSON.parse(${JSON.stringify(value)}) || {}; } catch (e) {} try { all = JSON.parse(localStorage.getItem(${JSON.stringify(key)}) || '{}') || {}; } catch (e) {}
    for (var k in mine) { if (mine[k]) all[k] = mine[k]; else delete all[k]; }
    localStorage.setItem(${JSON.stringify(key)}, JSON.stringify(all)); })();`);
    } else if (value === null) lines.push(`localStorage.removeItem(${JSON.stringify(key)});`);
    else lines.push(`localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)});`);
  });
  return lines.join('\n    ');
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
  await loadPageStore();
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

// Login codes are emailed by the email-code Edge Function, which holds the email service key (emailCode in docs/app.js).
export async function emailCode(action: string, extra?: Record<string, unknown>): Promise<{ sent?: boolean; hint?: string }> {
  if (session && session.expires_at - Date.now() / 1000 < 60) await refreshSession();
  if (!session) throw new Error('You have been signed out.');
  const res = await fetch(API_URL + '/functions/v1/email-code', {
    method: 'POST',
    headers: { apikey: API_KEY, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...(extra || {}) })
  });
  let json: any = null;
  try { json = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error((json && json.message) || 'The email could not be sent. Try again soon.');
  return json || {};
}
