// Tries the native venue page, the event pop-up and the restyled You (settings) page in a browser, against the local
// stand-in database (same set-up as native.mjs): Ana and Jack are friends, Ana is in a live sesh, and there is one event.
// It opens a venue from the Map tab (rates it, votes for it, adds it to the Sesh Map, each checked in the database),
// taps the event (Suggest to friends sends Jack a locked message, Add to sesh posts it in the sesh chat), and takes
// pictures of each screen. Run: node tools/live/venue-events.mjs [output folder]   (LOOK=day or LOOK=pop for the other looks)
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
// NATIVE_DIST: a folder from an earlier run, to skip the (slow) builds when only this script changed.
const dist = process.env.NATIVE_DIST || fs.mkdtempSync('/tmp/frendzy-native-web-');
if (!process.env.NATIVE_DIST) execSync('node scripts/bundle-web.mjs', { cwd: path.join(root, 'mobile'), stdio: 'inherit' });   // the packed page and docs/hours.js
if (!process.env.NATIVE_DIST) execSync(`CI=1 EXPO_PUBLIC_API_URL=http://127.0.0.1:54340 EXPO_PUBLIC_API_KEY=test-anon-key EXPO_PUBLIC_NATIVE_MAP=1 npx expo export --platform web --output-dir ${dist} --clear`,
  { cwd: path.join(root, 'mobile'), stdio: 'inherit' });

const copy = fs.mkdtempSync('/tmp/sb-native-');
execSync(`cp -r ${root}/supabase ${copy}/ && chmod -R a+rX ${copy} && chmod a+rx ${copy}`);
// The live database has a hand-made private.migration_log that some migration files add their own line to; the test
// database doesn't, so those lines are left out here.
execSync(`sed -i '/insert into private.migration_log/d' ${copy}/supabase/migrations/*.sql`);
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
  // LOOK=day or LOOK=pop opens the native screens in that look (You > Look) instead of Neon Night.
  if (process.env.LOOK) await ctx.addInitScript(`try { localStorage.setItem('frendzy-look', ${JSON.stringify(process.env.LOOK)}); } catch (e) {}`);
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
  page.on('response', async (r) => { if (!r.ok() && r.url().includes('54340')) console.log(name + ' http ' + r.status() + ' ' + r.url() + ' ' + (await r.text().catch(() => ''))); });
  await page.goto(url);
  return { name, ctx, page };
}
const has = async (p, s, t = 8000) => {
  try { await p.page.waitForFunction((x) => document.body.innerText.toLowerCase().includes(x.toLowerCase()), s, { timeout: t }); }
  catch (e) { console.log(p.name + ' never showed "' + s + '". On screen:\n' + (await p.page.evaluate(() => document.body.innerText))); throw e; }
};
async function join(p, name, dob) {
  const u = name.toLowerCase();
  await p.page.fill('#name', name); await p.page.fill('#dob', dob);
  await p.page.fill('#join-user', u + '_test'); await p.page.fill('#join-pass', 'longenough1'); await p.page.fill('#join-email', u + '@example.com');
  await tap(p, 'Get started');
  await has(p, 'Confirm your email'); await tap(p, 'Later');
  await has(p, 'Your status');
  // Skip the walkthrough that opens after sign-up: it sits over the screen and would swallow taps.
  await p.page.evaluate(() => localStorage.removeItem('seshhon-tour-pending'));
  await p.page.reload();
  await has(p, 'Your status');
}
// A database check: prints what was found, and fails the run if it isn't what was expected.
const expect = (what, got, want) => {
  const ok = String(got) === String(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + what + ': ' + got + (ok ? '' : ' (expected ' + want + ')'));
  if (!ok) process.exitCode = 1;
};
const until = async (fn, t = 8000) => { const end = Date.now() + t; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };
const shot = async (p, file) => { await p.page.waitForTimeout(600); await p.page.screenshot({ path: path.join(out, file) }); console.log('  saved ' + file); };

const tap = (p, label) => p.page.getByRole('button', { name: label, exact: true }).first().click();

