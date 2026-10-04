// A stand-in for the Supabase web address, for testing only. It speaks the same calls the app makes
// (anonymous sign-up, password log-in, token refresh, and "run a database function") but runs them on a local test Postgres
// through psql as the `authenticated` role, so the real database rules (RLS, grants) decide every answer.
import http from 'node:http';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

const [, , sock, dbPort, listen = '54330'] = process.argv;
const KEY = 'test-anon-key';
const tokens = new Map(); // access token -> user id
let ageOutcome = 'passed'; // what the pretend age check provider answers

function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return 'array[' + v.map(lit).join(',') + ']::text[]';
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
function session(uid) {
  const access = crypto.randomUUID(), refresh = crypto.randomUUID();
  tokens.set(access, uid); tokens.set(refresh, uid);
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
    const uid = crypto.randomUUID();
    await psql(`insert into auth.users (id, is_anonymous) values ('${uid}', true)`);
    return send(res, 200, session(uid));
  }
  // Username and password log-in: the same check Supabase Auth does on the stored bcrypt hash.
  if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
    const r = await psql(`select id from auth.users where lower(email) = lower(${lit(body.email)}) and email_confirmed_at is not null
      and encrypted_password = extensions.crypt(${lit(body.password)}, encrypted_password)`);
    return r.out ? send(res, 200, session(r.out)) : send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
  }
  if (url.pathname === '/auth/v1/token') {
    const uid = tokens.get(body.refresh_token);
    return uid ? send(res, 200, session(uid)) : send(res, 400, { message: 'Invalid Refresh Token' });
  }
  // Test-only switches for the age check: turn it on or off, and pick what the pretend provider answers.
  if (url.pathname === '/__fake/age-check') {
    if ('required' in body) await psql(`update public.app_settings set age_check_required = ${body.required ? 'true' : 'false'}`);
    if (body.outcome) ageOutcome = body.outcome;
    return send(res, 200, {});
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
        await svc('age_check_begin', { p_user: uid, p_provider: 'didit', p_session: 'fake-' + crypto.randomUUID() });
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
    const sql = `begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${uid}', true); select to_jsonb(public.${m[1]}(${args})); commit;`;
    const r = await psql(sql);
    if (r.code !== 0) {
      const msg = (r.err.match(/ERROR:\s+(.*)/) || [, r.err])[1];
      return send(res, 400, { message: msg });
    }
    const lines = r.out.split('\n').filter((l) => l && l !== 'BEGIN' && l !== 'COMMIT' && l !== 'SET');
    const json = lines[lines.length - 1];
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(json || 'null');
  }
  send(res, 404, { message: 'Not found' });
}).listen(Number(listen), '127.0.0.1', () => console.log('fake supabase on ' + listen));
