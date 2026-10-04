// Draws the phone app's icon and splash images: node tools/live/phone-icons.mjs
// Same Frenzy mark as the web app icon (tools/live/icon.html), at the sizes the App Store and Play Store want.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = (name) => path.join(here, '../../mobile/' + (name.startsWith('store/') ? '' : 'assets/'), name);
const BG = '#050506';
const FONT = 'brand/permanent-marker.woff2';
const page = path.join(here, '.phone-icon.html');

// The mark is drawn on a 512px tile, then scaled. bg: tile colour or transparent; scale: mark size inside the
// 1024px picture; white: draw everything white (Android's one-colour icon).
function picture({ bg, scale, white = false }) {
  return `<style>@font-face { font-family: 'Permanent Marker'; src: url(${FONT}) format('woff2'); }</style>
<body style="margin:0;background:transparent"><div id="p" style="width:1024px;height:1024px;background:${bg};display:flex;align-items:center;justify-content:center">
<div style="width:512px;height:512px;flex:none;transform:scale(${scale});display:flex;flex-direction:column;align-items:center;justify-content:center;gap:34px;${white ? 'filter:brightness(0) invert(1);' : ''}">
  <div style="position:relative;font:400 300px/1 'Permanent Marker',cursive;color:#fff;transform:rotate(-6deg);margin-top:20px">F<div style="position:absolute;left:-10%;right:-25%;bottom:6px;height:22px;border-radius:10px 30px 8px 24px;background:#F5C542;transform:skewX(-20deg)"></div></div>
  <div style="display:flex;gap:26px"><i style="width:44px;height:44px;border-radius:50%;background:#3DDC84"></i><i style="width:44px;height:44px;border-radius:50%;background:#F5C542"></i><i style="width:44px;height:44px;border-radius:50%;background:#F0524B"></i></div>
</div></div></body>`;
}

const pictures = [
  // App Store / home screen icon: square, no transparency.
  ['icon.png', picture({ bg: BG, scale: 2 })],
  // Android adaptive icon: the phone crops to a shape, so the mark stays inside the middle two thirds.
  ['android-icon-foreground.png', picture({ bg: 'transparent', scale: 1.25 })],
  ['android-icon-background.png', picture({ bg: BG, scale: 0 })],
  ['android-icon-monochrome.png', picture({ bg: 'transparent', scale: 1.25, white: true })],
  // Splash screen: the mark alone, shown on the dark background while the app opens.
  ['splash-icon.png', picture({ bg: 'transparent', scale: 1.6 })],
  ['favicon.png', picture({ bg: BG, scale: 2 }), 48],
  // Play Store listing icon.
  ['store/icon-512.png', picture({ bg: BG, scale: 2 }), 512],
];

// Play Store feature graphic (1024 x 500): the mark, the name and the line.
const feature = `<style>@font-face { font-family: 'Permanent Marker'; src: url(${FONT}) format('woff2'); }</style>
<body style="margin:0"><div id="p" style="width:1024px;height:500px;background:${BG};display:flex;align-items:center;gap:56px;padding:0 80px;box-sizing:border-box;font-family:'Permanent Marker',cursive;color:#fff">
<div style="font-size:300px;line-height:1;transform:rotate(-6deg);position:relative">F<div style="position:absolute;left:-10%;right:-25%;bottom:6px;height:22px;border-radius:10px 30px 8px 24px;background:#F5C542;transform:skewX(-20deg)"></div></div>
<div><div style="font-size:120px;line-height:1">Frenzy</div>
<div style="display:flex;gap:18px;margin:26px 0"><i style="width:34px;height:34px;border-radius:50%;background:#3DDC84"></i><i style="width:34px;height:34px;border-radius:50%;background:#F5C542"></i><i style="width:34px;height:34px;border-radius:50%;background:#F0524B"></i></div>
<div style="font:700 34px/1.2 system-ui,sans-serif;color:#d8d8dc">Get off the apps. Get out.</div></div>
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