try {
  const ana = await phone('Ana', `http://127.0.0.1:${WEB_PORT}/`);
  await has(ana, 'Get started');
  await join(ana, 'Ana', '1995-04-12');
  const code = psql("select invite_code from public.profiles where name = 'Ana'");
  const jack = await phone('Jack', `http://127.0.0.1:${WEB_PORT}/?invite=` + code);
  await join(jack, 'Jack', '1996-05-06');
  await until(() => psql("select count(*) from public.friendships") === '1');
  psql("update public.friendships set state = 'accepted'");
  await tap(jack, 'Green');
  const jackSession = JSON.parse(await jack.page.evaluate(() => localStorage.getItem('seshhon-session-v1')));
  await jack.ctx.close();
  await tap(ana, 'Green');
  const session = await ana.page.evaluate(() => localStorage.getItem('seshhon-session-v1'));
  const call = async (tok, fn, args = {}) => {
    const r = await fetch(API + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: 'test-anon-key', Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    if (!r.ok) throw new Error(fn + ': ' + r.status + ' ' + (await r.text()));
    return r.json().catch(() => null);
  };
  // Jack has opened Messages once on his phone, so there is a lock for him (a made-up public key is enough here).
  await call(jackSession.access_token, 'set_message_key', { p_key: Buffer.alloc(32, 7).toString('base64') });
  await call(JSON.parse(session).access_token, 'start_sesh');
  const anaId = psql("select id from public.profiles where name = 'Ana'");
  const seshId = psql(`select id from public.seshes where creator = '${anaId}' and ended_at is null`);
  psql('grant select on public.events to anon, authenticated');   // Supabase grants this by default; the test database doesn't
  psql("insert into public.events (title, kind, place, lat, lng, starts_at, ends_at, source_url) values ('Sunset Jazz Night', 'Gig', 'Kings Park', -31.96, 115.84, now() + interval '2 days', now() + interval '2 days 3 hours', 'https://example.com/jazz')");

  const nat = await phone('native', `http://127.0.0.1:${NATIVE_PORT}/`, `localStorage.setItem('seshhon-session-v1', ${JSON.stringify(session)});`);
  await has(nat, "You're green.");

  /* ---------- the venue page, opened from the Map tab ---------- */
  await nat.page.getByRole('tab', { name: 'Map' }).click();
  await nat.page.getByTestId('map-stub').waitFor();
  await nat.page.getByTestId('map-tap').click();
  const firstMarker = await nat.page.locator('[data-testid^="marker-"]').first().getAttribute('data-testid');
  const venueId = firstMarker.slice(7);
  await nat.page.getByTestId(firstMarker).click();
  await nat.page.getByTestId('pick-open').click();
  await nat.page.getByTestId('venue-page').waitFor();
  await has(nat, 'Opening hours');
  await has(nat, 'Rate this venue');
  await has(nat, "Vote for this in tonight's sesh");
  await shot(nat, 'venue-1-top.png');
  await nat.page.getByTestId('venue-star-4').click();
  await until(() => psql(`select stars from public.ratings where venue_id = '${venueId}' and user_id = '${anaId}'`) === '4');
  expect('4 stars saved', psql(`select stars from public.ratings where venue_id = '${venueId}' and user_id = '${anaId}'`), 4);
  await nat.page.getByTestId('venue-tag-Good vibe').click();
  await until(() => psql(`select array_to_string(tags, ',') from public.ratings where venue_id = '${venueId}' and user_id = '${anaId}'`) === 'Good vibe');
  expect('tag saved', psql(`select array_to_string(tags, ',') from public.ratings where venue_id = '${venueId}' and user_id = '${anaId}'`), 'Good vibe');
  await nat.page.getByTestId('venue-vote').click();
  await until(() => psql(`select venue_id from public.venue_votes where sesh_id = '${seshId}' and user_id = '${anaId}'`) === venueId);
  expect('vote saved', psql(`select venue_id from public.venue_votes where sesh_id = '${seshId}' and user_id = '${anaId}'`), venueId);
  await has(nat, 'You voted for this');
  await nat.page.getByTestId('venue-add').click();
  await has(nat, 'Stop 1 on the Sesh Map');
  expect('added to the Sesh Map', psql(`select count(*) from public.crawl_stops where sesh_id = '${seshId}' and venue_id = '${venueId}'`), 1);
  await nat.page.screenshot({ path: path.join(out, 'venue-2-full.png'), fullPage: true });
  await nat.page.getByTestId('venue-back').click();
  await nat.page.getByTestId('map-stub').waitFor();
  console.log('  ok   back returns to the Map');

  /* ---------- the event pop-up ---------- */
  await nat.page.getByRole('tab', { name: 'Events' }).click();
  await has(nat, 'Sunset Jazz Night');
  await shot(nat, 'events-1-list.png');
  await nat.page.getByText('Sunset Jazz Night').click();
  await nat.page.getByTestId('event-sheet').waitFor();
  await has(nat, 'Suggest to friends'); await has(nat, 'View event page'); await has(nat, "Add to tonight's sesh");
  await shot(nat, 'events-2-popup.png');
  await nat.page.getByTestId('event-suggest').click();
  await nat.page.locator('[data-testid^="suggest-"]').first().click();
  await shot(nat, 'events-3-suggest.png');
  await nat.page.getByTestId('suggest-send').click();
  await nat.page.waitForTimeout(2500);
  console.log('after Send: ' + (await nat.page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | '));
  // Friend messages keep their key in the phone's secure storage, which a browser doesn't have, so in this test the
  // pop-up must say why it didn't send (on a phone it sends). Either way the pop-up never leaves you guessing.
  await until(async () => psql('select count(*) from private.message_queue') === '1' || (await nat.page.getByTestId('event-note').count()) > 0);
  const queued = psql('select count(*) from private.message_queue');
  console.log('  info suggest: ' + (queued === '1' ? 'locked message queued for Jack' : 'browser note: ' + (await nat.page.getByTestId('event-note').innerText())));
  await shot(nat, 'events-4-after-send.png');
  if (queued !== '1') await nat.page.getByTestId('event-sheet').getByRole('button', { name: 'Back' }).click();
  await nat.page.getByTestId('event-add').click();
  await until(() => psql(`select count(*) from public.messages where sesh_id = '${seshId}'`) === '1');
  expect('event posted in the sesh chat', psql(`select body from public.messages where sesh_id = '${seshId}'`).includes('Sunset Jazz Night'), true);

  /* ---------- You (settings) ---------- */
  await nat.page.getByRole('tab', { name: 'Home' }).click();
  await nat.page.getByRole('button', { name: 'You', exact: true }).filter({ visible: true }).first().click();
  await has(nat, 'Your profile');
  await shot(nat, 'you-1.png');
  await nat.page.screenshot({ path: path.join(out, 'you-2-full.png'), fullPage: true });
  console.log(process.exitCode ? 'SOME CHECKS FAILED' : 'ALL CHECKS RAN');
} catch (e) {
  console.log('crashed: ' + e.message);
  process.exitCode = 1;
} finally {
  await browser.close(); api.kill(); web.close(); nativeWeb.close();
  try { execSync(`runuser -u postgres -- /usr/lib/postgresql/16/bin/pg_ctl -D $(dirname ${sock})/data -m immediate stop`, { stdio: 'ignore', shell: '/bin/bash' }); } catch {}
}
