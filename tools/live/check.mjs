// Several simulated phones use the live web app at once, against a local test database.
// Run: node tools/live/check.mjs   (needs PostgreSQL 15+ and Playwright's Chromium)
import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../..');
const API = 'http://127.0.0.1:54330', WEB_PORT = 54331;
let dealsOn = true;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };

// 1. throwaway database with the real migrations
const copy = fs.mkdtempSync('/tmp/sb-live-');
execSync(`cp -r ${root}/supabase ${copy}/ && chmod -R a+rX ${copy} && chmod a+rx ${copy}`);
const setup = execSync(`ONLY_SETUP=1 bash ${copy}/supabase/tests/run.sh`, { encoding: 'utf8' });
const [, sock, dbPort] = setup.match(/socket dir (\S+) port (\d+)/);
// 20 extra venues about 3 km out, so the sesh vote list has to pick the nearest few.
execSync(`psql -X -q -h ${sock} -p ${dbPort} -U postgres -c "insert into public.venues (name, kind, lat, lng) select 'Filler ' || g, 'Bar', -31.9523 + 0.027, 115.8613 + g * 0.0005 from generate_series(1, 20) g"`);
console.log('database ready');

// 2. the stand-in for Supabase's web address, and a static server for docs/
const api = spawn('node', [path.join(here, 'fake-supabase.mjs'), sock, dbPort, '54330'], { stdio: 'inherit' });
const web = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/config.js') { res.setHeader('Content-Type', 'text/javascript'); // Serve the real docs/config.js, only swapping the address and key, so a misnamed setting is caught here.
    return res.end(fs.readFileSync(path.join(root, 'docs/config.js'), 'utf8').replace(/url: '[^']*'/, `url: '${API}'`).replace(/key: '[^']*'/, "key: 'test-anon-key'").replace(/pollMs: \d+/, 'pollMs: 600, chatPollMs: 500').replace(/deals: (true|false)/, 'deals: ' + dealsOn).replace(/captchaSiteKey: '[^']*'/, "captchaSiteKey: ''").replace(/googleRatings: (true|false)/, 'googleRatings: true')); }
  const f = path.join(root, 'docs', p === '/' ? 'index.html' : p);
  if (f === path.join(root, 'docs/index.html')) { // The security policy must allow the real Supabase address; here it is swapped for the stand-in.
    const html = fs.readFileSync(f, 'utf8'), live = fs.readFileSync(path.join(root, 'docs/config.js'), 'utf8').match(/url: '([^']*)'/)[1];
    if (!html.includes('connect-src ' + live + ';')) { res.statusCode = 500; return res.end('index.html connect-src does not match config.js url ' + live); }
    res.setHeader('Content-Type', 'text/html'); return res.end(html.replace('connect-src ' + live + ';', 'connect-src ' + API + ';'));
  }
  if (!f.startsWith(path.join(root, 'docs')) || !fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream'); res.end(fs.readFileSync(f));
}).listen(WEB_PORT);
await new Promise((r) => setTimeout(r, 800));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const consoleErrors = [];
const tile = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');   // stand-in map tile
async function phone(name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, timezoneId: 'Australia/Perth' });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ contentType: 'image/png', body: tile }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => consoleErrors.push(name + ': ' + e.message));
  page.on('console', (m) => { if (/Content Security Policy/.test(m.text())) consoleErrors.push(name + ': ' + m.text()); });
  return { name, ctx, page };
}
const text = (p) => p.page.locator('body').innerText();
const has = async (p, s, t = 4000) => { try { await p.page.waitForFunction((x) => document.body.innerText.toLowerCase().includes(x.toLowerCase()), s, { timeout: t }); return true; } catch { return false; } };
const gone = async (p, s, t = 4000) => { try { await p.page.waitForFunction((x) => !document.body.innerText.toLowerCase().includes(x.toLowerCase()), s, { timeout: t }); return true; } catch { return false; } };
const lastEmail = () => fetch('http://127.0.0.1:54330/__fake/last-email', { method: 'POST', headers: { apikey: 'test-anon-key' } }).then((r) => r.json());
const tap = (p, label) => p.page.getByRole('button', { name: label, exact: true }).first().click();
async function signUp(p, name, link) {
  await p.page.goto(`http://127.0.0.1:${WEB_PORT}/${link || ''}`);
  await p.page.fill('#name', name);
  await p.page.fill('#dob', '1995-04-12');
  await p.page.fill('#join-user', name.toLowerCase().replace(/[^a-z0-9_]/g, '') + '_live');
  await p.page.fill('#join-pass', 'longenough1');
  await p.page.fill('#join-email', name.toLowerCase().replace(/[^a-z0-9_]/g, '') + '@example.com');
  await tap(p, 'Get started');
  await has(p, 'Confirm your email'); await tap(p, 'Later');   // email codes are checked in full for Ana and Fay
  await has(p, 'Save your recovery code');
  await tap(p, "I've saved it");
  await has(p, 'Your status');
}
async function tab(p, t) { await (t === 'You' ? p.page.locator('button.profile-btn') : p.page.locator(`nav button:has-text("${t}")`)).click(); }   // You is the profile button at the top right
async function inviteOf(p) { await tab(p, 'You'); await tap(p, 'Send your invite link'); const l = await p.page.locator('#invite-link').innerText(); return l.slice(l.indexOf('?')); }

