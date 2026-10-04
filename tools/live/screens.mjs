// Takes phone-sized screenshots of the main screens of the live web app, against a local test database.
// Run: node tools/live/screens.mjs [output folder]   (needs PostgreSQL 15+ and Playwright's Chromium)
// Map tiles are drawn locally as a stand-in street grid, because the test machine cannot reach OpenStreetMap.
import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../..');
const out = path.resolve(process.argv[2] || 'screens');
fs.mkdirSync(out, { recursive: true });
const API = 'http://127.0.0.1:54340', WEB_PORT = 54341;

const copy = fs.mkdtempSync('/tmp/sb-screens-');
execSync(`cp -r ${root}/supabase ${copy}/ && chmod -R a+rX ${copy} && chmod a+rx ${copy}`);
const setup = execSync(`ONLY_SETUP=1 PG_PORT=54339 bash ${copy}/supabase/tests/run.sh`, { encoding: 'utf8' });
const [, sock, dbPort] = setup.match(/socket dir (\S+) port (\d+)/);
const api = spawn('node', [path.join(here, 'fake-supabase.mjs'), sock, dbPort, '54340'], { stdio: 'inherit' });
const web = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/config.js') { res.setHeader('Content-Type', 'text/javascript');
    return res.end(fs.readFileSync(path.join(root, 'docs/config.js'), 'utf8').replace(/url: '[^']*'/, `url: '${API}'`).replace(/key: '[^']*'/, "key: 'test-anon-key'").replace(/pollMs: \d+/, 'pollMs: 600, chatPollMs: 500').replace(/deals: (true|false)/, 'deals: true').replace(/captchaSiteKey: '[^']*'/, "captchaSiteKey: ''")); }
  const f = path.join(root, 'docs', p === '/' ? 'index.html' : p);
  if (f === path.join(root, 'docs/index.html')) {
    const live = fs.readFileSync(path.join(root, 'docs/config.js'), 'utf8').match(/url: '([^']*)'/)[1];
    res.setHeader('Content-Type', 'text/html'); return res.end(fs.readFileSync(f, 'utf8').replace('connect-src ' + live + ';', 'connect-src ' + API + ';'));
  }
  if (!f.startsWith(path.join(root, 'docs')) || !fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
  res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream'); res.end(fs.readFileSync(f));
}).listen(WEB_PORT);
await new Promise((r) => setTimeout(r, 800));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
// A light street grid with a river, drawn in world pixels so neighbouring tiles line up (the app darkens light tiles itself).
const painter = await (await browser.newContext()).newPage();
async function tile(z, x, y) {
  const url = await painter.evaluate(([z, x, y]) => {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    const ox = x * 256, oy = y * 256;
    g.fillStyle = '#f2efe9'; g.fillRect(0, 0, 256, 256);   // OpenStreetMap's own colours: land, parks, water, roads
    g.fillStyle = '#c8facc';
    for (let i = -1; i < 3; i++) for (let j = -1; j < 3; j++) {
      const gx = Math.floor(ox / 240) + i, gy = Math.floor(oy / 240) + j;
      if (((gx * 7 + gy * 13) % 5 + 5) % 5 === 0) g.fillRect(gx * 240 - ox + 54, gy * 240 - oy + 54, 132, 84);
    }
    g.fillStyle = '#aad3df';
    for (let py = 0; py < 256; py += 2) { const wx = 900 - ((oy + py) % 3000) * 0.5 - (ox % 3000); for (let k = -1; k <= 1; k++) g.fillRect(wx + k * 3000, py, 70, 2); }
    const lines = (step, w, casing, col) => {
      for (const [lw, cs] of [[w + 2, casing], [w, col]]) {
        g.strokeStyle = cs; g.lineWidth = lw;
        for (let v = Math.floor(ox / step) * step; v < ox + 256 + step; v += step) { g.beginPath(); g.moveTo(v - ox, 0); g.lineTo(v - ox, 256); g.stroke(); }
        for (let v = Math.floor(oy / step) * step; v < oy + 256 + step; v += step) { g.beginPath(); g.moveTo(0, v - oy); g.lineTo(256, v - oy); g.stroke(); }
      }
    };
    lines(48, 4, '#cfcac0', '#ffffff'); lines(240, 8, '#c99a5e', '#fcd6a4');
    return c.toDataURL('image/png');
  }, [z, x, y]);
  return Buffer.from(url.split(',')[1], 'base64');
}
async function phone(name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'Australia/Perth' });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route(/tile\.openstreetmap\.org\/(\d+)\/(\d+)\/(\d+)/, async (r) => {
    const [, z, x, y] = r.request().url().match(/(\d+)\/(\d+)\/(\d+)\.png/).map(Number);
    r.fulfill({ contentType: 'image/png', body: await tile(z, x, y) });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(name + ': ' + e.message));
  return { name, ctx, page };
}
const has = (p, s, t = 6000) => p.page.waitForFunction((x) => document.body.innerText.toLowerCase().includes(x.toLowerCase()), s, { timeout: t });
const tap = (p, label) => p.page.getByRole('button', { name: label, exact: true }).first().click();
const tab = (p, t) => (t === 'You' ? p.page.locator('button.profile-btn') : p.page.locator(`nav button:has-text("${t}")`)).click();
const shot = async (p, file, scroll) => {
  await p.page.waitForTimeout(700);
  await p.page.evaluate(() => { document.getElementById('toast').hidden = true; });
  if (scroll !== undefined) await p.page.evaluate((s) => { const m = document.getElementById('view'); m.scrollTop = s === 'end' ? m.scrollHeight : s; }, scroll);
  await p.page.waitForTimeout(300);
  await p.page.screenshot({ path: path.join(out, file) });
  console.log('  saved ' + file);
};

