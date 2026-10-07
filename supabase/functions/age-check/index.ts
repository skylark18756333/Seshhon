// Seshhon age check: a Supabase Edge Function.
//   POST { action: "start", return_to }  -> { url }      send the person to the provider's check page
//   POST { action: "finish" }            -> { result }   after they come back: passed, failed or pending
// The person's own sign-in token must be sent as "Authorization: Bearer ...". The provider keys never
// leave this function, and only the outcome is written to the database (see migration 0005).
import { pickReturnUrl, provider } from './providers.ts';

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

// Runs one of the age_check_* database functions as the service role.
async function db(fn: string, args: Record<string, unknown>): Promise<any> {
  const res = await fetch(env('SUPABASE_URL') + '/rest/v1/rpc/' + fn, { method: 'POST', headers: serviceHeaders(), body: JSON.stringify(args) });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error((data && data.message) || 'Database call failed.');
    (err as any).shown = true; // these messages are written for people (e.g. "Too many age check attempts today")
    throw err;
  }
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });   // a 204 can't have a body
  if (req.method !== 'POST') return reply(405, { message: 'Use POST.' });
  try {
    const userId = await whoIs(req);
    if (!userId) return reply(401, { message: 'Sign in first.' });
    const body = await req.json().catch(() => ({}));

    if (body.action === 'start') {
      const { provider: name } = await db('age_check_can_start', { p_user: userId });
      const p = provider(name, env);
      const { session, url } = await p.start(userId, pickReturnUrl(env, body.return_to));
      await db('age_check_begin', { p_user: userId, p_provider: name, p_session: session });
      return reply(200, { url });
    }

    if (body.action === 'finish') {
      const latest = await db('age_check_latest', { p_user: userId });
      if (!latest) return reply(200, { result: 'none' });
      if (latest.result !== 'pending') return reply(200, { result: latest.result });
      const p = provider(latest.provider, env);
      const outcome = await p.result(latest.provider_session, userId);
      if (outcome.result === 'pending') return reply(200, { result: 'pending' });
      if (outcome.reason) console.log('age check', latest.id, outcome.result, outcome.reason);
      await db('age_check_decide', { p_check: latest.id, p_result: outcome.result, p_method: outcome.method });
      await p.purge(latest.provider_session);
      return reply(200, { result: outcome.result });
    }

    return reply(400, { message: 'Unknown action.' });
  } catch (e) {
    console.error('age check error', e);
    const shown = e && (e as any).shown;
    const msg = e instanceof Error && (shown || /not set up yet/.test(e.message)) ? e.message : 'The age check is not working right now. Try again soon.';
    return reply(shown ? 400 : 500, { message: msg });
  }
});
