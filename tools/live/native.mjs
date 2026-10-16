// Tries the phone app's native screens in a browser, against a local stand-in database with the real rules.
// Phone builds can't be made here, so the screens are built for Expo's web target instead (react-native-web)
// and driven with Playwright. It starts the test database and the fake Supabase from tools/live, signs up a
// handful of people in the web app so there are real friends with real statuses, then opens the native Home
// as one of them and takes pictures. Then the native Sesh tab: Ana starts a sesh, Jack joins it on his own
// phone, both vote, they chat both ways, Ana reports and blocks, plans a crawl and plans a sesh for later,
// and every tap is checked in the database. It also checks the web half the app packs in: that it opens on the
// tab the app asks for, switches tabs when the app says so, tells the app when it moves to another tab by
// itself, opens on a venue when asked, and tells the app when the sign-in changes.
// Then crews, besties and free time: Ana makes a crew, Jack and Mia join, they share exact times, Home suggests a
// catch-up and Plan it makes a planned sesh invited to the crew.
// Then the native You page, as Mia and Zoe on their own phones: a photo, Safety, adding a friend by username
// and cancelling the request, removing a friend, a new username and password, an email for login codes,
// log out and back in, and deleting an account, each checked in the database.
// Then the native Map tab (Google map on the phone): react-native-maps can't draw a map in a browser, so the browser build
// swaps in a stand-in (NativeMap.web.tsx) that lists the very same markers, circle and stops. It checks the venues
// inside the radius, the radius slider, the busy glow (api_buzz), the filter chips, search, the picked venue's vote and
// "Add to the Sesh Map" (checked in the database), friend faces, Near me (and that the position is never sent), the
// simple-map link, and that a build without a Google Maps key keeps the web map.
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
// NATIVE_DIST / NATIVE_DIST_NOKEY: folders from an earlier run, to skip the (slow) builds when only this script changed.
const dist = process.env.NATIVE_DIST || fs.mkdtempSync('/tmp/frendzy-native-web-');
if (!process.env.NATIVE_DIST) execSync('node scripts/bundle-web.mjs', { cwd: path.join(root, 'mobile'), stdio: 'inherit' });   // the packed page and docs/hours.js
if (!process.env.NATIVE_DIST) execSync(`CI=1 EXPO_PUBLIC_API_URL=http://127.0.0.1:54340 EXPO_PUBLIC_API_KEY=test-anon-key EXPO_PUBLIC_NATIVE_MAP=1 npx expo export --platform web --output-dir ${dist} --clear`,
  { cwd: path.join(root, 'mobile'), stdio: 'inherit' });

// The same app built without a Google Maps key (no EXPO_PUBLIC_NATIVE_MAP): the Map tab must stay the web map.
const distNoKey = process.env.NATIVE_DIST_NOKEY || fs.mkdtempSync('/tmp/frendzy-native-web-nokey-');
if (!process.env.NATIVE_DIST_NOKEY) execSync(`CI=1 EXPO_PUBLIC_API_URL=http://127.0.0.1:54340 EXPO_PUBLIC_API_KEY=test-anon-key EXPO_PUBLIC_NATIVE_MAP=0 npx expo export --platform web --output-dir ${distNoKey} --clear`,
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
const NOKEY_PORT = 54343;
const nativeNoKey = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const f = path.join(distNoKey, p === '/' ? 'index.html' : p);
  if (!f.startsWith(distNoKey) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream'); res.end(fs.readFileSync(f));
}).listen(NOKEY_PORT);
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
// A database check: prints what was found, and fails the run if it isn't what was expected.
const expect = (what, got, want) => {
  const ok = String(got) === String(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + what + ': ' + got + (ok ? '' : ' (expected ' + want + ')'));
  if (!ok) process.exitCode = 1;
};
const until = async (fn, t = 8000) => { const end = Date.now() + t; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };
const shot = async (p, file) => { await p.page.waitForTimeout(600); await p.page.screenshot({ path: path.join(out, file) }); console.log('  saved ' + file); };