try {
  const ana = await phone('Ana'), ben = await phone('Ben');
  await ana.page.goto(`http://127.0.0.1:${WEB_PORT}/`);
  await has(ana, 'Get started');
  await shot(ana, '1-welcome.png');
  await ana.page.fill('#name', 'Ana'); await ana.page.fill('#dob', '1995-04-12'); await tap(ana, 'Get started');
  await has(ana, 'Your status');
  await tab(ana, 'You'); await tap(ana, 'Send your invite link');
  const l = await ana.page.locator('#invite-link').innerText();
  await ben.page.goto(`http://127.0.0.1:${WEB_PORT}/` + l.slice(l.indexOf('?')));
  await ben.page.fill('#name', 'Jack'); await ben.page.fill('#dob', '1994-02-03'); await tap(ben, 'Get started');
  await has(ben, 'Your status');
  await tab(ana, 'Home'); await has(ana, 'wants to add you'); await tap(ana, 'Accept');
  await tap(ben, 'Green'); await tap(ana, 'Green');
  await has(ana, 'Up for it now');
  await shot(ana, '2-home.png');
  await tap(ana, 'Start a sesh'); await has(ana, 'Where to?');
  await tab(ben, 'Sesh'); await tap(ben, 'Join'); await has(ben, '2 in');
  for (const p of [ana, ben]) {
    await tab(p, 'Venues');
    await p.page.locator('.card', { hasText: 'The Paper Lantern' }).getByRole('button', { name: 'Open' }).click();
    await tap(p, "Vote for this in tonight's sesh");
    await has(p, 'Where to?');
  }
  await tap(ana, 'Lock in The Paper Lantern'); await has(ben, 'Locked in', 10000);
  const say = async (p, text) => { await p.page.fill('#chat-input', text); await tap(p, 'Send'); await has(p, text); };
  await say(ben, 'You keen for a sesh tonight?');
  await say(ana, "Yeah I'm keen");
  await say(ben, 'Sweet! The Paper Lantern has live music and free entry for groups. You down to head there?');
  await say(ana, "Yeah let's go. I'll meet you there in about 15 mins");
  await say(ben, 'Legend! See you there');
  await has(ana, 'Legend! See you there');
  await shot(ana, '3-sesh.png', 0);
  await shot(ana, '4-chat.png', 'end');
  await tab(ana, 'Venues');
  await ana.page.locator('.card', { hasText: 'The Paper Lantern' }).getByRole('button', { name: 'Open' }).click();
  await has(ana, 'Rate this venue');
  await shot(ana, '5-venue.png');
  await tab(ana, 'Map');
  await shot(ana, '6-map.png');
} catch (e) {
  console.log('crashed: ' + e.message);
  process.exitCode = 1;
} finally {
  await browser.close(); api.kill(); web.close();
  try { execSync(`runuser -u postgres -- /usr/lib/postgresql/16/bin/pg_ctl -D $(dirname ${sock})/data -m immediate stop`, { stdio: 'ignore', shell: '/bin/bash' }); } catch {}
}
