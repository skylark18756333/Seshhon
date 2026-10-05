// What the database sends back, and the handful of calls the native Home screen makes.
// The shapes match api_state() in supabase/update.sql, which is what docs/app.js reads.
import { rpc } from './session';

export type Colour = 'on' | 'thinking' | 'off';

export type Me = { id: string; name: string; invite_code: string; colour: Colour; expires_at: string | null };
export type Friend = { friendship: string; id: string; name: string; colour: Colour; since: string | null };
export type Request = { friendship: string; name: string };
export type Sesh = { id: string; am_member: boolean; planned?: boolean; starts_at?: string | null; locked_venue?: string | null };

export type State = {
  now: string;
  me: Me | null;
  friends: Friend[];
  requests_in: Request[];
  requests_out: Request[];
  seshes: Sesh[];
};

// Every list a screen reads is always a list, even if the database leaves one out (an update not run yet),
// so one missing piece can't stop the screen. Same idea as tidyState in docs/app.js.
function tidy(data: any): State {
  const out: State = {
    now: (data && data.now) || new Date().toISOString(),
    me: (data && data.me) || null,
    friends: [],
    requests_in: [],
    requests_out: [],
    seshes: []
  };
  (['friends', 'requests_in', 'requests_out', 'seshes'] as const).forEach((k) => {
    if (data && Array.isArray(data[k])) (out as any)[k] = data[k];
  });
  return out;
}

export function loadState(): Promise<State> {
  return rpc('api_state').then(tidy);
}

export function setStatus(colour: Colour): Promise<unknown> {
  return rpc('set_status', { new_colour: colour });
}

export function answerFriend(friendship: string, accept: boolean): Promise<unknown> {
  return rpc('answer_friend', { p_friendship: friendship, p_accept: accept });
}

export function addFriendByUsername(username: string): Promise<{ ok: boolean; message?: string; state?: string; name?: string }> {
  return rpc('request_friend_by_username', { p_username: username });
}

// Friends' photos, when they added one and you're allowed to see it: { user id: picture address }.
export function friendPhotos(): Promise<Record<string, string>> {
  return rpc('friend_photos').then((p: any) => (p && typeof p === 'object' ? p : {}), () => ({}));
}

// Your username, shown in the "add your friends" card. An older database has no such function.
export function myAccount(): Promise<{ username?: string } | null> {
  return rpc('my_account').then((a: any) => a || null, () => null);
}

// The three things that have to be settled before the native screens can be shown. When any of them says
// "not yet" the packed web app takes over, because it has the screens for them (and they are rare).
export type Gates = { twoStep: boolean; ageCheck: boolean; role: string };
export function loadGates(): Promise<Gates> {
  return Promise.all([
    rpc('two_step_state').then((t: any) => !!(t && t.needed), () => false),
    rpc('age_check_state').then((a: any) => !!(a && a.required && !a.passed), () => false),
    rpc('my_role').then((r: any) => (r && r.role) || 'user', () => 'user')
  ]).then(([twoStep, ageCheck, role]) => ({ twoStep, ageCheck, role }));
}
