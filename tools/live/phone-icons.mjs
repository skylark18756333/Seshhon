// Draws the phone app's icon and splash images: node tools/live/phone-icons.mjs
// The Crewzy mark (three status lights: red, amber, green) at the sizes the App Store and Play Store want.
// The top of the app shows "Crewzy" with the same lights over "ewzy" (mobile/src/Logo.tsx).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = (name) => path.join(here, '../../mobile/' + (name.startsWith('store/') ? '' : 'assets/'), name);
const BG = '#050506';
const TILE = `radial-gradient(circle at 50% 50%,#15161B,${BG} 70%)`;
const FONT = '../../mobile/assets/fonts/Baloo2-ExtraBold.ttf';
const FACE = `<style>@font-face { font-family: 'Baloo 2'; src: url(${FONT}) format('truetype'); }</style>`;
const page = path.join(here, '.phone-icon.html');

// The mark: the three status lights in a row, red, amber and green from left to right, as on the Home switch
// and the dock. white: draw them white with no glow (Android's one-colour icon).
function lights({ white = false } = {}) {
  const light = (c) => `<i style="width:112px;height:112px;border-radius:50%;background:${white ? '#fff' : c};box-shadow:${white ? 'none' : `0 0 40px ${c},0 0 90px ${c}66`}"></i>`;
  return `<div style="display:flex;gap:34px">${light('#F0524B')}${light('#F5C542')}${light('#3DDC84')}</div>`;
}

// The mark is drawn on a 512px tile, then scaled. bg: tile background or transparent; scale: mark size inside
// the 1024px picture (0 draws the background only).
function picture({ bg, scale, white = false }) {
  return `<body style="margin:0;background:transparent"><div id="p" style="width:1024px;height:1024px;background:${bg};display:flex;align-items:center;justify-content:center">
<div style="width:512px;height:512px;flex:none;transform:scale(${scale});display:flex;align-items:center;justify-content:center">${scale ? lights({ white }) : ''}</div></div></body>`;
}

const pictures = [
  // App Store / home screen icon: square, no transparency. The name under it on the phone is the app name, Crewzy.
  ['icon.png', picture({ bg: TILE, scale: 1.5 })],
  // Android adaptive icon: the phone crops to a shape, so the mark stays inside the middle two thirds.
  ['android-icon-foreground.png', picture({ bg: 'transparent', scale: 1.05 })],
  ['android-icon-background.png', picture({ bg: TILE, scale: 0 })],
  ['android-icon-monochrome.png', picture({ bg: 'transparent', scale: 1.05, white: true })],
  // Splash screen: the mark alone, shown on the dark background while the app opens.
  ['splash-icon.png', picture({ bg: 'transparent', scale: 1.1 })],
  ['favicon.png', picture({ bg: TILE, scale: 1.7 }), 48],
  // Play Store listing icon.
  ['store/icon-512.png', picture({ bg: TILE, scale: 1.5 }), 512],
];

// Play Store feature graphic (1024 x 500): the name with the three lights, and the line.
const dot = (c) => `<i style="width:34px;height:34px;border-radius:50%;background:${c};box-shadow:0 0 22px ${c}"></i>`;
const feature = `${FACE}
<body style="margin:0"><div id="p" style="width:1024px;height:500px;background:radial-gradient(120% 90% at 50% 0%,#1a1b22,${BG} 70%);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;color:#fff">
<div style="display:flex;align-items:flex-end;gap:18px">
  <div style="font:800 168px/0.9 'Baloo 2',sans-serif;letter-spacing:-4px">Crewzy</div>
  <div style="display:flex;gap:14px;margin-bottom:34px">${dot('#F0524B')}${dot('#F5C542')}${dot('#3DDC84')}</div>
</div>
<div style="font:700 34px/1.2 system-ui,sans-serif;color:#d8d8dc">Get off the apps. Get out.</div>
</div></body>`;

const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
for (const [name, html, size = 1024] of pictures) {
  const p = await b.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: size / 1024 });
  fs.writeFileSync(page, html);
  await p.goto('file://' + page);
  await p.evaluate(() => document.fonts.ready);
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
