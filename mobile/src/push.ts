// Push notifications on the phone: asking permission, getting this phone's Expo push token, saving it against the
// account with a database function (register_push_token, migration 0035; never a direct table write), removing it on
// log out, and opening the right screen when a notification is tapped.
//
// Permission is never asked at launch. It is asked in two places: once when the walkthrough after sign-up is
// finished or skipped (askAfterTour), and from the Notifications switch on the You page. After that, each sign-in
// quietly refreshes the saved token if the permission is already granted (registerPushToken).
//
// Everything here fails quietly: without Firebase set up (google-services.json) Android cannot hand out a token;
// the app just carries on without notifications. What is sent, and to whom, is decided in the database
// (supabase/migrations/0035_push_notifications.sql) and sent by supabase/functions/push.
//
// Hooks left for later: the "home safe" nudge and favourite-venue alerts only need a new row in private.push_kinds
// (already there, not live) and a database job that queues them; the screen names a notification may open are
// listed in SCREENS below.
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { API_KEY, API_URL } from './config';
import { onBeforeSignOut, rpc, type Session } from './session';

// The screens a notification can open, and the tab each one is.
export const SCREENS: Record<string, string> = { home: 'home', sesh: 'sesh', crews: 'crews' };
const TOKEN_KEY = 'seshhon-push-token';
const ASKED_KEY = 'seshhon-push-asked';

export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

// In a browser (used only to try the screens out) there are no real pushes; a test can stand in for the phone with
// window.__SESHHON_FAKE_PUSH__ = { permission, token }.
type Fake = { permission?: PushPermission; token?: string; asked?: boolean };
function fake(): Fake | null {
  if (Platform.OS !== 'web') return null;
  const w = globalThis as { __SESHHON_FAKE_PUSH__?: Fake };
  return w.__SESHHON_FAKE_PUSH__ || null;
}

let myToken: string | null = null;

// How notifications look while the app is open, and the Android channel they arrive on (Android 13 and up will not
// even ask for permission until a channel exists). Safe to call more than once.
let ready = false;
async function setup(): Promise<void> {
  if (ready || Platform.OS === 'web') return;
  ready = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false })
    });
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'Frendzy', importance: Notifications.AndroidImportance.DEFAULT });
    }
  } catch (e) { /* no notifications on this phone */ }
}

export async function pushPermission(): Promise<PushPermission> {
  const f = fake();
  if (f) return f.permission || 'undetermined';
  if (Platform.OS === 'web') return 'unsupported';
  try {
    await setup();
    const p = await Notifications.getPermissionsAsync();
    return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
  } catch (e) { return 'unsupported'; }
}

async function fetchToken(): Promise<string | null> {
  const f = fake();
  if (f) return f.token || null;
  try {
    const extra = (Constants.expoConfig && Constants.expoConfig.extra) as { eas?: { projectId?: string } } | undefined;
    const projectId = (extra && extra.eas && extra.eas.projectId) || (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
    const t = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return t && t.data ? t.data : null;
  } catch (e) { return null; }   // for example Firebase is not set up yet
}

// Saves this phone's token against the signed-in account. Never throws.
async function save(): Promise<boolean> {
  const token = await fetchToken();
  if (!token) return false;
  try {
    await rpc('register_push_token', { p_token: token, p_platform: Platform.OS === 'ios' ? 'ios' : 'android' });
    myToken = token;
    if (Platform.OS !== 'web') SecureStore.setItemAsync(TOKEN_KEY, token).catch(() => {});
    return true;
  } catch (e) { return false; }   // an older database without migration 0035
}

// Asks for permission if it has not been decided, then saves the token. Used by the switch on the You page.
// Returns what the person should be told: 'on', 'denied' (blocked in the phone's settings) or 'unavailable'.
export async function enablePush(): Promise<'on' | 'denied' | 'unavailable'> {
  const f = fake();
  if (f) {
    if (f.permission === 'denied') return 'denied';
    f.permission = 'granted';
    return (await save()) ? 'on' : 'unavailable';
  }
  if (Platform.OS === 'web') return 'unavailable';
  try {
    await setup();
    let p = await Notifications.getPermissionsAsync();
    if (!p.granted && p.canAskAgain !== false) p = await Notifications.requestPermissionsAsync();
    if (!p.granted) return 'denied';
    return (await save()) ? 'on' : 'unavailable';
  } catch (e) { return 'unavailable'; }
}

// Called once per sign-in as soon as the native screens are up: if notifications are already allowed, refresh the
// saved token (it can change). It never asks.
export async function registerPushToken(_userId: string | null): Promise<void> {
  if ((await pushPermission()) !== 'granted') return;
  await save();
}

// Called when the walkthrough after sign-up is finished or skipped: the first, one-time moment to ask.
export async function askAfterTour(): Promise<void> {
  try {
    if (Platform.OS !== 'web') {
      if ((await SecureStore.getItemAsync(ASKED_KEY)) === '1') return;
      await SecureStore.setItemAsync(ASKED_KEY, '1');
    }
    if ((await pushPermission()) === 'undetermined') await enablePush();
  } catch (e) { /* carry on without */ }
}

// Log out: take this phone's token off the account while the sign-in is still good, so the next person on this phone
// (or nobody) is not sent the previous account's notifications. Best effort; if it fails, the next sign-in on this
// phone takes the token over, and Expo's "not registered" answer cleans up the rest.
onBeforeSignOut((s: Session) => {
  (async () => {
    let token = myToken;
    if (!token && Platform.OS !== 'web') { try { token = await SecureStore.getItemAsync(TOKEN_KEY); } catch (e) { token = null; } }
    myToken = null;
    if (Platform.OS !== 'web') SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
    if (!token) return;
    await fetch(API_URL + '/rest/v1/rpc/unregister_push_token', {
      method: 'POST',
      headers: { apikey: API_KEY, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_token: token })
    });
  })().catch(() => {});
});

// Tapping a notification: tells the app which tab to open. Also covers the tap that launched the app. Each tap is
// handled once. Returns a function that stops listening.
export function watchNotificationTaps(open: (tab: string) => void): () => void {
  if (Platform.OS === 'web') return () => {};
  const seen = new Set<string>();
  const handle = (r: Notifications.NotificationResponse | null | undefined) => {
    if (!r || r.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = r.notification.request.identifier;
    if (seen.has(id)) return;
    seen.add(id);
    const data = r.notification.request.content.data as { screen?: unknown } | undefined;
    const tab = data && typeof data.screen === 'string' ? SCREENS[data.screen] : undefined;
    open(tab || 'home');
  };
  let sub: { remove: () => void } | null = null;
  setup().then(() => {
    try {
      sub = Notifications.addNotificationResponseReceivedListener(handle);
      Promise.resolve(Notifications.getLastNotificationResponse()).then(handle, () => {});
    } catch (e) { /* no notifications on this phone */ }
  });
  return () => { if (sub) sub.remove(); };
}
