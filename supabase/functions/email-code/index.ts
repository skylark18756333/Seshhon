// Frenzy email codes: a Supabase Edge Function that emails the 6-digit login codes (migration 0018).
//   POST { action: "setup", email: "you@example.com" } -> { sent: true, hint }   confirm a new login email
//   POST { action: "login" }                           -> { sent: true, hint }   a code for this login
// The person's own sign-in token must be sent as "Authorization: Bearer ...". The database makes the code
// and keeps only its hash; this function just sends it. The email service key never leaves this function.
//
// Secrets (Edge Functions > Secrets):
//   BREVO_API_KEY or RESEND_API_KEY   one email service's API key
//   EMAIL_FROM                        the sender address that service has verified, e.g. frenzy.codes@gmail.com

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
// Who is asking, and which sign-in: checked with Supabase Auth, never taken from the request body.
async function whoIs(req: Request): Promise<{ user: string; session: string | null } | null> {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const res = await fetch(env('SUPABASE_URL') + '/auth/v1/user', {
    headers: { apikey: env('SUPABASE_ANON_KEY') || env('SUPABASE_SERVICE_ROLE_KEY') || '', Authorization: auth }
  });
  if (!res.ok) return null;
  const user = await res.json();
  if (!user || !user.id) return null;
  // Supabase Auth accepted this token, so its session ID can be read straight from it.
  let session: string | null = null;
  try {
    const part = auth.slice(7).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(part + '==='.slice((part.length + 3) % 4)));
    if (claims.sub === user.id && typeof claims.session_id === 'string') session = claims.session_id;
  } catch (_) { /* no session ID */ }
  return { user: String(user.id), session };
}

function message(code: string, purpose: string) {
  const subject = purpose === 'setup' ? 'Confirm your email for Frenzy' : 'Your Frenzy login code';
  const intro = purpose === 'setup' ? 'Type this code in Frenzy to confirm your email:' : 'Type this code in Frenzy to finish logging in:';
  const outro = 'It works for 10 minutes. If this wasn\'t you, ignore this email. Nobody can log in without this code.';
  return {
    subject,
    text: intro + '\n\n' + code + '\n\n' + outro,
    html: '<p>' + intro + '</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">' + code + '</p><p>' + outro + '</p>'
  };
}
async function send(to: string, code: string, purpose: string): Promise<void> {
  const from = env('EMAIL_FROM') || '';
  const m = message(code, purpose);
  let res: Response;
  if (env('BREVO_API_KEY')) {
    res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env('BREVO_API_KEY')!, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: { name: 'Frenzy', email: from }, to: [{ email: to }], subject: m.subject, textContent: m.text, htmlContent: m.html })
    });
  } else {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env('RESEND_API_KEY'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Frenzy <' + from + '>', to: [to], subject: m.subject, text: m.text, html: m.html })
    });
  }
  if (!res.ok) throw new Error('Email service said ' + res.status + ': ' + (await res.text()).slice(0, 200));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return reply(204, {});
  if (req.method !== 'POST') return reply(405, { message: 'Use POST.' });
  if (!(env('BREVO_API_KEY') || env('RESEND_API_KEY')) || !env('EMAIL_FROM')) {
    return reply(503, { message: 'Email codes aren\'t set up yet. Try again later.' });
  }
  try {
    const who = await whoIs(req);
    if (!who) return reply(401, { message: 'Sign in first.' });
    const body = await req.json().catch(() => ({}));
    const purpose = body.action === 'setup' ? 'setup' : body.action === 'login' ? 'login' : null;
    if (!purpose) return reply(400, { message: 'Which code?' });
    if (purpose === 'setup' && (typeof body.email !== 'string' || body.email.length > 254)) return reply(400, { message: 'Enter a real email address.' });
    const made = await db('two_step_make_code', { p_user: who.user, p_session: who.session, p_purpose: purpose, p_email: purpose === 'setup' ? body.email : null });
    await send(made.email, made.code, purpose);
    const [name, domain] = String(made.email).split('@');
    return reply(200, { sent: true, hint: name.slice(0, 1) + '•••@' + domain });
  } catch (e) {
    console.error(e);
    return reply(400, { message: (e as any).shown ? (e as Error).message : 'The email could not be sent. Try again soon.' });
  }
});
