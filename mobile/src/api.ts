// What the database sends back, and the handful of calls the native Home screen makes.
// The shapes match api_state() in supabase/update.sql, which is what docs/app.js reads.
import { rpc } from './session';

export type Colour = 'on' | 'thinking' | 'off';

export type Me = { id: string; name: string; invite_code: string; colour: Colour; expires_at: string | null };
export type Friend = { friendship: string; id: string; name: string; colour: Colour; since: string | null };
export type Request = { friendship: string; name: string };
export type Member = { id: string; name: string };
export type Vote = { user_id: string; venue_id: string; voted_at: string };
// The private pres address (migration 0025). address is left out until 4 hours before, except for the host.
export type Pres = { address?: string | null; at?: string | null; shows_at: string };
export type Sesh = {
  id: string;
  am_member: boolean;
  mine?: boolean;
  creator_name?: string;
  private?: boolean;
  planned?: boolean;
  starts_at?: string | null;
  locked_venue?: string | null;
  pres?: Pres | null;
  invited?: string[] | null;
  members: Member[];
  votes: Vote[];
};
// A sesh chat message, as get_messages() sends it.
export type Message = { id: string; sender: string; name: string; body: string; at: string };
// One stop of the Sesh Map (pub crawl), as sesh_crawl() sends it.
export type CrawlStop = { venue_id: string; position: number; done: boolean; mine: boolean };
// A venue, as api_venues() sends it.
export type Venue = { id: string; name: string; kind?: string | null; closes?: string | null; hours?: string | null; is_example?: boolean };

// Someone you blocked (blocked_list), shown on the You page so you can unblock them.
export type Blocked = { id: string; name: string };

