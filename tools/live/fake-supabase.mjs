// A stand-in for the Supabase web address, for testing only. It speaks the same calls the app makes
// (anonymous sign-up, password log-in, token refresh, and "run a database function") but runs them on a local test Postgres
// through psql as the `authenticated` role, so the real database rules (RLS, grants) decide every answer.
import http from 'node:http';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

const [, , sock, dbPort, listen = '54330'] = process.argv;
const KEY = 'test-anon-key';
const tokens = new Map(); // access token -> user id
const sessions = new Map(); // access or refresh token -> { sid, role }, like the session_id and role in a real token
let lastEmail = null; // the latest email code "sent", for the test to read
let ageOutcome = 'passed'; // what the pretend age check provider answers
// Like Supabase with CAPTCHA protection on: sign-up and password log-in need a fresh human-check token,
// and each token works once. The test's pretend Turnstile hands out tokens starting "fake-ts-".
const usedCaptcha = new Set();
function captchaProblem(body) {
  const t = body.gotrue_meta_security && body.gotrue_meta_security.captcha_token;
  if (!t || !String(t).startsWith('fake-ts-') || usedCaptcha.has(t)) return { error_code: 'captcha_failed', msg: 'captcha protection: request disallowed (' + (t ? 'timeout-or-duplicate' : 'no captcha response') + ')' };
  usedCaptcha.add(t);
  return null;
}

