// Draws the phone app's icon and splash images: node tools/live/phone-icons.mjs
// Same Frendzy mark as the web app icon (tools/live/icon.html): a neon speech bubble holding the
// green / amber / red status lights, at the sizes the App Store and Play Store want.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = (name) => path.join(here, '../../mobile/' + (name.startsWith('store/') ? '' : 'assets/'), name);
const BG = '#050506';
const TILE = `radial-gradient(circle at 50% 50%,#15161B,${BG} 70%)`;
const FONT = '../../docs/fonts/tilt-neon-latin-400-normal.woff2';
const page = path.join(here, '.phone-icon.html');

// The bubble, as in icon.html. white: draw everything white (Android's one-colour icon).
function bubble({ white = false } = {}) {
  const light = (c) => `<i style="width:76px;height:76px;border-radius:50%;background:${white ? '#fff' : c};box-shadow:0 0 34px ${white ? 'transparent' : c}"></i>`;
  const glow = white ? 'none' : '0 0 30px rgba(255,255,255,.7),0 0 70px rgba(255,255,255,.25),inset 0 0 26px rgba(255,255,255,.35)';
  return `<div style="display:flex;gap:30px;padding:42px 46px;border:12px solid #fff;border-radius:120px 120px 120px 34px;box-shadow:${glow}">
  ${light('#3DDC84')}${light('#F5C542')}${light('#F0524B')}</div>`;
}

// The mark is drawn on a 512px tile, then scaled. bg: tile background or transparent; scale: mark size inside
// the 1024px picture.
function picture({ bg, scale, white = false }) {
  return `<body style="margin:0;background:transparent"><div id="p" style="width:1024px;height:1024px;background:${bg};display:flex;align-items:center;justify-content:center">
<div style="width:512px;height:512px;flex:none;transform:scale(${scale});display:flex;align-items:center;justify-content:center">${scale ? bubble({ white }) : ''}</div></div></body>`;
}

const pictures = [
  // App Store / home screen icon: square, no transparency.
  ['icon.png', picture({ bg: TILE, scale: 2 })],
  // Android adaptive icon: the phone crops to a shape, so the mark stays inside the middle two thirds.
  ['android-icon-foreground.png', picture({ bg: 'transparent', scale: 1.3 })],
  ['android-icon-background.png', picture({ bg: TILE, scale: 0 })],
  ['android-icon-monochrome.png', picture({ bg: 'transparent', scale: 1.3, white: true })],
  // Splash screen: the mark alone, shown on the dark background while the app opens.
  ['splash-icon.png', picture({ bg: 'transparent', scale: 1.4 })],
  ['favicon.png', picture({ bg: TILE, scale: 2 }), 48],
  // Play Store listing icon.
  ['store/icon-512.png', picture({ bg: TILE, scale: 2 }), 512],
];

// Play Store feature graphic (1024 x 500): the glowing name, the bubble and the line.
const feature = `<style>@font-face { font-family: 'Tilt Neon'; src: url(${FONT}) format('woff2'); }</style>
<body style="margin:0"><div id="p" style="width:1024px;height:500px;background:radial-gradient(120% 90% at 50% 0%,#1a1b22,${BG} 70%);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:30px;color:#fff">
<div style="display:flex;align-items:center;gap:44px">
  <div style="font:400 150px/1 'Tilt Neon',sans-serif;padding-bottom:18px;text-shadow:0 0 8px rgba(255,255,255,.9),0 0 26px rgba(255,255,255,.55),0 0 60px rgba(255,255,255,.3)">frendzy</div>
  <div style="width:512px;height:512px;margin:-170px -160px;transform:scale(.4);display:flex;align-items:center;justify-content:center">${bubble()}</div>
</div>
<div style="font:700 34px/1.2 system-ui,sans-serif;color:#d8d8dc">Get off the apps. Get out.</div>
</div></body>`;

const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
for (const [name, html, size = 1024] of pictures) {
  const p = await b.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: size / 1024 });
  fs.writeFileSync(page, html);
  await p.goto('file://' + page);
  await p.locator('#p').screenshot({ path: out(name), omitBackground: true });
  await p.close();
}
{
  const p = await b.newPage({ viewport: { width: 1024, height: 500 } });
  fs.writeFileSync(page, feature);
  await p.goto('file://' + page);
  await p.evaluate(() => document.fonts.ready);
  await p.locator('#p').screenshot({ path: out('store/feature-graphic.png') });
  await p.close();
}
await b.close();
fs.unlinkSync(page);
