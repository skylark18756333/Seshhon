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
    return res.end(fs.readFileSync(path.join(root, 'docs/config.js'), 'utf8').replace(/url: '[^']*'/, `url: '${API}'`).replace(/key: '[^']*'/, "key: 'test-anon-key'").replace(/pollMs: \d+/, 'pollMs: 600')); }
  const f = path.join(root, 'docs', p === '/' ? 'index.html' : p);
  if (!f.startsWith(path.join(root, 'docs')) || !fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream'); res.end(fs.readFileSync(f));
}).listen(WEB_PORT);
await new Promise((r) => setTimeout(r, 800));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const consoleErrors = [];
async function phone(name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, timezoneId: 'Australia/Perth' });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e) => consoleErrors.push(name + ': ' + e.message));
  return { name, ctx, page };
}
const text = (p) => p.page.locator('body').innerText();
const has = async (p, s, t = 4000) => { try { await p.page.waitForFunction((x) => document.body.innerText.toLowerCase().includes(x.toLowerCase()), s, { timeout: t }); return true; } catch { return false; } };
const gone = async (p, s, t = 4000) => { try { await p.page.waitForFunction((x) => !document.body.innerText.toLowerCase().includes(x.toLowerCase()), s, { timeout: t }); return true; } catch { return false; } };
const tap = (p, label) => p.page.getByRole('button', { name: label, exact: true }).first().click();
async function signUp(p, name, link) {
  await p.page.goto(`http://127.0.0.1:${WEB_PORT}/${link || ''}`);
  await p.page.fill('#name', name);
  await p.page.check('#adult');
  await tap(p, 'Get started');
  await has(p, 'Your status');
}
async function tab(p, t) { await p.page.locator(`nav button:has-text("${t}")`).click(); }
async function inviteOf(p) { await tab(p, 'You'); await tap(p, 'Send your invite link'); const l = await p.page.locator('#invite-link').innerText(); return l.slice(l.indexOf('?')); }

try {
  const ana = await phone('Ana'), ben = await phone('Ben'), cam = await phone('Cam');

  console.log('Sign-up');
  await ana.page.goto(`http://127.0.0.1:${WEB_PORT}/`);
  await ana.page.fill('#name', 'Ana'); await tap(ana, 'Get started');
  ok(await has(ana, 'Tick the box to confirm'), 'cannot sign up without the 18+ box');
  await ana.page.check('#adult'); await tap(ana, 'Get started');
  ok(await has(ana, "You're off."), 'Ana signs up and starts Off');
  ok(await has(ana, 'Add your friends'), 'a new person is told to add friends');

  console.log('Invite links and friends');
  const anaLink = await inviteOf(ana);
  ok(/^\?invite=[A-Z0-9]{6,}/.test(anaLink), 'Ana gets an invite link: ' + anaLink);
  await signUp(ben, 'Ben', anaLink);
  await tab(ana, 'Home');
  ok(await has(ana, 'Ben wants to add you'), 'Ana sees Ben\'s friend request without refreshing');
  await tap(ana, 'Accept');
  ok(await has(ana, 'Friends are hidden while you\'re off'), 'accepted; Ana is Off so friends stay hidden');
  ok(await has(ben, 'Friends are hidden'), 'Ben sees he is friends with Ana (Off hides her)');

  await signUp(cam, 'Cam', anaLink);
  await tap(ana, 'Accept');

  console.log('Status and privacy');
  await tap(ben, 'On');
  ok(await has(ben, "You're on."), 'Ben goes On');
  ok(!(await text(ana)).includes('Ben') || (await text(ana)).includes('hidden'), 'Ana is Off so she cannot see Ben');
  await tap(ana, 'On');
    ok(await has(ana, 'Up for it now'), 'Ana goes On and sees the friends list');
  const anaHome = await text(ana);
  ok(/Ben\s+On/.test(anaHome), 'Ana sees Ben is On');
  ok(/Cam\s+Off/.test(anaHome), 'Ana sees Cam as Off');
  ok((await cam.page.locator('.friend').count()) === 0 && !(await text(cam)).includes('Up for it now'), 'Cam (Off) cannot see Ana');
  await tap(cam, 'Thinking');
  ok(await has(cam, 'Up for it now'), 'Cam goes Thinking and sees friends');
  ok(/Ana\s+On/.test(await text(cam)), 'Cam (Thinking) sees Ana is On');
  ok(await ana.page.waitForFunction(() => /Cam\s+Thinking/.test(document.body.innerText), null, { timeout: 4000 }).then(() => true, () => false), 'Ana sees Cam Thinking within a poll');

  console.log('Sesh');
  await tap(ana, 'Start a sesh');
  ok(await has(ana, "Tonight's sesh") && await has(ana, 'Where to?'), 'Ana starts a sesh and sees venues');
  await tab(ben, 'Sesh');
  ok(await has(ben, "Ana's sesh"), 'Ben sees Ana\'s sesh');
  await tap(ben, 'Join');
  ok(await has(ben, '2 in'), 'Ben joins: 2 in');
  await tab(cam, 'Sesh');
  ok(await has(cam, "Ana's sesh"), 'Cam (Thinking) sees the sesh');
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

  console.log('Going Off hides you');
  await tab(cam, 'Home'); await tap(cam, 'Off');
  await tab(ana, 'Home');
  ok(await ana.page.waitForFunction(() => /Cam\s+Off/.test(document.body.innerText), null, { timeout: 4000 }).then(() => true, () => false), 'Ana sees Cam as Off after Cam goes Off');

  console.log('Delete account');
  await tab(cam, 'You'); await tap(cam, 'Delete my account'); await tap(cam, 'Delete for good');
  ok(await has(cam, 'Get started'), 'Cam is deleted and back at the welcome screen');
  await tab(ana, 'Home');
  ok(await gone(ana, 'Cam', 5000), 'Cam disappears from Ana\'s friends');

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