export type State = {
  now: string;
  me: Me | null;
  friends: Friend[];
  requests_in: Request[];
  requests_out: Request[];
  seshes: Sesh[];
  blocked: Blocked[];
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
    seshes: [],
    blocked: []
  };
  (['friends', 'requests_in', 'requests_out', 'seshes', 'blocked'] as const).forEach((k) => {
    if (data && Array.isArray(data[k])) (out as any)[k] = data[k];
  });
  out.seshes.forEach((s) => {
    if (!Array.isArray(s.members)) s.members = [];
    if (!Array.isArray(s.votes)) s.votes = [];
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

// The three things that have to be settled before the native screens can be shown: the email login code, the
// 18+ age check and what kind of account this is (venue and admin accounts are for frendzy.au on a computer).
export type Gates = { twoStep: boolean; ageCheck: boolean; role: string };
export function loadGates(): Promise<Gates> {
  return Promise.all([
    rpc('two_step_state').then((t: any) => !!(t && t.needed), () => false),
    rpc('age_check_state').then((a: any) => !!(a && a.required && !a.passed), () => false),
    rpc('my_role').then((r: any) => (r && r.role) || 'user', () => 'user')
  ]).then(([twoStep, ageCheck, role]) => ({ twoStep, ageCheck, role }));
}
// Whether this person still needs the age check, and who runs it (loadAge in docs/app.js). An older database without it means "no".
export type Age = { required: boolean; passed?: boolean; pending?: boolean; provider?: string };
export function loadAge(): Promise<Age> {
  return rpc('age_check_state').then((a: any) => a || { required: false }, () => ({ required: false }));
}

/* ---------- the Sesh tab ---------- */
// The chat of a sesh you're in: up to the last 200 messages, oldest first, without anyone blocked either way.
export function getMessages(sesh: string): Promise<Message[]> {
  return rpc('get_messages', { p_sesh: sesh }).then((l: any) => (Array.isArray(l) ? l : []));
}
export function sendMessage(sesh: string, body: string): Promise<unknown> {
  return rpc('send_message', { p_sesh: sesh, p_body: body });
}
export function reportMessage(message: string): Promise<unknown> {
  return rpc('report_message', { p_message: message, p_reason: '' });
}
// The Sesh Map's stops in order. 'missing' (an older database without it) is passed on so the tab can hide it.
export function seshCrawl(sesh: string): Promise<CrawlStop[]> {
  return rpc('sesh_crawl', { p_sesh: sesh }).then((l: any) => (Array.isArray(l) ? l : []));
}
// Every venue (api_venues) and where each one is (venue_pins). Fetched on their own, like the web app does.
export function loadVenues(): Promise<Venue[]> {
  return rpc('api_venues').then((l: any) => (Array.isArray(l) ? l : []));
}
export function loadPins(): Promise<Record<string, [number, number]>> {
  return rpc('venue_pins').then((l: any) => {
    const pins: Record<string, [number, number]> = {};
    (Array.isArray(l) ? l : []).forEach((p: any) => { pins[p.id] = [Number(p.lat), Number(p.lng)]; });
    return pins;
  });
}

/* ---------- the You page ---------- */
// Each of these is 'off' when the database is older than the feature, and the You page then leaves it out,
// as loadAccount, loadSafety and loadRole in docs/app.js do.
export type Account = { username: string; email?: string | null; pending_email?: string | null };
export type Safety = { gender: string | null; women_only: boolean };
export type Claim = { status: string; venue_name: string; note?: string | null };
export type Role = { role: string; claim?: Claim | null };
export function loadAccount(): Promise<Account | null | 'off'> {
  return rpc('my_account').then((a: any) => a || null, () => 'off' as const);
}
export function loadSafety(): Promise<Safety | 'off'> {
  return rpc('my_safety').then((sf: any) => sf || { gender: null, women_only: false }, () => 'off' as const);
}
export function loadRole(): Promise<Role | 'off'> {
  return rpc('my_role').then((r: any) => r || { role: 'user' }, () => 'off' as const);
}
// Whether login codes by email are switched on in this database (emailsOn in docs/app.js).
export function loadEmailsOn(): Promise<boolean> {
  return rpc('two_step_state').then(() => true, () => false);
}

/* ---------- crews, besties and free time (migration 0031) ---------- */
export type Share = 'off' | 'week' | 'exact';
export type Suggest = 'off' | 'weekly' | 'enough';
export type ShareSettings = { share: Share; hangouts: string[]; suggest: Suggest; min: number; quiet: number[] };
export type CrewMember = { id: string; name: string; state: 'member' | 'invited'; week: boolean | null };
export type Crew = { id: string; name: string; mine: boolean; state: 'member' | 'invited'; invited_by: string; settings: ShareSettings; members: CrewMember[] };
// state: 'accepted', 'out' (I asked, waiting) or 'in' (they asked me).
export type Bestie = { id: string; name: string; state: 'accepted' | 'out' | 'in'; settings: ShareSettings; week: boolean | null };
export type CrewsState = { today: string; besties: Bestie[]; crews: Crew[] };
export type FreeTime = { today: string; days: { day: string; free: string[] }[]; pattern: string[] };
// A suggestion card: enough of a crew (or a bestie and me) are free in the same slot.
export type CatchUp = { kind: 'crew' | 'bestie'; target: string; label: string; day: string; part: string; free: number; of: number; hangouts: string[]; names: string[] };

const NO_SETTINGS: ShareSettings = { share: 'off', hangouts: [], suggest: 'off', min: 3, quiet: [] };
function tidySettings(s: any): ShareSettings {
  return { ...NO_SETTINGS, ...(s && typeof s === 'object' ? s : {}), hangouts: Array.isArray(s && s.hangouts) ? s.hangouts : [], quiet: Array.isArray(s && s.quiet) ? s.quiet : [] };
}
// 'off' when the database is older than the feature (migration 0031 not run yet): the screens then say so.
export function loadCrews(): Promise<CrewsState | 'off'> {
  return rpc('crews_state').then((d: any) => ({
    today: (d && d.today) || '',
    besties: ((d && d.besties) || []).map((b: Bestie) => ({ ...b, settings: tidySettings(b.settings) })),
    crews: ((d && d.crews) || []).map((c: Crew) => ({ ...c, settings: tidySettings(c.settings), members: Array.isArray(c.members) ? c.members : [] }))
  }), () => 'off' as const);
}
export function loadFreeTime(): Promise<FreeTime | null> {
  return rpc('my_free_time').then((d: any) => (d && Array.isArray(d.days) ? { today: d.today, days: d.days, pattern: Array.isArray(d.pattern) ? d.pattern : [] } : null), () => null);
}
export function loadCatchUps(): Promise<CatchUp[]> {
  return rpc('catch_up_suggestions').then((l: any) => (Array.isArray(l) ? l : []), () => []);
}

/* ---------- notifications (migration 0035) ---------- */
export type PushKind = { kind: string; label: string; hint: string; on: boolean };
export type PushSettings = { registered: boolean; kinds: PushKind[] };
// 'off' when the database is older than the feature: the You page then leaves the Notifications section out.
export function loadPushSettings(): Promise<PushSettings | 'off'> {
  return rpc('my_push_settings').then((d: any) => ({ registered: !!(d && d.registered), kinds: d && Array.isArray(d.kinds) ? d.kinds : [] }), () => 'off' as const);
}
export function setPushSetting(kind: string, on: boolean): Promise<PushSettings> {
  return rpc('set_push_setting', { p_kind: kind, p_enabled: on }).then((d: any) => ({ registered: !!(d && d.registered), kinds: d && Array.isArray(d.kinds) ? d.kinds : [] }));
}
