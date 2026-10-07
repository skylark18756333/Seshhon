// Frendzy push notifications: a Supabase Edge Function that sends the notifications waiting in the database
// (private.push_queue, migration 0035) through Expo's push service. The database decides who is allowed to get what
// (blocks, hidden status, women-only mode, per-type switches); this function only delivers.
//   POST (any body) with the header "x-push-secret: <PUSH_SECRET>"  ->  { sent, dead }
// It is poked by the database right after something is queued (pg_net), and once a minute by pg_cron.
//
// Deploy WITHOUT the sign-in check, because the caller is the database, not a signed-in person:
//   supabase functions deploy push --no-verify-jwt
// Secrets (Edge Functions > Secrets):
//   PUSH_SECRET        a long random text; the same one you give private.set_push_config() in the SQL editor
//   EXPO_ACCESS_TOKEN  optional: an Expo access token, only needed if "Enhanced Security for Push Notifications" is on
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase itself.

declare const Deno: { env: { get(name: string): string | undefined }; serve(h: (req: Request) => Promise<Response>): void };
const env = (name: string) => Deno.env.get(name);

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function serviceHeaders(): Record<string, string> {
  const key = env('SUPABASE_SERVICE_ROLE_KEY') || '';
  const h: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' };
  if (key.startsWith('eyJ')) h.Authorization = 'Bearer ' + key;
  return h;
}
async function db(fn: string, args: Record<string, unknown>): Promise<any> {
  const res = await fetch(env('SUPABASE_URL') + '/rest/v1/rpc/' + fn, { method: 'POST', headers: serviceHeaders(), body: JSON.stringify(args) });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.message) || 'Database call failed.');
  return data;
}
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type Item = { id: number; title: string; body: string; data: Record<string, unknown>; tokens: string[] };

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { message: 'Use POST.' });
  const secret = env('PUSH_SECRET') || '';
  if (secret.length < 16) return reply(503, { message: 'Push notifications are not set up yet.' });
  if (!same(req.headers.get('x-push-secret') || '', secret)) return reply(401, { message: 'Not allowed.' });
  let sent = 0;
  const dead: string[] = [];
  try {
    // Up to 5 rounds of 50, so one call can never run for long; the next poke carries on.
    for (let round = 0; round < 5; round++) {
      const items: Item[] = await db('push_take', { p_limit: 50 });
      if (!items.length) break;
      const messages: Record<string, unknown>[] = [];
      const owners: number[] = [];
      for (const it of items) {
        for (const to of it.tokens) {
          messages.push({ to, title: it.title, body: it.body, data: it.data, channelId: 'default', priority: 'high' });
          owners.push(it.id);
        }
      }
      const finished = new Set<number>(items.map((i) => i.id));
      for (let i = 0; i < messages.length; i += 100) {
        const chunk = messages.slice(i, i + 100);
        const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
        if (env('EXPO_ACCESS_TOKEN')) headers.Authorization = 'Bearer ' + env('EXPO_ACCESS_TOKEN');
        const res = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers, body: JSON.stringify(chunk) });
        if (!res.ok) {
          // Expo is down or refused: leave these queued; they are offered again after 2 minutes (3 tries).
          for (let j = i; j < i + chunk.length; j++) finished.delete(owners[j]);
          continue;
        }
        const tickets = ((await res.json()).data || []) as { status: string; details?: { error?: string } }[];
        tickets.forEach((t, j) => {
          if (t.status === 'ok') sent++;
          else if (t.details && t.details.error === 'DeviceNotRegistered') dead.push(chunk[j].to as string);
        });
      }
      await db('push_finish', { p_done: [...finished], p_dead_tokens: dead });
    }
  } catch (e) {
    return reply(500, { message: 'Could not send: ' + (e as Error).message.slice(0, 200) });
  }
  return reply(200, { sent, dead: dead.length });
});
