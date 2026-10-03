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
console.log('database ready');

// 2. the stand-in for Supabase's web address, and a static server for docs/
const api = spawn('node', [path.join(here, 'fake-supabase.mjs'), sock, dbPort, '54330'], { stdio: 'inherit' });
const web = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/config.js') { res.setHeader('Content-Type', 'text/javascript'); // Serve the real docs/config.js, only swapping the address and key, so a misnamed setting is caught here.
    return res.end(fs.readFileSync(path.join(root, 'docs/config.js'), 'utf8').replace(/url: '[^']*'/, `url: '${API}'`).replace(/key: '[^']*'/, "key: 'test-anon-key'").replace(/pollMs: \d+/, 'pollMs: 600, chatPollMs: 500').replace(/deals: (true|false)/, 'deals: ' + dealsOn).replace(/captchaSiteKey: '[^']*'/, "captchaSiteKey: ''")); }
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
const tap = (p, label) => p.page.getByRole('button', { name: label, exact: true }).first().click();
async function signUp(p, name, link) {
  await p.page.goto(`http://127.0.0.1:${WEB_PORT}/${link || ''}`);
  await p.page.fill('#name', name);
  await p.page.fill('#dob', '1995-04-12');
  await tap(p, 'Get started');
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
  await tab(ben, 'Map');
  const sent = [];
  ben.page.on('request', (r) => { if (r.url().startsWith(API)) sent.push(r.url() + ' ' + (r.postData() || '')); });
  ok(await has(ben, '3 venues within 5 km'), 'the map shows how many venues are inside the radius');
  ok(await ben.page.locator('.leaflet-container path.leaflet-interactive').count() === 3, 'each example venue has a pin on the map');
  ok(await has(ben, 'away,'), 'venue cards say how far away they are');
  await ben.ctx.grantPermissions(['geolocation']);
  await ben.ctx.setGeolocation({ latitude: -32.0569, longitude: 115.7439 });   // Fremantle, about 16 km from the example venues
  await tap(ben, 'Near me');
  ok(await has(ben, '0 venues within 5 km of you') && await has(ben, '3 more further away'), 'Near me searches around the phone\'s location');
  await ben.page.locator('#radius').fill('25');
  ok(await has(ben, '3 venues within 25 km of you'), 'widening the radius brings the venues back');
  await ben.page.locator('#radius').fill('15');
  ok(await has(ben, '0 venues within 15 km'), 'narrowing the radius filters them out again');
  await ben.page.waitForTimeout(1500);   // let a few background refreshes run
  ok(await ben.page.locator('#radius').inputValue() === '15' && await has(ben, 'within 15 km of you'), 'the radius and location survive background refreshes');
  ok(!sent.some((x) => /-32\.05|115\.74/.test(x)), 'the phone\'s location is never sent to the server');
  await ben.page.locator('#radius').fill('25');
  await ben.page.evaluate(() => { document.getElementById('view').scrollTop = 0; });
  await ben.page.screenshot({ path: path.join(copy, 'venue-map.png') });
  await ben.page.evaluate(() => { document.getElementById('view').scrollTop = 0; });
  await ben.page.locator('.leaflet-container path.leaflet-interactive').first().dispatchEvent('click');
  ok(await has(ben, 'Rate this venue'), 'tapping a pin opens that venue');
  await tab(ben, 'Venues');

  console.log('Deals');
  await tab(ben, 'Deals');
  ok(await has(ben, '2-for-1 pizzas'), 'deals list shows food deals');
  await tap(ben, 'Drinks');
  ok(await has(ben, 'Happy hour: 25% off house drinks'), 'Drinks filter shows the compliant happy hour');
  await tap(ben, 'All');
  const bodega = ben.page.locator('.card', { hasText: 'Test deal: free garlic bread' });
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

  console.log('Ratings');
  await tap(ben, 'Rate Bodega Nine');
  await ben.page.getByRole('button', { name: '4 stars' }).click();
  ok(await has(ben, 'from 1 rating'), 'Ben rates 4 stars: "from 1 rating"');
  await ben.page.getByRole('button', { name: 'Good vibe' }).click();
  await ben.page.reload();
  await has(ben, 'Your status');
  await tab(ben, 'Deals'); await ben.page.locator('.card', { hasText: 'Bodega Nine' }).getByRole('button', { name: 'Venue' }).first().click();
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

  console.log('Deals switched off');
  dealsOn = false;
  const dan = await phone('Dan');
  await signUp(dan, 'Dan');
  ok((await dan.page.locator('nav button:has-text("Deals")').count()) === 0 && (await dan.page.locator('nav button:has-text("Venues")').count()) === 1, 'with deals off there is a Venues tab and no Deals tab');
  await tab(dan, 'Venues'); await dan.page.getByRole('button', { name: 'Open' }).first().click();
  ok(await has(dan, 'Rate this venue') && !(await text(dan)).includes('Deals here'), 'a venue page shows ratings but no deals');

  console.log('Third-party age check');
  const ageSet = (b) => fetch(API + '/__fake/age-check', { method: 'POST', headers: { apikey: 'test-anon-key', 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  await ageSet({ required: true, outcome: 'failed' });
  const eve = await phone('Eve');
  await eve.page.goto(`http://127.0.0.1:${WEB_PORT}/`);
  await eve.page.fill('#name', 'Eve'); await eve.page.fill('#dob', '1999-02-03'); await tap(eve, 'Get started');
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
  ok(await eve.page.evaluate(() => sessionStorage.getItem('seshhon-signup-waiting')) === null, 'the date of birth held during the check is cleared');
  await dan.page.reload();
  ok(await has(dan, 'Quick age check'), 'someone who joined before the check was switched on is asked to do it');
  await tap(dan, 'Start age check');
  ok(await has(dan, 'Your status'), 'and gets back in once they pass');
  await ageSet({ required: false });

  console.log('Username and password');
  const fay = await phone('Fay');
  await signUp(fay, 'Fay');
  await tab(fay, 'You');
  ok(await has(fay, 'Keep your account'), 'a new account is offered a username and password');
  await fay.page.fill('#save-user', 'x'); await fay.page.fill('#save-pass', 'longenough1'); await tap(fay, 'Save my account');
  ok(await has(fay, '3 to 20 letters'), 'a bad username is explained');
  await fay.page.fill('#save-user', 'Fay_99'); await tap(fay, 'Save my account');
  ok(await has(fay, 'Save your recovery code'), 'saving shows a recovery code');
  const code1 = (await fay.page.locator('#recovery-code').innerText()).trim();
  ok(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(code1), 'the recovery code looks like XXXX-XXXX-XXXX-XXXX');
  await tap(fay, "I've saved it");
  ok(await has(fay, 'logged in as fay_99'), 'Fay sees her username');
  const fay2 = await phone('Fay on a new phone');
  await fay2.page.goto(`http://127.0.0.1:${WEB_PORT}/`);
  await tap(fay2, 'I already have an account');
  await fay2.page.fill('#login-user', 'fay_99'); await fay2.page.fill('#login-pass', 'wrongpassword');
  await tap(fay2, 'Log in');
  ok(await has(fay2, "don't match"), 'a wrong password is turned away');
  await fay2.page.fill('#login-pass', 'longenough1'); await tap(fay2, 'Log in');
  ok(await has(fay2, 'Your status'), 'Fay logs in on a new phone with her username and password');
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
  await tap(fay2, "I've saved it");
  ok(await fay2.page.locator('#login-user').inputValue() === 'fay_99', 'then the log-in form has the username filled in');
  await fay2.page.fill('#login-pass', 'brandnewpass'); await tap(fay2, 'Log in');
  ok(await has(fay2, 'Your status'), 'and the new password works');

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
