// Packs the web app (docs/) into one HTML page that ships inside the phone app: npm run bundle-web
// The phone app shows this copy instead of loading the website, so it opens without frendzy.au.
// Scripts, styles and fonts are put inline; the page's security policy is widened only by the exact
// hashes of those scripts. Output: web/app-html.generated.ts (not committed; made before every build).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mobile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = path.join(mobile, '../docs');
const read = (f) => fs.readFileSync(path.join(docs, f), 'utf8');
const dataUrl = (f, type) => `data:${type};base64,${fs.readFileSync(path.join(docs, f)).toString('base64')}`;

let html = read('index.html');
const hashes = [];
const script = (code) => {
  hashes.push(`'sha256-${crypto.createHash('sha256').update(code).digest('base64')}'`);
  return `<script>${code}</script>`;
};
const swap = (from, to) => {
  if (!html.includes(from)) throw new Error('bundle-web: docs/index.html no longer has ' + from);
  html = html.replace(from, () => to);
};

swap('<script src="load-config.js"></script>', script(read('config.js')));
swap('<script src="vendor/leaflet/leaflet.js"></script>', script(read('vendor/leaflet/leaflet.js')));
swap('<script src="load-app.js"></script>', ['hours.js', 'tour.js', 'app.js'].map((f) => script(read(f))).join('\n'));
swap('<link rel="stylesheet" href="vendor/leaflet/leaflet.css">', `<style>${read('vendor/leaflet/leaflet.css')}</style>`);
swap('<link rel="manifest" href="manifest.webmanifest">\n', '');
html = html.replace(/url\((fonts\/[\w.-]+\.woff2)\)/g, (_, f) => `url(${dataUrl(f, 'font/woff2')})`);
html = html.replace(/href="(icon-\d+\.png)"/g, (_, f) => `href="${dataUrl(f, 'image/png')}"`);

// The policy: inline scripts only by hash, and fonts from data: URLs.
const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
if (!csp) throw new Error('bundle-web: docs/index.html has no Content-Security-Policy');
const policy = csp[1]
  .replace("script-src 'self'", `script-src 'self' ${hashes.join(' ')}`)
  .replace("font-src 'self'", "font-src 'self' data:")
  .replace(/ ?manifest-src 'self';/, '');
html = html.replace(csp[1], () => policy);

const out = path.join(mobile, 'web/app-html.generated.ts');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, '// Made by scripts/bundle-web.mjs from docs/. Do not edit.\nexport default ' + JSON.stringify(html) + ';\n');
console.log(`bundle-web: ${out} (${Math.round(html.length / 1024)} KB)`);