try {
  const ana = await phone('Ana'), ben = await phone('Ben'), cam = await phone('Cam');

  console.log('Sign-up');
  await ana.page.goto(`http://127.0.0.1:${WEB_PORT}/`);
  await ana.page.fill('#name', 'Ana'); await tap(ana, 'Get started');
  ok(await has(ana, 'Enter your date of birth'), 'cannot sign up without a date of birth');
  await ana.page.fill('#dob', '2015-06-01'); await tap(ana, 'Get started');
  ok(await has(ana, 'aged 18 and over') && (await ana.page.locator('#name').count()) === 0, 'an under-18 date of birth is turned away');
  await ana.page.reload(); 
  ok(await has(ana, 'aged 18 and over') && (await ana.page.locator('#name').count()) === 0, 'and stays turned away after a reload');
  await ana.page.evaluate(() => localStorage.clear()); await ana.page.reload();
  await ana.page.fill('#name', 'Ana'); await ana.page.fill('#dob', '1995-04-12'); await tap(ana, 'Get started');
  ok(await has(ana, 'Pick a username of 3 to 20'), 'cannot sign up without a username');
  await ana.page.fill('#join-user', 'Ana_1'); await ana.page.fill('#join-pass', 'short'); await tap(ana, 'Get started');
  ok(await has(ana, 'at least 10 characters'), 'a short password is explained');
  await ana.page.fill('#join-pass', 'longenough1'); await tap(ana, 'Get started');
  ok(await has(ana, 'Enter your email address'), 'cannot sign up without an email');
  await ana.page.fill('#join-email', 'Ana@Example.com');
  if (process.env.SHOTS) { await ana.page.evaluate(() => { document.getElementById('join-error').hidden = true; }); await ana.page.screenshot({ path: process.env.SHOTS + '/sign-up.png', fullPage: true }); }
  await tap(ana, 'Get started');
  ok(await has(ana, 'Confirm your email') && await has(ana, 'a•••@example.com'), 'signing up sends a code to confirm the email, and only a hint of it is shown');
  ok((await lastEmail()).email === 'ana@example.com', 'the code goes to Ana\'s email');
  await ana.page.fill('#ec-code', '00000'); await tap(ana, 'Confirm email');
  ok(await has(ana, '6-digit code'), 'a short code is explained');
  await ana.page.fill('#ec-code', (await lastEmail()).code); await tap(ana, 'Confirm email');
  ok(await has(ana, 'Save your recovery code') && await has(ana, 'ana_1'), 'after confirming the email, signing up shows the username and a recovery code');
  ok(await has(ana, 'We also emailed it to a•••@example.com'), 'the recovery code is emailed to Ana as well');
  ok(await ana.page.evaluate(async () => { const r = await (await fetch('http://127.0.0.1:54330/__fake/last-email', { method: 'POST', headers: { apikey: 'test-anon-key' } })).json(); return r.recovery === document.getElementById('recovery-code').innerText.trim(); }), 'and the email holds the same code that is on screen');
  await tap(ana, "I've saved it");
  ok(await has(ana, "You're red."), 'Ana signs up and starts Red');
  ok(await has(ana, 'Add your friends'), 'a new person is told to add friends');

  console.log('Invite links and friends');
  const anaLink = await inviteOf(ana);
  ok(/^\?invite=[A-Z0-9]{6,}/.test(anaLink), 'Ana gets an invite link: ' + anaLink);
  await signUp(ben, 'Ben', anaLink);
  await tab(ana, 'Home');
  ok(await has(ana, 'Ben wants to add you'), 'Ana sees Ben\'s friend request without refreshing');
  await tap(ana, 'Accept');
  ok(await has(ana, 'Friends are hidden while you\'re red'), 'accepted; Ana is Red so friends stay hidden');
  ok(await has(ben, 'Friends are hidden'), 'Ben sees he is friends with Ana (Red hides her)');

  await signUp(cam, 'Cam', anaLink);
  await tap(ana, 'Accept');

  console.log('Status and privacy');
  await tap(ben, 'Green');
  ok(await has(ben, "You're green."), 'Ben goes Green');
  ok(!(await text(ana)).includes('Ben') || (await text(ana)).includes('hidden'), 'Ana is Red so she cannot see Ben');
  await tap(ana, 'Green');
    ok(await has(ana, 'Up for it now'), 'Ana goes Green and sees the friends list');
  const anaHome = await text(ana);
  ok(/Ben\s+Green/.test(anaHome), 'Ana sees Ben is Green');
  ok(/Cam\s+Red/.test(anaHome), 'Ana sees Cam as Red');
  ok((await cam.page.locator('.friend').count()) === 0 && !(await text(cam)).includes('Up for it now'), 'Cam (Red) cannot see Ana');
  await tap(cam, 'Amber');
  ok(await has(cam, 'Up for it now'), 'Cam goes Amber and sees friends');
  ok(/Ana\s+Green/.test(await text(cam)), 'Cam (Amber) sees Ana is Green');
  ok(await ana.page.waitForFunction(() => /Cam\s+Amber/.test(document.body.innerText), null, { timeout: 4000 }).then(() => true, () => false), 'Ana sees Cam Amber within a poll');

  console.log('Sesh');
  await tap(ana, 'Start a sesh');
  ok(await has(ana, "Tonight's sesh") && await has(ana, 'Where to?'), 'Ana starts a sesh and sees venues');
  ok(await has(ana, 'Find more on the map') && await ana.page.locator('[data-act="vote"]').count() === 8 && await has(ana, 'Bodega Nine'), 'the vote list shows only the 8 nearest venues');
  await tab(ben, 'Sesh');
  ok(await has(ben, "Ana's sesh"), 'Ben sees Ana\'s sesh');
  await tap(ben, 'Join');
  ok(await has(ben, '2 in'), 'Ben joins: 2 in');
  await tab(cam, 'Sesh');
  ok(await has(cam, "Ana's sesh"), 'Cam (Amber) sees the sesh');
  await tap(cam, 'Join');
  ok(await has(cam, '3 in'), 'Cam joins: 3 in');

  const voteFor = async (p, venue) => { await p.page.locator('.card', { hasText: venue }).getByRole('button', { name: /Vote|Your vote/ }).click(); };
  await voteFor(ben, 'Bodega Nine');
  await voteFor(cam, 'Bodega Nine');
  await voteFor(ana, 'Lowtide Bar');
  ok(await has(ana, 'Lock in Bodega Nine'), 'two votes beat one: lock button names Bodega Nine');
  ok(!(await text(ben)).includes('Lock in'), 'only the organiser can lock in');
  await tap(ana, 'Lock in Bodega Nine');
  ok(await has(ben, 'Locked in', 10000) && (await text(ben)).includes('Bodega Nine'), 'Ben sees it locked in');

  console.log('Chat');
  const say = async (p, text) => { await p.page.fill('#chat-input', text); await tap(p, 'Send'); };
  await say(ben, 'Lowtide at 8?');
  ok(await has(ana, 'Lowtide at 8?') && await has(cam, 'Lowtide at 8?'), 'Ana and Cam see Ben\'s message');
  await cam.page.fill('#chat-input', 'half typed');
  await say(ana, 'Yes please');
  ok(await has(cam, 'Yes please'), 'Cam sees Ana\'s reply');
  ok((await cam.page.inputValue('#chat-input')) === 'half typed', 'Cam\'s half-typed message survives new messages arriving');
  await cam.page.fill('#chat-input', '');
  await cam.page.locator('.msg', { hasText: 'Lowtide at 8?' }).getByRole('button', { name: 'Report', exact: true }).click();
  await cam.page.locator('.msg', { hasText: 'Lowtide at 8?' }).getByRole('button', { name: 'Report', exact: true }).click();
  ok(await has(cam, 'Reported'), 'Cam reports a message');
  ok(execSync(`psql -X -tA -h ${sock} -p ${dbPort} -U postgres -d postgres -c "select count(*) from public.reports where message_body = 'Lowtide at 8?'"`, { encoding: 'utf8' }).trim() === '1', 'the report keeps a copy of the message');
  await cam.page.locator('.msg', { hasText: 'Lowtide at 8?' }).getByRole('button', { name: 'Block', exact: true }).click();
  await cam.page.locator('.msg', { hasText: 'Lowtide at 8?' }).getByRole('button', { name: 'Block', exact: true }).click();
  ok(await gone(cam, 'Lowtide at 8?'), 'Cam blocks Ben and his messages vanish for Cam');
  ok(await has(ana, 'Lowtide at 8?', 1500), 'Ana still sees Ben\'s message');
  await tab(cam, 'You');
  ok(await has(cam, 'Blocked people') && await has(cam, 'Unblock'), 'the blocked person appears under You');
  await tap(cam, 'Unblock');
  ok(await gone(cam, 'Blocked people'), 'Cam unblocks Ben');
  await tab(cam, 'Sesh');
  ok(await has(cam, 'Lowtide at 8?'), 'Ben\'s messages are back for Cam');
  await cam.page.screenshot({ path: path.join(copy, 'chat.png') });
  await tab(ben, 'Venues');
  ok(await has(ben, 'Bodega Nine') && await has(ben, 'Example venue'), 'the Venues tab lists the example venues');

  console.log('Venue map');
  ok(await ben.page.locator('.leaflet-container').count() === 0, 'the Venues tab is a plain list with no map');
  ok(await ben.page.locator('nav button:has-text("You")').count() === 0 && await ben.page.locator('button.profile-btn').count() === 1, 'You is a profile button at the top right, not a tab');
  const sent = [];
  ben.page.on('request', (r) => { if (r.url().startsWith(API)) sent.push(r.url() + ' ' + (r.postData() || '')); });
  await tab(ben, 'Map');
  ok(await has(ben, 'Choose where to look') && await ben.page.locator('.leaflet-container .leaflet-marker-icon.leaflet-interactive').count() === 0, 'no venues show until you choose where to look');
  await ben.page.evaluate(() => { document.getElementById('view').scrollTop = 0; });
  await ben.page.screenshot({ path: path.join(copy, 'map-choose.png') });
  await ben.page.fill('#venue-search', 'bodega');
  ok(await has(ben, '1 venue matches') && await ben.page.locator('.leaflet-container .leaflet-marker-icon.leaflet-interactive').count() === 1, 'searching finds a venue by name before choosing where to look');
  await ben.page.fill('#venue-search', 'live music');
  ok(await has(ben, 'The Paper Lantern') && !(await ben.page.locator('#venue-list').innerText()).includes('Bodega Nine'), 'search matches venue kinds too');
  await ben.page.waitForTimeout(5600);   // a background refresh must not wipe the search box
  ok(await ben.page.locator('#venue-search').inputValue() === 'live music', 'the search survives background refreshes');
  await ben.page.locator('#venue-list').getByRole('button', { name: 'Show' }).first().click();
  ok(await ben.page.locator('#map-pick').count() === 1, 'Show puts a found venue under the map');
  await ben.page.evaluate(() => { document.getElementById('view').scrollTop = 0; });
  await ben.page.screenshot({ path: path.join(copy, 'map-search.png') });
  await ben.page.getByRole('button', { name: 'Clear search' }).click();
  await ben.page.locator('#map-pick').getByRole('button', { name: 'Close' }).click();
  ok(await has(ben, 'Choose where to look'), 'clearing the search hides the venues again');
  await ben.page.locator('.leaflet-container').click();   // tap the middle of the map
  ok(await has(ben, 'within 5 km of the pin'), 'tapping the map chooses where to look');
  const shown = Number(/(\d+) venues? within/.exec(await ben.page.locator('#venue-count').innerText())[1]);
  ok(shown > 0 && await ben.page.locator('.leaflet-container .leaflet-marker-icon.leaflet-interactive').count() === shown, 'the map shows a pin for each venue inside the radius: ' + shown);
  ok(await ben.page.locator('.leaflet-container .leaflet-marker-icon.leaflet-interactive').count() === 23, 'every venue with a position has a pin on the map');
  ok(await has(ben, 'away,'), 'venue cards say how far away they are');
  await ben.ctx.grantPermissions(['geolocation']);
  await ben.ctx.setGeolocation({ latitude: -32.0569, longitude: 115.7439 });   // Fremantle, about 16 km from the example venues
  await tap(ben, 'Near me');
  ok(await has(ben, '0 venues within 5 km of you') && await has(ben, '23 more further away'), 'Near me searches around the phone\'s location');
  await ben.page.locator('#radius').fill('25');
  ok(await has(ben, '23 venues within 25 km of you'), 'widening the radius brings the venues back');
  await ben.page.locator('#radius').fill('15');
  ok(await has(ben, '0 venues within 15 km'), 'narrowing the radius filters them out again');
  const mark = sent.length;
  await ben.page.waitForTimeout(1500);   // let a few background refreshes run
  const during = sent.slice(mark);
  ok(during.filter((x) => x.includes('/rpc/api_state')).length >= 2 && during.filter((x) => x.includes('/rpc/api_venues')).length === 0, 'background refreshes do not download the venues again');
  ok(await ben.page.locator('#radius').inputValue() === '15' && await has(ben, 'within 15 km of you'), 'the radius and location survive background refreshes');
  ok(!sent.some((x) => /-32\.05|115\.74/.test(x)), 'the phone\'s location is never sent to the server');
  ok(await ben.page.locator('.leaflet-container .me-mark').count() === 1, 'Near me shows you as a Me marker on your own map');
  ok(sent.some((x) => x.includes('/rpc/api_buzz')), 'the map asks which venues are busy, by counts only');
  await ben.page.locator('#radius').fill('25');
  const mapChip = (p, name) => p.page.evaluate((n) => { document.getElementById('view').scrollTop = 0; [...document.querySelectorAll('.map-chips .chip')].find((b) => b.textContent === n).click(); }, name);
  await mapChip(ben, 'Open now');
  ok(await ben.page.locator('.map-chips .chip', { hasText: 'Open now' }).getAttribute('aria-pressed') === 'true' && await has(ben, 'open now venue'), 'the Open now chip filters the venues');
  const openPins = await ben.page.locator('.leaflet-container .leaflet-marker-icon.leaflet-interactive').count();
  ok(openPins === Number(/(\d+) open now venues? within/.exec(await ben.page.locator('#venue-count').innerText())[1]), 'and the map shows a bubble for each open one: ' + openPins);
  await mapChip(ben, 'Open now');
  ok(await has(ben, '23 venues within 25 km of you'), 'tapping the chip again shows every venue');
  { // the traffic light in the header is the status switch, and the screen glows in that colour
    const before = await ben.page.evaluate(() => document.body.dataset.status);
    const other = before === 'thinking' ? 'Green' : 'Amber', otherKey = other === 'Green' ? 'on' : 'thinking';
    await ben.page.getByRole('button', { name: 'Switch to ' + other }).click();
    await ben.page.waitForFunction((k) => document.body.dataset.status === k && document.querySelector('.dots.switch [aria-pressed="true"]')?.getAttribute('data-v') === k, otherKey, { timeout: 6000 }).catch(() => {});
    ok(await ben.page.evaluate(() => document.body.dataset.status) === otherKey && await ben.page.locator('#venue-search').count() === 1, 'tapping a light in the header changes your status and keeps you on the map');
    await ben.page.getByRole('button', { name: 'Switch to ' + { on: 'Green', thinking: 'Amber', off: 'Red' }[before] }).click();
    await ben.page.waitForFunction((k) => document.body.dataset.status === k, before, { timeout: 6000 }).catch(() => {});
    ok(await ben.page.evaluate(() => document.body.dataset.status) === before, 'and back again');
  }
  await ben.page.locator('#radius').fill('25');
  await ben.page.evaluate(() => { document.getElementById('view').scrollTop = 0; });
  await ben.page.screenshot({ path: path.join(copy, 'venue-map.png') });
  await ben.page.evaluate(() => { document.getElementById('view').scrollTop = 0; });
  const pin = (p, name) => p.page.locator(`.leaflet-container .leaflet-marker-icon[title="${name}"]`).dispatchEvent('click');
  await pin(ben, 'Lowtide Bar');
  ok(await has(ben, 'No Frendzy ratings yet') && await has(ben, '4.4 ★ on Google Maps (120)'), 'the card under a pin shows Frendzy and Google ratings');
  await ben.page.getByRole('button', { name: 'Rate 5 stars' }).click();
  ok(await has(ben, '5.0 ★ on Frendzy (1)'), 'tapping a star on the card rates the venue');
  await pin(ben, 'Bodega Nine');
  ok(await has(ben, 'Open venue') && await ben.page.locator('#map-pick', { hasText: 'Bodega Nine' }).count() === 1, 'tapping a pin shows that venue under the map');
  ok(/(Open till|Closes soon|Opens) /.test(await ben.page.locator('#map-pick').innerText()), 'the picked venue says when it opens or closes');
  ok(await ben.page.locator('.pin-badge').count() >= 3, 'pins show an open or closed badge');
  await ben.page.screenshot({ path: path.join(copy, 'venue-pick.png') });
  await tap(ben, 'Open venue');
  ok(await has(ben, 'Rate this venue'), 'and Open venue opens its page');
  ok(/Tu-Su|Opening hours/.test(await text(ben)) && /(Open till|Closes soon|Opens) /.test(await text(ben)) && await has(ben, 'Mon') && await has(ben, 'Closed'), 'a venue page shows its opening hours and whether it is open');
  await tab(ben, 'Venues');

  console.log('Deals on the map, and events');
  ok(await ben.page.locator('nav button:has-text("Deals")').count() === 0 && await ben.page.locator('nav button:has-text("Events")').count() === 1, 'there is an Events tab and no Deals tab');
  await tab(ben, 'Events');
  ok(await has(ben, 'Live music tonight') && !(await text(ben)).includes('2-for-1 pizzas') && !(await text(ben)).includes('Happy hour'), 'Events lists events only, never food or drink deals');
  await tab(ben, 'Map');
  await pin(ben, 'Bodega Nine');
  ok(await has(ben, '2-for-1 pizzas'), 'a venue\'s deals show under the map when its pin is tapped');
  await pin(ben, 'Lowtide Bar');
  ok(await has(ben, 'Happy hour: 25% off house drinks') && !(await text(ben)).includes('2-for-1 pizzas'), 'tapping another pin shows that venue\'s deals instead');
  await pin(ben, 'Bodega Nine');
  const bodega = ben.page.locator('.deal-banner', { hasText: 'Test deal: free garlic bread' });
  await bodega.getByRole('button', { name: 'Use deal' }).click();
  ok(await has(ben, 'Show this to staff'), 'Ben gets a deal code screen');
  const code = await ben.page.locator('#code').innerText();
  ok(/^SESH-\d{4}$/.test(code), 'code looks right: ' + code);

  // make Ana staff at Bodega Nine (done by the organiser in the database, not in the app)
  const u = execSync(`psql -X -tA -h ${sock} -p ${dbPort} -U postgres -d postgres -c "select id from public.profiles where name='Ana'"`, { encoding: 'utf8' }).trim();
  execSync(`psql -X -q -h ${sock} -p ${dbPort} -U postgres -d postgres -c "insert into public.venue_staff (venue_id, user_id) values ('a0000000-0000-4000-8000-000000000002','${u}')"`);
  await tab(ana, 'Home'); await tab(ana, 'You');
  ok(await has(ana, 'Staff: confirm a deal code', 4000), 'staff section appears for Ana');
  await ana.page.fill('#staff-code', 'SESH-0000');
  await tap(ana, 'Confirm code');
  ok(await has(ana, 'code'), 'a wrong code shows an error');
  await ana.page.fill('#staff-code', code);
  await tap(ana, 'Confirm code');
  ok(await has(ana, 'Code confirmed'), 'staff confirm Ben\'s code');
  ok(await has(ben, 'Deal used', 4000), 'Ben\'s screen flips to "Deal used" by itself');
  await ana.page.fill('#staff-code', code); await tap(ana, 'Confirm code');
  ok(await has(ana, 'not valid') || await has(ana, 'already') || await has(ana, 'used') || await has(ana, 'expired'), 'a second use of the same code is refused: ' + (await ana.page.locator('#staff-error').innerText().catch(() => '?')));
  await tab(ana, 'Map');
  await ana.page.fill('#venue-search', 'bodega nine');
  await has(ana, '1 venue matches');
  await ana.page.evaluate(() => { document.getElementById('view').scrollTop = 0; });
  await ana.page.locator('.leaflet-container .leaflet-marker-icon[title="Bodega Nine"]').dispatchEvent('click');
  await tap(ana, 'Open venue');
  ok(await has(ana, 'You work here'), 'staff see a box to change their venue\'s hours');
  await ana.page.fill('#hours-input', 'whenever');
  await tap(ana, 'Save hours');
  ok(await has(ana, 'could not be read'), 'hours the app cannot read are refused');
  await ana.page.fill('#hours-input', 'Mo-Su 00:00-24:00');
  await tap(ana, 'Save hours');
  ok(await has(ana, 'Open 24 hours'), 'staff can change the hours and the venue updates');

  console.log('Ratings');
  await tap(ben, 'Rate Bodega Nine');
  await ben.page.getByRole('button', { name: '4 stars' }).click();
  ok(await has(ben, 'from 1 rating'), 'Ben rates 4 stars: "from 1 rating"');
  await ben.page.getByRole('button', { name: 'Good vibe' }).click();
  await ben.page.reload();
  await has(ben, 'Your status');
  await tab(ben, 'Map'); await ben.page.fill('#venue-search', 'bodega'); await has(ben, '1 venue matches'); await pin(ben, 'Bodega Nine'); await tap(ben, 'Open venue');
  ok(await ben.page.locator('button[aria-label="4 stars"][aria-pressed="true"]').count() === 1, 'rating and sign-in survive a page reload');

  console.log('Chat is erased');
  await tab(ana, 'Sesh');
  await tap(ana, 'End the sesh');
  ok(await has(ana, 'Nobody has started one yet') || await has(ana, 'Start a sesh'), 'Ana ends the sesh');
  ok(execSync(`psql -X -tA -h ${sock} -p ${dbPort} -U postgres -d postgres -c "select count(*) from public.messages"`, { encoding: 'utf8' }).trim() === '0', 'every message is erased from the database');
  await tab(cam, 'Sesh');
  ok(await gone(cam, 'Yes please'), 'Cam no longer sees the chat');

  console.log('Going Red hides you');
  await tab(cam, 'Home');
  { // drag the knob across the switch from Amber to Red, like a finger would
    await cam.page.waitForSelector('#status-slide');
    const box = await cam.page.locator('#status-slide').boundingBox(), y = box.y + box.height / 2;
    await cam.page.mouse.move(box.x + box.width / 2, y); await cam.page.mouse.down();
    for (let i = 1; i <= 8; i++) await cam.page.mouse.move(box.x + box.width / 2 + (box.width / 3) * i / 8, y);
    await cam.page.mouse.up();
  }
  ok(await has(cam, "You're red."), 'Cam slides the switch to Red');
  await tab(ana, 'Home');
  ok(await ana.page.waitForFunction(() => /Cam\s+Red/.test(document.body.innerText), null, { timeout: 4000 }).then(() => true, () => false), 'Ana sees Cam as Red after Cam slides to Red');

  console.log('Delete account');
  await tab(cam, 'You'); await tap(cam, 'Delete my account'); await tap(cam, 'Delete for good');
  ok(await has(cam, 'Get started'), 'Cam is deleted and back at the welcome screen');
  await tab(ana, 'Home');
  ok(await gone(ana, 'Cam', 5000), 'Cam disappears from Ana\'s friends');

  console.log('Women and non-binary mode, and blocking');
  await tab(ana, 'You'); await tap(ana, 'Woman');
  ok(await has(ana, 'Women and non-binary only'), 'Ana says she is a woman and is offered the mode');
  await tap(ana, 'Turn on');
  ok(await has(ana, 'Turn off') && await has(ana, 'Anyone else just sees you as red'), 'Ana turns on women-only mode');
  if (process.env.SHOTS) await ana.page.screenshot({ path: process.env.SHOTS + '/women-only.png', fullPage: true });
  await tab(ben, 'Home');
  ok(await ben.page.waitForFunction(() => /Ana\s+Red/.test(document.body.innerText), null, { timeout: 5000 }).then(() => true, () => false), 'Ben (no gender given) now sees Ana as Red');
  await tap(ana, 'Turn off');
  ok(await ben.page.waitForFunction(() => /Ana\s+Green/.test(document.body.innerText), null, { timeout: 5000 }).then(() => true, () => false), 'with it off, Ben sees Ana is Green again');
  await tap(ana, 'Rather not say');
  ok(await gone(ana, 'Women and non-binary only'), 'Ana can take her gender back off');
  const gus = await phone('Gus');
  await signUp(gus, 'Gus', anaLink);
  await tab(ana, 'Home');
  ok(await has(ana, 'Gus wants to add you'), 'Gus sends Ana a request');
  await tap(ana, 'Block'); await tap(ana, 'Block');
  ok(await gone(ana, 'Gus wants to add you'), 'Ana blocks Gus straight from the request');
  await tab(ana, 'You');
  ok(await has(ana, 'Blocked people') && /Gus/.test(await text(ana)), 'Gus is on Ana\'s blocked list');
  await ana.page.locator('.card', { hasText: 'Your friends' }).getByRole('button', { name: 'Block', exact: true }).click();
  await tap(ana, 'Block');
  ok(await has(ana, 'Blocked.'), 'Ana blocks Ben from her friends list');
  await tab(ben, 'You');
  ok(await gone(ben, 'Ana', 5000), 'Ana disappears from Ben\'s app');

  console.log('Deals switched off');
  dealsOn = false;
  const dan = await phone('Dan');
  await signUp(dan, 'Dan');
  ok((await dan.page.locator('nav button:has-text("Deals")').count()) === 0 && (await dan.page.locator('nav button:has-text("Venues")').count()) === 1, 'with deals off there is a Venues tab and no Deals tab');
  await tab(dan, 'Events');
  ok(await has(dan, 'Live music tonight') && await dan.page.getByRole('button', { name: 'Use deal' }).count() === 0, 'with deals off, events still show but cannot be redeemed');
  await tab(dan, 'Venues'); await dan.page.getByRole('button', { name: 'Open' }).first().click();
  ok(await has(dan, 'Rate this venue') && !(await text(dan)).includes('Deals here'), 'a venue page shows ratings but no deals');

  console.log('Third-party age check');
  const ageSet = (b) => fetch(API + '/__fake/age-check', { method: 'POST', headers: { apikey: 'test-anon-key', 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  await ageSet({ required: true, outcome: 'failed' });
  const eve = await phone('Eve');
  await eve.page.goto(`http://127.0.0.1:${WEB_PORT}/`);
  await eve.page.fill('#name', 'Eve'); await eve.page.fill('#dob', '1999-02-03');
  await eve.page.fill('#join-user', 'eve_live'); await eve.page.fill('#join-pass', 'longenough1'); await eve.page.fill('#join-email', 'eve@example.com'); await tap(eve, 'Get started');
  ok(await has(eve, 'Quick age check') && await has(eve, 'Yoti checks your age with a quick selfie'), 'with the check switched on, sign-up asks for the age check');
  await tap(eve, 'Start age check');
  ok(await has(eve, "couldn't confirm you're 18"), 'a failed check is explained and Eve is not let in');
  ok(!eve.page.url().includes('age_check'), 'the return address is tidied away');
  await ageSet({ outcome: 'pending' });
  await tap(eve, 'Start age check');
  ok(await has(eve, 'still being looked at'), 'a check still under review says so');
  await ageSet({ outcome: 'passed' });
  await tap(eve, "I've finished, check again");
  ok(await has(eve, "You're red."), 'once the check passes, Eve is signed up');
  await tab(eve, 'You');
  ok(await has(eve, 'Keep your account'), 'the password is never stored during the check, so the You page asks for it again');
  await tab(eve, 'Home');
  ok(await eve.page.evaluate(() => sessionStorage.getItem('seshhon-signup-waiting')) === null, 'the date of birth held during the check is cleared');
  await dan.page.reload();
  ok(await has(dan, 'Quick age check'), 'someone who joined before the check was switched on is asked to do it');
  await tap(dan, 'Start age check');
  ok(await has(dan, 'Your status'), 'and gets back in once they pass');
  await ageSet({ required: false });

  console.log('Username and password');
  const fay = await phone('Fay');
  await fay.page.goto(`http://127.0.0.1:${WEB_PORT}/`);
  await fay.page.fill('#name', 'Fay'); await fay.page.fill('#dob', '1995-04-12');
  await fay.page.fill('#join-user', 'ANA_1'); await fay.page.fill('#join-pass', 'longenough1'); await fay.page.fill('#join-email', 'Fay@Example.com'); await tap(fay, 'Get started');
  ok(await has(fay, 'That username is taken'), 'a taken username is refused at sign-up');
  await fay.page.fill('#join-user', 'Fay_99'); await tap(fay, 'Get started');
  ok(await has(fay, 'Confirm your email'), 'Fay is asked to confirm her email');
  await fay.page.fill('#ec-code', (await lastEmail()).code); await tap(fay, 'Confirm email');
  ok(await has(fay, 'Save your recovery code'), 'signing up shows a recovery code');
  const code1 = (await fay.page.locator('#recovery-code').innerText()).trim();
  ok(await has(fay, 'We also emailed it to f•••@example.com') && (await lastEmail()).recovery === code1, 'Fay\'s recovery code is emailed to her too');
  ok(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(code1), 'the recovery code looks like XXXX-XXXX-XXXX-XXXX');
  await tap(fay, "I've saved it");
  await tab(fay, 'You');
  ok(await has(fay, 'logged in as fay_99'), 'Fay sees her username');
  ok(await has(fay, 'need a code sent to f•••@example.com'), 'and that new logins need an email code');

  console.log('Add a friend by username');
  ok(await has(fay, 'Your username is fay_99'), 'Fay is shown the username to give friends');
  await fay.page.fill('#friend-user', 'nobody_here'); await tap(fay, 'Add');
  ok(await has(fay, 'No one with that username'), 'an unknown username finds no one');
  await fay.page.fill('#friend-user', '@Ana_1'); await tap(fay, 'Add');
  ok(await has(fay, 'Friend request sent to Ana'), 'Fay adds Ana by username');
  ok(await has(fay, 'Waiting for them to accept'), 'the request shows as waiting');
  if (process.env.SHOTS) await fay.page.locator('#add-friend').locator('xpath=..').screenshot({ path: process.env.SHOTS + '/add-friend.png' });
  await tab(ana, 'Home');
  ok(await has(ana, 'Fay wants to add you'), 'Ana gets Fay\'s request');
  await tap(ana, 'Accept');
  await tab(fay, 'You');
  ok(await gone(fay, 'Waiting for them to accept'), 'Fay and Ana are now friends');
  const fay2 = await phone('Fay on a new phone');
  await fay2.page.goto(`http://127.0.0.1:${WEB_PORT}/`);
  await tap(fay2, 'I already have an account');
  await fay2.page.fill('#login-user', 'fay_99'); await fay2.page.fill('#login-pass', 'wrongpassword');
  await tap(fay2, 'Log in');
  ok(await has(fay2, "don't match"), 'a wrong password is turned away');
  await fay2.page.fill('#login-pass', 'longenough1'); await tap(fay2, 'Log in');
  ok(await has(fay2, 'Check your email') && await has(fay2, 'sent a 6-digit code to f•••@example.com'), 'the right password then asks for a code from her email');
  await fay2.page.reload();
  ok(await has(fay2, 'Check your email') && !(await has(fay2, 'Your status', 800)), 'reloading the page does not skip the code');
  ok(await fay2.page.evaluate(async () => {   // and the database itself refuses this login until the code is typed
    const s = JSON.parse(localStorage.getItem('seshhon-session-v1'));
    const r = await fetch('http://127.0.0.1:54330/rest/v1/rpc/api_state', { method: 'POST', headers: { apikey: 'test-anon-key', Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' }, body: '{}' });
    return !r.ok;
  }), 'the database gives nothing to a login still waiting for its code');
  await fay2.page.waitForTimeout(500);
  const loginCode = (await lastEmail()).code;
  await fay2.page.fill('#ts-code', loginCode === '123456' ? '654321' : '123456'); await tap(fay2, 'Log in');
  ok(await has(fay2, "isn't right"), 'a wrong code is turned away');
  await fay2.page.fill('#ts-code', loginCode); await tap(fay2, 'Log in');
  ok(await has(fay2, 'Your status'), 'Fay logs in on a new phone with her password and the emailed code');
  await tab(fay2, 'You');
  ok(await has(fay2, 'logged in as fay_99'), 'and it is the same account');
  await tap(fay2, 'Log out');
  ok(await has(fay2, 'I already have an account'), 'logging out goes back to the start');
  await tap(fay2, 'I already have an account'); await tap(fay2, 'Forgot your password?');
  await fay2.page.fill('#rec-user', 'fay_99'); await fay2.page.fill('#rec-code', 'AAAA-AAAA-AAAA-AAAA'); await fay2.page.fill('#rec-pass', 'brandnewpass');
  await tap(fay2, 'Set new password');
  ok(await has(fay2, "recovery code don't match"), 'a wrong recovery code is turned away');
  await fay2.page.fill('#rec-code', code1.toLowerCase()); await tap(fay2, 'Set new password');
  ok(await has(fay2, 'Save your recovery code'), 'the right recovery code sets a new password and gives a new code');
  const code2 = (await fay2.page.locator('#recovery-code').innerText()).trim();
  ok(code2 !== code1, 'the used code is replaced');
  ok(await has(fay2, 'We also emailed it to f•••@example.com') && (await lastEmail()).recovery === code2, 'and the new code is emailed to her');
  await tap(fay2, "I've saved it");
  ok(await fay2.page.locator('#login-user').inputValue() === 'fay_99', 'then the log-in form has the username filled in');
  await fay2.page.fill('#login-pass', 'brandnewpass'); await tap(fay2, 'Log in');
  ok(await has(fay2, 'Your status'), 'and the new password works, without an email code straight after a recovery');

  console.log('Profile photos');
  const pim = await phone('Pim'), quin = await phone('Quin');
  await signUp(pim, 'Pim');
  const pmLink = await inviteOf(pim);
  await signUp(quin, 'Quin', pmLink);
  await tab(pim, 'Home'); await has(pim, 'Quin wants to add you'); await tap(pim, 'Accept');
  await tap(pim, 'Green'); await has(pim, 'Up for it now'); await tap(quin, 'Green');
  ok(await has(quin, 'Up for it now') && await quin.page.locator('.friend.face .pic').count() === 0, 'with no photo, a friend\'s circle shows their initial');
  await tab(pim, 'You');
  ok(await has(pim, 'Add a photo'), 'the You page offers to add a photo');
  // a 40 x 30 red PNG, so the square crop is tried too
  const png = await pim.page.evaluate(() => { const c = document.createElement('canvas'); c.width = 40; c.height = 30; const g = c.getContext('2d'); g.fillStyle = '#d33'; g.fillRect(0, 0, 40, 30); return c.toDataURL('image/png').split(',')[1]; });
  await pim.page.locator('#photo-file').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  ok(await pim.page.waitForSelector('button.profile-btn img.pic', { timeout: 6000 }).then(() => true, () => false), 'Pim adds a photo and his profile button shows it');
  await quin.page.reload(); await has(quin, 'Up for it now');
  ok(await quin.page.waitForFunction(() => document.querySelectorAll('.friend.face .pic').length === 1, null, { timeout: 4000 }).then(() => true, () => false), 'his friend Quin sees his photo on his circle');
  await tap(pim, 'Remove');
  ok(await pim.page.waitForSelector('button.profile-btn img.pic', { state: 'detached', timeout: 6000 }).then(() => true, () => false), 'Pim can remove his photo');

  ok(consoleErrors.length === 0, 'no script errors on any phone' + (consoleErrors.length ? ': ' + consoleErrors.join('; ') : ''));
  await ana.page.screenshot({ path: path.join(copy, 'ana.png') });
} catch (e) {
  fail++; console.log('  FAIL crashed: ' + e.message.split('\n')[0] + '\n' + String(e.stack).split('\n').filter((l) => l.includes('check.mjs')).slice(0, 2).join('\n'));
} finally {
  await browser.close(); api.kill(); web.close();
  try { execSync(`runuser -u postgres -- /usr/lib/postgresql/16/bin/pg_ctl -D $(dirname ${sock})/data -m immediate stop`, { stdio: 'ignore', shell: '/bin/bash' }); } catch {}
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
