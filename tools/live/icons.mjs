// Draws the home-screen icons: node tools/live/icons.mjs
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 512, height: 512 } });
await p.goto('file://' + path.join(here, 'icon.html'));
const el = p.locator('#i');
await el.screenshot({ path: path.join(here, '../../docs/icon-512.png') });
for (const [size, name] of [[192, 'icon-192.png'], [180, 'icon-180.png']]) {
  await p.setViewportSize({ width: 512, height: 512 });
  await p.evaluate((s) => { document.getElementById('i').style.zoom = s / 512; }, size);
  await p.setViewportSize({ width: size, height: size });
  await p.locator('#i').screenshot({ path: path.join(here, '../../docs/' + name) });
  await p.evaluate(() => { document.getElementById('i').style.zoom = 1; });
}
await b.close();
