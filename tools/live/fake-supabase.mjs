// A stand-in for the Supabase web address, for testing only. It speaks the same three calls the app makes
// (anonymous sign-up, token refresh, and "run a database function") but runs them on a local test Postgres
// through psql as the `authenticated` role, so the real database rules (RLS, grants) decide every answer.
import http from 'node:http';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

const [, , sock, dbPort, listen = '54330'] = process.argv;
const KEY = 'test-anon-key';
const tokens = new Map(); // access token -> user id

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
    await psql(`insert into auth.users (id) values ('${uid}')`);
    return send(res, 200, session(uid));
  }
  if (url.pathname === '/auth/v1/token') {
    const uid = tokens.get(body.refresh_token);
    return uid ? send(res, 200, session(uid)) : send(res, 400, { message: 'Invalid Refresh Token' });
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
