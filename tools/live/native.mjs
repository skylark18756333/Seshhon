// Tries the phone app's native screens in a browser, against a local stand-in database with the real rules.
// Phone builds can't be made here, so the screens are built for Expo's web target instead (react-native-web)
// and driven with Playwright. It starts the test database and the fake Supabase from tools/live, signs up a
// handful of people in the web app so there are real friends with real statuses, then opens the native Home
// as one of them and takes pictures. It also checks the web half the app packs in: that it opens on the tab
// the app asks for, switches tabs when the app says so, and tells the app when the sign-in changes.
// Run: node tools/live/native.mjs [output folder]   (needs PostgreSQL 15+ and Playwright's Chromium)
import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../..');
const out = path.resolve(process.argv[2] || 'native-screens');
fs.mkdirSync(out, { recursive: true });
const API = 'http://127.0.0.1:54340', WEB_PORT = 54341, NATIVE_PORT = 54342;

// The native screens, built for the browser. The addresses go in at build time (EXPO_PUBLIC_...).
const dist = fs.mkdtempSync('/tmp/frendzy-native-web-');
execSync(`CI=1 EXPO_PUBLIC_API_URL=http://127.0.0.1:54340 EXPO_PUBLIC_API_KEY=test-anon-key npx expo export --platform web --output-dir ${dist} --clear`,
  { cwd: path.join(root, 'mobile'), stdio: 'inherit' });

