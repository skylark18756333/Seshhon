// Draws the phone app's icon and splash images: node tools/live/phone-icons.mjs
// Same mark as the web app icon (tools/live/icon.html), at the sizes the App Store and Play Store want.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = (name) => path.join(here, '../../mobile/assets', name);

// size: picture size; circle: the green disc's diameter; bg: background (null = transparent); fg/disc colours.
function mark({ size, circle, bg, disc = '#3DDC84', ink = '#121110' }) {
  const font = Math.round(circle * 190 / 300), spacing = -Math.round(circle * 8 / 300);
  return `<body style="margin:0;background:transparent"><div id="i" style="width:${size}px;height:${size}px;background:${bg || 'transparent'};display:flex;align-items:center;justify-content:center"><div style="width:${circle}px;height:${circle}px;border-radius:50%;background:${disc};display:flex;align-items:center;justify-content:center;font:800 ${font}px/1 'Trebuchet MS',sans-serif;color:${ink};letter-spacing:${spacing}px">s</div></div></body>`;
}

const pictures = [
  // App Store / home screen icon: square, no transparency.
  ['icon.png', mark({ size: 1024, circle: 600, bg: '#121110' })],
  // Android adaptive icon: the phone crops to a shape, so the mark stays inside the middle two thirds.
  ['android-icon-foreground.png', mark({ size: 1024, circle: 520 })],
  ['android-icon-background.png', mark({ size: 1024, circle: 0, bg: '#121110' })],
  ['android-icon-monochrome.png', mark({ size: 1024, circle: 520, disc: 'transparent', ink: '#ffffff' })],
  // Splash screen: the mark alone, shown on the dark background while the app opens.
  ['splash-icon.png', mark({ size: 1024, circle: 1024 })],
  ['favicon.png', mark({ size: 48, circle: 40, bg: '#121110' })],
];

const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
for (const [name, html] of pictures) {
  const size = Number(html.match(/width:(\d+)px/)[1]);
  const p = await b.newPage({ viewport: { width: size, height: size } });
  await p.setContent(html);
  await p.locator('#i').screenshot({ path: out(name), omitBackground: true });
  await p.close();
}
await b.close();
