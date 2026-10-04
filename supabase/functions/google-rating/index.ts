// SeshOn Google ratings: a Supabase Edge Function.
//   POST { venue: "<venue id>" } -> { enabled: false }                       no Google key set up yet
//                                -> { enabled: true, found: false }          Google doesn't know the venue
//                                -> { enabled: true, found: true, rating, count, url }
// The person's own sign-in token must be sent as "Authorization: Bearer ...". The Google key never leaves
// this function. Google's terms allow keeping the place ID (saved on the venue) but not the rating, so
// the rating is fetched fresh every time. Each person gets at most 100 look-ups a day (migration 0016).

declare const Deno: { env: { get(name: string): string | undefined }; serve(h: (req: Request) => Promise<Response>): void };
const env = (name: string) => Deno.env.get(name);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function serviceHeaders(): Record<string, string> {
  const key = env('SUPABASE_SERVICE_ROLE_KEY') || '';
  const h: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' };
  if (key.startsWith('eyJ')) h.Authorization = 'Bearer ' + key; // older JWT-style keys also go here
  return h;
}
async function db(fn: string, args: Record<string, unknown>): Promise<any> {
  const res = await fetch(env('SUPABASE_URL') + '/rest/v1/rpc/' + fn, { method: 'POST', headers: serviceHeaders(), body: JSON.stringify(args) });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) { const err = new Error((data && data.message) || 'Database call failed.'); (err as any).shown = true; throw err; }
  return data;
}
// Who is asking: checked with Supabase Auth, never taken from the request body.
async function whoIs(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const res = await fetch(env('SUPABASE_URL') + '/auth/v1/user', {
    headers: { apikey: env('SUPABASE_ANON_KEY') || env('SUPABASE_SERVICE_ROLE_KEY') || '', Authorization: auth }
  });
  if (!res.ok) return null;
  const user = await res.json();
  return user && user.id ? String(user.id) : null;
}

const PLACES = 'https://places.googleapis.com/v1/';
// Finds the venue's Google place ID by name, inside a small box around its pin (about 300 m each way).
async function findPlace(key: string, v: { name: string; lat: number | null; lng: number | null }): Promise<string | null> {
  const body: Record<string, unknown> = { textQuery: v.name, maxResultCount: 1, regionCode: 'AU' };
  if (typeof v.lat === 'number' && typeof v.lng === 'number') {
    const d = 0.003;
    body.locationRestriction = { rectangle: { low: { latitude: v.lat - d, longitude: v.lng - d }, high: { latitude: v.lat + d, longitude: v.lng + d } } };
  } else {
    body.textQuery = v.name + ', Perth WA';
  }
  const res = await fetch(PLACES + 'places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.id' },   // IDs only: the cheapest search
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('Google search failed: ' + res.status);
  const data = await res.json();
  return data.places && data.places[0] ? String(data.places[0].id) : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return reply(204, {});
  if (req.method !== 'POST') return reply(405, { message: 'Use POST.' });
  const key = env('GOOGLE_PLACES_KEY');
  if (!key) return reply(200, { enabled: false });
  try {
    const userId = await whoIs(req);
    if (!userId) return reply(401, { message: 'Sign in first.' });
    const body = await req.json().catch(() => ({}));
    if (typeof body.venue !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.venue)) return reply(400, { message: 'Which venue?' });
    const v = await db('google_lookup_start', { p_user: userId, p_venue: body.venue });
    let place: string | null = v.place;
    if (!place) {
      place = await findPlace(key, v);
      if (!place) return reply(200, { enabled: true, found: false });
      await db('google_set_place', { p_venue: body.venue, p_place: place });
    }
    const res = await fetch(PLACES + 'places/' + encodeURIComponent(place), {
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'rating,userRatingCount,googleMapsUri' }
    });
    if (!res.ok) throw new Error('Google details failed: ' + res.status);
    const d = await res.json();
    if (typeof d.rating !== 'number') return reply(200, { enabled: true, found: false });
    return reply(200, { enabled: true, found: true, rating: d.rating, count: d.userRatingCount || 0, url: d.googleMapsUri || null });
  } catch (e) {
    console.error(e);
    return reply(200, { enabled: true, found: false, message: (e as any).shown ? (e as Error).message : undefined });
  }
});