try {
  // A test user with friends, made through the real sign-up in the web app.
  const ana = await phone('Ana', `http://127.0.0.1:${WEB_PORT}/`);
  await has(ana, 'Get started');
  await join(ana, 'Ana', '1995-04-12');
  const code = psql("select invite_code from public.profiles where name = 'Ana'");
  const link = '?invite=' + code;
  const sessions = {};
  for (const [name, colour] of [['Jack', 'Green'], ['Mia', 'Amber'], ['Tom', 'Green'], ['Zoe', 'Red']]) {
    const f = await phone(name, `http://127.0.0.1:${WEB_PORT}/` + link);
    await join(f, name, '1996-05-06');
    await has(ana, 'wants to add you'); await tap(ana, 'Accept');
    if (colour !== 'Red') await tap(f, colour);
    await f.page.waitForTimeout(400);
    sessions[name] = await f.page.evaluate(() => localStorage.getItem('seshhon-session-v1'));
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

  /* ---------- the native Sesh tab ---------- */
  const sesh = path.join(out, 'native-sesh');
  fs.mkdirSync(sesh, { recursive: true });
  const sshot = async (p, file) => { await p.page.waitForTimeout(700); await p.page.screenshot({ path: path.join(sesh, file), fullPage: true }); console.log('  saved native-sesh/' + file); };
  const id = (name) => psql(`select id from public.profiles where name = '${name}'`);
  const anaId = id('Ana'), jackId = id('Jack'), tomId = id('Tom');
  await nat.page.getByRole('tab', { name: 'Sesh' }).click();
  await has(nat, "Tonight's sesh");
  await has(nat, 'Nobody has started one yet');
  await sshot(nat, '1-no-sesh.png');

  // Start a sesh: start_sesh, the same function the web app calls.
  await tap(nat, 'Start a sesh');
  await has(nat, 'Live now');
  await has(nat, 'Where to?');
  const seshId = psql(`select id from public.seshes where creator = '${anaId}' and ended_at is null`);
  expect('a live sesh started by Ana', psql(`select count(*) from public.seshes where creator = '${anaId}' and ended_at is null`), 1);
  // The vote list: the venues within 5 km of the city centre, with their opening hours and distance.
  const venues = psql("select string_agg(id || '|' || name, ';' order by name) from public.venues where lat is not null").split(';').map((x) => x.split('|'));
  const [venueA, nameA] = venues[0], [venueB, nameB] = venues[1];
  await has(nat, nameA, 15000);
  await sshot(nat, '2-sesh-started.png');

  // Ana votes; the vote must land in the database, and tapping again takes it back, as on the web.
  await nat.page.getByTestId('vote-' + venueA).click();
  await has(nat, 'Your vote');
  await until(() => psql(`select count(*) from public.venue_votes where sesh_id = '${seshId}'`) === '1');
  expect("Ana's vote in the database", psql(`select venue_id from public.venue_votes where sesh_id = '${seshId}' and user_id = '${anaId}'`), venueA);

  // Jack, on his own phone, sees Ana's sesh and joins it.
  const natJ = await phone('Jack native', `http://127.0.0.1:${NATIVE_PORT}/`, `localStorage.setItem('seshhon-session-v1', ${JSON.stringify(sessions.Jack)});`);
  await has(natJ, "You're green.");
  await natJ.page.getByRole('tab', { name: 'Sesh' }).click();
  await has(natJ, "Ana's sesh");
  await sshot(natJ, '3-jack-sees-sesh.png');
  await tap(natJ, 'Join');
  await has(natJ, 'Live now');
  expect('Jack is in the sesh', psql(`select count(*) from public.sesh_members where sesh_id = '${seshId}' and user_id = '${jackId}'`), 1);
  // Jack votes for the other venue, then changes to Ana's: two votes for one venue.
  await natJ.page.getByTestId('vote-' + venueB).click();
  await until(() => psql(`select count(*) from public.venue_votes where sesh_id = '${seshId}'`) === '2');
  expect("Jack's first vote", psql(`select venue_id from public.venue_votes where sesh_id = '${seshId}' and user_id = '${jackId}'`), venueB);
  await natJ.page.getByTestId('vote-' + venueA).click();
  await until(() => psql(`select venue_id from public.venue_votes where sesh_id = '${seshId}' and user_id = '${jackId}'`) === venueA);
  expect('votes counted for ' + nameA, psql(`select count(*) from public.venue_votes where sesh_id = '${seshId}' and venue_id = '${venueA}'`), 2);
  await has(natJ, '2 votes in');
  await has(nat, '2 votes in', 10000);
  console.log("Ana's screen shows the vote count Jack changed: yes");

  // Chat, both ways. Each phone only polls, so this also checks the chat poll.
  await natJ.page.getByLabel('Message your mates').fill('Heading there at 9, who is in?');
  await natJ.page.getByRole('button', { name: 'Send', exact: true }).click();
  await until(() => psql(`select count(*) from public.messages where sesh_id = '${seshId}'`) === '1');
  expect('message stored', psql(`select body from public.messages where sesh_id = '${seshId}' and sender = '${jackId}'`), 'Heading there at 9, who is in?');
  await has(nat, 'Heading there at 9, who is in?', 10000);
  console.log("Ana's phone received Jack's message: yes");
  await nat.page.getByLabel('Message your mates').fill("I'm in, see you there");
  await nat.page.getByLabel('Message your mates').press('Enter');
  await has(natJ, "I'm in, see you there", 10000);
  console.log("Jack's phone received Ana's reply: yes");
  expect('messages stored', psql(`select count(*) from public.messages where sesh_id = '${seshId}'`), 2);
  expect('input cleared after sending', await nat.page.getByLabel('Message your mates').inputValue(), '');
  await sshot(nat, '4-chat-ana.png');
  await sshot(natJ, '5-chat-jack.png');

  // Reporting a message: report_message, with the message kept for the moderators.
  await nat.page.getByRole('button', { name: 'Report', exact: true }).first().click();
  await has(nat, 'Report this message?');
  await sshot(nat, '6-report-confirm.png');
  await nat.page.getByRole('button', { name: 'Report', exact: true }).first().click();
  await has(nat, 'Reported. Thanks for telling us.');
  expect('report stored', psql(`select count(*) from public.reports where reporter = '${anaId}' and reported = '${jackId}' and message_body = 'Heading there at 9, who is in?'`), 1);


  /* ---------- the native Map tab ---------- */
  // Ana, on a second phone, with the sesh live (she and Jack both voted for venue A, so A is "busy": 2 people heading there).
  const mapDir = path.join(out, 'native-map');
  fs.mkdirSync(mapDir, { recursive: true });
  const mshot = async (p, file) => { await p.page.waitForTimeout(700); await p.page.screenshot({ path: path.join(mapDir, file) }); console.log('  saved native-map/' + file); };
  psql("insert into public.venues (name, kind, closes, is_example, lat, lng) values ('Zed Far Tap', 'Pub', 'open till 11pm', false, -32.0569, 115.7439), ('Zed Cafe', 'Cafe', 'open till 5pm', false, -31.9530, 115.8620) on conflict do nothing");
  const rows = psql("select string_agg(id || '|' || name || '|' || lat || '|' || lng || '|' || coalesce(kind, '') || '|' || coalesce(opening_hours, ''), ';') from public.venues where lat is not null").split(';').map((x) => x.split('|'))
    .map(([vid, vname, lat, lng, kind, hours]) => ({ id: vid, name: vname, at: [Number(lat), Number(lng)], kind, hours }));
  const kmBetween = (a, b) => { const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2; return 12742 * Math.asin(Math.min(1, Math.sqrt(h))); };
  const CITY = [-31.9523, 115.8613];
  const within = (r) => rows.filter((x) => kmBetween(CITY, x.at) <= r).map((x) => x.id).sort();
  const farId = rows.filter((x) => x.name === 'Zed Far Tap')[0].id, cafeId = rows.filter((x) => x.name === 'Zed Cafe')[0].id;
  const venueC = rows.filter((x) => x.name === 'The Paper Lantern')[0].id;
  const markerIds = (p) => p.page.evaluate(() => [...document.querySelectorAll('[data-testid^="marker-"]')].map((e) => e.getAttribute('data-testid').slice(7)).sort());
  const markerText = (p, id) => p.page.getByTestId('marker-' + id).innerText();
  const natMap = await phone('Ana map', `http://127.0.0.1:${NATIVE_PORT}/`, `localStorage.setItem('seshhon-session-v1', ${JSON.stringify(session)});`);
  const sentOut = [];   // everything this phone sends to the database, to prove its position never leaves it
  natMap.page.on('request', (r) => { if (r.url().includes('54340')) sentOut.push((r.postData() || '') + ' ' + r.url()); });
  await has(natMap, "You're green.");
  await natMap.page.getByRole('tab', { name: 'Map' }).click();
  await natMap.page.getByTestId('map-stub').waitFor();
  expect('Map tab is the native map (stand-in in a browser)', await natMap.page.getByTestId('map-stub').count(), 1);
  // Nothing is shown until a spot is chosen.
  expect('no venues until a spot is chosen', (await markerIds(natMap)).length, 0);
  expect('no circle yet', await natMap.page.getByTestId('map-circle').innerText(), 'no circle');
  await has(natMap, 'Tap the map to pick a spot');
  await mshot(natMap, '1-map-start.png');

  // Tap the map (city centre): the circle appears and the venues inside 5 km.
  await natMap.page.getByTestId('map-tap').click();
  await until(async () => (await markerIds(natMap)).length > 0);
  expect('venues within 5 km of the pin', JSON.stringify(await markerIds(natMap)), JSON.stringify(within(5)));
  expect('circle is 5 km', (await natMap.page.getByTestId('map-circle').innerText()).startsWith('circle 5 km'), true);
  expect('far venue is not shown at 5 km', (await markerIds(natMap)).includes(farId), false);
  await has(natMap, `${within(5).length} venues within 5 km of the pin`);
  expect('cafe gets the food icon', (await markerText(natMap, cafeId)).includes('fork'), true);
  expect('live music venue gets the music icon', (await markerText(natMap, venueC)).includes('events'), true);
  expect('opening hours show as open or shut', /open|shut/.test(await markerText(natMap, venueA)), true);

  // The busy glow: Ana and Jack are both heading to A (api_buzz needs 2 people), nobody else is.
  const textA = await markerText(natMap, venueA);
  console.log('venue A marker: ' + textA.replace(/\n/g, ' | '));
  expect('venue A is busy tonight (2 heading there)', textA.includes('busy-1') && textA.includes('Busy tonight'), true);
  expect('a quiet venue has no glow', (await markerText(natMap, venueB)).includes('busy-'), false);
  await mshot(natMap, '2-map-5km.png');

  // The radius slider: a tap at the far right is 25 km, at the left is 1 km.
  const slide = async (r) => { const box = await natMap.page.getByTestId('radius').boundingBox();
    await natMap.page.mouse.click(box.x + Math.min(box.width - 2, Math.max(1, ((r - 1) / 24) * box.width)), box.y + box.height / 2); };
  await slide(25);
  await until(async () => (await natMap.page.getByTestId('radius-label').innerText()).startsWith('25'));
  expect('radius label at the right end', (await natMap.page.getByTestId('radius-label').innerText()).replace(/\s+/g, ' '), '25 km');
  expect('venues within 25 km (far pub joins)', JSON.stringify(await markerIds(natMap)), JSON.stringify(within(25)));
  expect('far pub shown at 25 km', (await markerIds(natMap)).includes(farId), true);
  await has(natMap, 'within 25 km of the pin');
  await mshot(natMap, '3-map-25km.png');
  await slide(1);
  await until(async () => (await natMap.page.getByTestId('radius-label').innerText()).startsWith('1'));
  expect('radius label at the left end', (await natMap.page.getByTestId('radius-label').innerText()).replace(/\s+/g, ' '), '1 km');
  expect('venues within 1 km', JSON.stringify(await markerIds(natMap)), JSON.stringify(within(1)));
  await slide(5);
  await until(async () => (await natMap.page.getByTestId('radius-label').innerText()).startsWith('5'));

  // Filters: Popular keeps what is busy or a top pick, Trending and Open now narrow the rest.
  await natMap.page.getByTestId('chip-popular').click();
  await until(async () => (await markerIds(natMap)).length === 1);
  expect('Popular shows only the busy venue', JSON.stringify(await markerIds(natMap)), JSON.stringify([venueA]));
  await natMap.page.getByTestId('chip-trending').click();
  await until(async () => (await markerIds(natMap)).length === 0);
  expect('Trending shows none (nobody has rated twice this week)', (await markerIds(natMap)).length, 0);
  await natMap.page.getByTestId('chip-open').click();
  await until(async () => (await markerIds(natMap)).length >= 0);
  const openNow = await markerIds(natMap);
  for (const mid of openNow) expect('Open now marker ' + mid + ' is open', (await markerText(natMap, mid)).includes('| open'), true);
  await natMap.page.getByTestId('chip-open').click();   // off again
  await until(async () => (await markerIds(natMap)).length === within(5).length);

  // Search finds a venue anywhere, whatever the radius, and shows its card under the box.
  await natMap.page.getByTestId('venue-search').fill('zed far');
  await until(async () => (await markerIds(natMap)).includes(farId));
  expect('search puts the far pub on the map', JSON.stringify(await markerIds(natMap)), JSON.stringify([farId]));
  await has(natMap, '1 venue matches');
  await mshot(natMap, '4-map-search.png');
  await natMap.page.getByTestId('show-' + farId).click();
  await has(natMap, 'Zed Far Tap');
  expect('Show picks the venue (card under the map)', await natMap.page.getByTestId('map-pick').count(), 1);
  expect('search cleared after Show', await natMap.page.getByTestId('venue-search').inputValue(), '');
  await until(async () => (await markerIds(natMap)).length === within(5).length + 1);   // the picked far venue stays on the map
  await natMap.page.getByRole('button', { name: 'Close', exact: true }).click();

  // Tap a bubble: the card with the venue's details, voting, and the Sesh Map.
  await natMap.page.getByTestId('marker-' + venueB).click();
  await natMap.page.getByTestId('map-pick').waitFor();
  expect('card names the venue', (await natMap.page.getByTestId('map-pick').innerText()).includes(nameB), true);
  expect('card has the opening hours line', /open|closed|Closes|Opens|Hours/i.test(await natMap.page.getByTestId('map-pick').innerText()), true);
  await natMap.page.getByTestId('pick-vote').click();
  await until(() => psql(`select venue_id from public.venue_votes where sesh_id = '${seshId}' and user_id = '${anaId}'`) === venueB);
  expect('Vote for it from the map moves the vote', psql(`select venue_id from public.venue_votes where sesh_id = '${seshId}' and user_id = '${anaId}'`), venueB);
  await natMap.page.getByTestId('marker-' + venueA).click();
  await natMap.page.getByTestId('pick-vote').click();
  await until(() => psql(`select venue_id from public.venue_votes where sesh_id = '${seshId}' and user_id = '${anaId}'`) === venueA);
  expect('vote back on A', psql(`select venue_id from public.venue_votes where sesh_id = '${seshId}' and user_id = '${anaId}'`), venueA);
  // A quick star rating from the card.
  await natMap.page.getByTestId('star-4').click();
  await until(() => psql(`select stars from public.ratings where venue_id = '${venueA}' and user_id = '${anaId}'`) === '4');
  expect('quick star rating saved', psql(`select stars from public.ratings where venue_id = '${venueA}' and user_id = '${anaId}'`), 4);

  // The Sesh Map: add stops from the map; they get numbers and a dotted line.
  expect('no stops yet', psql(`select count(*) from public.crawl_stops where sesh_id = '${seshId}'`), 0);
  await natMap.page.getByTestId('pick-add').click();
  await until(() => psql(`select count(*) from public.crawl_stops where sesh_id = '${seshId}'`) === '1');
  expect('stop 1 added from the map', psql(`select position from public.crawl_stops where sesh_id = '${seshId}' and venue_id = '${venueA}'`), 1);
  await until(async () => (await natMap.page.getByTestId('pick-stop').count()) === 1);
  await has(natMap, 'Stop 1 on the Sesh Map');
  await natMap.page.getByTestId('marker-' + venueB).click();
  await natMap.page.getByTestId('pick-add').click();
  await until(() => psql(`select count(*) from public.crawl_stops where sesh_id = '${seshId}'`) === '2');
  await until(async () => (await natMap.page.getByTestId('map-route').innerText()) === 'route of 2 stops');
  expect('the stops are joined by a line', await natMap.page.getByTestId('map-route').innerText(), 'route of 2 stops');
  expect('stop 1 is numbered on the map', (await markerText(natMap, venueA)).startsWith('1. '), true);
  expect('stop 2 is numbered on the map', (await markerText(natMap, venueB)).startsWith('2. '), true);
  await mshot(natMap, '5-map-stops.png');
  // Put the Sesh Map back as the next part of the test expects (it adds its own stops).
  await natMap.page.evaluate(async ([a, b, sid]) => {
    const s = JSON.parse(localStorage.getItem('seshhon-session-v1'));
    for (const v of [a, b]) await fetch('http://127.0.0.1:54340/rest/v1/rpc/crawl_remove', { method: 'POST', headers: { apikey: 'test-anon-key', Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_sesh: sid, p_venue: v }) });
  }, [venueA, venueB, seshId]);
  expect('stops tidied away', psql(`select count(*) from public.crawl_stops where sesh_id = '${seshId}'`), 0);

  // Friends who are out show as faces (never where they are): Jack, Tom (green) and Mia (amber), not Zoe (red).
  const faces = await natMap.page.getByLabel('Friends out tonight').innerText();
  console.log('friend faces on the map: ' + faces.replace(/\n/g, ', '));
  expect('green and amber friends are shown', ['Jack', 'Mia', 'Tom'].every((n) => faces.includes(n)), true);
  expect('a red friend is not shown', faces.includes('Zoe'), false);

  // Near me: this phone's position stays on the phone.
  await natMap.ctx.grantPermissions(['geolocation']);
  await natMap.ctx.setGeolocation({ latitude: -31.9871, longitude: 115.8412 });
  await natMap.page.getByTestId('map-near-me').click();
  await has(natMap, 'Your location stays on this phone and is never saved or shown to friends.');
  expect('the circle is on the person (Me)', (await natMap.page.getByTestId('map-circle').innerText()).includes('(me)'), true);
  expect('"Me" is shown', (await natMap.page.getByTestId('map-me').count()), 1);
  expect('circle centre is the phone position', (await natMap.page.getByTestId('map-circle').innerText()).includes('-31.9871,115.8412'), true);
  await mshot(natMap, '6-map-near-me.png');
  await natMap.page.waitForTimeout(1500);
  expect('the position was never sent to the database', sentOut.some((x) => x.includes('31.9871') || x.includes('115.8412')), false);
  const dbHasIt = psql("select count(*) from (select row_to_json(p)::text t from public.profiles p union all select row_to_json(s)::text from public.statuses s) x where t like '%31.9871%'");
  expect('and is not in the database', dbHasIt, 0);

  // List view lists the same venues, with Show and distances.
  await natMap.page.getByTestId('map-list-toggle').click();
  await natMap.page.getByTestId('venue-list').waitFor();
  await has(natMap, 'away');
  await mshot(natMap, '7-map-list.png');
  await natMap.page.getByTestId('map-list-toggle').click();

  // Open venue: the existing venue page flow takes over (in the browser the page itself can't run, so the map just leaves).
  await natMap.page.getByTestId('marker-' + venueA).click().catch(() => {});
  await natMap.page.getByTestId('pick-open').click();
  await until(async () => (await natMap.page.getByTestId('map-stub').count()) === 0);
  expect('Open venue leaves the native map for the venue page', await natMap.page.getByTestId('map-stub').count(), 0);
  await natMap.page.getByRole('tab', { name: 'Map' }).click();
  await natMap.page.getByTestId('map-stub').waitFor();
  console.log('back on the native map after a venue: yes');

  // "Map not loading? Use the simple map": the Map tab becomes the packed web map.
  await natMap.page.getByTestId('map-simple').click();
  await until(async () => (await natMap.page.getByTestId('map-stub').count()) === 0);
  expect('the simple map link switches to the web map', await natMap.page.getByTestId('map-stub').count(), 0);
  await mshot(natMap, '8-map-simple.png');
  await natMap.ctx.close();

  // A build without a Google Maps key keeps the web map (the app opens and the tab does not crash).
  const noKey = await phone('no-key build', `http://127.0.0.1:${NOKEY_PORT}/`, `localStorage.setItem('seshhon-session-v1', ${JSON.stringify(session)});`);
  await has(noKey, "You're green.");
  await noKey.page.getByRole('tab', { name: 'Map' }).click();
  await noKey.page.waitForTimeout(1500);
  expect('no key: no native map', await noKey.page.getByTestId('map-stub').count(), 0);
  expect('no key: the tab bar is still there', await noKey.page.getByRole('tab', { name: 'Home' }).count(), 1);
  await noKey.ctx.close();

  // Lock in the winner: lock_sesh.
  await tap(nat, 'Lock in ' + nameA);
  await has(nat, 'Locked in');
  await until(() => psql(`select coalesce(locked_venue::text, '') from public.seshes where id = '${seshId}'`) === venueA);
  expect('locked venue in the database', psql(`select locked_venue from public.seshes where id = '${seshId}'`), venueA);
  await has(natJ, 'Locked in', 10000);

  // The Sesh Map: stops are added from the map (the web half), so two are added straight through the
  // database as Jack and Ana would, then Ana ticks one off and moves one on the native screen.
  const rpcAs = (p, fn, args) => p.page.evaluate(async ([fn, args]) => {
    const s = JSON.parse(localStorage.getItem('seshhon-session-v1'));
    const r = await fetch('http://127.0.0.1:54340/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: 'test-anon-key', Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    return r.status;
  }, [fn, args]);
  console.log('crawl_add as Jack: ' + await rpcAs(natJ, 'crawl_add', { p_sesh: seshId, p_venue: venueA }));
  console.log('crawl_add as Ana: ' + await rpcAs(nat, 'crawl_add', { p_sesh: seshId, p_venue: venueB }));
  await has(nat, '2 stops', 10000);
  await nat.page.getByRole('button', { name: 'Done with ' + nameA, exact: true }).click();
  await until(() => psql(`select done from public.crawl_stops where sesh_id = '${seshId}' and venue_id = '${venueA}'`) === 't');
  expect('stop 1 ticked off', psql(`select done from public.crawl_stops where sesh_id = '${seshId}' and venue_id = '${venueA}'`), 't');
  await has(nat, 'Next stop');
  await nat.page.getByRole('button', { name: 'Move ' + nameB + ' earlier', exact: true }).click();
  await until(() => psql(`select position from public.crawl_stops where sesh_id = '${seshId}' and venue_id = '${venueB}'`) === '1');
  expect(nameB + ' moved to stop 1', psql(`select position from public.crawl_stops where sesh_id = '${seshId}' and venue_id = '${venueB}'`), 1);
  await has(natJ, '2 stops', 10000);
  await has(natJ, 'started this sesh, so they set the order');
  await sshot(nat, '7-crawl-ana.png');
  await sshot(natJ, '8-crawl-jack.png');

  // Tom joins and says something; Ana blocks him from the chat (block_user) and his messages go.
  const natT = await phone('Tom native', `http://127.0.0.1:${NATIVE_PORT}/`, `localStorage.setItem('seshhon-session-v1', ${JSON.stringify(sessions.Tom)});`);
  await natT.page.getByRole('tab', { name: 'Sesh' }).click();
  await has(natT, "Ana's sesh");
  await tap(natT, 'Join');
  await has(natT, 'Live now');
  await natT.page.getByLabel('Message your mates').fill('Ugh not there');
  await natT.page.getByRole('button', { name: 'Send', exact: true }).click();
  await has(nat, 'Ugh not there', 10000);
  const tomRow = nat.page.locator('[data-testid="chat-list"] >> text=Ugh not there').locator('xpath=../..');
  await tomRow.getByRole('button', { name: 'Block', exact: true }).click();
  await has(nat, 'Block Tom?');
  await sshot(nat, '9-block-confirm.png');
  await tomRow.getByRole('button', { name: 'Block', exact: true }).click();
  await has(nat, 'Blocked.');
  expect('block stored', psql(`select count(*) from public.blocks where blocker = '${anaId}' and blocked = '${tomId}'`), 1);
  expect('no longer friends with Tom', psql(`select count(*) from public.friendships where state = 'accepted' and ((requester = '${anaId}' and addressee = '${tomId}') or (requester = '${tomId}' and addressee = '${anaId}'))`), 0);
  await until(async () => !(await nat.page.evaluate(() => document.body.innerText.includes('Ugh not there'))));
  expect("Tom's message gone from Ana's chat", await nat.page.evaluate(() => document.body.innerText.includes('Ugh not there')), false);
  await natT.ctx.close();

  // Plan a sesh for later, for all friends: plan_sesh.
  await tap(nat, 'Plan a sesh for later');
  await has(nat, "When's it on?");
  await tap(nat, 'A day later');
  await sshot(nat, '10-plan.png');
  await tap(nat, 'Pick friends');
  await has(nat, 'Pick at least one friend');
  await nat.page.getByRole('button', { name: 'Jack', exact: true }).click();
  await has(nat, 'Plan it with 1');
  await sshot(nat, '11-plan-pick.png');
  await tap(nat, 'Plan it with 1');
  await has(nat, 'Planned. Only the friends you picked can see it.');
  await has(nat, 'Add a private pres address');
  expect('a planned private sesh in the database', psql(`select count(*) from public.seshes where creator = '${anaId}' and created_at > now() + interval '20 hours' and private`), 1);
  // The pres address for it: set_sesh_pres.
  await tap(nat, 'Add a private pres address');
  await nat.page.getByLabel('Address', { exact: true }).fill('12 Smith St, Northbridge');
  await tap(nat, '15 minutes earlier');   // the pres starts from 7:00 pm, so earlier is always before the sesh
  await tap(nat, 'Save');
  await has(nat, 'Pres address saved.');
  expect('pres address stored', psql(`select address from private.sesh_pres p join public.seshes s on s.id = p.sesh_id where s.creator = '${anaId}' and s.created_at > now() + interval '20 hours'`), '12 Smith St, Northbridge');
  await sshot(nat, '12-planned-sesh.png');
  await tap(nat, 'All seshes');
  await has(nat, 'Live now');
  await has(nat, 'Planned');
  await sshot(nat, '13-back-to-tonight.png');

  // A private sesh from Jack's phone: start_private_sesh. He leaves Ana's first.
  await tap(natJ, 'Leave the sesh');
  await has(natJ, "Ana's sesh");
  await until(() => psql(`select count(*) from public.sesh_members where sesh_id = '${seshId}' and user_id = '${jackId}'`) === '0');   // the screen can move on a moment before the database answer is read
  expect('Jack left', psql(`select count(*) from public.sesh_members where sesh_id = '${seshId}' and user_id = '${jackId}'`), 0);
  await tap(natJ, 'Start a private sesh');
  await has(natJ, "Who's invited?");
  await natJ.page.getByRole('button', { name: 'Ana', exact: true }).click();   // Jack's one friend
  await sshot(natJ, '14-private-picker.png');
  await tap(natJ, 'Start private sesh with 1');
  await has(natJ, 'Private sesh started.');
  await has(natJ, 'Only you and the 1 friend you picked can see it.');
  expect("Jack's private sesh", psql(`select count(*) from public.seshes where creator = '${jackId}' and private and ended_at is null`), 1);
  await sshot(natJ, '15-private-sesh.png');

  // Ending: end_sesh.
  await tap(nat, 'End the sesh');
  await has(nat, 'Sesh ended.');
  // end_sesh deletes the sesh, with its members, votes, stops and chat.
  expect("Ana's sesh gone", psql(`select count(*) from public.seshes where id = '${seshId}'`), 0);
  expect('its chat gone', psql(`select count(*) from public.messages where sesh_id = '${seshId}'`), 0);
  await sshot(nat, '16-ended.png');
  await natJ.ctx.close();
  // Home's "Start a sesh" opens the native Sesh tab too.
  await nat.page.getByRole('tab', { name: 'Home' }).click();
  await has(nat, 'Up for it now');

  /* ---------- crews, besties and free time ---------- */
  // Ana makes a crew with Jack and Mia, shares exact times, ticks when she's free, and Home suggests a catch-up
  // that "Plan it" turns into a planned sesh. Jack and Mia answer through the same database functions (as their
  // own phones would); every step is checked in the database, including who can't see what.
  const crewsDir = path.join(out, 'native-crews');
  fs.mkdirSync(crewsDir, { recursive: true });
  const cshot = async (p, file) => { await p.page.waitForTimeout(700); await p.page.screenshot({ path: path.join(crewsDir, file), fullPage: true }); console.log('  saved native-crews/' + file); };
  const asUser = async (name, fn, args = {}) => {
    const tok = JSON.parse(sessions[name]).access_token;
    const r = await fetch(API + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: 'test-anon-key', Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new Error(name + ' ' + fn + ': ' + ((body && body.message) || r.status));
    return body;
  };
  const day3 = psql("select to_char(private.free_today() + 3, 'YYYY-MM-DD')");
  await tap(nat, 'You');
  await has(nat, 'Crews and besties');
  await nat.page.getByTestId('open-crews').click();
  await has(nat, 'Your free time');
  await has(nat, 'Not shared with anyone yet');
  await cshot(nat, '1-crews-empty.png');

  // Make a crew and invite two friends: make_crew, invite_to_crew. Nobody is in it until they accept.
  await nat.page.getByLabel('Crew name', { exact: true }).fill('The Girls');
  await tap(nat, 'Make crew');
  await has(nat, 'Invite friends');
  const crewId = psql(`select id from private.crews where name = 'The Girls' and owner = '${anaId}'`);
  expect('a crew made by Ana', psql(`select count(*) from private.crews where owner = '${anaId}'`), 1);
  await tap(nat, 'Invite friends');
  await nat.page.getByRole('button', { name: 'Jack', exact: true }).click();
  await nat.page.getByRole('button', { name: 'Mia', exact: true }).click();
  expect('Tom, who is blocked, is not on the list', await nat.page.getByRole('button', { name: 'Tom', exact: true }).count(), 0);
  await tap(nat, 'Invite 2');
  await has(nat, 'Invited, waiting for them to join');
  expect('two invited, not in yet', psql(`select count(*) from private.crew_members where crew_id = '${crewId}' and state = 'invited'`), 2);
  await cshot(nat, '2-crew-invited.png');

  // Jack answers on his own phone: the invite shows on his Crews screen and Join puts him in.
  const natJ2 = await phone('Jack crews', `http://127.0.0.1:${NATIVE_PORT}/`, `localStorage.setItem('seshhon-session-v1', ${JSON.stringify(sessions.Jack)});`);
  await has(natJ2, "You're green.");
  await tap(natJ2, 'Crews and besties');
  await has(natJ2, 'invited you to the crew');
  await cshot(natJ2, '3-jack-invite.png');
  await tap(natJ2, 'Join');
  await until(() => psql(`select state from private.crew_members where crew_id = '${crewId}' and user_id = '${jackId}'`) === 'member');
  expect('Jack joined', psql(`select state from private.crew_members where crew_id = '${crewId}' and user_id = '${jackId}'`), 'member');
  expect('and shares nothing yet', psql(`select count(*) from private.share_settings where user_id = '${jackId}'`), 0);
  await natJ2.page.getByTestId('crew-The Girls').click();
  await has(natJ2, 'What you share with The Girls');
  await tap(natJ2, 'Exact times');
  await tap(natJ2, 'Whenever enough are free');
  await until(() => psql(`select coalesce((select share || ',' || suggest from private.share_settings where user_id = '${jackId}'), '')`) === 'exact,enough');
  expect("Jack's settings in the database", psql(`select share || ',' || suggest || ',' || min_free from private.share_settings where user_id = '${jackId}'`), 'exact,enough,3');
  await cshot(natJ2, '4-jack-crew-settings.png');
  await natJ2.page.getByTestId('crews-back').click();
  await natJ2.page.getByTestId('open-free').click();
  await natJ2.page.getByTestId('free-' + day3 + '-night').click();
  await until(() => psql(`select count(*) from private.free_slots where user_id = '${jackId}' and free`) === '1');
  expect("Jack's free night in the database", psql(`select part from private.free_slots where user_id = '${jackId}' and day = '${day3}' and free`), 'night');
  await cshot(natJ2, '5-jack-free-grid.png');
  await natJ2.ctx.close();

  // Mia answers through the same functions.
  await asUser('Mia', 'answer_crew_invite', { p_crew: crewId, p_accept: true });
  await asUser('Mia', 'set_share_settings', { p_kind: 'crew', p_target: crewId, p_share: 'exact', p_hangouts: [], p_suggest: 'off', p_min: 3, p_quiet: [] });
  await asUser('Mia', 'set_free', { p_day: day3, p_part: 'night', p_free: true });

  // Ana's settings for the crew: exact times, suggestions whenever enough are free, coffee.
  await nat.page.getByTestId('crews-back').click().catch(() => {});
  await has(nat, 'The Girls');
  await nat.page.getByTestId('crew-The Girls').click();
  await has(nat, 'What you share with The Girls');
  await has(nat, 'Jack');
  expect('sharing and suggestions start off', psql(`select count(*) from private.share_settings where user_id = '${anaId}'`), 0);
  await tap(nat, 'Exact times');
  await tap(nat, 'Whenever enough are free');
  await tap(nat, 'Coffee');
  await until(() => psql(`select coalesce((select share || ',' || suggest || ',' || hangouts::text from private.share_settings where user_id = '${anaId}'), '')`) === 'exact,enough,{coffee}');
  expect("Ana's settings in the database", psql(`select share || ',' || suggest || ',' || hangouts::text || ',' || min_free from private.share_settings where user_id = '${anaId}'`), 'exact,enough,{coffee},3');
  await cshot(nat, '6-crew-settings.png');

  // Ana ticks the same night in the free-time grid (set_free) and sets a usual pattern (set_free_pattern).
  await nat.page.getByTestId('crews-back').click();
  await nat.page.getByTestId('open-free').click();
  await has(nat, 'Usually free');
  await nat.page.getByTestId('free-' + day3 + '-night').click();
  await until(() => psql(`select count(*) from private.free_slots where user_id = '${anaId}' and free`) === '1');
  expect("Ana's free night in the database", psql(`select part from private.free_slots where user_id = '${anaId}' and day = '${day3}' and free`), 'night');
  await tap(nat, 'Usually free Fri night');
  await until(() => psql(`select count(*) from private.free_pattern where user_id = '${anaId}'`) === '1');
  expect("Ana's usual pattern", psql(`select dow || ':' || part from private.free_pattern where user_id = '${anaId}'`), '5:night');
  await tap(nat, 'Usually free Fri night');
  await until(() => psql(`select count(*) from private.free_pattern where user_id = '${anaId}'`) === '0');
  await cshot(nat, '7-free-grid.png');

  // Home now has the suggestion card, with the people free and a Plan it button.
  await tap(nat, 'Back');
  await tap(nat, 'Back');
  await nat.page.getByRole('tab', { name: 'Home' }).click();
  await has(nat, 'works for The Girls', 15000);
  await has(nat, '3 of 3 are free');
  await cshot(nat, '8-home-catch-up.png');
  await tap(nat, 'Plan it');
  await has(nat, 'Planned for');
  await until(() => psql(`select count(*) from public.seshes where creator = '${anaId}' and created_at > now() + interval '48 hours' and created_at < now() + interval '4 days' and private`) === '1');
  expect('Plan it made a private planned sesh', psql(`select count(*) from public.seshes where creator = '${anaId}' and created_at > now() + interval '48 hours' and created_at < now() + interval '4 days' and private`), 1);
  expect('invited to Jack and Mia only', psql(`select string_agg(p.name, ',' order by p.name) from public.sesh_invites i join public.profiles p on p.id = i.user_id join public.seshes s on s.id = i.sesh_id where s.creator = '${anaId}' and s.created_at > now() + interval '48 hours' and s.created_at < now() + interval '4 days'`), 'Jack,Mia');
  await has(nat, "Tonight's sesh");
  await cshot(nat, '9-planned-from-catch-up.png');

  // Someone who is in no crew sees nothing of it, and no suggestions.
  const zoeState = await asUser('Zoe', 'crews_state');
  expect('Zoe sees no crews', zoeState.crews.length + zoeState.besties.length, 0);
  expect('Zoe gets no suggestions', (await asUser('Zoe', 'catch_up_suggestions')).length, 0);
  expect('Zoe only has her own, empty, free-time grid', await asUser('Zoe', 'my_free_time').then((t) => t.days.filter((d) => d.free.length).length), 0);

  // Besties: Ana asks Jack from Crews and besties; Jack says yes.
  await tap(nat, 'You');
  await nat.page.getByTestId('open-crews').click();
  await tap(nat, 'Add a bestie');
  await nat.page.getByRole('button', { name: 'Jack', exact: true }).click();
  await has(nat, 'Waiting for them to say yes');
  expect('bestie request in the database', psql(`select state from private.besties where requester = '${anaId}' and addressee = '${jackId}'`), 'requested');
  await asUser('Jack', 'answer_bestie', { p_user: anaId, p_accept: true });
  await until(() => nat.page.evaluate(() => document.body.innerText.includes('1 of 5')), 20000);
  await has(nat, 'not sharing');
  await cshot(nat, '10-besties.png');
  await nat.page.getByTestId('bestie-Jack').click();
  await has(nat, 'What you share with Jack');
  await tap(nat, 'Exact times');
  await until(() => psql(`select coalesce((select share from private.share_settings where user_id = '${anaId}' and bestie = '${jackId}'), '')`) === 'exact');
  expect('Ana shares exact times with her bestie', psql(`select share from private.share_settings where user_id = '${anaId}' and bestie = '${jackId}'`), 'exact');
  await tap(nat, 'Remove bestie');
  await tap(nat, 'Remove bestie');
  await until(() => psql(`select count(*) from private.besties where requester = '${anaId}'`) === '0');
  expect('bestie removed, with the sharing settings', psql(`select count(*) from private.share_settings where bestie = '${jackId}'`), 0);
  await has(nat, 'Add a bestie');
  // Leaving the crew: quiet, and the sharing stops straight away.
  await nat.page.getByTestId('crew-The Girls').click();
  await tap(nat, 'Leave crew');
  await tap(nat, 'Leave');
  await until(() => psql(`select count(*) from private.crew_members where user_id = '${anaId}'`) === '0');
  expect('Ana left the crew; her settings for it are gone', psql(`select count(*) from private.share_settings where user_id = '${anaId}' and crew_id = '${crewId}'`), 0);
  expect('the crew carries on, now run by Jack or Mia', psql(`select count(*) from private.crews where id = '${crewId}'`), 1);
  await cshot(nat, '11-left-crew.png');
  await nat.page.getByRole('tab', { name: 'Home' }).click();
  await has(nat, 'Up for it now');

  /* ---------- the native You page ---------- */
  const you = path.join(out, 'native-you');
  fs.mkdirSync(you, { recursive: true });
  const yshot = async (p, file) => { await p.page.waitForTimeout(700); await p.page.screenshot({ path: path.join(you, file), fullPage: true }); console.log('  saved native-you/' + file); };
  const openSet = async (p, key) => {   // open a drop-down section if it is closed
    const b = p.page.getByTestId('set-' + key);
    if ((await b.getAttribute('aria-expanded')) !== 'true') await b.click();
  };
  const miaId = id('Mia'), zoeId = id('Zoe');
  const natM = await phone('Mia native', `http://127.0.0.1:${NATIVE_PORT}/`, `if (!sessionStorage.getItem('started')) { sessionStorage.setItem('started', '1'); localStorage.setItem('seshhon-session-v1', ${JSON.stringify(sessions.Mia)}); }`);
  await has(natM, "You're amber.");
  await tap(natM, 'You');
  await has(natM, 'Settings');
  await has(natM, 'Your photo');
  await has(natM, 'Username and password');
  console.log('native You text:\n' + (await natM.page.evaluate(() => document.body.innerText)).replace(/^/gm, '    '));
  await yshot(natM, '1-you.png');

  // A photo: picked with expo-image-picker, cropped to the middle square and shrunk to 160 x 160, then set_photo.
  await openSet(natM, 'photo');
  await has(natM, 'Only your friends see it on your circle');
  const chooser = natM.page.waitForEvent('filechooser');
  await tap(natM, 'Add a photo');
  await (await chooser).setFiles(path.join(out, '1-home-green.png'));   // a tall picture, 780 x 1688
  await has(natM, 'Photo saved.', 15000);
  const pic = psql(`select picture from public.profile_photos where user_id = '${miaId}'`);
  expect('photo stored as a JPEG data address', pic.startsWith('data:image/jpeg;base64,'), true);
  expect('photo small enough for the database', pic.length > 1000 && pic.length <= 60000, true);
  expect('photo is 160 x 160', await natM.page.evaluate((src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i.naturalWidth + 'x' + i.naturalHeight); i.onerror = () => ok('unreadable'); i.src = src; }), pic), '160x160');
  await has(natM, 'Change photo');
  await yshot(natM, '2-photo.png');

  // Safety: gender and the women and non-binary only mode, through set_safety.
  await openSet(natM, 'safety');
  await tap(natM, 'Woman');
  await has(natM, 'Women and non-binary only');
  await until(() => psql(`select coalesce((select gender from private.safety where user_id = '${miaId}'), '')`) === 'woman');
  await tap(natM, 'Turn on');
  await has(natM, 'Women and non-binary only is on.');
  await until(() => psql(`select coalesce((select women_only::text from private.safety where user_id = '${miaId}'), '')`) === 'true');
  expect("Mia's safety in the database", psql(`select gender || ' ' || women_only from private.safety where user_id = '${miaId}'`), 'woman true');
  await has(natM, 'Women only on');
  await yshot(natM, '3-safety.png');
  await tap(natM, 'Turn off');
  await has(natM, 'Women and non-binary only is off.');
  await until(() => psql(`select coalesce((select women_only::text from private.safety where user_id = '${miaId}'), '')`) === 'false');
  expect('women only turned off again', psql(`select women_only from private.safety where user_id = '${miaId}'`), 'f');

  // Notifications: a browser can't receive real pushes, so a stand-in phone hands out a token. This checks the switches
  // (defaults, saving, the database's own answers) and that turning notifications on saves the token through the function.
  await natM.page.evaluate(() => { window.__SESHHON_FAKE_PUSH__ = { permission: 'undetermined', token: 'ExponentPushToken[miamiamiamiamiamiamia]' }; });
  await openSet(natM, 'notifications');
  await has(natM, 'Friend requests'); await has(natM, 'Friends going Green'); await has(natM, 'Crew catch-ups');
  expect('only the two answer-type switches start on', await natM.page.evaluate(() => ['Friend requests', 'Sesh invites', 'Friends going Green', 'Crew catch-ups'].map((l) => document.querySelector('input[aria-label="' + l + '"]').checked).join()), 'true,true,false,false');
  expect('no token before asking', psql(`select count(*) from private.push_tokens where user_id = '${miaId}'`), 0);
  await tap(natM, 'Turn on notifications');
  await has(natM, 'Notifications are on.');
  expect('the token was saved for Mia through register_push_token', psql(`select count(*) from private.push_tokens where user_id = '${miaId}'`), 1);
  await natM.page.locator('input[aria-label="Friends going Green"]').click();
  await until(() => psql(`select count(*) from private.push_settings where user_id = '${miaId}' and kind = 'friend_green' and enabled`) === '1');
  expect('Friends going Green switched on in the database', psql(`select enabled from private.push_settings where user_id = '${miaId}' and kind = 'friend_green'`), 't');
  await natM.page.locator('input[aria-label="Sesh invites"]').click();
  await until(() => psql(`select count(*) from private.push_settings where user_id = '${miaId}' and kind = 'invite' and not enabled`) === '1');
  expect('Sesh invites switched off in the database', psql(`select enabled from private.push_settings where user_id = '${miaId}' and kind = 'invite'`), 'f');
  await yshot(natM, '3b-notifications.png');
  await natM.page.locator('input[aria-label="Sesh invites"]').click();   // back on, so later steps are unaffected

  // Add a friend by username (request_friend_by_username), then cancel the request from Your friends.
  await openSet(natM, 'add');
  await natM.page.getByLabel('Add by username', { exact: true }).fill('nobody_here');
  await tap(natM, 'Add');
  await has(natM, 'No one with that username.');
  await natM.page.getByLabel('Add by username', { exact: true }).fill('zoe_test');
  await tap(natM, 'Add');
  await has(natM, 'Friend request sent to Zoe.');
  expect('friend request Mia -> Zoe', psql(`select state from public.friendships where requester = '${miaId}' and addressee = '${zoeId}'`), 'requested');
  await has(natM, 'Waiting for them to accept');
  await tap(natM, 'Send your invite link');
  await has(natM, 'Copy this link and send it to a friend');
  await yshot(natM, '4-add-friend.png');
  const zoeRow = natM.page.getByText('Waiting for them to accept').locator('xpath=../..');
  await zoeRow.getByRole('button', { name: 'Cancel', exact: true }).click();
  await until(() => psql(`select count(*) from public.friendships where requester = '${miaId}' and addressee = '${zoeId}'`) === '0');
  expect('request cancelled', psql(`select count(*) from public.friendships where requester = '${miaId}' and addressee = '${zoeId}'`), 0);

  // Remove a friend: answer_friend with no, after "Remove" is asked twice, as on the web.
  await openSet(natM, 'friends');
  const anaRow = natM.page.getByTestId('friend-' + anaId);
  await anaRow.getByRole('button', { name: 'Remove', exact: true }).click();
  await anaRow.getByRole('button', { name: 'Keep', exact: true }).waitFor();
  await yshot(natM, '5-remove-confirm.png');
  await anaRow.getByRole('button', { name: 'Remove', exact: true }).click();
  await until(() => psql(`select count(*) from public.friendships where (requester = '${miaId}' and addressee = '${anaId}') or (requester = '${anaId}' and addressee = '${miaId}')`) === '0');
  expect('Mia and Ana no longer friends', psql(`select count(*) from public.friendships where (requester = '${miaId}' and addressee = '${anaId}') or (requester = '${anaId}' and addressee = '${miaId}')`), 0);

  // A new username and password: save_account, then the new recovery code.
  await openSet(natM, 'login');
  await tap(natM, 'Change password');
  await natM.page.getByLabel('Username', { exact: true }).fill('mia_renamed');
  await natM.page.getByLabel('New password', { exact: true }).fill('short');
  await tap(natM, 'Save and get a new recovery code');
  await has(natM, 'Use a password of at least 10 characters.');
  await natM.page.getByLabel('New password', { exact: true }).fill('newpassword9');
  await tap(natM, 'Save and get a new recovery code');
  await has(natM, 'Save your recovery code');
  expect("Mia's new username", psql(`select username from public.account_logins where user_id = '${miaId}'`), 'mia_renamed');
  expect('the app noted it for the login screen', await natM.page.evaluate(() => JSON.parse(localStorage.getItem('seshhon-page-store') || '{}')['seshhon-last-username']), '"mia_renamed"');
  await yshot(natM, '6-recovery-code.png');
  await tap(natM, "I've saved it");
  await has(natM, "You're logged in as mia_renamed");

  // Log out: the sign-in goes from this phone (where the app keeps it) and the walkthrough flag is cleared for the page.
  await tap(natM, 'Log out');
  await until(() => natM.page.evaluate(() => localStorage.getItem('seshhon-session-v1') === null));
  expect('native sign-in cleared on log out', await natM.page.evaluate(() => localStorage.getItem('seshhon-session-v1')), 'null');
  expect('tour flag cleared for the page', await natM.page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('seshhon-page-store') || '{}')['seshhon-tour-pending'])), 'null');
  expect('native screens gone after log out', await natM.page.evaluate(() => document.body.innerText.includes('Settings')), false);
  await yshot(natM, '7-logged-out.png');

  // And back in, with the new username and password, through the web login (which hands the app the sign-in).
  const login = await phone('Mia login', `http://127.0.0.1:${WEB_PORT}/`);
  await tap(login, 'I already have an account');
  await login.page.fill('#login-user', 'mia_renamed');
  await login.page.fill('#login-pass', 'newpassword9');
  await tap(login, 'Log in');
  await has(login, 'Your status');
  const miaAgain = await login.page.evaluate(() => localStorage.getItem('seshhon-session-v1'));
  await login.ctx.close();
  await natM.page.evaluate((s) => localStorage.setItem('seshhon-session-v1', s), miaAgain);
  await natM.page.reload();
  await has(natM, "You're amber.");
  await tap(natM, 'You');
  await openSet(natM, 'login');
  await has(natM, "You're logged in as mia_renamed");
  console.log('logged back in on the native You page: yes');

  // An email for login codes: the email-code function sends a code, two_step_check confirms it, and this
  // phone is remembered so its next login skips the code.
  await natM.page.getByLabel('Email for login codes', { exact: true }).fill('mia.new@example.com');
  await tap(natM, 'Send me a code');
  await has(natM, 'Confirm your email');
  const mail = await (await fetch(API + '/__fake/last-email', { method: 'POST', headers: { apikey: 'test-anon-key' } })).json();
  expect('code sent to the new email', mail.email, 'mia.new@example.com');
  await yshot(natM, '8-confirm-email.png');
  await natM.page.getByLabel('Code from the email', { exact: true }).fill(mail.code);
  await tap(natM, 'Confirm email');
  await has(natM, 'Email confirmed. New logins will ask for a code from it.');
  expect('email confirmed in the database', psql(`select email from private.two_step where user_id = '${miaId}'`), 'mia.new@example.com');
  await has(natM, 'Save your recovery code');   // a fresh recovery code, also emailed
  await has(natM, 'We also emailed it to', 10000);
  await until(() => natM.page.evaluate(() => !!JSON.parse(JSON.parse(localStorage.getItem('seshhon-page-store') || '{}')['seshhon-remembered-phone'] || '{}')));
  const phonesKept = await natM.page.evaluate(() => JSON.parse(JSON.parse(localStorage.getItem('seshhon-page-store') || '{}')['seshhon-remembered-phone'] || '{}'));
  expect('this phone remembered for Mia', typeof phonesKept[miaId] === 'string' && phonesKept[miaId].length > 10, true);
  expect('remembered phone in the database', psql(`select count(*) from private.two_step_devices where user_id = '${miaId}'`), 1);
  await yshot(natM, '9-email-confirmed.png');
  await tap(natM, "I've saved it");
  await has(natM, 'New logins also need a code sent to');

  // The tour, from "Show the tour".
  await openSet(natM, 'tour');
  await tap(natM, 'Show the tour');
  await has(natM, 'Welcome, Mia.');
  await yshot(natM, '10-tour.png');
  await tap(natM, 'Show me');
  await has(natM, "Slide to show you're up for it");
  await tap(natM, 'Skip');
  await natM.page.waitForTimeout(500);
  expect('tour closed', await natM.page.evaluate(() => document.body.innerText.includes('Slide to show')), false);
  await openSet(natM, 'about');
  await has(natM, 'Privacy Policy');
  await yshot(natM, '11-about.png');
  await natM.ctx.close();

  // Delete an account (Zoe's): delete_account, then the sign-in and her remembered username go from this phone.
  const natZ = await phone('Zoe native', `http://127.0.0.1:${NATIVE_PORT}/`, `if (!sessionStorage.getItem('started')) { sessionStorage.setItem('started', '1'); localStorage.setItem('seshhon-session-v1', ${JSON.stringify(sessions.Zoe)}); }`);
  await has(natZ, "You're red.");
  await tap(natZ, 'You');
  await openSet(natZ, 'account');
  await tap(natZ, 'Delete my account');
  await has(natZ, 'This removes your name, friends, votes and ratings for good.');
  await yshot(natZ, '12-delete-confirm.png');
  await tap(natZ, 'Delete for good');
  await until(() => natZ.page.evaluate(() => localStorage.getItem('seshhon-session-v1') === null));
  expect("Zoe's profile gone", psql(`select count(*) from public.profiles where id = '${zoeId}'`), 0);
  expect("Zoe's friendships gone", psql(`select count(*) from public.friendships where requester = '${zoeId}' or addressee = '${zoeId}'`), 0);
  expect('native sign-in cleared on delete', await natZ.page.evaluate(() => localStorage.getItem('seshhon-session-v1')), 'null');
  expect('last username cleared for the page', await natZ.page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('seshhon-page-store') || '{}')['seshhon-last-username'])), 'null');
  await natZ.ctx.close();

  /* ---------- the native sign-up and login ---------- */
  // Signing up, the email code, the recovery code, the tour, an invite link, logging out and in, the login code on
  // a new phone, and "Forgot your password", all on the native screens (the human check is the test's pretend one).
  const auth = path.join(out, 'native-auth');
  fs.mkdirSync(auth, { recursive: true });
  const ashot = async (p, file) => { await p.page.waitForTimeout(700); await p.page.screenshot({ path: path.join(auth, file), fullPage: true }); console.log('  saved native-auth/' + file); };
  const fillL = (p, label, text) => p.page.getByLabel(label, { exact: true }).fill(text);
  const lastMail = async () => (await fetch(API + '/__fake/last-email', { method: 'POST', headers: { apikey: 'test-anon-key' } })).json();
  const memory = (p, key) => p.page.evaluate((k) => JSON.parse(JSON.parse(localStorage.getItem('seshhon-page-store') || '{}')[k] || 'null'), key);
  const NAT = `http://127.0.0.1:${NATIVE_PORT}/`;

  // Under 18: the screen that says so, and it stays that way on this phone.
  const kid = await phone('under 18', NAT);
  await has(kid, "Tell your friends you're up for a sesh.");
  await fillL(kid, 'Your first name', 'Kid'); await fillL(kid, 'Date of birth', '01/01/' + (new Date().getFullYear() - 10));
  await fillL(kid, 'Pick a username', 'kid_test'); await fillL(kid, 'Make a password', 'longenough1'); await fillL(kid, 'Your email', 'kid@example.com');
  await tap(kid, 'Get started');
  await has(kid, 'Frendzy is for people aged 18 and over.');
  await kid.page.reload();
  await has(kid, 'Frendzy is for people aged 18 and over.');
  expect('no account made for under 18', psql("select count(*) from public.profiles where name = 'Kid'"), 0);
  await kid.ctx.close();

  // Sign up from an invite link (Ana's), with a check on each box first.
  const nina = await phone('Nina', NAT + '?invite=' + code, `window.__SESHHON_FAKE_PUSH__ = { permission: 'granted', token: 'ExponentPushToken[ninaninaninaninaninanina]' };`);
  await has(nina, 'A friend invited you. Sign up and they will get your friend request.');
  await ashot(nina, '1-sign-up.png');
  await tap(nina, 'Get started');
  await has(nina, 'Enter your first name to continue.');
  await fillL(nina, 'Your first name', 'Nina');
  await tap(nina, 'Get started'); await has(nina, 'Enter your date of birth.');
  await fillL(nina, 'Date of birth', '20/03/1994');
  await tap(nina, 'Get started'); await has(nina, 'Pick a username of 3 to 20 letters, numbers or _.');
  await fillL(nina, 'Pick a username', 'nina_test');
  await tap(nina, 'Get started'); await has(nina, 'Use a password of at least 10 characters.');
  await fillL(nina, 'Make a password', 'longenough1');
  await tap(nina, 'Get started'); await has(nina, 'Enter your email address. Login codes go there.');
  await fillL(nina, 'Your email', 'nina@example.com');
  await tap(nina, 'Show password');
  expect('the eye shows the password', (await nina.page.getByLabel('Make a password', { exact: true }).getAttribute('type')) !== 'password', true);
  await tap(nina, 'Get started');
  await has(nina, 'Confirm your email');
  expect('profile made for Nina', psql("select count(*) from public.profiles where name = 'Nina'"), 1);
  expect("Nina's username", psql("select username from public.account_logins l join public.profiles p on p.id = l.user_id where p.name = 'Nina'"), 'nina_test');
  const ninaId = id('Nina');
  const ninaMail = await lastMail();
  expect('setup code sent to her email', ninaMail.email, 'nina@example.com');
  await ashot(nina, '2-confirm-email.png');
  await fillL(nina, 'Code from the email', '000000');
  await tap(nina, 'Confirm email'); await has(nina, 'That');   // the database's own words for a wrong code
  await fillL(nina, 'Code from the email', ninaMail.code);
  await tap(nina, 'Confirm email');
  await has(nina, 'Save your recovery code');
  await has(nina, 'We also emailed it to', 10000);
  expect('email confirmed in the database', psql(`select email from private.two_step where user_id = '${ninaId}'`), 'nina@example.com');
  const ninaCode = (await nina.page.getByTestId('recovery-code').innerText()).trim();
  expect('a recovery code was shown', /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/.test(ninaCode), true);
  expect('the recovery code was emailed too', (await lastMail()).recovery, ninaCode);
  await ashot(nina, '3-recovery-code.png');
  await tap(nina, "I've saved it");
  await has(nina, 'Welcome, Nina.');   // the tour after sign-up
  await ashot(nina, '4-tour.png');
  await tap(nina, 'Show me');
  await tap(nina, 'Skip');
  await has(nina, 'Your status');
  expect('the invite sent a friend request to Ana', psql(`select count(*) from public.friendships where requester = '${ninaId}' and addressee = '${anaId}'`), 1);
  expect('the tour flag is cleared', await memory(nina, 'seshhon-tour-pending'), null);
  expect('last username noted', await memory(nina, 'seshhon-last-username'), 'nina_test');
  expect('signed in on the phone', await nina.page.evaluate(() => !!localStorage.getItem('seshhon-session-v1')), true);
  await ashot(nina, '5-home-after-sign-up.png');

  // Log out from the You page, and back in on the same phone: the password is wrong once, and the email code is skipped
  // because this phone confirmed the email.
  await until(() => psql(`select count(*) from private.push_tokens where user_id = '${ninaId}'`) === '1');
  expect("Nina's push token was saved after she signed in", psql(`select count(*) from private.push_tokens where user_id = '${ninaId}'`), 1);
  await tap(nina, 'You');
  await openSet(nina, 'login');
  await tap(nina, 'Log out');
  await until(() => psql(`select count(*) from private.push_tokens where user_id = '${ninaId}'`) === '0');
  await has(nina, 'Logged out. Log in again with your username and password.');
  await has(nina, "Tell your friends you're up for a sesh.");
  expect('and removed again on log out', psql(`select count(*) from private.push_tokens where user_id = '${ninaId}'`), 0);
  expect('sign-in cleared on log out', await nina.page.evaluate(() => localStorage.getItem('seshhon-session-v1')), 'null');
  await tap(nina, 'I already have an account');
  await has(nina, 'Log in');
  expect('username filled in', await nina.page.getByLabel('Username or email', { exact: true }).inputValue(), 'nina_test');
  await tap(nina, 'Log in'); await has(nina, 'Enter your username or email, and your password.');
  await fillL(nina, 'Password', 'wrongpassword1');
  await tap(nina, 'Log in'); await has(nina, "That username and password don't match.");
  await ashot(nina, '6-log-in.png');
  await fillL(nina, 'Password', 'longenough1');
  await tap(nina, 'Log in');
  await has(nina, 'Your status');
  expect('back in without a code on the remembered phone', await nina.page.evaluate(() => document.body.innerText.includes('Check your email')), false);
  await nina.ctx.close();

  // A new phone logs in with the email: the password, then the code from the email. A wrong code is refused.
  const ninaNew = await phone('Nina on a new phone', NAT);
  await tap(ninaNew, 'I already have an account');
  await fillL(ninaNew, 'Username or email', 'nina@example.com'); await fillL(ninaNew, 'Password', 'longenough1');
  await tap(ninaNew, 'Log in');
  await has(ninaNew, 'Check your email');
  await has(ninaNew, 'We sent a 6-digit code to');
  expect('login code emailed', (await lastMail()).email, 'nina@example.com');
  await ashot(ninaNew, '7-login-code.png');
  await tap(ninaNew, 'Log in'); await has(ninaNew, 'Enter the 6-digit code from the email.');
  await fillL(ninaNew, 'Code from the email', '000000');
  await tap(ninaNew, 'Log in'); await has(ninaNew, 'That');
  await tap(ninaNew, 'Send a new code');
  await has(ninaNew, 'We sent a 6-digit code to');
  await fillL(ninaNew, 'Code from the email', (await lastMail()).code);
  await tap(ninaNew, 'Log in');
  await has(ninaNew, 'Your status');
  await until(() => memory(ninaNew, 'seshhon-remembered-phone').then((m) => !!m && typeof m[ninaId] === 'string'));
  expect('two phones remembered (sign-up and the new phone)', psql(`select count(*) from private.two_step_devices where user_id = '${ninaId}'`), 2);
  await ninaNew.ctx.close();

  // Forgot the password: the recovery code and a new password, the new recovery code, then log in (no email code, the
  // recovery code vouches for this login).
  const forgot = await phone('Nina forgot', NAT);
  await tap(forgot, 'I already have an account');
  await tap(forgot, 'Forgot your password?');
  await tap(forgot, 'Use your recovery code instead');
  await has(forgot, 'Enter the recovery code you saved');
  await tap(forgot, 'Set new password'); await has(forgot, 'Enter your username or email, and your recovery code.');
  await fillL(forgot, 'Username or email', 'nina_test'); await fillL(forgot, 'Recovery code', 'AAAA-BBBB-CCCC-DDDD');
  await fillL(forgot, 'New password', 'short');
  await tap(forgot, 'Set new password'); await has(forgot, 'Use a password of at least 10 characters.');
  await fillL(forgot, 'New password', 'brandnewpass1');
  await tap(forgot, 'Set new password');
  await has(forgot, "That");   // a wrong recovery code is refused with the database's words
  await ashot(forgot, '8-recover.png');
  await fillL(forgot, 'Recovery code', ninaCode);
  await tap(forgot, 'Set new password');
  await has(forgot, 'Save your recovery code');
  await has(forgot, 'We also emailed it to', 10000);
  const newerCode = (await forgot.page.getByTestId('recovery-code').innerText()).trim();
  expect('a new recovery code', newerCode !== ninaCode && /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/.test(newerCode), true);
  await ashot(forgot, '9-new-recovery-code.png');
  await tap(forgot, "I've saved it");
  await has(forgot, 'Log in');
  expect('username filled in after recovery', await forgot.page.getByLabel('Username or email', { exact: true }).inputValue(), 'nina_test');
  await fillL(forgot, 'Password', 'brandnewpass1');
  await tap(forgot, 'Log in');
  await has(forgot, 'Your status');
  expect('no email code after a recovery', await forgot.page.evaluate(() => document.body.innerText.includes('Check your email')), false);
  await forgot.ctx.close();

  // Forgot the password and the recovery code: a code to the confirmed email, then a new password.
  const reset = await phone('Nina reset', NAT);
  await tap(reset, 'I already have an account');
  await tap(reset, 'Forgot your password?');
  await fillL(reset, 'Email', 'Nina@Example.com');
  await tap(reset, 'Email me a code');
  await has(reset, 'If nina@example.com has a Frendzy account');
  const resetMail = await lastMail();
  expect('a reset code emailed to her confirmed email', resetMail.reset && resetMail.email === 'nina@example.com' && resetMail.username === 'nina_test', true);
  await fillL(reset, 'Code from the email', resetMail.code === '000000' ? '111111' : '000000'); await fillL(reset, 'New password', 'resetbyemail1');
  await tap(reset, 'Set new password'); await has(reset, "That code isn't right");
  await fillL(reset, 'Code from the email', resetMail.code);
  await tap(reset, 'Set new password');
  await has(reset, 'Your password is changed');
  await ashot(reset, '9b-reset-by-email.png');
  expect('username filled in after the reset', await reset.page.getByLabel('Username or email', { exact: true }).inputValue(), 'nina_test');
  await fillL(reset, 'Password', 'resetbyemail1');
  await tap(reset, 'Log in');
  await has(reset, 'Your status');
  expect('no email code straight after an email reset', await reset.page.evaluate(() => document.body.innerText.includes('Check your email')), false);
  await reset.ctx.close();

  // The 18+ check: the database asks for it, the pretend provider fails the first try and passes the next, and "Later"
  // skips the email.
  await fetch(API + '/__fake/age-check', { method: 'POST', headers: { apikey: 'test-anon-key', 'Content-Type': 'application/json' }, body: JSON.stringify({ required: true, outcome: 'failed' }) });
  const omar = await phone('Omar', NAT);
  await fillL(omar, 'Your first name', 'Omar'); await fillL(omar, 'Date of birth', '02/02/1992');
  await fillL(omar, 'Pick a username', 'omar_test'); await fillL(omar, 'Make a password', 'longenough1'); await fillL(omar, 'Your email', 'omar@example.com');
  await tap(omar, 'Get started');
  await has(omar, 'Quick age check');
  expect('no account yet while the age check is open', psql("select count(*) from public.profiles where name = 'Omar'"), 0);
  await ashot(omar, '10-age-check.png');
  await tap(omar, 'Start age check');
  await has(omar, "We couldn't confirm you're 18 or over.");
  await fetch(API + '/__fake/age-check', { method: 'POST', headers: { apikey: 'test-anon-key', 'Content-Type': 'application/json' }, body: JSON.stringify({ outcome: 'passed' }) });
  await tap(omar, 'Start again');
  await has(omar, 'Confirm your email');
  expect('account made after the age check', psql("select count(*) from public.profiles where name = 'Omar'"), 1);
  await tap(omar, 'Later');
  await has(omar, 'Save your recovery code');
  await tap(omar, "I've saved it");
  await has(omar, 'Welcome, Omar.');
  await tap(omar, 'Skip');
  await has(omar, 'Your status');
  await fetch(API + '/__fake/age-check', { method: 'POST', headers: { apikey: 'test-anon-key', 'Content-Type': 'application/json' }, body: JSON.stringify({ required: false }) });
  await omar.ctx.close();

  /* ---------- the web half inside the app ---------- */
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
  console.log('messages so far (what the page keeps for the app, the "past sign-up" one, then the tab it moved to when asked): ' + JSON.stringify(posted));
  expect('page messages', JSON.stringify(posted), JSON.stringify(['store', 'store', 'store', 'ready', 'tab']));
  // Opened on one venue (from the native Sesh tab): the page shows it, and its back button tells the app to
  // go back to the Sesh tab.
  const venueId = psql("select id from public.venues where lat is not null order by name limit 1");
  const venueName = psql("select name from public.venues where lat is not null order by name limit 1");
  const onVenue = await phone('venue', `http://127.0.0.1:${WEB_PORT}/`, `
    window.__posted = [];
    window.ReactNativeWebView = { postMessage: function (m) { window.__posted.push(JSON.parse(m)); } };
    window.SESHHON_TAB = 'sesh';
    window.SESHHON_VENUE = ${JSON.stringify(venueId)};
    localStorage.setItem('seshhon-session-v1', ${JSON.stringify(session)});
  `);
  await has(onVenue, venueName);
  await onVenue.page.waitForSelector('button.back[data-act="close"]');
  await sshot(onVenue, '17-venue-page.png');
  await onVenue.page.locator('button.back[data-act="close"]').first().click();
  await until(() => onVenue.page.evaluate(() => window.__posted.some((m) => m.type === 'tab')));
  expect('page told the app it went back to Sesh', JSON.stringify(await onVenue.page.evaluate(() => window.__posted.filter((m) => m.type === 'tab'))), JSON.stringify([{ type: 'tab', tab: 'sesh' }]));
  await onVenue.ctx.close();
  // After the native You page logs out, the app opens the page with a line to show, and the page's storage as the app keeps it.
  const afterOut = await phone('after log out', `http://127.0.0.1:${WEB_PORT}/`, `
    window.__posted = [];
    window.ReactNativeWebView = { postMessage: function (m) { window.__posted.push(JSON.parse(m)); } };
    window.SESHHON_TOAST = 'Logged out. Log in again with your username and password.';
    localStorage.removeItem('seshhon-session-v1');
  `);
  await has(afterOut, 'Logged out. Log in again with your username and password.');
  await has(afterOut, 'Get started');
  await sshot(afterOut, '18-page-after-native-log-out.png');
  await afterOut.ctx.close();
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
  console.log(process.exitCode ? 'SOME CHECKS FAILED' : 'ALL CHECKS RAN');
} catch (e) {
  console.log('crashed: ' + e.message);
  process.exitCode = 1;
} finally {
  await browser.close(); api.kill(); web.close(); nativeWeb.close(); nativeNoKey.close();
  try { execSync(`runuser -u postgres -- /usr/lib/postgresql/16/bin/pg_ctl -D $(dirname ${sock})/data -m immediate stop`, { stdio: 'ignore', shell: '/bin/bash' }); } catch {}
}