function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  // An untyped array literal, so Postgres reads it as the function's own argument type (text[], uuid[], ...), as PostgREST does.
  if (Array.isArray(v)) return lit('{' + v.map((x) => '"' + String(x).replace(/["\\]/g, '\\$&') + '"').join(',') + '}');
  return "'" + String(v).replace(/'/g, "''") + "'";
}
function psql(sql) {
  return new Promise((resolve) => {
    const p = spawn('psql', ['-X', '-q', '-tA', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-p', dbPort, '-U', 'postgres', '-d', 'postgres', '-c', sql]);
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}
// Each token gets its role from the same hook Supabase Auth would call (migration 0018), when there is one.
async function session(uid, sid = crypto.randomUUID()) {
  const access = crypto.randomUUID(), refresh = crypto.randomUUID();
  const event = JSON.stringify({ user_id: uid, claims: { sub: uid, role: 'authenticated', session_id: sid } });
  const r = await psql(`select coalesce(public.two_step_token_hook(${lit(event)}::jsonb) #>> '{claims,role}', 'authenticated')`);
  const role = r.code === 0 && r.out ? r.out : 'authenticated';
  tokens.set(access, uid); tokens.set(refresh, uid);
  sessions.set(access, { sid, role }); sessions.set(refresh, { sid, role });
  return { access_token: access, refresh_token: refresh, expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid } };
}
const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' });
  res.end(JSON.stringify(body));
};
http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  let raw = ''; for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : {};
  const url = new URL(req.url, 'http://x');
  if (req.headers.apikey !== KEY) return send(res, 401, { message: 'No API key' });
  if (url.pathname === '/auth/v1/signup') {
    const bad = captchaProblem(body); if (bad) return send(res, 400, bad);
    const uid = crypto.randomUUID();
    await psql(`insert into auth.users (id, is_anonymous) values ('${uid}', true)`);
    return send(res, 200, await session(uid));
  }
  // Username and password log-in: the same check Supabase Auth does on the stored bcrypt hash.
  if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
    const bad = captchaProblem(body); if (bad) return send(res, 400, bad);
    const r = await psql(`select id from auth.users where lower(email) = lower(${lit(body.email)}) and email_confirmed_at is not null
      and encrypted_password = extensions.crypt(${lit(body.password)}, encrypted_password)`);
    return r.out ? send(res, 200, await session(r.out)) : send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
  }
  if (url.pathname === '/auth/v1/token') {
    const uid = tokens.get(body.refresh_token);
    return uid ? send(res, 200, await session(uid, sessions.get(body.refresh_token).sid)) : send(res, 400, { message: 'Invalid Refresh Token' });
  }
  // Test-only switches for the age check: turn it on or off, and pick what the pretend provider answers.
  if (url.pathname === '/__fake/age-check') {
    if ('required' in body) await psql(`update public.app_settings set age_check_required = ${body.required ? 'true' : 'false'}`);
    if (body.outcome) ageOutcome = body.outcome;
    return send(res, 200, {});
  }
  if (url.pathname === '/__fake/last-email') return send(res, 200, lastEmail);
  // A stand-in for the email-code Edge Function: the same database call, and the "email" is kept for the test.
  if (url.pathname === '/functions/v1/email-code') {
    const token = (req.headers.authorization || '').replace('Bearer ', ''), uid = tokens.get(token);
    if (!uid) return send(res, 401, { message: 'Sign in first.' });
    if (body.action === 'recovery') {
      const r = await psql(`begin; set local role service_role; select to_jsonb(public.two_step_recovery_target(${lit(uid)}, ${lit(body.username)}, ${lit(body.code)})); commit;`);
      if (r.code !== 0) return send(res, 400, { message: (r.err.match(/ERROR:\s+(.*)/) || [, r.err])[1] });
      const lines = r.out.split('\n').filter((l) => l && l !== 'BEGIN' && l !== 'COMMIT' && l !== 'SET');
      lastEmail = { email: JSON.parse(lines[lines.length - 1]).email, recovery: body.code };
      const [name, domain] = lastEmail.email.split('@');
      return send(res, 200, { sent: true, hint: name.slice(0, 1) + '•••@' + domain });
    }
    const purpose = body.action === 'setup' ? 'setup' : 'login';
    const r = await psql(`begin; set local role service_role; select to_jsonb(public.two_step_make_code(${lit(uid)}, ${lit(sessions.get(token).sid)}, ${lit(purpose)}, ${lit(purpose === 'setup' ? body.email : null)})); commit;`);
    if (r.code !== 0) return send(res, 400, { message: (r.err.match(/ERROR:\s+(.*)/) || [, r.err])[1] });
    const lines = r.out.split('\n').filter((l) => l && l !== 'BEGIN' && l !== 'COMMIT' && l !== 'SET');
    lastEmail = JSON.parse(lines[lines.length - 1]);
    const [name, domain] = lastEmail.email.split('@');
    return send(res, 200, { sent: true, hint: name.slice(0, 1) + '•••@' + domain });
  }
  // A stand-in for the google-rating Edge Function: every venue gets the same pretend Google rating.
  if (url.pathname === '/functions/v1/google-rating') {
    if (!tokens.get((req.headers.authorization || '').replace('Bearer ', ''))) return send(res, 401, { message: 'Sign in first.' });
    return send(res, 200, { enabled: true, found: true, rating: 4.4, count: 120, url: 'https://maps.google.com/?cid=1' });
  }
  // A stand-in for the age-check Edge Function: same database calls, with a pretend provider whose
  // check page just sends the person straight back.
  if (url.pathname === '/functions/v1/age-check') {
    const uid = tokens.get((req.headers.authorization || '').replace('Bearer ', ''));
    if (!uid) return send(res, 401, { message: 'Sign in first.' });
    const svc = async (fn, args) => {
      const r = await psql(`begin; set local role service_role; select to_jsonb(public.${fn}(${Object.entries(args).map(([k, v]) => `${k} := ${lit(v)}`).join(', ')})); commit;`);
      if (r.code !== 0) throw new Error((r.err.match(/ERROR:\s+(.*)/) || [, r.err])[1]);
      const lines = r.out.split('\n').filter((l) => l && l !== 'BEGIN' && l !== 'COMMIT' && l !== 'SET');
      return JSON.parse(lines[lines.length - 1] || 'null');
    };
    try {
      if (body.action === 'start') {
        await svc('age_check_can_start', { p_user: uid });
        await svc('age_check_begin', { p_user: uid, p_provider: 'yoti', p_session: 'fake-' + crypto.randomUUID() });
        return send(res, 200, { url: String(body.return_to).split('?')[0] + '?age_check=done' });
      }
      if (body.action === 'finish') {
        const latest = await svc('age_check_latest', { p_user: uid });
        if (!latest) return send(res, 200, { result: 'none' });
        if (latest.result !== 'pending' || ageOutcome === 'pending') return send(res, 200, { result: latest.result });
        await svc('age_check_decide', { p_check: latest.id, p_result: ageOutcome, p_method: ageOutcome === 'passed' ? 'face_estimate' : null });
        return send(res, 200, { result: ageOutcome });
      }
    } catch (e) { return send(res, 400, { message: e.message }); }
    return send(res, 400, { message: 'Unknown action.' });
  }
  const m = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
  if (m) {
    const uid = tokens.get((req.headers.authorization || '').replace('Bearer ', ''));
    if (!uid) return send(res, 401, { message: 'JWT expired' });
    const args = Object.entries(body).map(([k, v]) => `${k} := ${lit(v)}`).join(', ');
    const { sid, role } = sessions.get((req.headers.authorization || '').replace('Bearer ', ''));
    const claims = JSON.stringify({ sub: uid, role, session_id: sid });
    const sql = `begin; set local role ${role}; select set_config('request.jwt.claim.sub', '${uid}', true), set_config('request.jwt.claims', ${lit(claims)}, true); select to_jsonb(public.${m[1]}(${args})); commit;`;
    const r = await psql(sql);
    if (r.code !== 0) {
      const msg = (r.err.match(/ERROR:\s+(.*)/) || [, r.err])[1];
      // Like PostgREST, a function the database doesn't have yet is a 404 with code PGRST202.
      if (/^function public\.\w+\(.*\) does not exist/.test(msg)) return send(res, 404, { code: 'PGRST202', message: 'Could not find the function public.' + m[1] + ' in the schema cache' });
      return send(res, 400, { message: msg });
    }
    const lines = r.out.split('\n').filter((l) => l && l !== 'BEGIN' && l !== 'COMMIT' && l !== 'SET');
    const json = lines[lines.length - 1];
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(json || 'null');
  }
  send(res, 404, { message: 'Not found' });
}).listen(Number(listen), '127.0.0.1', () => console.log('fake supabase on ' + listen));