const copy = fs.mkdtempSync('/tmp/sb-native-');
execSync(`cp -r ${root}/supabase ${copy}/ && chmod -R a+rX ${copy} && chmod a+rx ${copy}`);
const setup = execSync(`ONLY_SETUP=1 PG_PORT=54339 bash ${copy}/supabase/tests/run.sh`, { encoding: 'utf8' });
const [, sock, dbPort] = setup.match(/socket dir (\S+) port (\d+)/);
const api = spawn('node', [path.join(here, 'fake-supabase.mjs'), sock, dbPort, '54340'], { stdio: 'inherit' });
const psql = (q) => execSync(`psql -X -q -t -h ${sock} -p ${dbPort} -U postgres -d postgres -c "${q}"`, { encoding: 'utf8' }).trim();

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const web = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/config.js') { res.setHeader('Content-Type', 'text/javascript');
    return res.end(fs.readFileSync(path.join(root, 'docs/config.js'), 'utf8').replace(/url: '[^']*'/, `url: '${API}'`).replace(/key: '[^']*'/, "key: 'test-anon-key'").replace(/pollMs: \d+/, 'pollMs: 600').replace(/captchaSiteKey: '[^']*'/, "captchaSiteKey: 'test-site-key'")); }
  const f = path.join(root, 'docs', p === '/' ? 'index.html' : p);
  if (f === path.join(root, 'docs/index.html')) {
    const live = fs.readFileSync(path.join(root, 'docs/config.js'), 'utf8').match(/url: '([^']*)'/)[1];
    res.setHeader('Content-Type', 'text/html'); return res.end(fs.readFileSync(f, 'utf8').replace('connect-src ' + live + ';', 'connect-src ' + API + ';'));
  }
  if (!f.startsWith(path.join(root, 'docs')) || !fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream'); res.end(fs.readFileSync(f));
}).listen(WEB_PORT);
// The exported native bundle (npx expo export --platform web).
const nativeWeb = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const f = path.join(dist, p === '/' ? 'index.html' : p);
  if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream'); res.end(fs.readFileSync(f));
}).listen(NATIVE_PORT);
await new Promise((r) => setTimeout(r, 800));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
async function phone(name, url, init) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'Australia/Perth' });
  if (init) await ctx.addInitScript(init);
  // A pretend Cloudflare Turnstile at the real address, as tools/live/check.mjs uses: it hands out a
  // one-time token a moment after it appears, so the stand-in database accepts the sign-up.
  await ctx.route(/challenges\.cloudflare\.com\/turnstile/, (r) => r.fulfill({ contentType: 'text/javascript', body: `(() => {
    const w = {}; let n = 0, k = 0;
    const issue = (id) => setTimeout(() => { const x = w[id]; if (x && x.el.isConnected) x.opts.callback('fake-ts-' + Date.now() + '-' + (++k)); }, 150);
    window.turnstile = {
      render(el, opts) { const id = 'w' + (++n); w[id] = { el, opts }; el.innerHTML = '<div>Human check</div>'; issue(id); return id; },
      reset(id) { if (w[id]) issue(id); },
      remove(id) { delete w[id]; }
    };
  })();` }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(name + ' page error: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log(name + ' console: ' + m.text()); });
  page.on('response', (r) => { if (!r.ok() && r.url().includes('54340')) console.log(name + ' http ' + r.status() + ' ' + r.url()); });
  await page.goto(url);
  return { name, ctx, page };
}
const has = async (p, s, t = 8000) => {
  try { await p.page.waitForFunction((x) => document.body.innerText.toLowerCase().includes(x.toLowerCase()), s, { timeout: t }); }
  catch (e) { console.log(p.name + ' never showed "' + s + '". On screen:\n' + (await p.page.evaluate(() => document.body.innerText))); throw e; }
};
const tap = (p, label) => p.page.getByRole('button', { name: label, exact: true }).first().click();
async function join(p, name, dob) {
  const u = name.toLowerCase();
  await p.page.fill('#name', name); await p.page.fill('#dob', dob);
  await p.page.fill('#join-user', u + '_test'); await p.page.fill('#join-pass', 'longenough1'); await p.page.fill('#join-email', u + '@example.com');
  await tap(p, 'Get started');
  await has(p, 'Confirm your email'); await tap(p, 'Later');
  await has(p, 'Save your recovery code'); await tap(p, "I've saved it");
  await has(p, 'Your status');
  // Skip the walkthrough that opens after sign-up: it sits over the screen and would swallow taps.
  await p.page.evaluate(() => localStorage.removeItem('seshhon-tour-pending'));
  await p.page.reload();
  await has(p, 'Your status');
}
const shot = async (p, file) => { await p.page.waitForTimeout(600); await p.page.screenshot({ path: path.join(out, file) }); console.log('  saved ' + file); };

try {
  // A test user with friends, made through the real sign-up in the web app.
  const ana = await phone('Ana', `http://127.0.0.1:${WEB_PORT}/`);
  await has(ana, 'Get started');
  await join(ana, 'Ana', '1995-04-12');
  const code = psql("select invite_code from public.profiles where name = 'Ana'");
  const link = '?invite=' + code;
  for (const [name, colour] of [['Jack', 'Green'], ['Mia', 'Amber'], ['Tom', 'Green'], ['Zoe', 'Red']]) {
    const f = await phone(name, `http://127.0.0.1:${WEB_PORT}/` + link);
    await join(f, name, '1996-05-06');
    await has(ana, 'wants to add you'); await tap(ana, 'Accept');
    if (colour !== 'Red') await tap(f, colour);
    await f.ctx.close();
  }
  await tap(ana, 'Green');
  await has(ana, 'Up for it now');
  const session = await ana.page.evaluate(() => localStorage.getItem('seshhon-session-v1'));
  console.log('web app signed in: ' + (session ? 'yes' : 'no'));

  // The native screens, signed in as Ana by putting the app's sign-in where the app keeps it in a browser.
  const nat = await phone('native', `http://127.0.0.1:${NATIVE_PORT}/`, `localStorage.setItem('seshhon-session-v1', ${JSON.stringify(session)});`);
  await has(nat, "You're green.");
  await has(nat, 'Up for it now');
  console.log('native Home text:\n' + (await nat.page.evaluate(() => document.body.innerText)).replace(/^/gm, '    '));
  await shot(nat, '1-home-green.png');

  // Changing status must go to the same database function the web app calls.
  await nat.page.getByRole('button', { name: 'Amber', exact: true }).first().click();
  await has(nat, "You're amber.");
  await nat.page.waitForTimeout(800);
  console.log('status in the database after tapping Amber: ' + psql("select colour from public.statuses s join public.profiles p on p.id = s.user_id where p.name = 'Ana'"));
  await shot(nat, '2-home-amber.png');
  await nat.page.getByRole('button', { name: 'Red', exact: true }).first().click();
  await has(nat, "You're red.");
  await shot(nat, '3-home-red.png');
  console.log('status in the database after tapping Red: ' + psql("select coalesce((select colour::text from public.statuses s join public.profiles p on p.id = s.user_id where p.name = 'Ana' and s.expires_at > now() and s.colour <> 'off'), 'off')"));
  await nat.page.getByRole('button', { name: 'Green', exact: true }).first().click();
  await has(nat, "You're green.");
  // The other tabs open the packed web app; in a browser the WebView itself can't run, so this only shows the bar.
  await nat.page.getByRole('tab', { name: 'Map' }).click();
  await shot(nat, '4-tab-map.png');
  console.log('after tapping Map: ' + (await nat.page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | '));
  // The web half inside the app: it starts on the tab the app asks for, tells the app when the sign-in
  // changes, and switches tabs when the app says so. The app itself is stubbed, as a WebView can't run here.
  const inApp = await phone('in-app', `http://127.0.0.1:${WEB_PORT}/`, `
    window.__posted = [];
    window.ReactNativeWebView = { postMessage: function (m) { window.__posted.push(JSON.parse(m)); } };
    window.SESHHON_TAB = 'map';
    localStorage.setItem('seshhon-session-v1', ${JSON.stringify(session)});
  `);
  await has(inApp, 'How far');
  console.log('page opened on the tab the app asked for: ' + (await inApp.page.evaluate(() => !!document.querySelector('nav button[data-v="map"][aria-current="page"]'))));
  await inApp.page.evaluate(() => window.FrendzyNative.go('venues'));
  await has(inApp, 'Venues');
  console.log('page switched tab when the app asked: ' + (await inApp.page.evaluate(() => !!document.querySelector('nav button[data-v="venues"][aria-current="page"]'))));
  // Storing anything else must not send the app a message, and the page says once that it is past sign-up.
  const posted = await inApp.page.evaluate(() => { localStorage.setItem('seshhon-not-the-session', '1'); return window.__posted.map((m) => m.type); });
  console.log('messages so far (only the "past sign-up" one): ' + JSON.stringify(posted));
  // Log out from the You page, which clears the sign-in: the app must be told.
  await inApp.page.evaluate(() => { window.__posted = []; });
  await inApp.page.locator('button.profile-btn').click();
  await inApp.page.waitForSelector('details.set');
  await inApp.page.evaluate(() => document.querySelectorAll('details.set:not([open]) > summary').forEach((x) => x.click()));
  await tap(inApp, 'Log out');
  await has(inApp, 'Get started');
  const told = await inApp.page.evaluate(() => window.__posted);
  console.log('messages after logging out: ' + JSON.stringify(told));
  // Logging in again: the app must be handed the new sign-in.
  await inApp.page.evaluate(() => { window.__posted = []; });
  await tap(inApp, 'I already have an account');
  await inApp.page.fill('#login-user', 'ana_test');
  await inApp.page.fill('#login-pass', 'longenough1');
  await tap(inApp, 'Log in');
  await inApp.page.waitForFunction(() => window.__posted.length > 0, null, { timeout: 15000 });
  const back = await inApp.page.evaluate(() => window.__posted.map((m) => m.type + ':' + (m.session && m.session.access_token ? 'a sign-in' : String(m.session))));
  console.log('messages after logging in: ' + JSON.stringify(back));
  console.log('ALL CHECKS RAN');
} catch (e) {
  console.log('crashed: ' + e.message);
  process.exitCode = 1;
} finally {
  await browser.close(); api.kill(); web.close(); nativeWeb.close();
  try { execSync(`runuser -u postgres -- /usr/lib/postgresql/16/bin/pg_ctl -D $(dirname ${sock})/data -m immediate stop`, { stdio: 'ignore', shell: '/bin/bash' }); } catch {}
}
