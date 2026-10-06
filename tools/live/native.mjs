// Tries the phone app's native screens in a browser, against a local stand-in database with the real rules.
// Phone builds can't be made here, so the screens are built for Expo's web target instead (react-native-web)
// and driven with Playwright. It starts the test database and the fake Supabase from tools/live, signs up a
// handful of people in the web app so there are real friends with real statuses, then opens the native Home
// as one of them and takes pictures. Then the native Sesh tab: Ana starts a sesh, Jack joins it on his own
// phone, both vote, they chat both ways, Ana reports and blocks, plans a crawl and plans a sesh for later,
// and every tap is checked in the database. It also checks the web half the app packs in: that it opens on the
// tab the app asks for, switches tabs when the app says so, tells the app when it moves to another tab by
// itself, opens on a venue when asked, and tells the app when the sign-in changes.
// Then the native You page, as Mia and Zoe on their own phones: a photo, Safety, adding a friend by username
// and cancelling the request, removing a friend, a new username and password, an email for login codes,
// log out and back in, and deleting an account, each checked in the database.
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
execSync('node scripts/bundle-web.mjs', { cwd: path.join(root, 'mobile'), stdio: 'inherit' });   // the packed page and docs/hours.js
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
  await browser.close(); api.kill(); web.close(); nativeWeb.close();
  try { execSync(`runuser -u postgres -- /usr/lib/postgresql/16/bin/pg_ctl -D $(dirname ${sock})/data -m immediate stop`, { stdio: 'ignore', shell: '/bin/bash' }); } catch {}
}
