// Builds the phone app's code into one web page (tools/preview/dist/index.html)
// by swapping react-native for the browser stand-in in this folder.
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const result = await build({
  entryPoints: [resolve(here, 'entry.tsx')],
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: {
    'react-native': resolve(here, 'react-native.tsx'),
    '@react-native-async-storage/async-storage': resolve(here, 'async-storage.ts'),
  },
  nodePaths: (process.env.NODE_PATH || '').split(':').filter(Boolean),
});
const js = result.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Seshhon preview</title>' +
  '<style>html,body,#root{height:100%;margin:0}body{background:#121110}#root{display:flex;flex-direction:column;max-width:440px;margin:0 auto}button{border:0;padding:0}</style></head>' +
  '<body><div id="root"></div><script>' + js + '</script></body></html>';
mkdirSync(resolve(here, 'dist'), { recursive: true });
writeFileSync(resolve(here, 'dist/index.html'), html);
console.log('Built tools/preview/dist/index.html (' + Math.round(html.length / 1024) + ' KB)');
